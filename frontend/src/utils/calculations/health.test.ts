import { describe, expect, it } from "vitest";

import {
  calculateHealth,
  calculateHealthScore,
  healthBand,
  summariseHealth,
} from "@/utils/calculations/health";
import {
  compareStatusSeverity,
  deriveStatus,
  describeStatusChange,
  isLifecycleStatus,
} from "@/utils/calculations/status";
import type { HealthInputs } from "@/types/device";
import {
  average,
  coefficientOfVariation,
  ewma,
  percentile,
  summarise,
} from "@/utils/calculations/stats";

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    status: "online",
    battery: 100,
    signalStrength: -62,
    mainsPowered: false,
    telemetryInstability: 0,
    errorCount: 0,
    messageCount: 1000,
    activeAlerts: 0,
    criticalAlerts: 0,
    msSinceLastSeen: 0,
    ...overrides,
  };
}

describe("calculateHealth", () => {
  it("scores a perfectly healthy device at 100", () => {
    const result = calculateHealth(inputs());
    expect(result.score).toBe(100);
    expect(result.factors).toHaveLength(0);
  });

  it("penalises an offline device the most heavily", () => {
    const offline = calculateHealthScore(inputs({ status: "offline" }));
    const critical = calculateHealthScore(inputs({ status: "critical" }));
    const warning = calculateHealthScore(inputs({ status: "warning" }));

    expect(offline).toBeLessThan(critical);
    expect(critical).toBeLessThan(warning);
    expect(warning).toBeLessThan(100);
  });

  it("explains every deduction it makes", () => {
    const result = calculateHealth(
      inputs({ status: "warning", battery: 14, signalStrength: -104 }),
    );

    const labels = result.factors.map((factor) => factor.label);
    expect(labels).toContain("Operating state");
    expect(labels).toContain("Battery");
    expect(labels).toContain("Signal strength");
    // The score is exactly 100 plus the penalties — nothing unexplained.
    const total = result.factors.reduce((sum, factor) => sum + factor.penalty, 0);
    expect(result.score).toBe(Math.max(0, 100 + total));
  });

  it("does not penalise battery on a mains-powered device", () => {
    expect(calculateHealthScore(inputs({ battery: 0, mainsPowered: true }))).toBe(100);
    expect(calculateHealthScore(inputs({ battery: 0, mainsPowered: false }))).toBeLessThan(
      100,
    );
  });

  it("leaves healthy battery and signal levels alone", () => {
    expect(calculateHealthScore(inputs({ battery: 75, signalStrength: -68 }))).toBe(100);
  });

  it("degrades steeply as battery falls", () => {
    const scores = [60, 40, 20, 5].map((battery) =>
      calculateHealthScore(inputs({ battery })),
    );
    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]!).toBeLessThan(scores[index - 1]!);
    }
  });

  it("penalises unstable telemetry even when readings are in range", () => {
    const stable = calculateHealthScore(inputs({ telemetryInstability: 0.01 }));
    const unstable = calculateHealthScore(inputs({ telemetryInstability: 0.3 }));
    expect(stable).toBe(100);
    expect(unstable).toBeLessThan(90);
  });

  it("weights errors against traffic volume, not in absolute terms", () => {
    const chatty = calculateHealthScore(inputs({ errorCount: 10, messageCount: 100_000 }));
    const quiet = calculateHealthScore(inputs({ errorCount: 10, messageCount: 50 }));
    expect(chatty).toBeGreaterThan(quiet);
  });

  it("weights critical alerts above ordinary ones", () => {
    const withCritical = calculateHealthScore(
      inputs({ activeAlerts: 1, criticalAlerts: 1 }),
    );
    const withWarning = calculateHealthScore(
      inputs({ activeAlerts: 1, criticalAlerts: 0 }),
    );
    expect(withCritical).toBeLessThan(withWarning);
  });

  it("catches a device that claims to be online but has gone quiet", () => {
    const fresh = calculateHealthScore(inputs({ msSinceLastSeen: 10_000 }));
    const stale = calculateHealthScore(inputs({ msSinceLastSeen: 600_000 }));
    expect(fresh).toBe(100);
    expect(stale).toBeLessThan(90);
  });

  it("clamps the score to 0-100", () => {
    const worst = calculateHealthScore(
      inputs({
        status: "offline",
        battery: 0,
        signalStrength: -118,
        telemetryInstability: 2,
        errorCount: 500,
        messageCount: 500,
        activeAlerts: 20,
        criticalAlerts: 10,
        msSinceLastSeen: 86_400_000,
      }),
    );
    expect(worst).toBe(0);
  });
});

