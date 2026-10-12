import type { Alert } from "@/types/alerts";
import type { DeviceSummary } from "@/types/device";
import { METRIC_DESCRIPTORS, type MetricKey } from "@/types/telemetry";
import type { CsvColumn } from "@/utils/export/csv";

/**
 * Column definitions for each exportable view.
 *
 * These live here rather than in the components for the same reason every
 * other mapping does: what a CSV contains is a decision about the data, and a
 * component should not be the place it is recorded. It also means the shape of
 * an export is testable without rendering anything.
 *
 * Two conventions throughout:
 *
 * - Timestamps are written as ISO 8601 **and** as a raw epoch. The ISO column
 *   is what a human reads; the epoch is what survives a spreadsheet's import
 *   heuristics, which will happily reinterpret a date column by local locale.
 * - Values are unrounded. An export is the input to someone else's analysis,
 *   so rounding for display here would be discarding information they came for.
 */

/** `undefined` rather than `""`, so the CSV writer emits a genuinely empty cell. */
function isoOrBlank(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

export const DEVICE_EXPORT_COLUMNS: readonly CsvColumn<DeviceSummary>[] = [
  { header: "Device ID", value: (device) => device.id },
  { header: "Name", value: (device) => device.name },
  { header: "Type", value: (device) => device.type },
  { header: "Status", value: (device) => device.status },
  { header: "Site", value: (device) => device.location.site },
  { header: "City", value: (device) => device.location.city },
  { header: "Region", value: (device) => device.location.region },
  { header: "Latitude", value: (device) => device.location.lat },
  { header: "Longitude", value: (device) => device.location.lng },
  { header: "Group", value: (device) => device.groupId },
  { header: "Health score", value: (device) => device.healthScore },
  { header: "Battery %", value: (device) => device.battery },
  { header: "Signal dBm", value: (device) => device.signalStrength },
  { header: "Primary metric", value: (device) => device.primaryMetric },
  { header: "Primary value", value: (device) => device.primaryValue },
  {
    header: "Primary unit",
    value: (device) => METRIC_DESCRIPTORS[device.primaryMetric].unit,
  },
  { header: "Last seen (ISO)", value: (device) => isoOrBlank(device.lastSeen) },
  { header: "Last seen (epoch ms)", value: (device) => device.lastSeen },
];

export const ALERT_EXPORT_COLUMNS: readonly CsvColumn<Alert>[] = [
  { header: "Alert ID", value: (alert) => alert.id },
  { header: "Device ID", value: (alert) => alert.deviceId },
  { header: "Device name", value: (alert) => alert.deviceName },
  { header: "Severity", value: (alert) => alert.severity },
  { header: "Status", value: (alert) => alert.status },
  { header: "Title", value: (alert) => alert.title },
  { header: "Message", value: (alert) => alert.message },
  { header: "Source", value: (alert) => alert.source },
  { header: "Metric", value: (alert) => alert.metric },
  { header: "Value", value: (alert) => alert.value },
  { header: "Threshold", value: (alert) => alert.threshold },
  { header: "Assignee", value: (alert) => alert.assignee },
  { header: "Acknowledged by", value: (alert) => alert.acknowledgedBy },
  { header: "Rule ID", value: (alert) => alert.ruleId },
  { header: "Created (ISO)", value: (alert) => isoOrBlank(alert.createdAt) },
  { header: "Acknowledged (ISO)", value: (alert) => isoOrBlank(alert.acknowledgedAt) },
  { header: "Resolved (ISO)", value: (alert) => isoOrBlank(alert.resolvedAt) },
  { header: "Snoozed until (ISO)", value: (alert) => isoOrBlank(alert.snoozedUntil) },
  { header: "Created (epoch ms)", value: (alert) => alert.createdAt },
];

/** One device/timestamp pair — the long format a pivot table expects. */
export interface TelemetryExportRow {
  readonly deviceId: string;
  readonly metric: string;
  readonly unit: string;
  readonly timestamp: number;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly sampleCount: number;
}

export const TELEMETRY_EXPORT_COLUMNS: readonly CsvColumn<TelemetryExportRow>[] = [
  { header: "Timestamp (ISO)", value: (row) => isoOrBlank(row.timestamp) },
  { header: "Timestamp (epoch ms)", value: (row) => row.timestamp },
  { header: "Device ID", value: (row) => row.deviceId },
  { header: "Metric", value: (row) => row.metric },
  { header: "Unit", value: (row) => row.unit },
  { header: "Value", value: (row) => row.value },
  { header: "Min", value: (row) => row.min },
  { header: "Max", value: (row) => row.max },
  { header: "Samples in bucket", value: (row) => row.sampleCount },
];

/**
 * The minimum a series needs to be exportable.
 *
 * Structural rather than importing `ComparisonSeries` from the hooks layer:
 * both that type and `MetricSeries` satisfy it, and a utility reaching up into
 * `hooks/` to describe its own input would invert the dependency.
 */
export interface ExportableSeries {
  readonly deviceId: string;
  readonly points: readonly {
    readonly timestamp: number;
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly count: number;
  }[];
}

/**
 * Flattens the comparison series to long format.
 *
 * Long rather than wide (one column per device) because the device set is
 * chosen at runtime: a wide layout would give every export a different column
 * count, which is awkward to diff and impossible to append to. Long format
 * pivots in one step at the other end.
 *
 * Sorted by timestamp then device so the file reads chronologically regardless
 * of the order the series were selected in.
 */
export function toTelemetryExportRows(
  series: readonly ExportableSeries[],
  metric: MetricKey,
): readonly TelemetryExportRow[] {
  const rows: TelemetryExportRow[] = [];
  const descriptor = METRIC_DESCRIPTORS[metric];

  for (const entry of series) {
    for (const point of entry.points) {
      rows.push({
        deviceId: entry.deviceId,
        metric: descriptor.label,
        unit: descriptor.unit,
        timestamp: point.timestamp,
        value: point.value,
        min: point.min,
        max: point.max,
        sampleCount: point.count,
      });
    }
  }

  return rows.sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.deviceId.localeCompare(right.deviceId),
  );
}
