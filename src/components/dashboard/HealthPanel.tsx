"use client";

import { HeartPulse } from "lucide-react";
import { useRouter } from "next/navigation";

import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { useHealthDistribution } from "@/hooks/useDevices";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import { HEALTH_BANDS } from "@/utils/calculations/health";
import { cn } from "@/lib/utils";
import { formatCompact, formatPercent } from "@/utils/formatting";

/**
 * Fleet health distribution.
 *
 * A single stacked bar rather than three separate gauges: health bands are
 * parts of one whole, and showing them as one bar makes "92% healthy" legible
 * at a glance while keeping the degraded and critical slivers visible — which
 * three separate progress rings would not.
 *
 * Each band is clickable and filters the device table to that health range,
 * so the chart is a way into the fleet rather than just a picture of it.
 */

interface BandSpec {
  readonly key: "healthy" | "degraded" | "critical";
  readonly label: string;
  readonly colour: string;
  readonly range: readonly [number, number];
}

const BANDS: readonly BandSpec[] = [
  {
    key: "healthy",
    label: "Healthy",
    colour: "bg-status-online",
    range: [HEALTH_BANDS.healthy, 100],
  },
  {
    key: "degraded",
    label: "Degraded",
    colour: "bg-status-warning",
    range: [HEALTH_BANDS.degraded, HEALTH_BANDS.healthy - 1],
  },
  {
    key: "critical",
    label: "Critical",
    colour: "bg-status-critical",
    range: [0, HEALTH_BANDS.degraded - 1],
  },
];

export function HealthPanel() {
  const health = useHealthDistribution();
  const router = useRouter();
  const setFilters = useDeviceViewStore((state) => state.setFilters);

  const total = Math.max(health.total, 1);

  const drillInto = (range: readonly [number, number]): void => {
    setFilters({ healthRange: [range[0], range[1]], statuses: [] });
    router.push("/devices");
  };

  return (
    <Panel flush className="h-full">
      <PanelHeader
        title="Device health"
        description={`Fleet average ${health.average} / 100`}
        icon={<HeartPulse className="size-4" />}
      />
      <PanelBody className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span
              className={cn(
                "tabular text-3xl font-semibold tracking-tight",
                health.average >= HEALTH_BANDS.healthy
                  ? "text-status-online"
                  : health.average >= HEALTH_BANDS.degraded
                    ? "text-status-warning"
                    : "text-status-critical",
              )}
            >
              {health.average}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                /100
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCompact(health.total)} devices
            </span>
          </div>

          {/* One stacked bar: the parts-of-a-whole relationship is the point. */}
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Fleet health: ${health.healthy} healthy, ${health.degraded} degraded, ${health.critical} critical`}
          >
            {BANDS.map((band) => {
              const count = health[band.key];
              if (count === 0) return null;
              return (
                <span
                  key={band.key}
                  className={cn("h-full transition-[width] duration-700", band.colour)}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              );
            })}
          </div>
        </div>

        <ul className="space-y-1.5">
          {BANDS.map((band) => {
            const count = health[band.key];
            const share = (count / total) * 100;
            return (
              <li key={band.key}>
                <button
                  type="button"
                  onClick={() => drillInto(band.range)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent/40"
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-sm", band.colour)}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-xs">{band.label}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {formatCompact(count)}
                  </span>
                  <span className="tabular w-11 text-right text-xs font-medium">
                    {formatPercent(share)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
          Health combines connectivity, battery, signal, telemetry stability, error
          rate and open alerts. Open a device to see its score broken down by factor.
        </p>
      </PanelBody>
    </Panel>
  );
}
