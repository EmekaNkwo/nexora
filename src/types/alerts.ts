import type { MetricKey } from "./telemetry";

export type AlertSeverity = "info" | "warning" | "critical";

export const ALERT_SEVERITIES: readonly AlertSeverity[] = [
  "critical",
  "warning",
  "info",
] as const;

export type AlertStatus = "active" | "acknowledged" | "snoozed" | "resolved";

export const ALERT_STATUSES: readonly AlertStatus[] = [
  "active",
  "acknowledged",
  "snoozed",
  "resolved",
] as const;

/** What produced the alert. Threshold alerts auto-resolve; rule alerts do not. */
export type AlertSource = "threshold" | "rule" | "connectivity" | "system";

export interface Alert {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly title: string;
  readonly message: string;
  readonly source: AlertSource;
  readonly metric?: MetricKey;
  /** Metric value at the moment the alert fired. */
  readonly value?: number;
  /** Threshold that was breached. */
  readonly threshold?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acknowledgedAt?: number;
  readonly acknowledgedBy?: string;
  readonly resolvedAt?: number;
  readonly snoozedUntil?: number;
  readonly assignee?: string;
  readonly ruleId?: string;
  /**
   * Stable key used to avoid duplicate alerts for the same ongoing condition
   * (e.g. `LAG-2048:temperature:critical`).
   */
  readonly dedupeKey: string;
}

export interface AlertFilters {
  readonly search: string;
  readonly severities: readonly AlertSeverity[];
  readonly statuses: readonly AlertStatus[];
  readonly sources: readonly AlertSource[];
  readonly deviceId?: string;
}

export const DEFAULT_ALERT_FILTERS: AlertFilters = {
  search: "",
  severities: [],
  statuses: ["active", "acknowledged", "snoozed"],
  sources: [],
};

export interface AlertCounts {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
  readonly active: number;
  readonly acknowledged: number;
  readonly snoozed: number;
  readonly resolved: number;
  readonly total: number;
}

export const EMPTY_ALERT_COUNTS: AlertCounts = {
  critical: 0,
  warning: 0,
  info: 0,
  active: 0,
  acknowledged: 0,
  snoozed: 0,
  resolved: 0,
  total: 0,
};

/**
 * A per-metric threshold set. `recovery` implements hysteresis: once an alert
 * fires it stays open until the value crosses back past `recovery`, which
 * stops the alert list from flapping on a value hovering at the boundary.
 */
export interface MetricThreshold {
  readonly metric: MetricKey;
  readonly enabled: boolean;
  readonly warning: number | null;
  readonly critical: number | null;
  readonly recovery: number | null;
  /**
   * `above` fires when the value exceeds the threshold (temperature);
   * `below` fires when it drops under it (battery, signal).
   */
  readonly direction: "above" | "below";
}

export type ThresholdSet = Readonly<Partial<Record<MetricKey, MetricThreshold>>>;

/** Severity a breach maps to, or null when nothing is breached. */
export type BreachLevel = AlertSeverity | null;

export interface ThresholdEvaluation {
  readonly metric: MetricKey;
  readonly level: BreachLevel;
  readonly value: number;
  readonly threshold: number | null;
}
