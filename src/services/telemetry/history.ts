import type { SiteDescriptor } from "@/services/simulator/locations";
import { ambientForMetric } from "@/services/simulator/profiles";
import {
  createSignalState,
  readSignal,
  stepSignal,
  type SignalConfig,
} from "@/services/simulator/signals";
import type { AggregatedPoint, MetricKey, TimeRangeKey } from "@/types/telemetry";
import { TIME_RANGES } from "@/types/telemetry";
import { clamp, createRng, deriveSeed } from "@/utils/random";

/**
 * Long-range history synthesis.
 *
 * The live ring buffers hold minutes to hours of telemetry — keeping 30 days
 * of real samples for thousands of devices in a browser tab is not a sensible
 * trade. But a 30-day chart still has to show something truthful, so history
 * beyond the live window is *regenerated* from the same signal model that
 * produced the live data, seeded per device and metric.
 *
 * Two properties make this honest rather than decorative:
 *
 * - **Deterministic.** The same device and range always yields the same curve,
 *   so a chart does not reshuffle itself every time it is re-opened.
 * - **Anchored.** The synthesised tail is offset so it meets the device's
 *   current reading, which means the historical line joins the live line
 *   instead of jumping at the seam.
 *
 * The real-world equivalent would be querying a downsampled rollup table on
 * the server; this is the frontend-only stand-in for that, and it is clearly
 * labelled as synthetic in the UI.
 */

export interface SynthesiseOptions {
  readonly deviceId: string;
  readonly metric: MetricKey;
  readonly config: SignalConfig;
  readonly site: SiteDescriptor;
  readonly from: number;
  readonly to: number;
  readonly buckets: number;
  readonly faulty: boolean;
  /** Current live reading. When provided, the series is offset to meet it. */
  readonly anchorValue?: number;
}

export function synthesiseHistory(options: SynthesiseOptions): readonly AggregatedPoint[] {
  const { from, to, buckets, config, site, metric } = options;
  const span = to - from;
  if (span <= 0 || buckets <= 1) return [];

  const stepMs = span / buckets;
  const dtSeconds = stepMs / 1000;
  const rng = createRng(deriveSeed(0x4157, `${options.deviceId}:${metric}:${from}`));
  let state = createSignalState(config, rng);

  const timestamps: number[] = [];
  const raw: number[] = [];

  // A faulty device gets a handful of fault episodes scattered through the
  // window, so its history looks as troubled as its present.
  const episodes: readonly [number, number][] = options.faulty
    ? buildFaultEpisodes(from, to, rng.next())
    : [];

  for (let index = 0; index < buckets; index += 1) {
    const at = from + index * stepMs;
    const faultActive = episodes.some(([start, end]) => at >= start && at <= end);
    state = stepSignal(config, state, {
      dtSeconds,
      rng,
      ambient: ambientForMetric(metric, site, at, config),
      faultActive,
    });
    timestamps.push(at);
    raw.push(readSignal(config, state));
  }

  // Anchor the tail to the live value, preserving shape.
  let offset = 0;
  if (options.anchorValue !== undefined && raw.length > 0) {
    offset = options.anchorValue - raw[raw.length - 1]!;
  }

  const points: AggregatedPoint[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = clamp(raw[index]! + offset, config.min, config.max);
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

/** Two to four fault windows spread across the range. */
function buildFaultEpisodes(
  from: number,
  to: number,
  roll: number,
): readonly [number, number][] {
  const span = to - from;
  const count = 2 + Math.floor(roll * 3);
  const episodes: [number, number][] = [];
  for (let index = 0; index < count; index += 1) {
    const start = from + span * ((index + 0.5 + roll * 0.4) / count);
    episodes.push([start, start + Math.min(span * 0.06, 3 * 3_600_000)]);
  }
  return episodes;
}

/**
 * Builds a complete series for a range, stitching synthesised history to live
 * samples. `liveFrom` is the oldest timestamp actually held in memory.
 */
export function stitchSeries(
  synthetic: readonly AggregatedPoint[],
  live: readonly AggregatedPoint[],
): readonly AggregatedPoint[] {
  if (live.length === 0) return synthetic;
  if (synthetic.length === 0) return live;
  const liveStart = live[0]!.timestamp;
  const head = synthetic.filter((point) => point.timestamp < liveStart);
  return [...head, ...live];
}

/** Whether a range extends further back than the live buffer can cover. */
export function needsSynthesis(
  range: TimeRangeKey,
  oldestLiveTimestamp: number | undefined,
  now: number,
): boolean {
  if (oldestLiveTimestamp === undefined) return true;
  const windowStart = now - TIME_RANGES[range].durationMs;
  // Allow a small tolerance so a buffer that covers all but a few seconds of
  // the window is not needlessly supplemented.
  return oldestLiveTimestamp > windowStart + 5000;
}
