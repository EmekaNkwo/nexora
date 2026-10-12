import { clamp, roundTo, type Rng } from "@/utils/random";

/**
 * Telemetry signal generation.
 *
 * Random numbers per tick look nothing like a sensor. A real reading is a
 * continuous physical quantity sampled discretely, so the model here is an
 * Ornstein–Uhlenbeck process — mean-reverting drift plus Brownian noise —
 * layered with the things that actually make operations interesting:
 *
 *   target  ← baseline, optionally coupled to site ambient conditions
 *   drift   ← deterministic trend (battery discharge, sensor ageing)
 *   noise   ← Gaussian, scaled by √dt so the walk is sample-rate independent
 *   spike   ← rare impulse that decays back, not a permanent step
 *   fault   ← progressive escalation for devices seeded as faulty
 *   actuate ← external influence, e.g. a fan the rule engine switched on
 *
 * Every function here is pure: state in, state out. That is what lets the
 * tests assert "cold storage stays within ±1°C over 2,000 ticks" instead of
 * just checking that a number came back.
 */

export interface SignalConfig {
  /** Resting value the signal reverts toward. */
  readonly baseline: number;
  readonly min: number;
  readonly max: number;
  /**
   * Reversion rate per second. 0 = free random walk (battery), 0.5 = snaps
   * back within a couple of seconds (tightly controlled cold store).
   */
  readonly meanReversion: number;
  /** Gaussian noise standard deviation per √second. */
  readonly noise: number;
  /**
   * How strongly site ambient conditions pull the target, 0-1. An outdoor
   * sensor is ~0.9; a cold store is ~0.04 because refrigeration isolates it.
   */
  readonly ambientCoupling: number;
  /** Deterministic trend per hour, e.g. −1.8 %/h for battery discharge. */
  readonly driftPerHour: number;
  /** Probability per second of an impulse. */
  readonly spikeChance: number;
  /** Impulse size in signal units. */
  readonly spikeMagnitude: number;
  /** Fraction of the spike that remains after one second. */
  readonly spikeDecay: number;
  /** Escalation per second once a fault is active. */
  readonly faultRampPerSecond: number;
  /** Ceiling on the fault contribution. */
  readonly faultCeiling: number;
  readonly decimals: number;
  /** Prevents noise from pushing the value back up (battery never refills). */
  readonly monotonic?: "down" | "up";
}

export interface SignalState {
  /** Underlying process value, before spike and fault contributions. */
  readonly value: number;
  readonly spike: number;
  readonly faultRamp: number;
}

export interface SignalStepContext {
  readonly dtSeconds: number;
  readonly rng: Rng;
  /** Site ambient value for this metric at this instant. */
  readonly ambient?: number;
  /**
   * External influence in units per second — negative while a cooling fan
   * runs. This is the hook that closes the rule → command → telemetry loop.
   */
  readonly actuation?: number;
  /** When true, the fault ramp grows; when false, it decays away. */
  readonly faultActive?: boolean;
  /** Collapses the value toward the baseline (calibration command). */
  readonly recalibrate?: boolean;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  baseline: 0,
  min: Number.NEGATIVE_INFINITY,
  max: Number.POSITIVE_INFINITY,
  meanReversion: 0.08,
  noise: 0.1,
  ambientCoupling: 0,
  driftPerHour: 0,
  spikeChance: 0,
  spikeMagnitude: 0,
  spikeDecay: 0.4,
  faultRampPerSecond: 0,
  faultCeiling: 0,
  decimals: 1,
};

export function createSignalState(config: SignalConfig, rng: Rng): SignalState {
  // Start each device at a slightly different point in its range so a fresh
  // fleet does not render as one flat line.
  const spread = Math.max(config.noise * 6, Math.abs(config.baseline) * 0.02, 0.4);
  return {
    value: clamp(config.baseline + rng.gaussian(0, spread), config.min, config.max),
    spike: 0,
    faultRamp: 0,
  };
}

/** The value the process reverts toward, after ambient coupling. */
export function resolveTarget(config: SignalConfig, ambient: number | undefined): number {
  if (ambient === undefined || config.ambientCoupling <= 0) return config.baseline;
  return (
    config.baseline * (1 - config.ambientCoupling) + ambient * config.ambientCoupling
  );
}

export function stepSignal(
  config: SignalConfig,
  state: SignalState,
  ctx: SignalStepContext,
): SignalState {
  const dt = Math.max(ctx.dtSeconds, 0);
  if (dt === 0) return state;

  const target = resolveTarget(config, ctx.ambient);

  // Exponential pull toward the target. Using 1 − e^(−k·dt) rather than k·dt
  // keeps behaviour stable even when ticks are long or irregular.
  const reversion = 1 - Math.exp(-config.meanReversion * dt);
  let next = state.value + (target - state.value) * reversion;

  if (config.noise > 0) {
    next += ctx.rng.gaussian(0, config.noise * Math.sqrt(dt));
  }

  next += (config.driftPerHour * dt) / 3600;

  if (ctx.actuation) {
    next += ctx.actuation * dt;
  }

  if (ctx.recalibrate) {
    // Calibration pulls hard toward baseline and discards accumulated fault.
    next = next + (config.baseline - next) * Math.min(1, dt * 0.8);
  }

  if (config.monotonic === "down") {
    next = Math.min(next, state.value);
  } else if (config.monotonic === "up") {
    next = Math.max(next, state.value);
  }

  next = clamp(next, config.min, config.max);

  // Spikes: Poisson-ish arrival, exponential decay back to zero.
  let spike = state.spike * config.spikeDecay ** dt;
  if (Math.abs(spike) < 1e-4) spike = 0;
  if (config.spikeChance > 0 && ctx.rng.chance(1 - Math.exp(-config.spikeChance * dt))) {
    const direction = ctx.rng.chance(0.78) ? 1 : -1;
    spike += direction * config.spikeMagnitude * ctx.rng.range(0.55, 1.35);
  }

  // Faults escalate while active and heal once cleared, which is what gives
  // the 31.2 → 31.5 → 38.9 → 42.4 → 47.8 shape of a failing sensor.
  let faultRamp = state.faultRamp;
  if (ctx.faultActive && config.faultCeiling !== 0) {
    const rate = config.faultRampPerSecond || config.faultCeiling / 20;
    faultRamp = clamp(faultRamp + rate * dt, -Math.abs(config.faultCeiling), Math.abs(config.faultCeiling));
  } else if (faultRamp !== 0) {
    const healed = faultRamp * 0.82 ** dt;
    faultRamp = Math.abs(healed) < 1e-3 ? 0 : healed;
  }
  if (ctx.recalibrate) faultRamp = 0;

  return { value: next, spike, faultRamp };
}

/** The value a device actually reports, after all contributions and rounding. */
export function readSignal(config: SignalConfig, state: SignalState): number {
  const raw = state.value + state.spike + state.faultRamp;
  return roundTo(clamp(raw, config.min, config.max), config.decimals);
}

/**
 * Advances a signal by `steps` ticks without allocating intermediate arrays.
 * Used to backfill history and to fast-forward a newly provisioned device.
 */
export function advanceSignal(
  config: SignalConfig,
  state: SignalState,
  steps: number,
  ctx: SignalStepContext,
): SignalState {
  let current = state;
  for (let index = 0; index < steps; index += 1) {
    current = stepSignal(config, current, ctx);
  }
  return current;
}
