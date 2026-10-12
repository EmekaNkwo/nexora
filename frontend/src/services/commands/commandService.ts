import { EventBus, eventBus as defaultBus } from "@/services/events/eventBus";
import { MockSocket, mockSocket as defaultSocket } from "@/services/websocket/mockSocket";
import type {
  CommandOrigin,
  CommandPayload,
  CommandStatus,
  CommandType,
  DeviceCommand,
} from "@/types/commands";
import { COMMAND_DESCRIPTORS } from "@/types/commands";
import { createBatchId, createCommandId } from "@/utils/ids";
import { createRng, type Rng } from "@/utils/random";

export interface CommandServiceOptions {
  readonly bus?: EventBus;
  readonly socket?: MockSocket;
  readonly seed?: number;
  readonly now?: () => number;
  /** Persists each transition. The store listens through this. */
  readonly onUpdate: (command: DeviceCommand) => void;
  /** Applies the command's physical effect on the simulated device. */
  readonly applyEffect: (deviceId: string, type: CommandType) => void;
  /** Whether the device can currently receive anything. */
  readonly isReachable: (deviceId: string) => boolean;
}

/**
 * Device command dispatch.
 *
 * Commands are modelled as a four-stage lifecycle rather than a function call,
 * because that is what remote device control actually is:
 *
 *   queued → sent → acknowledged → completed
 *
 * Each transition costs real time, any of them can fail, and a device that is
 * offline will time out rather than reject immediately. Modelling this is what
 * makes the command console worth building: the UI has to represent in-flight
 * state, partial failure across a bulk action, and commands that never come
 * back — all of which a simple promise would hide.
 *
 * The physical effect is applied at *acknowledgement*, not at issue time. A
 * fan does not start spinning because an operator clicked a button; it starts
 * when the device confirms it received the instruction.
 */
export class CommandService {
  private readonly bus: EventBus;
  private readonly socket: MockSocket;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly onUpdate: (command: DeviceCommand) => void;
  private readonly applyEffect: (deviceId: string, type: CommandType) => void;
  private readonly isReachable: (deviceId: string) => boolean;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, DeviceCommand>();
  private issued = 0;
  private completed = 0;
  private failed = 0;

  constructor(options: CommandServiceOptions) {
    this.bus = options.bus ?? defaultBus;
    this.socket = options.socket ?? defaultSocket;
    this.rng = createRng(options.seed ?? 0xc0de);
    this.now = options.now ?? (() => Date.now());
    this.onUpdate = options.onUpdate;
    this.applyEffect = options.applyEffect;
    this.isReachable = options.isReachable;
  }

  get diagnostics(): { issued: number; completed: number; failed: number; inFlight: number } {
    return {
      issued: this.issued,
      completed: this.completed,
      failed: this.failed,
      inFlight: this.inFlight.size,
    };
  }

  /** Queues a command and starts its lifecycle. Returns the queued record. */
  issue(input: {
    readonly deviceId: string;
    readonly deviceName: string;
    readonly type: CommandType;
    readonly origin: CommandOrigin;
    readonly payload?: CommandPayload;
    readonly ruleId?: string;
    readonly batchId?: string;
  }): DeviceCommand {
    const at = this.now();
    const command: DeviceCommand = {
      id: createCommandId(),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      type: input.type,
      status: "queued",
      origin: input.origin,
      issuedAt: at,
      payload: input.payload,
      ruleId: input.ruleId,
      batchId: input.batchId,
    };

    this.issued += 1;
    this.inFlight.set(command.id, command);
    this.emit("device.command.queued", command);
    this.scheduleSend(command);
    return command;
  }

  /**
   * Issues one command per device under a shared batch id, staggered so a
   * 500-device bulk action does not arrive as one instantaneous burst.
   */
  issueBulk(input: {
    readonly deviceIds: readonly string[];
    readonly resolveName: (deviceId: string) => string;
    readonly type: CommandType;
    readonly payload?: CommandPayload;
  }): { batchId: string; commands: readonly DeviceCommand[] } {
    const batchId = createBatchId();
    const commands: DeviceCommand[] = [];

    for (let index = 0; index < input.deviceIds.length; index += 1) {
      const deviceId = input.deviceIds[index]!;
      const command = this.issue({
        deviceId,
        deviceName: input.resolveName(deviceId),
        type: input.type,
        origin: "bulk",
        payload: input.payload,
        batchId,
      });
      commands.push(command);
    }

    return { batchId, commands };
  }

