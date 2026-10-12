import type {
  AggregatedPoint,
  MetricKey,
  TimeRangeKey,
} from "@/types/telemetry";
import { TIME_RANGES } from "@/types/telemetry";

/**
 * Telemetry aggregation.
 *
 * A 30-day window at the simulator's live cadence is on the order of hundreds
 * of thousands of samples. Handing that to a chart is both pointless — there
 * are ~1,200 horizontal pixels to draw into — and ruinous for frame time. So
 * raw samples are bucketed by time before rendering.
 *
 * The important detail is that every bucket keeps `min` and `max` alongside
 * the aggregated value. Downsampling by mean alone hides exactly the events an
 * operations team cares about: a 48°C spike inside a 10-minute bucket averages
 * away to nothing. Charts render the envelope behind the line, so a
 * downsampled series still shows that something happened.
 */

export type AggregationMode = "mean" | "max" | "min" | "last" | "sum";

/**
 * Per-metric aggregation choice. Counters sum, levels take the last reading,
 * and continuous measurements average.
 */
export const METRIC_AGGREGATION: Readonly<Record<MetricKey, AggregationMode>> = {
  temperature: "mean",
  humidity: "mean",
  battery: "last",
  signalStrength: "mean",
  powerConsumption: "mean",
  pressure: "mean",
  airQuality: "mean",
  motion: "sum",
};

export interface AggregateOptions {
  readonly mode?: AggregationMode;
  /** Number of output buckets. Defaults to the range's configured target. */
  readonly buckets?: number;
  readonly from?: number;
  readonly to?: number;
}

/**
 * Buckets a time series into at most `buckets` points.
 *
 * Inputs must be sorted ascending by timestamp, which the ring buffer
 * guarantees. Empty buckets are omitted rather than zero-filled so a gap in
 * telemetry reads as a gap, not as a drop to zero.
 */
export function aggregateSeries(
  timestamps: readonly number[],
  values: readonly number[],
  options: AggregateOptions = {},
): readonly AggregatedPoint[] {
  const length = Math.min(timestamps.length, values.length);
  if (length === 0) return [];

  const from = options.from ?? timestamps[0]!;
  const to = options.to ?? timestamps[length - 1]!;
  const bucketCount = Math.max(1, options.buckets ?? 120);
  const mode = options.mode ?? "mean";

  const span = to - from;
  if (span <= 0) {
    const value = values[length - 1]!;
    return [{ timestamp: to, value, min: value, max: value, count: 1 }];
  }

  // If there are fewer samples than buckets, bucketing would only invent
  // structure. Pass the raw samples through instead.
  if (length <= bucketCount) {
    const points: AggregatedPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const timestamp = timestamps[index]!;
      if (timestamp < from || timestamp > to) continue;
      const value = values[index]!;
      points.push({ timestamp, value, min: value, max: value, count: 1 });
    }
    return points;
  }

  const bucketMs = span / bucketCount;
  const sums = new Float64Array(bucketCount);
  const mins = new Float64Array(bucketCount).fill(Number.POSITIVE_INFINITY);
  const maxs = new Float64Array(bucketCount).fill(Number.NEGATIVE_INFINITY);
  const lasts = new Float64Array(bucketCount);
  const counts = new Uint32Array(bucketCount);

  for (let index = 0; index < length; index += 1) {
    const timestamp = timestamps[index]!;
    if (timestamp < from || timestamp > to) continue;
    const bucket = Math.min(bucketCount - 1, Math.floor((timestamp - from) / bucketMs));
    const value = values[index]!;
    sums[bucket] += value;
    if (value < mins[bucket]!) mins[bucket] = value;
    if (value > maxs[bucket]!) maxs[bucket] = value;
    lasts[bucket] = value;
    counts[bucket] += 1;
  }

  const points: AggregatedPoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const count = counts[bucket]!;
    if (count === 0) continue;
    const min = mins[bucket]!;
    const max = maxs[bucket]!;
    const sum = sums[bucket]!;
    const value =
      mode === "mean"
        ? sum / count
        : mode === "max"
          ? max
          : mode === "min"
            ? min
            : mode === "sum"
              ? sum
              : lasts[bucket]!;
    points.push({
      // Bucket centre, so the line sits in the middle of the interval it
      // summarises rather than being biased to its left edge.
      timestamp: from + bucket * bucketMs + bucketMs / 2,
      value,
      min,
      max,
      count,
    });
  }

  return points;
}

