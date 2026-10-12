import type {
  BreachLevel,
  MetricThreshold,
  ThresholdEvaluation,
  ThresholdSet,
} from "@/types/alerts";
import type { DeviceType } from "@/types/device";
import type { MetricKey, MetricValues } from "@/types/telemetry";

/**
 * Threshold configuration and evaluation.
 *
 * Two ideas carry most of the weight here:
 *
 * 1. **Hysteresis.** A threshold has a `recovery` level distinct from the
 *    firing level. Without it, a temperature hovering at 35.0 would open and
 *    close an alert every other tick and the alert list would be unusable.
 *
 * 2. **Scoped overrides.** A single global "temperature > 30°C" rule is wrong
 *    for a −18°C freezer. Thresholds resolve default → device type → group, so
 *    cold-chain devices get a cold-chain band while the fleet keeps a sensible
 *    default.
 */

function threshold(
  metric: MetricKey,
  direction: "above" | "below",
  warning: number | null,
  critical: number | null,
  recovery: number | null,
  enabled = true,
): MetricThreshold {
  return { metric, direction, warning, critical, recovery, enabled };
}

export const DEFAULT_THRESHOLDS: ThresholdSet = {
  temperature: threshold("temperature", "above", 30, 35, 28),
  humidity: threshold("humidity", "above", 85, 95, 80),
  battery: threshold("battery", "below", 20, 10, 25),
  signalStrength: threshold("signalStrength", "below", -100, -110, -95),
  powerConsumption: threshold("powerConsumption", "above", 26, 34, 22),
  airQuality: threshold("airQuality", "above", 150, 250, 120),
  pressure: threshold("pressure", "below", 975, 960, 985, false),
  motion: threshold("motion", "above", 9, 11, 7, false),
};

export type ThresholdScope =
  | { readonly kind: "default" }
  | { readonly kind: "type"; readonly deviceType: DeviceType }
  | { readonly kind: "group"; readonly groupId: string };

export interface ThresholdProfile {
  readonly id: string;
  readonly name: string;
  readonly scope: ThresholdScope;
  readonly thresholds: ThresholdSet;
}

export const DEFAULT_THRESHOLD_PROFILE: ThresholdProfile = {
  id: "thr-default",
  name: "Fleet default",
  scope: { kind: "default" },
  thresholds: DEFAULT_THRESHOLDS,
};

/**
 * Built-in type overrides. Cold chain is the important one: compliance bands
 * are far tighter than the fleet default and an excursion is a real event.
 */
export const BUILT_IN_THRESHOLD_PROFILES: readonly ThresholdProfile[] = [
  DEFAULT_THRESHOLD_PROFILE,
  {
    id: "thr-cold-chain",
    name: "Cold chain compliance",
    scope: { kind: "type", deviceType: "cold-storage-sensor" },
    thresholds: {
      temperature: threshold("temperature", "above", 6, 8, 5),
      humidity: threshold("humidity", "above", 88, 96, 84),
    },
  },
  {
    id: "thr-gateway",
    name: "Gateway enclosure",
    scope: { kind: "type", deviceType: "industrial-gateway" },
    thresholds: {
      temperature: threshold("temperature", "above", 58, 70, 52),
    },
  },
  {
    id: "thr-energy",
    name: "Energy monitoring",
    scope: { kind: "type", deviceType: "energy-monitor" },
    thresholds: {
      powerConsumption: threshold("powerConsumption", "above", 32, 42, 28),
      temperature: threshold("temperature", "above", 48, 60, 44),
    },
  },
  {
    id: "thr-meter",
    name: "Smart meter",
    scope: { kind: "type", deviceType: "smart-meter" },
    thresholds: {
      powerConsumption: threshold("powerConsumption", "above", 18, 24, 15),
      temperature: threshold("temperature", "above", 48, 60, 44),
    },
  },
  {
    id: "thr-vehicle",
    name: "Vehicle cabin",
    scope: { kind: "type", deviceType: "vehicle-tracker" },
    thresholds: {
      temperature: threshold("temperature", "above", 44, 55, 40),
      battery: threshold("battery", "below", 25, 12, 30),
    },
  },
];

/**
 * Merges profiles into one effective set for a device.
 * Later scopes win per metric: default < type < group.
 */
export function resolveThresholds(
  device: { readonly type: DeviceType; readonly groupId: string },
  profiles: readonly ThresholdProfile[],
): ThresholdSet {
  const merged: Record<string, MetricThreshold> = {};

  const apply = (set: ThresholdSet): void => {
    for (const [metric, value] of Object.entries(set)) {
      if (value) merged[metric] = value;
    }
  };

  for (const profile of profiles) {
    if (profile.scope.kind === "default") apply(profile.thresholds);
  }
  for (const profile of profiles) {
    if (profile.scope.kind === "type" && profile.scope.deviceType === device.type) {
      apply(profile.thresholds);
    }
  }
  for (const profile of profiles) {
    if (profile.scope.kind === "group" && profile.scope.groupId === device.groupId) {
      apply(profile.thresholds);
    }
  }

  return merged as ThresholdSet;
}

/** True when `value` has crossed `limit` in the threshold's direction. */
function breached(value: number, limit: number, direction: "above" | "below"): boolean {
  return direction === "above" ? value > limit : value < limit;
}

/** True when `value` has returned past the recovery level. */
export function recovered(
  value: number,
  threshold: MetricThreshold,
): boolean {
  if (threshold.recovery === null) return false;
  return threshold.direction === "above"
    ? value < threshold.recovery
    : value > threshold.recovery;
}

export function evaluateMetric(
  value: number,
  threshold: MetricThreshold | undefined,
): BreachLevel {
  if (!threshold || !threshold.enabled) return null;
  if (threshold.critical !== null && breached(value, threshold.critical, threshold.direction)) {
    return "critical";
  }
  if (threshold.warning !== null && breached(value, threshold.warning, threshold.direction)) {
    return "warning";
  }
  return null;
}

/**
 * Evaluates a full telemetry snapshot. Returns one entry per metric that has
 * a value *and* an enabled threshold, breached or not — callers need the
 * non-breaching entries too, to know when to resolve an existing alert.
 */
export function evaluateSnapshot(
  values: MetricValues,
  thresholds: ThresholdSet,
): readonly ThresholdEvaluation[] {
  const results: ThresholdEvaluation[] = [];

  for (const [metricKey, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const metric = metricKey as MetricKey;
    const threshold = thresholds[metric];
    if (!threshold || !threshold.enabled) continue;
    const level = evaluateMetric(value, threshold);
    results.push({
      metric,
      level,
      value,
      threshold:
        level === "critical"
          ? threshold.critical
          : level === "warning"
            ? threshold.warning
            : null,
    });
  }

  return results;
}

/** Highest severity across a set of evaluations. */
export function worstLevel(
  evaluations: readonly ThresholdEvaluation[],
): BreachLevel {
  let worst: BreachLevel = null;
  for (const evaluation of evaluations) {
    if (evaluation.level === "critical") return "critical";
    if (evaluation.level === "warning") worst = "warning";
  }
  return worst;
}

/** Describes a breach in the words an operator would use. */
export function describeBreach(
  evaluation: ThresholdEvaluation,
  threshold: MetricThreshold,
  unit: string,
  label: string,
): string {
  const limit = evaluation.level === "critical" ? threshold.critical : threshold.warning;
  const comparator = threshold.direction === "above" ? "exceeded" : "fell below";
  return `${label} ${comparator} ${limit}${unit} (current ${evaluation.value}${unit})`;
}
