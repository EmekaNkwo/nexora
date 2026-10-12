import type { AlertEngine } from "@/services/alerts/alertEngine";
import type { RuleEngine } from "@/services/rules/ruleEngine";
import type { TelemetryRepository } from "@/services/telemetry/telemetryRepository";
import {
  evaluateSnapshot,
  resolveThresholds,
  worstLevel,
  type ThresholdProfile,
} from "@/services/telemetry/thresholds";
import type { ActivityEntry } from "@/types/activity";
import type { Device, DevicePatch, DeviceStatus } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { TelemetryFrame } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import { calculateHealthScore } from "@/utils/calculations/health";
import {
  deriveStatus,
  describeStatusChange,
  isLifecycleStatus,
} from "@/utils/calculations/status";
import { coefficientOfVariation } from "@/utils/calculations/stats";
import { createActivityId } from "@/utils/ids";

/**
 * The telemetry ingestion pipeline.
 *
 * This is the hinge of the whole platform — the step that turns a raw frame
 * into everything the UI shows:
 *
 *   frame → ring buffer → thresholds → status → health → patch
 *                            ↓                              ↓
 *                     alert engine                     device store
 *                            ↓
 *                       rule engine → commands / alerts / state changes
 *
 * Three properties are deliberate:
 *
 * - **Pure, batch-shaped.** `ingestBatch` takes a batch and returns the patches
 *   and activity entries it produced rather than writing to stores itself. The
 *   caller commits once per batch, so a 400-frame tick costs one store write.
 *   It also means the whole pipeline is testable without a React tree.
 *
 * - **Status is derived, never trusted.** The simulator reports physics; this
 *   layer decides what that means. Lifecycle assertions (`maintenance`,
 *   `updating`) are respected so a rollout does not look like an incident.
 *
 * - **Thresholds are read per frame.** Resolving them per snapshot rather than
 *   caching means an operator lowering a threshold sees devices change status
 *   on the very next frame.
 */

export interface IngestionDependencies {
  readonly repository: TelemetryRepository;
  readonly alertEngine: AlertEngine;
  readonly ruleEngine: RuleEngine;
  /** Current device records. Read-only — the pipeline never mutates them. */
  readonly getDevice: (deviceId: string) => Device | undefined;
  readonly getLifecycle: (
    deviceId: string,
  ) => Extract<DeviceStatus, "maintenance" | "updating"> | undefined;
  /** Connection epoch, if the transport has reported a disconnect. */
  readonly getOfflineSince: (deviceId: string) => number | undefined;
  readonly getThresholdProfiles: () => readonly ThresholdProfile[];
  readonly getOpenAlertCount: (deviceId: string) => number;
  readonly getCriticalAlertCount: (deviceId: string) => number;
}

export interface IngestionResult {
  readonly patches: readonly DevicePatch[];
  readonly activity: readonly ActivityEntry[];
  readonly frameCount: number;
}

const EMPTY_RESULT: IngestionResult = { patches: [], activity: [], frameCount: 0 };

export class IngestionPipeline {
  private readonly deps: IngestionDependencies;
  private framesProcessed = 0;
  private statusChanges = 0;
  private staleFramesDropped = 0;

  constructor(deps: IngestionDependencies) {
    this.deps = deps;
  }

  get diagnostics(): {
    frames: number;
    statusChanges: number;
    staleFramesDropped: number;
  } {
    return {
      frames: this.framesProcessed,
      statusChanges: this.statusChanges,
      staleFramesDropped: this.staleFramesDropped,
    };
  }

  /** Processes a whole batch and returns the resulting store writes. */
  ingestBatch(frames: readonly TelemetryFrame[], now: number): IngestionResult {
    if (frames.length === 0) return EMPTY_RESULT;

    // Buffers first: the health calculation reads recent history back out, so
    // the newest sample must already be in the ring.
    this.deps.repository.ingestBatch(frames);

    const profiles = this.deps.getThresholdProfiles();
    const patches: DevicePatch[] = [];
    const activity: ActivityEntry[] = [];

    for (const frame of frames) {
      const device = this.deps.getDevice(frame.deviceId);
      if (!device) continue;
      this.framesProcessed += 1;
      this.processFrame(frame, device, profiles, now, patches, activity);
    }

    return { patches, activity, frameCount: frames.length };
  }

  /** Single out-of-band frame, e.g. a `telemetry.request` response. */
  ingestFrame(frame: TelemetryFrame, now: number): IngestionResult {
    return this.ingestBatch([frame], now);
  }

