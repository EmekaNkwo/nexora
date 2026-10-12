import type { MetricStats } from "@/types/telemetry";

export const EMPTY_METRIC_STATS: MetricStats = {
  min: 0,
  max: 0,
  mean: 0,
  last: 0,
  stdDev: 0,
  count: 0,
  delta: 0,
};

/**
 * Single-pass summary statistics.
 *
 * Uses Welford's algorithm for the variance so that long telemetry windows do
 * not lose precision to catastrophic cancellation the way the naive
 * sum-of-squares formula does.
 */
export function summarise(values: readonly number[]): MetricStats {
  if (values.length === 0) return EMPTY_METRIC_STATS;

  let min = values[0]!;
  let max = values[0]!;
  let mean = 0;
  let m2 = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value < min) min = value;
    if (value > max) max = value;
    const delta = value - mean;
    mean += delta / (index + 1);
    m2 += delta * (value - mean);
  }

  const variance = values.length > 1 ? m2 / (values.length - 1) : 0;

  return {
    min,
    max,
    mean,
    last: values[values.length - 1]!,
    stdDev: Math.sqrt(variance),
    count: values.length,
    delta: values[values.length - 1]! - values[0]!,
  };
}

/**
 * Coefficient of variation — standard deviation relative to the mean.
 *
 * This is the instability signal fed into the health score. It is scale-free,
 * so one formula works for a 2.5°C cold store and a 1,013 hPa pressure
 * reading. The `+ 1` floor on the denominator keeps metrics that legitimately
 * sit near zero (motion counts) from reporting infinite instability.
 */
export function coefficientOfVariation(stats: MetricStats): number {
  if (stats.count < 2) return 0;
  const scale = Math.max(Math.abs(stats.mean), 1);
  return stats.stdDev / scale;
}

/** Percentile over an unsorted array (nearest-rank). Does not mutate input. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank]!;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Exponentially weighted moving average. Used for the smoothed KPI readouts
 * so headline numbers do not jitter every tick.
 */
export function ewma(previous: number | null, next: number, alpha: number): number {
  if (previous === null || !Number.isFinite(previous)) return next;
  return previous + alpha * (next - previous);
}
