"use client";

import { LineChart } from "lucide-react";
import { useMemo, useState } from "react";

import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { StatBlock } from "@/components/shared/KpiTile";
import { TelemetryChart } from "@/components/telemetry/TelemetryChart";
import { Button } from "@/components/ui/button";
import { useTelemetrySeries } from "@/hooks/useTelemetry";
import { resolveThresholds } from "@/services/telemetry/thresholds";
import { useThresholdStore } from "@/stores/thresholdStore";
import type { Device } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { MetricKey, TimeRangeKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS, TIME_RANGE_ORDER } from "@/types/telemetry";
import { formatDelta, formatMetricValue } from "@/utils/formatting";

/**
 * Historical telemetry for one device.
 *
 * The range selector is where the aggregation strategy becomes visible: 1H
 * reads from the live ring buffer, while 7D and 30D are regenerated from the
 * device's own signal model and stitched in front of the recorded data. The
 * footer says which is which rather than quietly presenting synthesised
 * history as recorded fact.
 */
export function DeviceHistoryPanel({ device }: { readonly device: Device }) {
  const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
  const profiles = useThresholdStore((state) => state.profiles);

  const [metric, setMetric] = useState<MetricKey>(descriptor.primaryMetric);
  const [range, setRange] = useState<TimeRangeKey>("1H");

  const series = useTelemetrySeries(device.id, metric, range);

  const threshold = useMemo(() => {
    const resolved = resolveThresholds(device, profiles);
    return resolved[metric];
  }, [device, profiles, metric]);

  const { stats } = series;

  return (
    <Panel flush>
      <PanelHeader
        title="Telemetry history"
        description={`${METRIC_DESCRIPTORS[metric].label} over the last ${range}`}
        icon={<LineChart className="size-4" />}
        headingLevel={3}
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {TIME_RANGE_ORDER.map((key) => (
              <Button
                key={key}
                size="xs"
                variant={range === key ? "secondary" : "ghost"}
                onClick={() => setRange(key)}
                aria-pressed={range === key}
                className="px-2 text-[0.7rem]"
              >
                {key}
              </Button>
            ))}
          </div>
        }
      />

      <div
        className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5"
        role="group"
        aria-label="Metric"
      >
        {descriptor.metrics.map((key) => (
          <Button
            key={key}
            size="xs"
            variant={metric === key ? "secondary" : "ghost"}
            onClick={() => setMetric(key)}
            aria-pressed={metric === key}
            className="gap-1.5 px-2 text-[0.7rem]"
          >
            <span
              className="size-1.5 rounded-sm"
              style={{ background: METRIC_DESCRIPTORS[key].chartColor }}
              aria-hidden="true"
            />
            {METRIC_DESCRIPTORS[key].label}
          </Button>
        ))}
      </div>

      <PanelBody flush className="px-1 pt-3">
        <TelemetryChart
          points={series.points}
          metric={metric}
          range={range}
          threshold={threshold}
          liveFrom={series.synthesised ? series.liveFrom : undefined}
          height={300}
        />
      </PanelBody>

      <div className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3 sm:grid-cols-5">
        <StatBlock label="Latest" value={formatMetricValue(metric, stats.last)} />
        <StatBlock label="Minimum" value={formatMetricValue(metric, stats.min)} />
        <StatBlock label="Maximum" value={formatMetricValue(metric, stats.max)} />
        <StatBlock label="Mean" value={formatMetricValue(metric, stats.mean)} />
        <StatBlock
          label="Change"
          value={`${formatDelta(stats.delta, METRIC_DESCRIPTORS[metric].decimals)}${METRIC_DESCRIPTORS[metric].unit}`}
          tone={stats.delta === 0 ? "neutral" : stats.delta > 0 ? "warning" : "online"}
        />
      </div>

      <PanelFooter>
        <span>
          {stats.count} recorded sample{stats.count === 1 ? "" : "s"} in the live buffer
          {stats.stdDev > 0
            ? ` · σ ${stats.stdDev.toFixed(METRIC_DESCRIPTORS[metric].decimals + 1)}`
            : ""}
        </span>
        {series.synthesised ? (
          <span className="text-status-warning/90">
            History before the “live” marker is regenerated from this device&apos;s signal
            model
          </span>
        ) : (
          <span>Entire window is recorded telemetry</span>
        )}
      </PanelFooter>
    </Panel>
  );
}
