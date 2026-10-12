import type { EventBus } from "@/services/events/eventBus";
import { FIRMWARE_STAGE_LABELS } from "@/types/firmware";
import { COMMAND_DESCRIPTORS } from "@/types/commands";
import { PROVISION_STAGE_LABELS } from "@/services/provisioning/provisioningService";
import type { ActivityEntry } from "@/types/activity";
import type { Unsubscribe } from "@/types/events";
import { createActivityId } from "@/utils/ids";
import { formatMetricValue } from "@/utils/formatting";

/**
 * Event bus → activity feed.
 *
 * Subscribes to specific, *notable* events rather than using the bus's
 * wildcard. That distinction matters: telemetry batches fire several times a
 * second and would bury everything an operator actually needs to see. Routine
 * telemetry is summarised into the KPI tiles instead; the feed is reserved for
 * things a human would want to know happened.
 *
 * Entries are buffered and flushed on an interval so a burst of twenty events
 * in one tick costs one render rather than twenty.
 */

export interface ActivityFeedOptions {
  readonly bus: EventBus;
  readonly flush: (entries: readonly ActivityEntry[]) => void;
  readonly resolveDeviceName: (deviceId: string) => string;
  readonly flushIntervalMs?: number;
}

export class ActivityFeedBridge {
  private readonly options: ActivityFeedOptions;
  private buffer: ActivityEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private readonly flushIntervalMs: number;

  constructor(options: ActivityFeedOptions) {
    this.options = options;
    this.flushIntervalMs = options.flushIntervalMs ?? 400;
  }

