import { describe, expect, it } from "vitest";

import {
  aggregateSeries,
  downsampleLttb,
  mergeSeriesForComparison,
} from "@/services/telemetry/aggregation";
import { MetricRing } from "@/services/telemetry/ringBuffer";
import { needsSynthesis, synthesiseHistory } from "@/services/telemetry/history";
import { SITES } from "@/services/simulator/locations";
import { buildMetricProfile } from "@/services/simulator/profiles";
import { createRng } from "@/utils/random";

const SITE = SITES[0]!;

/** Builds a series with one sample per second starting at `from`. */
function series(
  from: number,
  count: number,
  valueAt: (index: number) => number,
): { timestamps: number[]; values: number[] } {
  const timestamps: number[] = [];
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    timestamps.push(from + index * 1000);
    values.push(valueAt(index));
  }
  return { timestamps, values };
}

describe("aggregateSeries", () => {
  it("reduces a large series to the requested bucket count", () => {
    const { timestamps, values } = series(0, 10_000, (index) => index);
    const points = aggregateSeries(timestamps, values, { buckets: 100 });
    expect(points.length).toBeLessThanOrEqual(100);
    expect(points.length).toBeGreaterThan(90);
  });

  it("passes raw samples through when there are fewer than buckets", () => {
    const { timestamps, values } = series(0, 12, (index) => index * 2);
    const points = aggregateSeries(timestamps, values, { buckets: 120 });
    expect(points).toHaveLength(12);
    expect(points.map((point) => point.value)).toEqual(values);
  });

  it("preserves spikes in min/max even when the mean hides them", () => {
    // 600 samples at 20, with a single 48 spike — the kind of event that must
    // never be averaged out of existence.
    const { timestamps, values } = series(0, 600, (index) => (index === 300 ? 48 : 20));
    const points = aggregateSeries(timestamps, values, { buckets: 10, mode: "mean" });

    const spikeBucket = points.find((point) => point.max > 40);
    expect(spikeBucket).toBeDefined();
    // The mean barely moves; the envelope records the truth.
    expect(spikeBucket!.value).toBeLessThan(21);
    expect(spikeBucket!.max).toBe(48);
    expect(Math.max(...points.map((point) => point.max))).toBe(48);
  });

  it("omits empty buckets so gaps read as gaps, not as zeros", () => {
    const timestamps = [0, 1000, 2000, 60_000, 61_000];
    const values = [5, 6, 7, 8, 9];
    const points = aggregateSeries(timestamps, values, { buckets: 20, from: 0, to: 61_000 });

    expect(points.every((point) => point.count > 0)).toBe(true);
    expect(points.every((point) => point.value !== 0)).toBe(true);
    expect(points.length).toBeLessThan(20);
  });

  it("applies the aggregation mode", () => {
    const { timestamps, values } = series(0, 100, (index) => index);

    expect(aggregateSeries(timestamps, values, { buckets: 1, mode: "max" })[0]!.value).toBe(99);
    expect(aggregateSeries(timestamps, values, { buckets: 1, mode: "min" })[0]!.value).toBe(0);
    expect(aggregateSeries(timestamps, values, { buckets: 1, mode: "last" })[0]!.value).toBe(99);
    expect(aggregateSeries(timestamps, values, { buckets: 1, mode: "sum" })[0]!.value).toBe(4950);
    expect(aggregateSeries(timestamps, values, { buckets: 1, mode: "mean" })[0]!.value).toBeCloseTo(49.5);
  });

  it("excludes samples outside the requested window", () => {
    const { timestamps, values } = series(0, 1000, () => 1);
    const points = aggregateSeries(timestamps, values, {
      buckets: 10,
      from: 500_000,
      to: 999_000,
    });
    const total = points.reduce((sum, point) => sum + point.count, 0);
    expect(total).toBeLessThan(1000);
    expect(total).toBeGreaterThan(400);
  });

  it("returns nothing for an empty series", () => {
    expect(aggregateSeries([], [], { buckets: 10 })).toEqual([]);
  });

  it("places bucket timestamps at interval centres", () => {
    const { timestamps, values } = series(0, 1000, () => 1);
    const points = aggregateSeries(timestamps, values, { buckets: 2, from: 0, to: 1000 });
    expect(points[0]!.timestamp).toBe(250);
    expect(points[1]!.timestamp).toBe(750);
  });
});

describe("downsampleLttb", () => {
  it("keeps the first and last samples", () => {
    const { timestamps, values } = series(0, 500, (index) => Math.sin(index / 20) * 10);
    const points = downsampleLttb(timestamps, values, 50);

    expect(points).toHaveLength(50);
    expect(points[0]!.timestamp).toBe(timestamps[0]);
    expect(points[points.length - 1]!.timestamp).toBe(timestamps[499]);
  });

  it("retains an extreme that bucketed averaging would soften", () => {
    const { timestamps, values } = series(0, 500, (index) => (index === 250 ? 100 : 0));
    const points = downsampleLttb(timestamps, values, 40);
    expect(Math.max(...points.map((point) => point.value))).toBe(100);
  });

  it("passes through when the threshold exceeds the sample count", () => {
    const { timestamps, values } = series(0, 10, (index) => index);
    expect(downsampleLttb(timestamps, values, 50)).toHaveLength(10);
  });
});

