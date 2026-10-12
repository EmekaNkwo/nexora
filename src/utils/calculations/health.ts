import type {
  HealthBreakdown,
  HealthDistribution,
  HealthFactor,
  HealthInputs,
} from "@/types/device";
import { clamp } from "@/utils/random";

/**
 * Device health score, 0-100.
 *
 * Health is a *penalty model*: every device starts at 100 and loses points for
 * each thing wrong with it. That choice matters — an additive weighted average
 * would let a device with a dead battery still score 80 because its signal is
 * fine, whereas operators need the score to drop the moment anything is
 * actually wrong.
 *
 * Returning the breakdown rather than just the number is what lets the device
 * page explain *why* a device is at 62 instead of asking the user to guess.
 */

export const HEALTH_BANDS = {
  healthy: 80,
  degraded: 50,
} as const;

export type HealthBand = "healthy" | "degraded" | "critical";

export function healthBand(score: number): HealthBand {
  if (score >= HEALTH_BANDS.healthy) return "healthy";
  if (score >= HEALTH_BANDS.degraded) return "degraded";
  return "critical";
}

/** Minutes after which a connected device is considered to have gone quiet. */
const STALE_AFTER_MS = 120_000;

export function calculateHealth(inputs: HealthInputs): HealthBreakdown {
  const factors: HealthFactor[] = [];

  // Connectivity dominates: an unreachable device cannot be healthy whatever
  // its last-known readings said.
  if (inputs.status === "offline") {
    factors.push({
      label: "Connectivity",
      penalty: -55,
      detail: "Device is offline and not reporting telemetry",
    });
  } else if (inputs.status === "critical") {
    factors.push({
      label: "Operating state",
      penalty: -34,
      detail: "Device is in a critical state",
    });
  } else if (inputs.status === "warning") {
    factors.push({
      label: "Operating state",
      penalty: -14,
      detail: "Device is in a warning state",
    });
  } else if (inputs.status === "maintenance") {
    factors.push({
      label: "Operating state",
      penalty: -8,
      detail: "Device is under maintenance",
    });
  }

  // Battery: no penalty above 60%, then a steepening curve.
  if (!inputs.mainsPowered) {
    const battery = clamp(inputs.battery, 0, 100);
    if (battery < 60) {
      const shortfall = (60 - battery) / 60;
      const penalty = -Math.round(26 * shortfall ** 1.6);
      if (penalty < 0) {
        factors.push({
          label: "Battery",
          penalty,
          detail: `Battery at ${Math.round(battery)}%`,
        });
      }
    }
  }

  // Signal: −70 dBm is good, −105 dBm is barely usable.
  const signal = clamp(inputs.signalStrength, -118, -30);
  if (signal < -70) {
    const shortfall = (-70 - signal) / 35;
    const penalty = -Math.round(18 * clamp(shortfall, 0, 1.4) ** 1.3);
    if (penalty < 0) {
      factors.push({
        label: "Signal strength",
        penalty,
        detail: `${Math.round(signal)} dBm`,
      });
    }
  }

  // Telemetry instability — a sensor whose readings scatter is suspect even
  // when every individual reading is inside its threshold.
  if (inputs.telemetryInstability > 0.05) {
    const penalty = -Math.round(clamp((inputs.telemetryInstability - 0.05) * 95, 0, 20));
    if (penalty < 0) {
      factors.push({
        label: "Telemetry stability",
        penalty,
        detail: `Readings vary by ${(inputs.telemetryInstability * 100).toFixed(1)}% of mean`,
      });
    }
  }

  // Error rate relative to traffic, so a chatty device is not punished for
  // having more absolute errors than a quiet one.
  if (inputs.errorCount > 0) {
    const rate = inputs.errorCount / Math.max(inputs.messageCount, 1);
    const penalty = -Math.round(clamp(rate * 240, 0, 16));
    if (penalty < 0) {
      factors.push({
        label: "Error rate",
        penalty,
        detail: `${inputs.errorCount} errors in ${inputs.messageCount} messages`,
      });
    }
  }

  if (inputs.criticalAlerts > 0) {
    factors.push({
      label: "Critical alerts",
      penalty: -Math.min(24, inputs.criticalAlerts * 12),
      detail: `${inputs.criticalAlerts} unresolved critical alert${inputs.criticalAlerts > 1 ? "s" : ""}`,
    });
  }

  const nonCritical = Math.max(0, inputs.activeAlerts - inputs.criticalAlerts);
  if (nonCritical > 0) {
    factors.push({
      label: "Open alerts",
      penalty: -Math.min(12, nonCritical * 4),
      detail: `${nonCritical} open alert${nonCritical > 1 ? "s" : ""}`,
    });
  }

  // A device that claims to be online but stopped reporting is a real failure
  // mode, and one the status field alone will not catch.
  if (inputs.status !== "offline" && inputs.msSinceLastSeen > STALE_AFTER_MS) {
    const minutes = inputs.msSinceLastSeen / 60_000;
    factors.push({
      label: "Reporting gap",
      penalty: -Math.round(clamp(minutes * 2.5, 0, 22)),
      detail: `No telemetry for ${Math.round(minutes)} min`,
    });
  }

  const total = factors.reduce((sum, factor) => sum + factor.penalty, 0);
  return { score: clamp(Math.round(100 + total), 0, 100), factors };
}

/** Convenience wrapper when only the number is needed (the hot path). */
export function calculateHealthScore(inputs: HealthInputs): number {
  return calculateHealth(inputs).score;
}

export function summariseHealth(scores: readonly number[]): HealthDistribution {
  let healthy = 0;
  let degraded = 0;
  let critical = 0;
  let sum = 0;

  for (const score of scores) {
    sum += score;
    const band = healthBand(score);
    if (band === "healthy") healthy += 1;
    else if (band === "degraded") degraded += 1;
    else critical += 1;
  }

  return {
    healthy,
    degraded,
    critical,
    total: scores.length,
    average: scores.length === 0 ? 0 : Math.round(sum / scores.length),
  };
}