  start(): void {
    if (this.unsubscribe) return;
    const bus = this.options.bus;

    this.unsubscribe = bus.onMany({
      "device.offline": ({ deviceId, at, reason }) => {
        this.push({
          at,
          kind: "connectivity",
          severity: "warning",
          subject: deviceId,
          message:
            reason === "injected"
              ? "Device went offline (operator-injected failure)"
              : reason === "power"
                ? "Device went offline — battery depleted"
                : reason === "network-outage"
                  ? "Device went offline — regional network outage"
                  : "Device went offline — signal lost",
          deviceId,
          sourceEvent: "device.offline",
        });
      },

      "device.online": ({ deviceId, at }) => {
        this.push({
          at,
          kind: "connectivity",
          severity: "success",
          subject: deviceId,
          message: "Device reconnected and resumed reporting",
          deviceId,
          sourceEvent: "device.online",
        });
      },

      "alert.created": ({ alert }) => {
        this.push({
          at: alert.createdAt,
          kind: "alert",
          severity: alert.severity === "critical" ? "critical" : "warning",
          subject: alert.deviceId,
          message:
            alert.metric && alert.value !== undefined
              ? `${alert.title} — ${formatMetricValue(alert.metric, alert.value)}`
              : alert.title,
          deviceId: alert.deviceId,
          alertId: alert.id,
          ruleId: alert.ruleId,
          sourceEvent: "alert.created",
        });
      },

      "alert.resolved": ({ alert }) => {
        this.push({
          at: alert.resolvedAt ?? alert.updatedAt,
          kind: "alert",
          severity: "success",
          subject: alert.deviceId,
          message: `Alert resolved: ${alert.title}`,
          deviceId: alert.deviceId,
          alertId: alert.id,
          sourceEvent: "alert.resolved",
        });
      },

      "rule.triggered": ({ trigger }) => {
        const actions = trigger.actions.map((action) => action.summary).join(", ");
        this.push({
          at: trigger.triggeredAt,
          kind: "rule",
          severity: "warning",
          subject: `Rule "${trigger.ruleName}"`,
          message: `Triggered on ${trigger.deviceId} → ${actions || "no actions"}`,
          deviceId: trigger.deviceId,
          ruleId: trigger.ruleId,
          sourceEvent: "rule.triggered",
        });
      },

      // Only the terminal command transitions reach the feed. Queued and sent
      // are visible in the command console, where they belong.
      "device.command.completed": ({ command }) => {
        this.push({
          at: command.completedAt ?? Date.now(),
          kind: "command",
          severity: "success",
          subject: command.deviceId,
          message: `${COMMAND_DESCRIPTORS[command.type].label} completed${
            command.origin === "rule" ? " (issued by rule)" : ""
          }`,
          deviceId: command.deviceId,
          ruleId: command.ruleId,
          sourceEvent: "device.command.completed",
        });
      },

      "device.command.failed": ({ command }) => {
        this.push({
          at: command.completedAt ?? Date.now(),
          kind: "command",
          severity: "critical",
          subject: command.deviceId,
          message: `${COMMAND_DESCRIPTORS[command.type].label} failed — ${command.error ?? "unknown error"}`,
          deviceId: command.deviceId,
          sourceEvent: "device.command.failed",
        });
      },

      "device.firmware.updated": ({ deviceId, version, at }) => {
        this.push({
          at,
          kind: "firmware",
          severity: "success",
          subject: deviceId,
          message: `Firmware update to ${version} completed`,
          deviceId,
          sourceEvent: "device.firmware.updated",
        });
      },

      "device.firmware.failed": ({ deviceId, error, at }) => {
        this.push({
          at,
          kind: "firmware",
          severity: "critical",
          subject: deviceId,
          message: `Firmware update failed — ${error}`,
          deviceId,
          sourceEvent: "device.firmware.failed",
        });
      },

      "device.provisioned": ({ device }) => {
        this.push({
          at: device.createdAt,
          kind: "provisioning",
          severity: "success",
          subject: device.id,
          message: `Device provisioned at ${device.location.site} and came online`,
          deviceId: device.id,
          sourceEvent: "device.provisioned",
        });
      },

      "device.provisioning.progress": ({ job }) => {
        // Only the failure is notable; successful stages stream in the dialog.
        if (job.stage !== "failed") return;
        this.push({
          at: Date.now(),
          kind: "provisioning",
          severity: "critical",
          subject: job.request.id,
          message: `Provisioning failed — ${job.error ?? PROVISION_STAGE_LABELS.failed}`,
          sourceEvent: "device.provisioning.progress",
        });
      },

      "device.mode.changed": ({ deviceId, mode, at }) => {
        this.push({
          at,
          kind: "status",
          severity: "info",
          subject: deviceId,
          message: `Device mode changed to ${mode}`,
          deviceId,
          sourceEvent: "device.mode.changed",
        });
      },

      "system.network.outage": ({ at, affectedDevices, durationMs }) => {
        this.push({
          at,
          kind: "system",
          severity: "critical",
          subject: "Network",
          message: `Regional outage — ${affectedDevices} devices unreachable for ~${Math.round(durationMs / 1000)}s`,
          sourceEvent: "system.network.outage",
        });
      },

      "system.network.restored": ({ at }) => {
        this.push({
          at,
          kind: "system",
          severity: "success",
          subject: "Network",
          message: "Regional connectivity restored",
          sourceEvent: "system.network.restored",
        });
      },

      "simulation.started": ({ at, deviceCount }) => {
        this.push({
          at,
          kind: "simulation",
          severity: "info",
          subject: "Simulator",
          message: `Simulation started with ${deviceCount.toLocaleString("en-US")} devices`,
          sourceEvent: "simulation.started",
        });
      },

      "simulation.stopped": ({ at }) => {
        this.push({
          at,
          kind: "simulation",
          severity: "info",
          subject: "Simulator",
          message: "Simulation stopped",
          sourceEvent: "simulation.stopped",
        });
      },

      "simulation.reset": ({ at }) => {
        this.push({
          at,
          kind: "simulation",
          severity: "info",
          subject: "Simulator",
          message: "Simulation reset — fleet regenerated",
          sourceEvent: "simulation.reset",
        });
      },

      "socket.disconnected": ({ at, reason }) => {
        this.push({
          at,
          kind: "system",
          severity: "warning",
          subject: "Transport",
          message: `Telemetry socket disconnected — ${reason}`,
          sourceEvent: "socket.disconnected",
        });
      },

      "socket.connected": ({ at }) => {
        this.push({
          at,
          kind: "system",
          severity: "success",
          subject: "Transport",
          message: "Telemetry socket connected",
          sourceEvent: "socket.connected",
        });
      },
    });

    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /** Appends externally produced entries (e.g. from the ingestion pipeline). */
  append(entries: readonly ActivityEntry[]): void {
    if (entries.length === 0) return;
    this.buffer.push(...entries);
  }

  private push(entry: Omit<ActivityEntry, "id">): void {
    this.buffer.push({ ...entry, id: createActivityId() });
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    // Newest first, matching how the feed renders.
    const entries = this.buffer.sort((a, b) => b.at - a.at);
    this.buffer = [];
    this.options.flush(entries);
  }
}

/** Stage caption used by the firmware rows in the feed and rollout list. */
export { FIRMWARE_STAGE_LABELS };
