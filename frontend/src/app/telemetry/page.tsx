"use client";

import { Activity, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ExportButton } from "@/components/shared/ExportButton";
import { SelectField } from "@/components/shared/fields";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeviceSummaries } from "@/hooks/useDevices";
import { useComparisonSeries } from "@/hooks/useTelemetry";
import { mergeSeriesForComparison } from "@/services/telemetry/aggregation";
import { MAX_COMPARISON_DEVICES, useUiStore } from "@/stores/uiStore";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { METRIC_DESCRIPTORS, METRIC_KEYS, TIME_RANGE_ORDER } from "@/types/telemetry";
import type { TimeRangeKey } from "@/types/telemetry";
import { cn } from "@/lib/utils";
import {
  TELEMETRY_EXPORT_COLUMNS,
  toTelemetryExportRows,
} from "@/utils/export/datasets";
import { formatDateTime, formatMetricValue, formatShortTime } from "@/utils/formatting";

/** Series colours, distinguishable in both themes and for common CVD types. */
const SERIES_COLORS: readonly string[] = [
  "var(--metric-temperature)",
  "var(--metric-humidity)",
  "var(--metric-battery)",
  "var(--metric-signal)",
  "var(--metric-air)",
];

/**
 * Telemetry comparison.
 *
 * Comparing devices is how an anomaly gets identified: one cold store reading
 * 6°C means little until you see the four beside it holding 2.5°C. The chart
 * aligns each device's aggregated series onto a shared time axis, and leaves
 * genuine gaps where a device has no sample for an interval rather than
 * interpolating across them.
 */
export default function TelemetryPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <TelemetryContent />
    </FleetReadyGate>
  );
}