describe("MetricRing", () => {
  it("overwrites oldest samples once full", () => {
    const ring = new MetricRing(4);
    for (let index = 0; index < 10; index += 1) ring.push(index * 1000, index);

    expect(ring.size).toBe(4);
    expect(ring.last).toBe(9);
    const { timestamps, values } = ring.toArrays();
    expect(values).toEqual([6, 7, 8, 9]);
    expect(timestamps).toEqual([6000, 7000, 8000, 9000]);
  });

  it("reports values in chronological order before it is full", () => {
    const ring = new MetricRing(8);
    ring.push(1000, 1);
    ring.push(2000, 2);
    expect(ring.toArrays().values).toEqual([1, 2]);
    expect(ring.firstTimestamp).toBe(1000);
    expect(ring.lastTimestamp).toBe(2000);
  });

  it("filters by timestamp", () => {
    const ring = new MetricRing(10);
    for (let index = 0; index < 10; index += 1) ring.push(index * 1000, index);
    expect(ring.valuesSince(7000)).toEqual([7, 8, 9]);
  });

  it("preserves the newest samples when grown", () => {
    const ring = new MetricRing(4);
    for (let index = 0; index < 6; index += 1) ring.push(index * 1000, index);

    ring.resize(10);
    expect(ring.capacity).toBe(10);
    expect(ring.toArrays().values).toEqual([2, 3, 4, 5]);

    ring.push(6000, 6);
    expect(ring.toArrays().values).toEqual([2, 3, 4, 5, 6]);
  });

  it("drops the oldest samples when shrunk", () => {
    const ring = new MetricRing(10);
    for (let index = 0; index < 10; index += 1) ring.push(index * 1000, index);

    ring.resize(3);
    expect(ring.toArrays().values).toEqual([7, 8, 9]);
  });

  it("is empty after clear", () => {
    const ring = new MetricRing(4);
    ring.push(1000, 1);
    ring.clear();
    expect(ring.isEmpty).toBe(true);
    expect(ring.last).toBeUndefined();
  });
});

describe("history synthesis", () => {
  it("is deterministic for the same device, metric and window", () => {
    const profile = buildMetricProfile("temperature-sensor", SITE, createRng(1), false);
    const options = {
      deviceId: "LAG-2048",
      metric: "temperature" as const,
      config: profile.temperature!,
      site: SITE,
      from: Date.UTC(2026, 2, 1),
      to: Date.UTC(2026, 2, 8),
      buckets: 168,
      faulty: false,
    };

    const first = synthesiseHistory(options);
    const second = synthesiseHistory(options);
    expect(first.map((point) => point.value)).toEqual(second.map((point) => point.value));
    expect(first).toHaveLength(168);
  });

  it("anchors the last point to the live reading so the seam is continuous", () => {
    const profile = buildMetricProfile("temperature-sensor", SITE, createRng(2), false);
    const points = synthesiseHistory({
      deviceId: "LAG-2048",
      metric: "temperature",
      config: profile.temperature!,
      site: SITE,
      from: Date.UTC(2026, 2, 1),
      to: Date.UTC(2026, 2, 2),
      buckets: 144,
      faulty: false,
      anchorValue: 27.4,
    });

    expect(points[points.length - 1]!.value).toBeCloseTo(27.4, 5);
  });

  it("stays within the signal's configured bounds", () => {
    const profile = buildMetricProfile("cold-storage-sensor", SITE, createRng(3), true);
    const config = profile.temperature!;
    const points = synthesiseHistory({
      deviceId: "LAG-9",
      metric: "temperature",
      config,
      site: SITE,
      from: Date.UTC(2026, 1, 1),
      to: Date.UTC(2026, 2, 3),
      buckets: 180,
      faulty: true,
      anchorValue: 2.5,
    });

    for (const point of points) {
      expect(point.value).toBeGreaterThanOrEqual(config.min);
      expect(point.value).toBeLessThanOrEqual(config.max);
    }
  });

  it("knows when the live buffer already covers the window", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 0);
    expect(needsSynthesis("1H", now - 3_600_000, now)).toBe(false);
    expect(needsSynthesis("24H", now - 3_600_000, now)).toBe(true);
    expect(needsSynthesis("1H", undefined, now)).toBe(true);
  });
});

describe("mergeSeriesForComparison", () => {
  it("merges device series onto one shared time axis", () => {
    const rows = mergeSeriesForComparison([
      {
        deviceId: "LAG-1",
        points: [
          { timestamp: 1000, value: 10, min: 10, max: 10, count: 1 },
          { timestamp: 2000, value: 11, min: 11, max: 11, count: 1 },
        ],
      },
      {
        deviceId: "LAG-2",
        points: [
          { timestamp: 1000, value: 20, min: 20, max: 20, count: 1 },
          { timestamp: 3000, value: 22, min: 22, max: 22, count: 1 },
        ],
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ timestamp: 1000, "LAG-1": 10, "LAG-2": 20 });
    // A device with no sample at that instant is simply absent, so the chart
    // can render a gap rather than inventing a zero.
    expect(rows[1]!["LAG-2"]).toBeUndefined();
    expect(rows[2]!["LAG-1"]).toBeUndefined();
  });
});
