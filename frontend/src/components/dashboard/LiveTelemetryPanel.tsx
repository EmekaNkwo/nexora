"use client";

import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { TelemetryChart } from "@/components/telemetry/TelemetryChart";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useDeviceSummaries } from "@/hooks/useDevices";
import { useTelemetrySeries } from "@/hooks/useTelemetry";
import { useThresholdStore } from "@/stores/thresholdStore";
import { resolveThresholds } from "@/services/telemetry/thresholds";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { MetricKey, TimeRangeKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS, TIME_RANGE_ORDER } from "@/types/telemetry";
import { formatMetricValue } from "@/utils/formatting";
import { cn } from "@/lib/utils";

/**
 * Live telemetry for one device, picked automatically.
 *
 * The dashboard should show something *interesting* without the operator
 * choosing a device first, so this picks the fleet's most alarming device —
 * the one most worth looking at. It re-picks only when the current focus stops
 * being worth watching, because a chart that jumps to a different device every
 * second is useless.
 */

/** Ranks devices by how much attention they deserve. */
function selectFocusDevice(
  devices: readonly { id: string; status: string; healthScore: number; primaryValue: number | undefined }[],
): string | null {
  let best: { id: string; score: number } | null = null;

  for (const device of devices) {
    if (device.primaryValue === undefined) continue;
    const statusScore =
      device.status === "critical"
        ? 1000
        : device.status === "warning"
          ? 500
          : device.status === "online"
            ? 10
            : 0;
    // Lower health is more interesting, hence the subtraction.
    const score = statusScore + (100 - device.healthScore);
    if (!best || score > best.score) best = { id: device.id, score };
  }

  return best?.id ?? null;
}

export function LiveTelemetryPanel() {
  const devices = useDeviceSummaries();
  const profiles = useThresholdStore((state) => state.profiles);
  const [range, setRange] = useState<TimeRangeKey>("1H");
  /** Operator's explicit pick, which wins over the automatic one. */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey | null>(null);

  // The focus device is *derived*, not stored. Keeping it in state and syncing
  // it from an effect would mean an extra render on every change and a window
  // where the panel points at a device that no longer exists after a reset.
  const candidateId = useMemo(() => selectFocusDevice(devices), [devices]);
  const focused = useMemo(() => {
    const pinned = pinnedId
      ? devices.find((device) => device.id === pinnedId)
      : undefined;
    return pinned ?? devices.find((device) => device.id === candidateId);
  }, [devices, pinnedId, candidateId]);

  const availableMetrics = useMemo<readonly MetricKey[]>(() => {
    if (!focused) return [];
    return DEVICE_TYPE_DESCRIPTORS[focused.type].metrics;
  }, [focused]);

  const activeMetric =
    metric && availableMetrics.includes(metric)
      ? metric
      : (focused ? DEVICE_TYPE_DESCRIPTORS[focused.type].primaryMetric : "temperature");

  const series = useTelemetrySeries(focused?.id ?? null, activeMetric, range);

  const threshold = useMemo(() => {
    if (!focused) return undefined;
    const resolved = resolveThresholds(
      { type: focused.type, groupId: focused.groupId },
      profiles,
    );
    return resolved[activeMetric];
  }, [focused, profiles, activeMetric]);

  if (!focused) {
    return (
      <Panel flush className="h-full">
        <PanelHeader title="Live telemetry" icon={<Activity className="size-4" />} />
        <PanelBody>
          <EmptyState
            compact
            icon={Activity}
            title="Waiting for telemetry"
            description="Start the simulation to begin streaming readings."
          />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel flush className="h-full">
      <PanelHeader
        title="Live telemetry"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/devices/${focused.id}`}
              className="ops-mono text-foreground hover:underline"
            >
              {focused.id}
            </Link>
            <span className="text-muted-foreground">·</span>
            <span>{DEVICE_TYPE_DESCRIPTORS[focused.type].label}</span>
            <StatusIndicator status={focused.status} compact />
            {pinnedId === focused.id ? null : (
              <button
                type="button"
                onClick={() => setPinnedId(focused.id)}
                className="text-[0.65rem] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                pin
              </button>
            )}
          </span>
        }
        icon={<Activity className="size-4" />}
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {pinnedId ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setPinnedId(null)}
                className="px-2 text-[0.7rem]"
              >
                Unpin
              </Button>
            ) : null}
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

      <PanelBody flush className="px-1 pt-3">
        <TelemetryChart
          points={series.points}
          metric={activeMetric}
          range={range}
          threshold={threshold}
          liveFrom={series.synthesised ? series.liveFrom : undefined}
          height={240}
        />
      </PanelBody>

      <div className="flex flex-wrap gap-1.5 px-4 pb-3" role="group" aria-label="Metric">
        {availableMetrics.map((key) => (
          <Button
            key={key}
            size="xs"
            variant={activeMetric === key ? "secondary" : "ghost"}
            onClick={() => setMetric(key)}
            aria-pressed={activeMetric === key}
            className="gap-1.5 px-2 text-[0.7rem]"
          >
            <span
              className="size-1.5 rounded-sm"
              style={{ background: METRIC_DESCRIPTORS[key].chartColor }}
              aria-hidden="true"
            />
            {METRIC_DESCRIPTORS[key].label}
            <span className="tabular text-muted-foreground">
              {formatMetricValue(key, focused.values[key])}
            </span>
          </Button>
        ))}
      </div>

      <PanelFooter>
        <span className={cn(series.synthesised && "text-status-warning/90")}>
          {series.synthesised
            ? "History before the live marker is regenerated from the device model"
            : `${series.stats.count} recorded samples in window`}
        </span>
        <Link
          href={`/devices/${focused.id}`}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          Open device <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
