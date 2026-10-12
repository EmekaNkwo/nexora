import type { MetricKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";

/**
 * Display formatting.
 *
 * All formatters are locale-stable (`en-US`) on purpose. An operations console
 * rendered on the server and hydrated on the client must produce byte-identical
 * text, and a formatter that picks up the browser locale is a hydration
 * mismatch waiting to happen.
 */

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "UTC",
});
const shortTimeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** 1,284 → "1,284"; 1,842,193 → "1.8M". Used for KPI tiles. */
export function formatCompact(value: number): string {
  return Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value);
}

export function formatMetricValue(metric: MetricKey, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const descriptor = METRIC_DESCRIPTORS[metric];
  return `${value.toFixed(descriptor.decimals)}${descriptor.unit}`;
}

/** Value without its unit — for tables that put the unit in the header. */
export function formatMetricNumber(
  metric: MetricKey,
  value: number | undefined,
): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(METRIC_DESCRIPTORS[metric].decimals);
}

export function metricUnit(metric: MetricKey): string {
  return METRIC_DESCRIPTORS[metric].unit;
}

export function metricLabel(metric: MetricKey): string {
  return METRIC_DESCRIPTORS[metric].label;
}

export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatTime(timestamp: number): string {
  return timeFormat.format(timestamp);
}

export function formatShortTime(timestamp: number): string {
  return shortTimeFormat.format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return dateTimeFormat.format(timestamp);
}

export function formatDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

/**
 * Compact relative time: "now", "42s ago", "3m ago", "2h ago", "6d ago".
 *
 * `now` is a parameter rather than a `Date.now()` call so components can pass
 * a single clock tick and keep a whole table's timestamps consistent.
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const deltaMs = now - timestamp;
  if (deltaMs < 0) return "just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Duration in the clearest unit: "820ms", "4.2s", "3m 12s", "2h 05m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainderSeconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Seconds as a condition label: "30s", "5m", "2h". */
export function formatSeconds(seconds: number): string {
  if (seconds === 0) return "immediately";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCoordinates(lat: number, lng: number): string {
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lngHemisphere = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latHemisphere}, ${Math.abs(lng).toFixed(4)}°${lngHemisphere}`;
}

/** Signed value with an explicit sign, for deltas: "+2.4", "−1.1". */
export function formatDelta(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 10 ** -decimals / 2) return "±0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/** kebab-case or snake_case → Title Case. */
export function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