  private processFrame(
    frame: TelemetryFrame,
    device: Device,
    profiles: readonly ThresholdProfile[],
    now: number,
    patches: DevicePatch[],
    activity: ActivityEntry[],
  ): void {
    // Discard frames belonging to a connection that has already ended. The
    // transport has real jitter, so a frame published just before a disconnect
    // can arrive just after it — and that frame carries `connected: true`, so
    // applying it would silently resurrect a device the platform knows is
    // unreachable.
    //
    // The comparison is inclusive: a frame stamped in the very millisecond of
    // the disconnect still belongs to the old connection. Connectivity is
    // established by the transport and never inferred from a reading.
    const offlineSince = this.deps.getOfflineSince(device.id);
    if (offlineSince !== undefined && frame.timestamp <= offlineSince) {
      this.staleFramesDropped += 1;
      return;
    }

    // Ordinary out-of-order protection within a single connection.
    if (frame.timestamp < device.lastSeen) {
      this.staleFramesDropped += 1;
      return;
    }

    const thresholds = resolveThresholds(device, profiles);
    const evaluations = evaluateSnapshot(frame.values, thresholds);
    const breach = worstLevel(evaluations);

    const lifecycle = this.deps.getLifecycle(device.id);
    const nextStatus = deriveStatus({
      connected: frame.connected,
      breach,
      lifecycle,
    });

    const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];

    // Instability is measured on the device's headline metric — the one an
    // operator would judge it by — over whatever history the buffer holds.
    const primaryStats = this.deps.repository.getStats(
      device.id,
      descriptor.primaryMetric,
    );
    const instability = coefficientOfVariation(primaryStats);

    const battery = frame.values.battery ?? device.battery;
    const signalStrength = frame.values.signalStrength ?? device.signalStrength;

    const healthScore = calculateHealthScore({
      status: nextStatus,
      battery,
      signalStrength,
      mainsPowered: descriptor.mainsPowered,
      telemetryInstability: instability,
      errorCount: device.errorCount,
      messageCount: device.messageCount + 1,
      activeAlerts: this.deps.getOpenAlertCount(device.id),
      criticalAlerts: this.deps.getCriticalAlertCount(device.id),
      msSinceLastSeen: 0,
    });

    patches.push({
      id: device.id,
      status: nextStatus,
      telemetry: { timestamp: frame.timestamp, values: frame.values },
      battery,
      signalStrength,
      lastSeen: frame.timestamp,
      healthScore,
      messageCount: device.messageCount + 1,
    });

    // A status transition is the one telemetry-derived thing worth putting in
    // the activity feed — the readings themselves are summarised into KPIs.
    if (nextStatus !== device.status && !isLifecycleStatus(nextStatus)) {
      this.statusChanges += 1;
      const worst = evaluations.find((entry) => entry.level === breach);
      activity.push({
        id: createActivityId(),
        at: frame.timestamp,
        kind: "status",
        severity:
          nextStatus === "critical"
            ? "critical"
            : nextStatus === "warning"
              ? "warning"
              : nextStatus === "online"
                ? "success"
                : "info",
        subject: device.id,
        message: describeStatusChange(device.status, nextStatus, {
          metric: worst ? METRIC_DESCRIPTORS[worst.metric].label : undefined,
          value: worst?.value,
        }),
        deviceId: device.id,
        sourceEvent: "device.status.changed",
      });
    }

    // Alerts and rules both see the *derived* status, not the raw frame, so
    // they agree with what the operator is looking at.
    this.deps.alertEngine.reconcile({ ...device, status: nextStatus }, evaluations, now);

    this.deps.ruleEngine.evaluateDevice({
      deviceId: device.id,
      deviceName: device.name,
      deviceType: device.type,
      groupId: device.groupId,
      status: nextStatus,
      values: frame.values,
      lastSeen: frame.timestamp,
      now,
    });
  }

  /**
   * Periodic sweep for conditions that cannot be detected from an incoming
   * frame, because they are defined by the *absence* of one: silent devices,
   * and health that should decay as a reporting gap widens.
   *
   * Without this, a "no telemetry for 5 minutes" rule could never fire — the
   * only thing that would trigger its evaluation is telemetry arriving.
   */
  sweepSilentDevices(
    devices: Iterable<Device>,
    now: number,
    staleAfterMs: number,
  ): IngestionResult {
    const patches: DevicePatch[] = [];
    const activity: ActivityEntry[] = [];

    for (const device of devices) {
      const silentMs = now - device.lastSeen;
      if (silentMs < staleAfterMs) continue;

      const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
      const healthScore = calculateHealthScore({
        status: device.status,
        battery: device.battery,
        signalStrength: device.signalStrength,
        mainsPowered: descriptor.mainsPowered,
        telemetryInstability: 0,
        errorCount: device.errorCount,
        messageCount: Math.max(device.messageCount, 1),
        activeAlerts: this.deps.getOpenAlertCount(device.id),
        criticalAlerts: this.deps.getCriticalAlertCount(device.id),
        msSinceLastSeen: silentMs,
      });

      if (healthScore !== device.healthScore) {
        patches.push({ id: device.id, healthScore });
      }

      this.deps.ruleEngine.evaluateDevice({
        deviceId: device.id,
        deviceName: device.name,
        deviceType: device.type,
        groupId: device.groupId,
        status: device.status,
        values: device.telemetry.values,
        lastSeen: device.lastSeen,
        now,
      });
    }

    return { patches, activity, frameCount: 0 };
  }
}
