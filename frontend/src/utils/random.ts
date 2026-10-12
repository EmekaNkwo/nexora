/**
 * Seeded pseudo-randomness.
 *
 * The simulator must be reproducible: the same seed has to produce the same
 * fleet and the same telemetry sequence, otherwise the behaviour can't be
 * asserted in tests. Everything in `services/simulator` draws from one of
 * these generators rather than `Math.random`.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Standard normal sample, via Box–Muller. */
  normal(): number;
  /** Normal sample with the given mean and standard deviation. */
  gaussian(mean: number, stdDev: number): number;
}

/** mulberry32 — small, fast, good enough statistically for simulation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box–Muller produces two independent samples per pair of uniforms; cache
  // the spare so normal() costs one uniform draw on average.
  let spare: number | null = null;

  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = radius * Math.sin(theta);
    return radius * Math.cos(theta);
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error("createRng().pick called with an empty array");
      }
      return items[Math.floor(next() * items.length)]!;
    },
    normal,
    gaussian: (mean, stdDev) => mean + normal() * stdDev,
  };
}

/**
 * Derives a stable child seed from a parent seed and a string key, so each
 * device gets its own independent stream without threading counters around.
 */
export function deriveSeed(parentSeed: number, key: string): number {
  let hash = parentSeed >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (Math.imul(hash ^ key.charCodeAt(index), 0x01000193) + 0x9e3779b9) >>> 0;
  }
  return hash >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Linear interpolation, with `t` clamped to [0, 1]. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}