function TelemetryContent() {
  const devices = useDeviceSummaries();
  const selectedIds = useUiStore((state) => state.comparisonDeviceIds);
  const toggleDevice = useUiStore((state) => state.toggleComparisonDevice);
  const setDevices = useUiStore((state) => state.setComparisonDevices);
  const clear = useUiStore((state) => state.clearComparison);
  const metric = useUiStore((state) => state.comparisonMetric);
  const setMetric = useUiStore((state) => state.setComparisonMetric);
  const range = useUiStore((state) => state.comparisonRange);
  const setRange = useUiStore((state) => state.setComparisonRange);

  const [search, setSearch] = useState("");

  const series = useComparisonSeries(selectedIds, metric, range);
  const rows = useMemo(() => mergeSeriesForComparison(series), [series]);
  const descriptor = METRIC_DESCRIPTORS[metric];

  // Long format: one row per device per bucket. Built lazily from the same
  // aggregated series the chart draws, so the export is exactly what is on
  // screen rather than a second, subtly different query.
  const exportRows = useMemo(() => toTelemetryExportRows(series, metric), [series, metric]);

  /** Devices that actually report the chosen metric, filtered by the search. */
  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return devices
      .filter((device) => DEVICE_TYPE_DESCRIPTORS[device.type].metrics.includes(metric))
      .filter(
        (device) =>
          needle.length === 0 ||
          device.id.toLowerCase().includes(needle) ||
          device.site.toLowerCase().includes(needle),
      )
      .slice(0, 60);
  }, [devices, metric, search]);

  /** Seeds a sensible comparison set: the first few devices of one type. */
  const autoSelect = (): void => {
    const sameType = candidates.slice(0, MAX_COMPARISON_DEVICES).map((d) => d.id);
    setDevices(sameType);
  };

  const spansDays = range === "7D" || range === "30D";

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Telemetry comparison</h2>
          <p className="text-xs text-muted-foreground">
            Plot up to {MAX_COMPARISON_DEVICES} devices on one axis to spot the outlier.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            label="Metric"
            hideLabel
            className="w-44"
            value={metric}
            onChange={setMetric}
            options={METRIC_KEYS.map((key) => ({
              value: key,
              label: METRIC_DESCRIPTORS[key].label,
            }))}
          />

          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {TIME_RANGE_ORDER.map((key) => (
              <Button
                key={key}
                size="xs"
                variant={range === key ? "secondary" : "ghost"}
                onClick={() => setRange(key as TimeRangeKey)}
                aria-pressed={range === key}
                className="px-2 text-[0.7rem]"
              >
                {key}
              </Button>
            ))}
          </div>

          <ExportButton
            filePrefix={`nexora-telemetry-${metric}`}
            rows={exportRows}
            columns={TELEMETRY_EXPORT_COLUMNS}
            noun="readings"
            size="sm"
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <Panel flush>
          <PanelHeader
            title={`${descriptor.label} comparison`}
            description={
              selectedIds.length === 0
                ? "Select devices to compare"
                : `${selectedIds.length} device${selectedIds.length === 1 ? "" : "s"} · ${range}`
            }
            icon={<Activity className="size-4" />}
            actions={
              selectedIds.length > 0 ? (
                <Button size="xs" variant="ghost" onClick={clear} className="text-[0.7rem]">
                  Clear
                </Button>
              ) : null
            }
          />

          <PanelBody flush className="px-1 pt-3">
            {selectedIds.length === 0 ? (
              <div className="grid h-72 place-items-center">
                <EmptyState
                  compact
                  icon={Activity}
                  title="No devices selected"
                  description="Pick devices from the list, or let the platform choose a comparable set."
                  action={
                    <Button size="sm" variant="outline" onClick={autoSelect}>
                      Compare first {MAX_COMPARISON_DEVICES}
                    </Button>
                  }
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="grid h-72 place-items-center">
                <EmptyState
                  compact
                  title="No telemetry in this window"
                  description="Start the simulation, or choose a longer range."
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart
                  // Recharts types its `data` prop as mutable; the merged rows
                  // are readonly by construction and never written to.
                  data={rows as unknown as Record<string, number>[]}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    stroke="var(--grid-line)"
                    strokeDasharray="2 4"
                    vertical={false}
                  />
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
                    tickFormatter={(value: number) => value.toFixed(descriptor.decimals)}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    stroke="var(--border)"
                    width={44}
                    unit={descriptor.unit}
                  />
                  {selectedIds.map((deviceId, index) => (
                    <Line
                      key={deviceId}
                      type="monotone"
                      dataKey={deviceId}
                      name={deviceId}
                      stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                      strokeWidth={1.75}
                      dot={false}
                      isAnimationActive={false}
                      // A device with no sample at an instant leaves a gap
                      // rather than a line drawn through nothing.
                      connectNulls={false}
                    />
                  ))}
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      return (
                        <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
                          <p className="tabular text-muted-foreground">
                            {formatDateTime(Number(label))}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {payload.map((entry) => (
                              <li
                                key={String(entry.dataKey)}
                                className="flex items-center gap-2"
                              >
                                <span
                                  className="size-2 rounded-sm"
                                  style={{ background: entry.color }}
                                  aria-hidden="true"
                                />
                                <span className="ops-mono">{String(entry.dataKey)}</span>
                                <span className="tabular ml-auto font-medium">
                                  {formatMetricValue(metric, Number(entry.value))}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </PanelBody>

          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {selectedIds.map((deviceId, index) => (
                <span
                  key={deviceId}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[0.7rem]"
                >
                  <span
                    className="size-2 rounded-sm"
                    style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    aria-hidden="true"
                  />
                  <span className="ops-mono">{deviceId}</span>
                  <button
                    type="button"
                    onClick={() => toggleDevice(deviceId)}
                    aria-label={`Remove ${deviceId} from comparison`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <PanelFooter>
            <span>
              Each series is bucketed independently then aligned on a shared axis.
              {spansDays
                ? " Long ranges include regenerated history for devices whose live buffer does not reach back that far."
                : ""}
            </span>
          </PanelFooter>
        </Panel>

        <Panel flush className="xl:sticky xl:top-4 xl:self-start">
          <PanelHeader
            title="Devices"
            description={`Reporting ${descriptor.label.toLowerCase()}`}
            headingLevel={3}
          />
          <div className="border-b border-border px-3 py-2.5">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by id or site…"
              aria-label="Filter comparison candidates"
              className="h-8 text-xs"
            />
          </div>
          <PanelBody flush className="max-h-[32rem] overflow-y-auto">
            {candidates.length === 0 ? (
              <EmptyState
                compact
                title="No devices report this metric"
                description="Pick a different metric, or clear the filter."
              />
            ) : (
              <ul className="divide-y divide-border">
                {candidates.map((device) => {
                  const selected = selectedIds.includes(device.id);
                  const atLimit =
                    !selected && selectedIds.length >= MAX_COMPARISON_DEVICES;
                  return (
                    <li key={device.id}>
                      <button
                        type="button"
                        onClick={() => toggleDevice(device.id)}
                        disabled={atLimit}
                        aria-pressed={selected}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          selected ? "bg-primary/10" : "hover:bg-accent/40",
                          atLimit && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {selected ? (
                          <X className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        ) : (
                          <Plus
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="ops-mono block truncate">{device.id}</span>
                          <span className="block truncate text-[0.7rem] text-muted-foreground">
                            {device.site}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-[0.7rem]">
                          {formatMetricValue(metric, device.values[metric])}
                        </span>
                        <StatusIndicator status={device.status} compact />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelBody>
          <PanelFooter>
            <span>
              {selectedIds.length}/{MAX_COMPARISON_DEVICES} selected
            </span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}
