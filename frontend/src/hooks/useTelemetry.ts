"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { useCoarseNow } from "@/hooks/useClock";

import { simulationEngine } from "@/services/simulator/simulationEngine";
import { aggregateForRange, downsampleLttb } from "@/services/telemetry/aggregation";
import { needsSynthesis, stitchSeries, synthesiseHistory } from "@/services/telemetry/history";
import { telemetryRepository } from "@/services/telemetry/telemetryRepository";
import type {
  AggregatedPoint,
  MetricKey,
  MetricStats,
  TimeRangeKey,
} from "@/types/telemetry";
import { TIME_RANGES } from "@/types/telemetry";
import { EMPTY_METRIC_STATS } from "@/utils/calculations/stats";

/**
 * React access to the telemetry repository.
 *
 * The repository is not a React store — it is written to thousands of times a
 * second. `useSyncExternalStore` over its throttled revision counter is what
 * lets components read always-current data while only re-rendering a few times
 * per second. Returning the revision (a number) as the snapshot is deliberate:
 * it is referentially stable, so React's bail-out works, and the actual data is
 * pulled imperatively inside a `useMemo` keyed on it.
 */
export function useTelemetryRevisionSignal(): number {
  return useSyncExternalStore(
    telemetryRepository.subscribe,
    telemetryRepository.getRevision,
    // Server snapshot: no telemetry exists during SSR, and returning a
    // constant avoids a hydration mismatch.
    () => 0,
  );
}

/**
 * Promotes a device to the repository's hot tier for as long as the component
 * is mounted, so its chart has a full-resolution buffer to draw from.
 */
export function useObservedDevice(deviceId: string | null | undefined): void {
  useEffect(() => {
    if (!deviceId) return;
    return telemetryRepository.observe(deviceId);
  }, [deviceId]);
}

/** Latest reading for one metric. Re-renders at the repository's throttle. */
export function useLiveMetric(
  deviceId: string | null | undefined,
  metric: MetricKey,
): number | undefined {
  const revision = useTelemetryRevisionSignal();
  return useMemo(() => {
    // `revision` is this memo's invalidation signal: the data is read
    // imperatively out of the repository below, so nothing else in the
    // dependency list changes when new samples land.
    void revision;
    if (!deviceId) return undefined;
    return telemetryRepository.getLatest(deviceId, metric);
  }, [deviceId, metric, revision]);
}

export interface TelemetrySeries {
  readonly points: readonly AggregatedPoint[];
  readonly stats: MetricStats;
  /** True when part of the window was regenerated rather than recorded. */
  readonly synthesised: boolean;
  /** Timestamp from which points are real recorded samples. */
  readonly liveFrom: number | undefined;
}

const EMPTY_SERIES: TelemetrySeries = {
  points: [],
  stats: EMPTY_METRIC_STATS,
  synthesised: false,
  liveFrom: undefined,
};

/**
 * A chart-ready series for one device and metric over a time range.
 *
 * Live samples are aggregated from the ring buffer; anything older than the
 * buffer is synthesised from the device's generative model and stitched in
 * front. `synthesised` is surfaced so the UI can say so rather than passing
 * regenerated history off as recorded data.
 */
export function useTelemetrySeries(
  deviceId: string | null | undefined,
  metric: MetricKey,
  range: TimeRangeKey,
): TelemetrySeries {
  const revision = useTelemetryRevisionSignal();
  useObservedDevice(deviceId);

  // The window is quantised to the range's bucket width and read from the
  // shared clock rather than `Date.now()`. Two reasons: calling an impure
  // function during render makes the result unstable across re-renders, and
  // quantising means the expensive history synthesis below is only recomputed
  // once per bucket instead of on every repaint.
  const bucketMs = TIME_RANGES[range].durationMs / TIME_RANGES[range].buckets;
  const quantisedNow = useCoarseNow(bucketMs);

  return useMemo(() => {
    // `revision` is this memo's invalidation signal: the data is read
    // imperatively out of the repository below, so nothing else in the
    // dependency list changes when new samples land.
    void revision;
    // The clock reports 0 until mounted, which keeps server and client markup
    // identical. There is no window to aggregate yet.
    if (!deviceId || quantisedNow === 0) return EMPTY_SERIES;

    const { durationMs } = TIME_RANGES[range];
    const from = quantisedNow - durationMs;

    const { timestamps, values } = telemetryRepository.getSeries(deviceId, metric, from);
    const live = aggregateForRange(timestamps, values, range, metric, quantisedNow);
    const stats = telemetryRepository.getStats(deviceId, metric, from);
    const oldest = telemetryRepository.getOldestTimestamp(deviceId, metric);

    if (!needsSynthesis(range, oldest, quantisedNow)) {
      return { points: live, stats, synthesised: false, liveFrom: oldest };
    }

    const model = simulationEngine.getModel(deviceId);
    const config = model?.profile[metric];
    if (!model || !config) {
      return { points: live, stats, synthesised: false, liveFrom: oldest };
    }

    const synthetic = synthesiseHistory({
      deviceId,
      metric,
      config,
      site: model.site,
      from,
      to: oldest ?? quantisedNow,
      buckets: TIME_RANGES[range].buckets,
      faulty: model.faulty,
      anchorValue: live[0]?.value ?? telemetryRepository.getLatest(deviceId, metric),
    });

    return {
      points: stitchSeries(synthetic, live),
      stats,
      synthesised: true,
      liveFrom: oldest,
    };
  }, [deviceId, metric, range, quantisedNow, revision]);
}

