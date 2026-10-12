"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { formatCompact, formatDelta } from "@/utils/formatting";

/**
 * The KPI tile.
 *
 * Two details make a tile like this usable in an operations context rather
 * than merely decorative:
 *
 * - **The number is the largest thing in it.** Label above, value dominant,
 *   context below — so a wall of tiles is scannable at a glance and from a
 *   distance.
 * - **Tabular figures.** These values change every second; proportional digits
 *   would make the number visibly jitter as a 1 becomes an 8.
 */

export type KpiTone = "neutral" | "online" | "offline" | "warning" | "critical" | "info";

const TONE_CLASSES: Record<KpiTone, string> = {
  neutral: "text-foreground",
  online: "text-status-online",
  offline: "text-status-offline",
  warning: "text-status-warning",
  critical: "text-status-critical",
  info: "text-status-updating",
};

const TONE_BORDER: Record<KpiTone, string> = {
  neutral: "border-border",
  online: "border-status-online/30",
  offline: "border-border",
  warning: "border-status-warning/35",
  critical: "border-status-critical/40",
  info: "border-status-updating/30",
};

export interface KpiTileProps {
  readonly label: string;
  readonly value: number | string;
  readonly tone?: KpiTone;
  /** Secondary line: a unit, a share, or a short qualifier. */
  readonly hint?: ReactNode;
  /** Signed change against the previous period. */
  readonly delta?: number;
  readonly deltaSuffix?: string;
  /** Inverts delta colouring for metrics where "up" is bad. */
  readonly invertDelta?: boolean;
  readonly icon?: ReactNode;
  readonly className?: string;
  /** Renders a compact variant for dense rows and mobile. */
  readonly compact?: boolean;
  readonly onClick?: () => void;
  readonly selected?: boolean;
}

export function KpiTile({
  label,
  value,
  tone = "neutral",
  hint,
  delta,
  deltaSuffix = "",
  invertDelta,
  icon,
  className,
  compact,
  onClick,
  selected,
}: KpiTileProps) {
  const display = typeof value === "number" ? formatCompact(value) : value;
  const hasDelta = delta !== undefined && Number.isFinite(delta) && delta !== 0;
  const deltaGood = hasDelta ? (invertDelta ? delta < 0 : delta > 0) : false;

  // Clickable tiles become real buttons so they are keyboard reachable and
  // announced as actionable; static tiles stay plain divs.
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "group flex min-w-0 flex-col justify-between rounded-lg border bg-card text-left transition-colors",
        TONE_BORDER[tone],
        compact ? "gap-1 p-3" : "gap-2 p-4",
        onClick && "hover:bg-accent/40 focus-visible:bg-accent/40",
        selected && "ring-1 ring-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="ops-label truncate">{label}</span>
        {icon ? (
          <span className={cn("shrink-0", TONE_CLASSES[tone])} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={cn(
            "tabular font-semibold leading-none tracking-tight",
            compact ? "text-xl" : "text-2xl",
            TONE_CLASSES[tone],
          )}
        >
          {display}
        </span>
        {hasDelta ? (
          <span
            className={cn(
              "tabular text-xs font-medium",
              deltaGood ? "text-status-online" : "text-status-critical",
            )}
          >
            {formatDelta(delta)}
            {deltaSuffix}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Component>
  );
}

export interface KpiGroupProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Minimum tile width before the grid reflows. */
  readonly minTileWidth?: number;
}

/**
 * Auto-fitting KPI grid.
 *
 * Uses `auto-fit` with a minimum track rather than fixed breakpoints, so the
 * row reflows based on the space it actually has — which matters because these
 * grids sit inside panels of varying width, not only at the page level.
 */
export function KpiGroup({ children, className, minTileWidth = 150 }: KpiGroupProps) {
  return (
    <div
      className={cn("grid gap-3", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${minTileWidth}px, 100%), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export interface StatBlockProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly className?: string;
  readonly tone?: KpiTone;
}

/** A label/value pair for detail panels — denser than a KPI tile. */
export function StatBlock({ label, value, className, tone = "neutral" }: StatBlockProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="ops-label truncate">{label}</p>
      <p className={cn("tabular mt-1 text-sm font-medium", TONE_CLASSES[tone])}>{value}</p>
    </div>
  );
}
