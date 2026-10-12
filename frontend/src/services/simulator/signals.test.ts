import { describe, expect, it } from "vitest";

import { buildMetricProfile } from "@/services/simulator/profiles";
import { SITES } from "@/services/simulator/locations";
import {
  DEFAULT_SIGNAL_CONFIG,
  createSignalState,
  readSignal,
  resolveTarget,
  stepSignal,
  type SignalConfig,
} from "@/services/simulator/signals";
import { coefficientOfVariation, summarise } from "@/utils/calculations/stats";
import { createRng } from "@/utils/random";

const LAGOS_COLD = SITES.find((site) => site.id === "site-lagos-cold")!;
const NAIROBI = SITES.find((site) => site.id === "site-nairobi-agri")!;

/** Runs a signal forward and collects the reported values. */
function run(
  config: SignalConfig,
  steps: number,
  options: { dtSeconds?: number; seed?: number; ambient?: number } = {},
): number[] {
  const rng = createRng(options.seed ?? 42);
  let state = createSignalState(config, rng);
  const values: number[] = [];
  for (let index = 0; index < steps; index += 1) {
    state = stepSignal(config, state, {
      dtSeconds: options.dtSeconds ?? 5,
      rng,
      ambient: options.ambient,
    });
    values.push(readSignal(config, state));
  }
  return values;
}

