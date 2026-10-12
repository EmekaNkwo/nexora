import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandService } from "@/services/commands/commandService";
import { EventBus } from "@/services/events/eventBus";
import { MockSocket } from "@/services/websocket/mockSocket";
import type { CommandStatus, CommandType, DeviceCommand } from "@/types/commands";
import { resetIdCounters } from "@/utils/ids";

const START = Date.UTC(2026, 3, 1, 12, 0, 0);

interface Harness {
  service: CommandService;
  bus: EventBus;
  socket: MockSocket;
  updates: DeviceCommand[];
  events: string[];
  effects: { deviceId: string; type: CommandType }[];
  setReachable: (reachable: boolean) => void;
  /** Statuses a command passed through, in order. */
  trail: (commandId: string) => CommandStatus[];
}

function createHarness(options: { seed?: number; reachable?: boolean } = {}): Harness {
  const bus = new EventBus();
  const socket = new MockSocket({
    bus,
    baseLatencyMs: 10,
    jitterMs: 0,
    dropRate: 0,
    handshakeMs: 0,
    seed: 1,
  });
  socket.connect();
  vi.advanceTimersByTime(1);

  let reachable = options.reachable ?? true;
  const updates: DeviceCommand[] = [];
  const events: string[] = [];
  const effects: { deviceId: string; type: CommandType }[] = [];

  bus.onAny((envelope) => {
    if (envelope.name.startsWith("device.command.")) events.push(envelope.name);
  });

  const service = new CommandService({
    bus,
    socket,
    seed: options.seed ?? 4242,
    now: () => Date.now(),
    onUpdate: (command) => updates.push(command),
    applyEffect: (deviceId, type) => effects.push({ deviceId, type }),
    isReachable: () => reachable,
  });

  return {
    service,
    bus,
    socket,
    updates,
    events,
    effects,
    setReachable: (value) => {
      reachable = value;
    },
    trail: (commandId) =>
      updates.filter((command) => command.id === commandId).map((command) => command.status),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  resetIdCounters();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CommandService lifecycle", () => {
  it("walks a command through queued → sent → acknowledged → completed", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    expect(command.status).toBe("queued");

    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.trail(command.id)).toEqual([
      "queued",
      "sent",
      "acknowledged",
      "completed",
    ]);
  });

  it("emits a bus event for each transition", async () => {
    const harness = createHarness();
    harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.events).toEqual([
      "device.command.queued",
      "device.command.sent",
      "device.command.acknowledged",
      "device.command.completed",
    ]);
  });

  it("records timestamps for each stage", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "device.calibrate",
      origin: "operator",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(final.status).toBe("completed");
    expect(final.sentAt).toBeGreaterThanOrEqual(final.issuedAt);
    expect(final.acknowledgedAt).toBeGreaterThanOrEqual(final.sentAt!);
    expect(final.completedAt).toBeGreaterThanOrEqual(final.acknowledgedAt!);
    expect(final.latencyMs).toBeGreaterThan(0);
  });

  it("applies the physical effect at acknowledgement, not at issue time", async () => {
    const harness = createHarness();
    harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    // A fan does not spin because a button was clicked.
    expect(harness.effects).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.effects).toEqual([{ deviceId: "LAG-2048", type: "fan.on" }]);
  });

  it("does not take effect at all if the command never reaches the device", async () => {
    const harness = createHarness({ reachable: false });
    harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "device.restart",
      origin: "operator",
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(harness.effects).toHaveLength(0);
  });
});