describe("healthBand and summariseHealth", () => {
  it("bands scores", () => {
    expect(healthBand(96)).toBe("healthy");
    expect(healthBand(80)).toBe("healthy");
    expect(healthBand(79)).toBe("degraded");
    expect(healthBand(50)).toBe("degraded");
    expect(healthBand(49)).toBe("critical");
  });

  it("summarises a fleet", () => {
    const distribution = summariseHealth([100, 92, 85, 70, 55, 30, 10]);
    expect(distribution.healthy).toBe(3);
    expect(distribution.degraded).toBe(2);
    expect(distribution.critical).toBe(2);
    expect(distribution.total).toBe(7);
    expect(distribution.average).toBe(63);
  });

  it("handles an empty fleet", () => {
    expect(summariseHealth([])).toEqual({
      healthy: 0,
      degraded: 0,
      critical: 0,
      total: 0,
      average: 0,
    });
  });
});

describe("deriveStatus", () => {
  it("derives offline from connectivity regardless of readings", () => {
    expect(deriveStatus({ connected: false, breach: "critical" })).toBe("offline");
  });

  it("derives warning and critical from threshold breaches", () => {
    expect(deriveStatus({ connected: true, breach: null })).toBe("online");
    expect(deriveStatus({ connected: true, breach: "warning" })).toBe("warning");
    expect(deriveStatus({ connected: true, breach: "critical" })).toBe("critical");
  });

  it("lets lifecycle statuses win over telemetry", () => {
    // A device mid-update reporting an odd value should read as "updating",
    // not "critical" — otherwise every rollout looks like an incident.
    expect(
      deriveStatus({ connected: true, breach: "critical", lifecycle: "updating" }),
    ).toBe("updating");
    expect(
      deriveStatus({ connected: false, breach: null, lifecycle: "maintenance" }),
    ).toBe("maintenance");
  });

  it("identifies lifecycle statuses", () => {
    expect(isLifecycleStatus("updating")).toBe(true);
    expect(isLifecycleStatus("maintenance")).toBe(true);
    expect(isLifecycleStatus("critical")).toBe(false);
  });

  it("sorts worst-first", () => {
    const sorted = (["online", "warning", "critical", "offline"] as const)
      .slice()
      .sort(compareStatusSeverity);
    expect(sorted[0]).toBe("critical");
    expect(sorted[sorted.length - 1]).toBe("online");
  });

  it("describes transitions in operator language", () => {
    expect(describeStatusChange("online", "offline")).toBe("Device went offline");
    expect(describeStatusChange("offline", "online")).toBe("Device came back online");
    expect(
      describeStatusChange("warning", "critical", { metric: "Temperature", value: 38.7 }),
    ).toBe("Critical: Temperature at 38.7");
  });
});

describe("statistics", () => {
  it("summarises in one pass", () => {
    const stats = summarise([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(9);
    expect(stats.mean).toBe(5);
    expect(stats.last).toBe(9);
    expect(stats.count).toBe(8);
    expect(stats.delta).toBe(7);
    // Sample standard deviation of this classic set.
    expect(stats.stdDev).toBeCloseTo(2.138, 3);
  });

  it("stays precise on large offset values where the naive formula fails", () => {
    // Values clustered far from zero: sum-of-squares would lose precision.
    const values = Array.from({ length: 1000 }, (_, index) => 1e9 + (index % 2));
    expect(summarise(values).stdDev).toBeCloseTo(0.5, 2);
  });

  it("handles empty and single-sample inputs", () => {
    expect(summarise([]).count).toBe(0);
    const single = summarise([42]);
    expect(single.stdDev).toBe(0);
    expect(single.mean).toBe(42);
    expect(single.delta).toBe(0);
  });

  it("computes a scale-free instability measure", () => {
    const cold = coefficientOfVariation(summarise([2.4, 2.6, 2.5, 2.7]));
    const outdoor = coefficientOfVariation(summarise([28.2, 29.1, 30.3, 29.7]));
    // Cold storage varies by less of its own scale than an outdoor sensor.
    expect(cold).toBeLessThan(outdoor * 4);
    expect(coefficientOfVariation(summarise([5]))).toBe(0);
    // Values near zero must not report infinite instability.
    expect(Number.isFinite(coefficientOfVariation(summarise([0, 0.1, 0])))).toBe(true);
  });

  it("computes percentiles without mutating the input", () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 100)).toBe(5);
    expect(percentile(values, 0)).toBe(1);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  it("averages", () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
    expect(average([])).toBe(0);
  });

  it("seeds the EWMA from the first sample", () => {
    expect(ewma(null, 10, 0.5)).toBe(10);
    expect(ewma(10, 20, 0.5)).toBe(15);
    expect(ewma(Number.NaN, 7, 0.5)).toBe(7);
  });
});