describe("stepSignal", () => {
  it("produces temporal continuity rather than independent samples", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 28,
      min: -20,
      max: 60,
      meanReversion: 0.1,
      noise: 0.12,
      decimals: 1,
    };

    const values = run(config, 400);

    // Consecutive readings must be close together: a sensor walks, it does
    // not teleport. Compare the mean step size against the overall spread.
    let totalStep = 0;
    for (let index = 1; index < values.length; index += 1) {
      totalStep += Math.abs(values[index]! - values[index - 1]!);
    }
    const meanStep = totalStep / (values.length - 1);
    const stats = summarise(values);
    const spread = stats.max - stats.min;

    expect(meanStep).toBeLessThan(spread / 4);
    expect(spread).toBeGreaterThan(0);
  });

  it("reverts to its baseline after being displaced", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 10,
      min: -50,
      max: 100,
      meanReversion: 0.4,
      noise: 0,
      decimals: 2,
    };

    const rng = createRng(7);
    let state = { value: 60, spike: 0, faultRamp: 0 };
    for (let index = 0; index < 60; index += 1) {
      state = stepSignal(config, state, { dtSeconds: 1, rng });
    }

    expect(readSignal(config, state)).toBeCloseTo(10, 1);
  });

  it("is deterministic for a given seed", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 5,
      min: 0,
      max: 10,
      noise: 0.3,
      spikeChance: 0.05,
      spikeMagnitude: 2,
    };

    expect(run(config, 120, { seed: 99 })).toEqual(run(config, 120, { seed: 99 }));
    expect(run(config, 120, { seed: 99 })).not.toEqual(run(config, 120, { seed: 100 }));
  });

  it("is sample-rate independent: noise scales with the square root of dt", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 20,
      min: -50,
      max: 90,
      meanReversion: 0.05,
      noise: 0.4,
      decimals: 3,
    };

    // 600 steps of 1s and 120 steps of 5s cover the same 10 minutes, so their
    // distributions should have comparable spread.
    const fine = summarise(run(config, 600, { dtSeconds: 1, seed: 11 }));
    const coarse = summarise(run(config, 120, { dtSeconds: 5, seed: 11 }));

    expect(coarse.stdDev).toBeGreaterThan(fine.stdDev * 0.4);
    expect(coarse.stdDev).toBeLessThan(fine.stdDev * 2.5);
  });

  it("decays spikes back toward the baseline instead of stepping permanently", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 30,
      min: 0,
      max: 90,
      meanReversion: 0.15,
      noise: 0,
      spikeDecay: 0.4,
      decimals: 2,
    };

    const rng = createRng(3);
    let state = { value: 30, spike: 18, faultRamp: 0 };
    const peak = readSignal(config, state);

    for (let index = 0; index < 20; index += 1) {
      state = stepSignal(config, state, { dtSeconds: 1, rng });
    }

    const recovered = readSignal(config, state);
    expect(peak).toBeGreaterThan(45);
    expect(recovered).toBeCloseTo(30, 0);
  });

  it("escalates while a fault is active and heals once it clears", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 31,
      min: 0,
      max: 120,
      meanReversion: 0.1,
      noise: 0,
      faultCeiling: 20,
      faultRampPerSecond: 1,
      decimals: 1,
    };

    const rng = createRng(5);
    let state = createSignalState(config, rng);
    const escalating: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      state = stepSignal(config, state, { dtSeconds: 1, rng, faultActive: true });
      escalating.push(readSignal(config, state));
    }

    // Monotone-ish escalation: the end is clearly hotter than the start.
    expect(escalating[escalating.length - 1]!).toBeGreaterThan(escalating[0]! + 10);

    for (let index = 0; index < 60; index += 1) {
      state = stepSignal(config, state, { dtSeconds: 1, rng, faultActive: false });
    }
    expect(readSignal(config, state)).toBeCloseTo(31, 0);
  });

  it("cools when an actuator is applied — the rule→command→telemetry loop", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 38,
      min: 0,
      max: 90,
      meanReversion: 0.02,
      noise: 0,
      decimals: 1,
    };

    const rng = createRng(8);
    let state = { value: 38, spike: 0, faultRamp: 0 };
    const start = readSignal(config, state);

    for (let index = 0; index < 30; index += 1) {
      state = stepSignal(config, state, { dtSeconds: 1, rng, actuation: -0.5 });
    }

    expect(readSignal(config, state)).toBeLessThan(start - 5);
  });

  it("never leaves its configured bounds", () => {
    const config: SignalConfig = {
      ...DEFAULT_SIGNAL_CONFIG,
      baseline: 50,
      min: 0,
      max: 100,
      meanReversion: 0.01,
      noise: 8,
      spikeChance: 0.2,
      spikeMagnitude: 60,
      decimals: 1,
    };

    for (const value of run(config, 2000, { seed: 21 })) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("resolveTarget", () => {
  it("blends baseline and ambient by the coupling factor", () => {
    const config = { ...DEFAULT_SIGNAL_CONFIG, baseline: 10, ambientCoupling: 0.5 };
    expect(resolveTarget(config, 30)).toBeCloseTo(20);
  });

  it("ignores ambient when coupling is zero", () => {
    const config = { ...DEFAULT_SIGNAL_CONFIG, baseline: 10, ambientCoupling: 0 };
    expect(resolveTarget(config, 30)).toBe(10);
  });
});

describe("device profiles", () => {
  it("keeps a cold-storage sensor far tighter than an outdoor sensor", () => {
    const rng = createRng(1234);
    const cold = buildMetricProfile("cold-storage-sensor", LAGOS_COLD, rng, false);
    const outdoor = buildMetricProfile("temperature-sensor", NAIROBI, rng, false);

    const coldValues = run(cold.temperature!, 500, { ambient: 28.5 });
    const outdoorValues = run(outdoor.temperature!, 500, { ambient: 28.5 });

    const coldStats = summarise(coldValues);
    const outdoorStats = summarise(outdoorValues);

    // A refrigerated unit holds its set point; an outdoor sensor tracks the air.
    expect(coldStats.max - coldStats.min).toBeLessThan(3);
    expect(coldStats.mean).toBeLessThan(10);
    expect(outdoorStats.mean).toBeGreaterThan(18);
    expect(coefficientOfVariation(coldStats)).toBeLessThan(
      coefficientOfVariation(outdoorStats) * 3,
    );
  });

  it("discharges battery monotonically and never recharges it", () => {
    const rng = createRng(555);
    const profile = buildMetricProfile("gps-tracker", LAGOS_COLD, rng, false);
    const values = run(profile.battery!, 300, { dtSeconds: 60 });

    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeLessThanOrEqual(values[index - 1]!);
    }
    expect(values[values.length - 1]!).toBeLessThan(values[0]!);
    expect(values.every((value) => Number.isInteger(value))).toBe(true);
  });

  it("gives a faulty device a higher spike rate than a healthy one", () => {
    const healthy = buildMetricProfile(
      "industrial-gateway",
      LAGOS_COLD,
      createRng(10),
      false,
    );
    const faulty = buildMetricProfile(
      "industrial-gateway",
      LAGOS_COLD,
      createRng(10),
      true,
    );

    expect(faulty.temperature!.spikeChance).toBeGreaterThan(
      healthy.temperature!.spikeChance,
    );
    expect(faulty.temperature!.spikeMagnitude).toBeGreaterThan(
      healthy.temperature!.spikeMagnitude,
    );
  });

  it("reports only the metrics its device class actually has sensors for", () => {
    const rng = createRng(77);
    const meter = buildMetricProfile("smart-meter", LAGOS_COLD, rng, false);
    const motion = buildMetricProfile("motion-sensor", LAGOS_COLD, rng, false);

    expect(meter.powerConsumption).toBeDefined();
    expect(meter.motion).toBeUndefined();
    expect(motion.motion).toBeDefined();
    expect(motion.powerConsumption).toBeUndefined();
  });
});
