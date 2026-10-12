"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Empty, loading and error states.
 *
 * Centralised because they are the states most often skipped, and the ones
 * that most define whether an app feels finished. Every list and panel in the
 * console routes through these rather than rendering a bare "No data".
 */

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span className="rounded-full border border-border bg-muted/40 p-2.5">
        <Icon
          className={cn("text-muted-foreground", compact ? "size-4" : "size-5")}
          aria-hidden="true"
        />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export interface LoadingStateProps {
  readonly label?: string;
  readonly className?: string;
}

export function LoadingState({ label = "Loading", className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground",
        className,
      )}
      // Announced politely so it does not interrupt, but is still reported.
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly description?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}
      role="alert"
    >
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-status-critical">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export interface TableSkeletonProps {
  readonly rows?: number;
  readonly columns?: number;
  readonly className?: string;
}

/**
 * Table placeholder matching the real row height, so the layout does not jump
 * when data arrives.
 */
export function TableSkeleton({ rows = 8, columns = 6, className }: TableSkeletonProps) {
  return (
    <div className={cn("divide-y divide-border", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className="h-3.5"
              style={{ width: columnIndex === 0 ? "22%" : `${Math.max(8, 60 / columns)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface ChartSkeletonProps {
  readonly className?: string;
  readonly height?: number;
}

export function ChartSkeleton({ className, height = 220 }: ChartSkeletonProps) {
  return (
    <div
      className={cn("flex items-end gap-1.5 px-1", className)}
      style={{ height }}
      aria-hidden="true"
    >
      {Array.from({ length: 28 }, (_, index) => (
        <Skeleton
          key={index}
          className="flex-1 rounded-sm"
          // A deterministic pseudo-random profile: a flat skeleton reads as a
          // broken chart, and Math.random would differ between SSR and client.
          style={{ height: `${28 + ((index * 37) % 62)}%` }}
        />
      ))}
    </div>
  );
}

export interface InlineHintProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: "muted" | "warning" | "info";
}

/** A short explanatory note under a control or chart. */
export function InlineHint({ children, className, tone = "muted" }: InlineHintProps) {
  return (
    <p
      className={cn(
        "text-xs leading-relaxed",
        tone === "muted" && "text-muted-foreground",
        tone === "warning" && "text-status-warning",
        tone === "info" && "text-status-updating",
        className,
      )}
    >
      {children}
    </p>
  );
}