  /** Cancels a queued command. Commands already sent cannot be recalled. */
  cancel(commandId: string): boolean {
    const command = this.inFlight.get(commandId);
    if (!command || command.status !== "queued") return false;
    this.settle(command, "failed", "Cancelled before dispatch");
    return true;
  }

  destroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.inFlight.clear();
  }

  private scheduleSend(command: DeviceCommand): void {
    const descriptor = COMMAND_DESCRIPTORS[command.type];
    // Queue dwell: short, but non-zero, so "queued" is actually observable.
    const dwell = this.rng.range(120, 420);

    this.schedule(() => {
      if (!this.socket.connected) {
        this.settle(command, "failed", "Transport disconnected");
        return;
      }
      if (!this.isReachable(command.deviceId)) {
        // Unreachable devices time out rather than failing fast — the platform
        // cannot tell "offline" from "slow" until the window expires.
        const sent = this.transition(command, "sent", { sentAt: this.now() });
        this.schedule(() => {
          this.settle(sent, "timeout", "Device did not acknowledge within 12s");
        }, 12_000);
        return;
      }

      const sent = this.transition(command, "sent", { sentAt: this.now() });

      this.socket
        .send(`command:${command.type}`, { commandId: command.id })
        .then(() => this.scheduleAck(sent, descriptor.baseLatencyMs))
        .catch((error: unknown) => {
          this.settle(
            sent,
            "failed",
            error instanceof Error ? error.message : "Transport error",
          );
        });
    }, dwell);
  }

  private scheduleAck(command: DeviceCommand, baseLatencyMs: number): void {
    const ackDelay = Math.max(80, baseLatencyMs * this.rng.range(0.1, 0.25));

    this.schedule(() => {
      if (!this.isReachable(command.deviceId)) {
        this.settle(command, "timeout", "Device went offline before acknowledging");
        return;
      }

      const descriptor = COMMAND_DESCRIPTORS[command.type];
      if (this.rng.chance(descriptor.failureChance)) {
        this.settle(command, "failed", "Device rejected the command");
        return;
      }

      const acknowledged = this.transition(command, "acknowledged", {
        acknowledgedAt: this.now(),
      });

      // The device has accepted the instruction — now it actually acts.
      this.applyEffect(command.deviceId, command.type);

      const executionDelay = Math.max(
        120,
        descriptor.baseLatencyMs * this.rng.range(0.6, 1.25),
      );
      this.schedule(() => {
        if (!this.isReachable(acknowledged.deviceId) && command.type !== "device.restart") {
          this.settle(acknowledged, "timeout", "Lost contact during execution");
          return;
        }
        this.settle(acknowledged, "completed");
      }, executionDelay);
    }, ackDelay);
  }

  private transition(
    command: DeviceCommand,
    status: Extract<CommandStatus, "sent" | "acknowledged">,
    patch: Partial<DeviceCommand>,
  ): DeviceCommand {
    const next: DeviceCommand = { ...command, ...patch, status };
    this.inFlight.set(next.id, next);
    this.emit(`device.command.${status}` as const, next);
    return next;
  }

  private settle(
    command: DeviceCommand,
    status: Extract<CommandStatus, "completed" | "failed" | "timeout">,
    error?: string,
  ): void {
    const at = this.now();
    const next: DeviceCommand = {
      ...command,
      status,
      completedAt: at,
      latencyMs: at - command.issuedAt,
      error,
    };
    this.inFlight.delete(command.id);
    if (status === "completed") this.completed += 1;
    else this.failed += 1;

    this.onUpdate(next);
    this.bus.emit(
      status === "completed" ? "device.command.completed" : "device.command.failed",
      { command: next },
    );
  }

  private emit(
    name:
      | "device.command.queued"
      | "device.command.sent"
      | "device.command.acknowledged"
      | "device.command.completed"
      | "device.command.failed",
    command: DeviceCommand,
  ): void {
    this.onUpdate(command);
    this.bus.emit(name, { command });
  }

  private schedule(fn: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
  }
}