/**
 * A compact shape-preserving series for sparklines.
 *
 * Uses LTTB rather than bucketed means: a sparkline has no room for a min/max
 * envelope, so preserving the visual shape matters more than per-interval
 * statistics.
 */
export function useSparkline(
  deviceId: string | null | undefined,
  metric: MetricKey,
  points = 32,
): readonly AggregatedPoint[] {
  const revision = useTelemetryRevisionSignal();

  return useMemo(() => {
    // `revision` is this memo's invalidation signal: the data is read
    // imperatively out of the repository below, so nothing else in the
    // dependency list changes when new samples land.
    void revision;
    if (!deviceId) return [];
    const { timestamps, values } = telemetryRepository.getSeries(deviceId, metric);
    if (timestamps.length === 0) return [];
    return downsampleLttb(timestamps, values, points);
  }, [deviceId, metric, points, revision]);
}

/** Every metric a device is currently reporting, with its latest value. */
export function useDeviceMetrics(
  deviceId: string | null | undefined,
): readonly { metric: MetricKey; value: number | undefined }[] {
  const revision = useTelemetryRevisionSignal();

  return useMemo(() => {
    // `revision` is this memo's invalidation signal: the data is read
    // imperatively out of the repository below, so nothing else in the
    // dependency list changes when new samples land.
    void revision;
    if (!deviceId) return [];
    return telemetryRepository.getMetrics(deviceId).map((metric) => ({
      metric,
      value: telemetryRepository.getLatest(deviceId, metric),
    }));
  }, [deviceId, revision]);
}

export interface ComparisonSeries {
  readonly deviceId: string;
  readonly points: readonly AggregatedPoint[];
}

/** Aligned series for several devices, for the comparison chart. */
export function useComparisonSeries(
  deviceIds: readonly string[],
  metric: MetricKey,
  range: TimeRangeKey,
): readonly ComparisonSeries[] {
  const revision = useTelemetryRevisionSignal();

  // Observe every compared device so each has a full-resolution buffer.
  const observedRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const observed = observedRef.current;
    for (const deviceId of deviceIds) {
      if (!observed.has(deviceId)) observed.set(deviceId, telemetryRepository.observe(deviceId));
    }
    for (const [deviceId, release] of observed) {
      if (!deviceIds.includes(deviceId)) {
        release();
        observed.delete(deviceId);
      }
    }
  }, [deviceIds]);

  useEffect(
    () => () => {
      for (const release of observedRef.current.values()) release();
      observedRef.current.clear();
    },
    [],
  );

  const bucketMs = TIME_RANGES[range].durationMs / TIME_RANGES[range].buckets;
  const quantisedNow = useCoarseNow(bucketMs);

  return useMemo(() => {
    // `revision` is this memo's invalidation signal: the data is read
    // imperatively out of the repository below, so nothing else in the
    // dependency list changes when new samples land.
    void revision;
    if (quantisedNow === 0) return [];
    const from = quantisedNow - TIME_RANGES[range].durationMs;
    return deviceIds.map((deviceId) => {
      const { timestamps, values } = telemetryRepository.getSeries(deviceId, metric, from);
      return {
        deviceId,
        points: aggregateForRange(timestamps, values, range, metric, quantisedNow),
      };
    });
  }, [deviceIds, metric, range, quantisedNow, revision]);
}
