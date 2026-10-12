import {
  describeBreach,
  recovered,
  resolveThresholds,
  type ThresholdProfile,
} from "@/services/telemetry/thresholds";
import type {
  Alert,
  AlertSeverity,
  ThresholdEvaluation,
  ThresholdSet,
} from "@/types/alerts";
import type { Device } from "@/types/device";
import type { MetricKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import { createAlertId } from "@/utils/ids";

/**
 * Alert lifecycle management.
 *
 * The hard part of alerting is not detecting a breach — it is *not* producing
 * a thousand alerts for one ongoing problem. Three mechanisms handle that:
 *
 * 1. **Dedupe keys.** One open alert per `device:metric:severity`. A device
 *    sitting above its critical threshold for an hour has one alert, which
 *    keeps updating, not 3,600 of them.
 * 2. **Hysteresis.** An open alert only auto-resolves once the value crosses
 *    back past the threshold's `recovery` level, not merely back under the
 *    firing level.
 * 3. **Escalation, not duplication.** A warning that deteriorates into a
 *    critical resolves the warning and opens a critical, rather than leaving
 *    two open alerts for one condition.
 *
 * The engine owns only the open-alert index. Storage, filtering and the
 * operator actions (acknowledge, snooze, assign) belong to the alert store.
 */

export interface AlertEngineCallbacks {
  readonly onCreated: (alert: Alert) => void;
  readonly onUpdated: (alert: Alert) => void;
  readonly onResolved: (alert: Alert) => void;
}

interface OpenAlertRecord {
  readonly alert: Alert;
  /** Threshold that fired, kept so recovery can be checked without a lookup. */
  readonly metric: MetricKey;
}

export class AlertEngine {
  /** dedupeKey → open alert. */
  private readonly open = new Map<string, OpenAlertRecord>();
  /** deviceId → dedupe keys, so a device can be cleared in one step. */
  private readonly byDevice = new Map<string, Set<string>>();
  private readonly callbacks: AlertEngineCallbacks;
  private thresholdProfiles: readonly ThresholdProfile[] = [];
  private created = 0;
  private resolved = 0;

  constructor(callbacks: AlertEngineCallbacks) {
    this.callbacks = callbacks;
  }

  setThresholdProfiles(profiles: readonly ThresholdProfile[]): void {
    this.thresholdProfiles = profiles;
  }

  get diagnostics(): { open: number; created: number; resolved: number } {
    return { open: this.open.size, created: this.created, resolved: this.resolved };
  }

  get openCount(): number {
    return this.open.size;
  }

  countForDevice(deviceId: string): number {
    return this.byDevice.get(deviceId)?.size ?? 0;
  }

  criticalCountForDevice(deviceId: string): number {
    const keys = this.byDevice.get(deviceId);
    if (!keys) return 0;
    let count = 0;
    for (const key of keys) {
      if (this.open.get(key)?.alert.severity === "critical") count += 1;
    }
    return count;
  }

  /**
   * Reconciles a device's threshold evaluations against currently open alerts.
   * Call once per ingested snapshot.
   */
  reconcile(
    device: Device,
    evaluations: readonly ThresholdEvaluation[],
    now: number,
  ): void {
    const thresholds = resolveFor(device, this.thresholdProfiles);

    for (const evaluation of evaluations) {
      const threshold = thresholds[evaluation.metric];
      if (!threshold) continue;

      const descriptor = METRIC_DESCRIPTORS[evaluation.metric];

      if (evaluation.level === null) {
        // Nothing breached right now — close any open alert that has recovered.
        for (const severity of ["critical", "warning"] as const) {
          const key = dedupeKey(device.id, evaluation.metric, severity);
          const record = this.open.get(key);
          if (!record) continue;
          if (recovered(evaluation.value, threshold)) {
            this.closeAlert(key, now, evaluation.value);
          }
        }
        continue;
      }

      // Escalation or de-escalation: close the other severity for this metric.
      const other: AlertSeverity = evaluation.level === "critical" ? "warning" : "critical";
      const otherKey = dedupeKey(device.id, evaluation.metric, other);
      if (this.open.has(otherKey)) {
        // Only de-escalate once the value has genuinely recovered past the
        // critical band; otherwise a value oscillating around the critical
        // line would flap between two alerts.
        if (evaluation.level === "critical" || recovered(evaluation.value, threshold)) {
          this.closeAlert(otherKey, now, evaluation.value);
        }
      }

      const key = dedupeKey(device.id, evaluation.metric, evaluation.level);
      const existing = this.open.get(key);
      const message = describeBreach(
        evaluation,
        threshold,
        descriptor.unit,
        descriptor.label,
      );

      if (existing) {
        // Refresh the live value on the open alert without re-notifying.
        const updated: Alert = {
          ...existing.alert,
          value: evaluation.value,
          message,
          updatedAt: now,
        };
        this.open.set(key, { alert: updated, metric: evaluation.metric });
        this.callbacks.onUpdated(updated);
        continue;
      }

      const alert: Alert = {
        id: createAlertId(),
        deviceId: device.id,
        deviceName: device.name,
        severity: evaluation.level,
        status: "active",
        title: `${descriptor.label} ${threshold.direction === "above" ? "above" : "below"} ${evaluation.level} threshold`,
        message,
        source: "threshold",
        metric: evaluation.metric,
        value: evaluation.value,
        threshold: evaluation.threshold ?? undefined,
        createdAt: now,
        updatedAt: now,
        dedupeKey: key,
      };

      this.track(key, alert, evaluation.metric);
      this.created += 1;
      this.callbacks.onCreated(alert);
    }
  }

  /** Raises a connectivity alert when a device drops off the network. */
  raiseConnectivityAlert(device: Device, reason: string, now: number): string | undefined {
    const key = dedupeKey(device.id, "connectivity", "warning");
    if (this.open.has(key)) return undefined;

    const alert: Alert = {
      id: createAlertId(),
      deviceId: device.id,
      deviceName: device.name,
      severity: "warning",
      status: "active",
      title: "Device offline",
      message: `Device stopped reporting (${reason})`,
      source: "connectivity",
      createdAt: now,
      updatedAt: now,
      dedupeKey: key,
    };

    this.track(key, alert, "signalStrength");
    this.created += 1;
    this.callbacks.onCreated(alert);
    return alert.id;
  }

  /** Resolves the connectivity alert when the device comes back. */
  clearConnectivityAlert(deviceId: string, now: number): void {
    this.closeAlert(dedupeKey(deviceId, "connectivity", "warning"), now);
  }

  /**
   * Raises a rule-sourced alert. Rule alerts do not auto-resolve — a rule
   * firing is a discrete event, and closing it is an operator decision.
   */
  raiseRuleAlert(input: {
    readonly deviceId: string;
    readonly deviceName: string;
    readonly severity: AlertSeverity;
    readonly message: string;
    readonly ruleId: string;
    readonly ruleName: string;
    readonly now: number;
  }): string {
    const key = dedupeKey(input.deviceId, `rule:${input.ruleId}`, input.severity);
    const existing = this.open.get(key);
    if (existing) {
      const updated: Alert = { ...existing.alert, updatedAt: input.now };
      this.open.set(key, { ...existing, alert: updated });
      this.callbacks.onUpdated(updated);
      return updated.id;
    }

    const alert: Alert = {
      id: createAlertId(),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      severity: input.severity,
      status: "active",
      title: `Rule triggered: ${input.ruleName}`,
      message: input.message,
      source: "rule",
      ruleId: input.ruleId,
      createdAt: input.now,
      updatedAt: input.now,
      dedupeKey: key,
    };

    this.track(key, alert, "temperature");
    this.created += 1;
    this.callbacks.onCreated(alert);
    return alert.id;
  }

  /** Raises a one-off system alert (firmware failure, outage, incident). */
  raiseSystemAlert(input: {
    readonly deviceId: string;
    readonly deviceName: string;
    readonly severity: AlertSeverity;
    readonly title: string;
    readonly message: string;
    readonly now: number;
    readonly assignee?: string;
    readonly dedupeSuffix?: string;
  }): string {
    const key = dedupeKey(
      input.deviceId,
      `system:${input.dedupeSuffix ?? input.title}`,
      input.severity,
    );
    const existing = this.open.get(key);
    if (existing) return existing.alert.id;

    const alert: Alert = {
      id: createAlertId(),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      severity: input.severity,
      status: "active",
      title: input.title,
      message: input.message,
      source: "system",
      assignee: input.assignee,
      createdAt: input.now,
      updatedAt: input.now,
      dedupeKey: key,
    };

    this.track(key, alert, "temperature");
    this.created += 1;
    this.callbacks.onCreated(alert);
    return alert.id;
  }

  /**
   * Called when an operator resolves an alert by hand, so the engine stops
   * treating the condition as already-reported and can raise it again if it
   * recurs.
   */
  forget(dedupeKeyValue: string): void {
    const record = this.open.get(dedupeKeyValue);
    if (!record) return;
    this.open.delete(dedupeKeyValue);
    this.byDevice.get(record.alert.deviceId)?.delete(dedupeKeyValue);
  }

  /** Drops every open alert for a device, e.g. when it is decommissioned. */
  forgetDevice(deviceId: string): void {
    const keys = this.byDevice.get(deviceId);
    if (!keys) return;
    for (const key of keys) this.open.delete(key);
    this.byDevice.delete(deviceId);
  }

  reset(): void {
    this.open.clear();
    this.byDevice.clear();
    this.created = 0;
    this.resolved = 0;
  }

  private track(key: string, alert: Alert, metric: MetricKey): void {
    this.open.set(key, { alert, metric });
    let keys = this.byDevice.get(alert.deviceId);
    if (!keys) {
      keys = new Set();
      this.byDevice.set(alert.deviceId, keys);
    }
    keys.add(key);
  }

  private closeAlert(key: string, now: number, value?: number): void {
    const record = this.open.get(key);
    if (!record) return;
    this.open.delete(key);
    this.byDevice.get(record.alert.deviceId)?.delete(key);
    this.resolved += 1;
    const resolvedAlert: Alert = {
      ...record.alert,
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
      value: value ?? record.alert.value,
      message:
        value === undefined
          ? record.alert.message
          : `${record.alert.message} — recovered at ${value}`,
    };
    this.callbacks.onResolved(resolvedAlert);
  }
}

/** `deviceId:subject:severity` — one open alert per condition per device. */
export function dedupeKey(
  deviceId: string,
  subject: string,
  severity: AlertSeverity,
): string {
  return `${deviceId}:${subject}:${severity}`;
}

function resolveFor(
  device: Device,
  profiles: readonly ThresholdProfile[],
): ThresholdSet {
  return resolveThresholds(device, profiles);
}
