"use client";

import { useEffect, useRef } from "react";

import { useReducedMotion } from "@/hooks/useKeyboardShortcuts";
import type { DeviceStatus } from "@/types/device";
import type { AggregatedPoint, MetricKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import { cn } from "@/lib/utils";
import { ELEMENT_NAMES } from "@/web-components/registry";
import type { DeviceStatusElement } from "@/web-components/device-status/DeviceStatusElement";
import type { SensorGaugeElement, GaugeStatus } from "@/web-components/sensor-gauge/SensorGaugeElement";
import type { ChartTone, TelemetryChartElement } from "@/web-components/telemetry-chart/TelemetryChartElement";

/**
 * React ↔ Web Component bridges.
 *
 * These thin wrappers are the only place React talks to the custom elements.
 * The pattern in each is the same and is the whole point of the exercise:
 *
 * - **Configuration** (ranges, labels, tone) goes through attributes, because
 *   it changes rarely and attributes are declarative and inspectable.
 * - **Data** (the live value, the series) is assigned to element *properties*
 *   through a ref inside an effect. React therefore never re-renders when the
 *   data changes — it only re-renders when the configuration does — and the
 *   element repaints itself on its own animation frame.
 *
 * The result is that a table of 50 sparklines updating twice a second costs
 * zero React renders and 50 canvas strokes.
 */

export interface SensorGaugeProps {
  readonly metric: MetricKey;
  readonly value: number | undefined;
  readonly status?: GaugeStatus;
  /** Overrides the metric's default display domain. */
  readonly domain?: readonly [number, number];
  readonly className?: string;
}

export function SensorGauge({
  metric,
  value,
  status = "normal",
  domain,
  className,
}: SensorGaugeProps) {
  const ref = useRef<SensorGaugeElement | null>(null);
  const descriptor = METRIC_DESCRIPTORS[metric];
  const reducedMotion = useReducedMotion();
  const [min, max] = domain ?? descriptor.domain;

  // Configuration: one call rather than four attribute writes, so the element
  // repaints once when the metric changes.
  useEffect(() => {
    ref.current?.configure({
      min,
      max,
      unit: descriptor.unit,
      label: descriptor.label,
      decimals: descriptor.decimals,
    });
  }, [min, max, descriptor]);

  // Data: a property assignment, not a render.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.value = value ?? Number.NaN;
  }, [value]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.status = status;
  }, [status]);

  return (
    <nexora-sensor-gauge
      ref={ref}
      className={cn("block h-full w-full", className)}
      reduced-motion={reducedMotion ? "true" : "false"}
    />
  );
}

export interface TelemetrySparklineProps {
  readonly points: readonly AggregatedPoint[];
  readonly metric?: MetricKey;
  readonly tone?: ChartTone;
  readonly label?: string;
  readonly fill?: boolean;
  readonly baseline?: number;
  readonly className?: string;
}

export function TelemetrySparkline({
  points,
  metric,
  tone = "neutral",
  label,
  fill = true,
  baseline,
  className,
}: TelemetrySparklineProps) {
  const ref = useRef<TelemetryChartElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Flatten once here rather than storing point objects in the element.
    const timestamps = points.map((point) => point.timestamp);
    const values = points.map((point) => point.value);
    element.setSeries(timestamps, values);
  }, [points]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.tone = tone;
  }, [tone]);

  return (
    <nexora-telemetry-chart
      ref={ref}
      className={cn("block h-full w-full", className)}
      label={label ?? (metric ? METRIC_DESCRIPTORS[metric].label : undefined)}
      fill={fill ? "true" : "false"}
      baseline={baseline}
    />
  );
}

export interface StatusIndicatorProps {
  readonly status: DeviceStatus;
  /** Hides the text label, leaving the glyph. */
  readonly compact?: boolean;
  readonly uppercase?: boolean;
  /** Animates the glyph — reserve for states that are actively changing. */
  readonly pulse?: boolean;
  readonly className?: string;
}

export function StatusIndicator({
  status,
  compact,
  uppercase,
  pulse,
  className,
}: StatusIndicatorProps) {
  const ref = useRef<DeviceStatusElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.status = status;
  }, [status]);

  return (
    <nexora-device-status
      ref={ref}
      status={status}
      className={cn("align-middle", className)}
      {...(compact ? { compact: "true" } : {})}
      {...(uppercase ? { uppercase: "true" } : {})}
      {...(pulse ? { pulse: "true" } : {})}
    />
  );
}

/** Element tag names, re-exported for tests and documentation. */
export { ELEMENT_NAMES };