/** Convenience wrapper that pulls bucket count and window from a range key. */
export function aggregateForRange(
  timestamps: readonly number[],
  values: readonly number[],
  range: TimeRangeKey,
  metric: MetricKey,
  now: number,
): readonly AggregatedPoint[] {
  const { durationMs, buckets } = TIME_RANGES[range];
  return aggregateSeries(timestamps, values, {
    mode: METRIC_AGGREGATION[metric],
    buckets,
    from: now - durationMs,
    to: now,
  });
}

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Offered alongside bucketed aggregation because the two answer different
 * questions. Bucketing answers "what was the average over each interval";
 * LTTB answers "which samples best preserve the shape of this line". For
 * sparklines, where there is no room for a min/max envelope, shape matters
 * more than exact per-interval statistics.
 */
export function downsampleLttb(
  timestamps: readonly number[],
  values: readonly number[],
  threshold: number,
): readonly AggregatedPoint[] {
  const length = Math.min(timestamps.length, values.length);
  if (threshold >= length || threshold < 3) {
    const points: AggregatedPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const value = values[index]!;
      points.push({
        timestamp: timestamps[index]!,
        value,
        min: value,
        max: value,
        count: 1,
      });
    }
    return points;
  }

  const sampled: AggregatedPoint[] = [];
  const bucketSize = (length - 2) / (threshold - 2);

  const point = (index: number): AggregatedPoint => {
    const value = values[index]!;
    return { timestamp: timestamps[index]!, value, min: value, max: value, count: 1 };
  };

  sampled.push(point(0));
  let previous = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    // Mean of the *next* bucket forms the third triangle vertex.
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, length);
    let avgTime = 0;
    let avgValue = 0;
    const nextCount = Math.max(1, nextEnd - nextStart);
    for (let index = nextStart; index < nextEnd; index += 1) {
      avgTime += timestamps[index]!;
      avgValue += values[index]!;
    }
    avgTime /= nextCount;
    avgValue /= nextCount;

    const rangeStart = Math.floor(bucket * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, length);

    let bestArea = -1;
    let bestIndex = rangeStart;
    const previousTime = timestamps[previous]!;
    const previousValue = values[previous]!;

    for (let index = rangeStart; index < rangeEnd; index += 1) {
      const area = Math.abs(
        (previousTime - avgTime) * (values[index]! - previousValue) -
          (previousTime - timestamps[index]!) * (avgValue - previousValue),
      );
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    }

    sampled.push(point(bestIndex));
    previous = bestIndex;
  }

  sampled.push(point(length - 1));
  return sampled;
}

/** Merges several device series onto one shared time axis for comparison. */
export interface ComparisonRow {
  readonly timestamp: number;
  readonly [deviceId: string]: number | undefined;
}

export function mergeSeriesForComparison(
  series: readonly { deviceId: string; points: readonly AggregatedPoint[] }[],
): readonly ComparisonRow[] {
  const byTimestamp = new Map<number, Record<string, number>>();

  for (const entry of series) {
    for (const point of entry.points) {
      let row = byTimestamp.get(point.timestamp);
      if (!row) {
        row = {};
        byTimestamp.set(point.timestamp, row);
      }
      row[entry.deviceId] = point.value;
    }
  }

  return [...byTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, values]) => ({ timestamp, ...values }) as ComparisonRow);
}