describe("CommandService failure modes", () => {
  it("times out against an unreachable device rather than failing instantly", async () => {
    const harness = createHarness({ reachable: false });
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    // Sent, then silence — the platform cannot distinguish offline from slow.
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.trail(command.id)).toEqual(["queued", "sent"]);

    await vi.advanceTimersByTimeAsync(13_000);
    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(final.status).toBe("timeout");
    expect(final.error).toMatch(/did not acknowledge/);
  });

  it("fails when the device goes offline mid-flight", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "device.calibrate",
      origin: "operator",
    });

    await vi.advanceTimersByTimeAsync(400);
    harness.setReachable(false);
    await vi.advanceTimersByTimeAsync(20_000);

    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(["timeout", "failed"]).toContain(final.status);
  });

  it("fails when the transport is disconnected before dispatch", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    harness.socket.disconnect("test");
    await vi.advanceTimersByTimeAsync(10_000);

    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(final.status).toBe("failed");
    expect(final.error).toMatch(/disconnected/i);
  });

  it("cancels a queued command but not one already sent", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });

    expect(harness.service.cancel(command.id)).toBe(true);
    const cancelled = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(cancelled.status).toBe("failed");
    expect(cancelled.error).toMatch(/Cancelled/);

    const second = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "operator",
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.service.cancel(second.id)).toBe(false);
  });

  it("eventually fails some commands given a non-zero rejection chance", async () => {
    const harness = createHarness({ seed: 7 });
    for (let index = 0; index < 120; index += 1) {
      harness.service.issue({
        deviceId: `LAG-${index}`,
        deviceName: `Device ${index}`,
        type: "device.calibrate",
        origin: "operator",
      });
    }

    await vi.advanceTimersByTimeAsync(60_000);

    const finals = new Map<string, DeviceCommand>();
    for (const update of harness.updates) finals.set(update.id, update);
    const statuses = [...finals.values()].map((command) => command.status);

    expect(statuses.filter((status) => status === "completed").length).toBeGreaterThan(80);
    expect(statuses.filter((status) => status === "failed").length).toBeGreaterThan(0);
  });
});

describe("CommandService bulk operations", () => {
  it("issues one command per device under a shared batch id", async () => {
    const harness = createHarness();
    const { batchId, commands } = harness.service.issueBulk({
      deviceIds: ["LAG-1", "LAG-2", "LAG-3"],
      resolveName: (deviceId) => `Device ${deviceId}`,
      type: "device.restart",
    });

    expect(commands).toHaveLength(3);
    expect(commands.every((command) => command.batchId === batchId)).toBe(true);
    expect(commands.map((command) => command.deviceId)).toEqual([
      "LAG-1",
      "LAG-2",
      "LAG-3",
    ]);
    expect(commands.every((command) => command.origin === "bulk")).toBe(true);
  });

  it("settles every command in a bulk batch", async () => {
    const harness = createHarness();
    const { commands } = harness.service.issueBulk({
      deviceIds: Array.from({ length: 25 }, (_, index) => `LAG-${index}`),
      resolveName: (deviceId) => deviceId,
      type: "fan.on",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    for (const command of commands) {
      const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
      expect(["completed", "failed", "timeout"]).toContain(final.status);
    }
    expect(harness.service.diagnostics.inFlight).toBe(0);
  });
});

describe("CommandService provenance", () => {
  it("records the rule that issued a command", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "fan.on",
      origin: "rule",
      ruleId: "rule-cold-critical",
    });

    expect(command.origin).toBe("rule");
    expect(command.ruleId).toBe("rule-cold-critical");

    await vi.advanceTimersByTimeAsync(10_000);
    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(final.ruleId).toBe("rule-cold-critical");
  });

  it("carries a payload through the lifecycle", async () => {
    const harness = createHarness();
    const command = harness.service.issue({
      deviceId: "LAG-2048",
      deviceName: "Cold Chain 2048",
      type: "device.set_mode",
      origin: "operator",
      payload: { mode: "eco" },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const final = harness.updates.filter((entry) => entry.id === command.id).at(-1)!;
    expect(final.payload).toEqual({ mode: "eco" });
  });

  it("tracks issued, completed and in-flight counts", async () => {
    const harness = createHarness();
    harness.service.issue({
      deviceId: "LAG-1",
      deviceName: "A",
      type: "fan.on",
      origin: "operator",
    });
    expect(harness.service.diagnostics.issued).toBe(1);
    expect(harness.service.diagnostics.inFlight).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.service.diagnostics.completed).toBe(1);
    expect(harness.service.diagnostics.inFlight).toBe(0);
  });
});
