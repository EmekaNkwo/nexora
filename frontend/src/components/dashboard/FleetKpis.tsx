"use client";

import {
  Activity,
  AlertTriangle,
  CircleCheck,
  Gauge,
  PowerOff,
  Siren,
  Timer,
  Waves,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { SectionHeading } from "@/components/shared/Panel";
import { useDashboardKpis } from "@/hooks/useActivity";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import type { DeviceStatus } from "@/types/device";
import { formatBytesPerSecond, formatCompact, formatPercent } from "@/utils/formatting";

/**
 * The dashboard KPI rows.
 *
 * The device tiles are *actionable*: clicking "Offline 47" filters the device
 * table to those 47 and navigates there. A KPI that tells you a number but
 * cannot show you which devices it refers to is a dead end, and avoiding that
 * is most of what distinguishes an operations console from a status page.
 */
export function FleetKpis() {
  const { statusCounts, health, alerts, infrastructure } = useDashboardKpis();
  const router = useRouter();
  const setFilters = useDeviceViewStore((state) => state.setFilters);

  const drillInto = (statuses: readonly DeviceStatus[]): void => {
    setFilters({ statuses, search: "" });
    router.push("/devices");
  };

  const healthShare = (count: number): string =>
    health.total === 0 ? "—" : formatPercent((count / health.total) * 100);

  return (
    <div className="space-y-5">
      <section aria-labelledby="kpi-devices" className="space-y-2.5">
        <SectionHeading>
          <span id="kpi-devices">Devices</span>
        </SectionHeading>
        <KpiGroup minTileWidth={140}>
          <KpiTile
            label="Online"
            value={statusCounts.online}
            tone="online"
            icon={<CircleCheck className="size-3.5" />}
            hint="Reporting normally"
            onClick={() => drillInto(["online"])}
          />
          <KpiTile
            label="Offline"
            value={statusCounts.offline}
            tone="offline"
            icon={<PowerOff className="size-3.5" />}
            hint="Not reachable"
            onClick={() => drillInto(["offline"])}
          />
          <KpiTile
            label="Warning"
            value={statusCounts.warning}
            tone="warning"
            icon={<AlertTriangle className="size-3.5" />}
            hint="Threshold crossed"
            onClick={() => drillInto(["warning"])}
          />
          <KpiTile
            label="Critical"
            value={statusCounts.critical}
            tone="critical"
            icon={<Siren className="size-3.5" />}
            hint="Needs attention now"
            onClick={() => drillInto(["critical"])}
          />
          <KpiTile
            label="Maintenance"
            value={statusCounts.maintenance + statusCounts.updating}
            tone="info"
            icon={<Timer className="size-3.5" />}
            hint={`${statusCounts.updating} updating`}
            onClick={() => drillInto(["maintenance", "updating"])}
          />
        </KpiGroup>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="kpi-infra" className="space-y-2.5">
          <SectionHeading>
            <span id="kpi-infra">Infrastructure</span>
          </SectionHeading>
          <KpiGroup minTileWidth={130}>
            <KpiTile
              label="Messages / sec"
              value={infrastructure.messagesPerSecond}
              compact
              icon={<Waves className="size-3.5" />}
              hint="Across the fleet"
            />
            <KpiTile
              label="Avg latency"
              value={`${infrastructure.averageLatencyMs}ms`}
              compact
              tone={infrastructure.averageLatencyMs > 250 ? "warning" : "neutral"}
              icon={<Timer className="size-3.5" />}
              hint="Transport round trip"
            />
            <KpiTile
              label="Telemetry events"
              value={formatCompact(infrastructure.totalTelemetryEvents)}
              compact
              icon={<Activity className="size-3.5" />}
              hint="Since session start"
            />
            <KpiTile
              label="Data ingestion"
              value={formatBytesPerSecond(infrastructure.ingestionBytesPerSecond)}
              compact
              icon={<Gauge className="size-3.5" />}
              hint={`${formatCompact(infrastructure.droppedFrames)} dropped`}
            />
          </KpiGroup>
        </section>

        <section aria-labelledby="kpi-health" className="space-y-2.5">
          <SectionHeading>
            <span id="kpi-health">Health &amp; alerts</span>
          </SectionHeading>
          <KpiGroup minTileWidth={130}>
            <KpiTile
              label="Healthy"
              value={healthShare(health.healthy)}
              compact
              tone="online"
              hint={`${formatCompact(health.healthy)} devices`}
            />
            <KpiTile
              label="Degraded"
              value={healthShare(health.degraded)}
              compact
              tone="warning"
              hint={`${formatCompact(health.degraded)} devices`}
            />
            <KpiTile
              label="Critical"
              value={healthShare(health.critical)}
              compact
              tone="critical"
              hint={`${formatCompact(health.critical)} devices`}
            />
            <KpiTile
              label="Open alerts"
              value={alerts.active + alerts.acknowledged + alerts.snoozed}
              compact
              tone={alerts.critical > 0 ? "critical" : "neutral"}
              icon={<Siren className="size-3.5" />}
              hint={`${alerts.critical} critical · ${alerts.warning} warning`}
              onClick={() => router.push("/alerts")}
            />
          </KpiGroup>
        </section>
      </div>
    </div>
  );
}
