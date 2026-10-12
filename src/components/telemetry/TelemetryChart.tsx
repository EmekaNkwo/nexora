"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/shared/states";
import type { MetricThreshold } from "@/types/alerts";
import type { AggregatedPoint, MetricKey, TimeRangeKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS, TIME_RANGES } from "@/types/telemetry";
import { formatMetricValue, formatShortTime, formatDateTime } from "@/utils/formatting";

/**
 * The interactive telemetry chart.
 *
 * Recharts is used *here* and not for the dense sparklines, and the split is
 * deliberate: this chart has one instance on screen, a tooltip, axes, a
 * threshold overlay and a min/max envelope — all things worth paying a React
 * render for. The fifty-per-table sparklines use the canvas Web Component
 * instead. Picking one library for both would mean either a heavyweight
 * sparkline or a crippled detail chart.
 *
 * The envelope (`min`/`max` per bucket) is drawn behind the mean line, so a
 * downsampled 30-day view still shows that a spike happened rather than
 * averaging it into invisibility.
 */

export interface TelemetryChartProps {
  readonly points: readonly AggregatedPoint[];
  readonly metric: MetricKey;
  readonly range: TimeRangeKey;
  /** Threshold bands drawn as reference lines and shaded regions. */
  readonly threshold?: MetricThreshold;
  readonly height?: number;
  /** Marks where regenerated history ends and recorded samples begin. */
  readonly liveFrom?: number;
  readonly showEnvelope?: boolean;
}

interface ChartRow {
  readonly timestamp: number;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Recharts renders an Area from a [low, high] tuple. */
  readonly band: readonly [number, number];
}

export function TelemetryChart({
  points,
  metric,
  range,
  threshold,
  height = 260,
  liveFrom,
  showEnvelope = true,
}: TelemetryChartProps) {
  const descriptor = METRIC_DESCRIPTORS[metric];

  const { rows, domain } = useMemo(() => {
    const mapped: ChartRow[] = points.map((point) => ({
      timestamp: point.timestamp,
      value: Number(point.value.toFixed(descriptor.decimals + 1)),
      min: point.min,
      max: point.max,
      band: [point.min, point.max] as const,
    }));

    if (mapped.length === 0) {
      return { rows: mapped, domain: descriptor.domain as readonly [number, number] };
    }

    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const row of mapped) {
      if (row.min < low) low = row.min;
      if (row.max > high) high = row.max;
    }

    // Widen the domain to include any threshold lines, so a band that is never
    // breached is still visible as context.
    if (threshold?.enabled) {
      for (const limit of [threshold.warning, threshold.critical, threshold.recovery]) {
        if (limit === null) continue;
        if (limit < low) low = limit;
        if (limit > high) high = limit;
      }
    }

    const padding = Math.max((high - low) * 0.12, 0.5);
    return {
      rows: mapped,
      domain: [low - padding, high + padding] as readonly [number, number],
    };
  }, [points, descriptor, threshold]);

  if (points.length === 0) {
    return (
      <div style={{ height }} className="grid place-items-center">
        <EmptyState
          compact
          title="No telemetry yet"
          description="Start the simulation to begin recording readings for this device."
        />
      </div>
    );
  }

  const spansDays = TIME_RANGES[range].durationMs > 36 * 3_600_000;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows as ChartRow[]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={descriptor.chartColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={descriptor.chartColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke="var(--grid-line)" strokeDasharray="2 4" vertical={false} />

        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(value: number) =>
            spansDays ? formatDateTime(value) : formatShortTime(value)
          }
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          stroke="var(--border)"
          minTickGap={48}
        />
        <YAxis
          domain={domain as [number, number]}
          tickFormatter={(value: number) => value.toFixed(descriptor.decimals)}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          stroke="var(--border)"
          width={44}
          unit={descriptor.unit}
        />

        {/* Threshold context: a shaded critical region plus labelled lines. */}
        {threshold?.enabled && threshold.critical !== null ? (
          <ReferenceArea
            y1={threshold.direction === "above" ? threshold.critical : domain[0]}
            y2={threshold.direction === "above" ? domain[1] : threshold.critical}
            fill="var(--status-critical)"
            fillOpacity={0.07}
            ifOverflow="hidden"
          />
        ) : null}

        {threshold?.enabled && threshold.warning !== null ? (
          <ReferenceLine
            y={threshold.warning}
            stroke="var(--status-warning)"
            strokeDasharray="4 4"
            strokeOpacity={0.85}
            label={{
              value: `warn ${threshold.warning}${descriptor.unit}`,
              position: "insideTopRight",
              fontSize: 9,
              fill: "var(--status-warning)",
            }}
          />
        ) : null}

        {threshold?.enabled && threshold.critical !== null ? (
          <ReferenceLine
            y={threshold.critical}
            stroke="var(--status-critical)"
            strokeDasharray="4 4"
            label={{
              value: `crit ${threshold.critical}${descriptor.unit}`,
              position: "insideBottomRight",
              fontSize: 9,
              fill: "var(--status-critical)",
            }}
          />
        ) : null}

        {/* Where synthesised history ends and recorded telemetry begins. */}
        {liveFrom !== undefined ? (
          <ReferenceLine
            x={liveFrom}
            stroke="var(--muted-foreground)"
            strokeDasharray="2 3"
            strokeOpacity={0.5}
            label={{
              value: "live",
              position: "insideTopLeft",
              fontSize: 9,
              fill: "var(--muted-foreground)",
            }}
          />
        ) : null}

        {showEnvelope ? (
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill={descriptor.chartColor}
            fillOpacity={0.14}
            isAnimationActive={false}
            // The envelope is decorative context; the line carries the value.
            activeDot={false}
            legendType="none"
          />
        ) : null}

        <Area
          type="monotone"
          dataKey="value"
          stroke="none"
          fill={`url(#fill-${metric})`}
          isAnimationActive={false}
          activeDot={false}
        />

        <Line
          type="monotone"
          dataKey="value"
          stroke={descriptor.chartColor}
          strokeWidth={1.75}
          dot={false}
          // Live data: animating every update would make the line visibly lag.
          isAnimationActive={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />

        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0]?.payload as ChartRow | undefined;
            if (!row) return null;
            const spread = row.max - row.min;
            return (
              <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
                <p className="tabular text-muted-foreground">
                  {formatDateTime(row.timestamp)}
                </p>
                <p className="tabular mt-1 font-medium">
                  {formatMetricValue(metric, row.value)}
                </p>
                {spread > 0.001 ? (
                  <p className="tabular mt-0.5 text-[0.7rem] text-muted-foreground">
                    range {formatMetricValue(metric, row.min)} –{" "}
                    {formatMetricValue(metric, row.max)}
                  </p>
                ) : null}
              </div>
            );
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
