"use client";

import { AlertTriangle, Battery, BatteryLow, Signal, SignalLow } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { BreachLevel } from "@/types/alerts";
import type { MetricKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import { formatMetricValue } from "@/utils/formatting";

/**
 * Metric presentation primitives.
 *
 * All of these keep the same contract: `undefined` means "this device does not
 * report this metric", and renders an em dash rather than a zero. Conflating
 * "no sensor" with "reading of zero" is the single most common way a fleet
 * dashboard ends up lying to its operators.
 */

export interface MetricValueProps {
  readonly metric: MetricKey;
  readonly value: number | undefined;
  readonly level?: BreachLevel;
  /** Shows the metric name alongside the value. */
  readonly showLabel?: boolean;
  readonly className?: string;
}

export function MetricValue({
  metric,
  value,
  level,
  showLabel,
  className,
}: MetricValueProps) {
  const descriptor = METRIC_DESCRIPTORS[metric];
  const missing = value === undefined;

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      {showLabel ? (
        <span className="text-xs text-muted-foreground">{descriptor.label}</span>
      ) : null}
      <span
        className={cn(
          "tabular text-sm font-medium",
          missing && "text-muted-foreground",
          level === "warning" && "text-status-warning",
          level === "critical" && "text-status-critical",
        )}
      >
        {formatMetricValue(metric, value)}
      </span>
      {level ? (
        <AlertTriangle
          className={cn(
            "size-3",
            level === "critical" ? "text-status-critical" : "text-status-warning",
          )}
          aria-label={`${descriptor.label} is ${level}`}
        />
      ) : null}
    </span>
  );
}

export interface BatteryCellProps {
  readonly value: number;
  /** Mains-powered devices have no battery to report. */
  readonly mainsPowered?: boolean;
  readonly className?: string;
}

/**
 * Battery with a proportional bar.
 *
 * The bar is the fast read; the number is the precise one. Colour thresholds
 * match the fleet default alert bands so the table agrees with the alert list.
 */
export function BatteryCell({ value, mainsPowered, className }: BatteryCellProps) {
  if (mainsPowered) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)} title="Mains powered">
        AC
      </span>
    );
  }

  const tone =
    value < 10
      ? "bg-status-critical"
      : value < 20
        ? "bg-status-warning"
        : "bg-status-online";
  const Icon = value < 20 ? BatteryLow : Battery;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          value < 10
            ? "text-status-critical"
            : value < 20
              ? "text-status-warning"
              : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span
        className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Battery ${Math.round(value)} percent`}
      >
        <span
          className={cn("block h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </span>
      <span className="tabular text-xs text-muted-foreground">{Math.round(value)}%</span>
    </span>
  );
}

export interface SignalCellProps {
  readonly value: number;
  readonly className?: string;
}

/**
 * Signal strength as discrete bars.
 *
 * dBm is a figure most people cannot read at a glance, so the bars carry the
 * meaning and the number is available for anyone who wants it. Bar count is
 * derived from the usable −110…−55 dBm range.
 */
export function SignalCell({ value, className }: SignalCellProps) {
  const bars = value >= -65 ? 4 : value >= -80 ? 3 : value >= -95 ? 2 : value >= -105 ? 1 : 0;
  const tone =
    bars <= 1 ? "bg-status-critical" : bars === 2 ? "bg-status-warning" : "bg-status-online";
  const Icon = bars <= 1 ? SignalLow : Signal;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span
        className="flex items-end gap-0.5"
        role="img"
        aria-label={`Signal ${Math.round(value)} dBm, ${bars} of 4 bars`}
      >
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              "w-1 rounded-sm transition-colors",
              index < bars ? tone : "bg-muted",
            )}
            style={{ height: `${4 + index * 2.5}px` }}
          />
        ))}
      </span>
      <span className="tabular text-xs text-muted-foreground">{Math.round(value)}</span>
    </span>
  );
}

export interface HealthBarProps {
  readonly score: number;
  readonly className?: string;
  /** Hides the numeric score, leaving only the bar. */
  readonly barOnly?: boolean;
  readonly width?: string;
}

export function HealthBar({ score, className, barOnly, width = "3.5rem" }: HealthBarProps) {
  const tone =
    score >= 80 ? "bg-status-online" : score >= 50 ? "bg-status-warning" : "bg-status-critical";
  const textTone =
    score >= 80
      ? "text-status-online"
      : score >= 50
        ? "text-status-warning"
        : "text-status-critical";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted"
        style={{ width }}
        role="img"
        aria-label={`Health score ${score} of 100`}
      >
        <span
          className={cn("block h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </span>
      {barOnly ? null : (
        <span className={cn("tabular text-xs font-medium", textTone)}>{score}</span>
      )}
    </span>
  );
}

export interface MetricChipProps {
  readonly metric: MetricKey;
  readonly children?: ReactNode;
  readonly className?: string;
}

/** A colour-keyed metric label, matching the chart series colour. */
export function MetricChip({ metric, children, className }: MetricChipProps) {
  const descriptor = METRIC_DESCRIPTORS[metric];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <span
        className="size-2 shrink-0 rounded-sm"
        style={{ background: descriptor.chartColor }}
        aria-hidden="true"
      />
      <span className="truncate">{children ?? descriptor.label}</span>
    </span>
  );
}
