"use client";

import { Activity } from "lucide-react";

import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AlertSummaryPanel } from "@/components/dashboard/AlertSummaryPanel";
import { FleetKpis } from "@/components/dashboard/FleetKpis";
import { HealthPanel } from "@/components/dashboard/HealthPanel";
import { LiveTelemetryPanel } from "@/components/dashboard/LiveTelemetryPanel";
import { MapPanel } from "@/components/dashboard/MapPanel";
import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { FleetReadyGate } from "@/components/shared/FleetReadyGate";

/**
 * The operations dashboard.
 *
 * Layout follows the order an operator actually reads in: aggregate state
 * first (is anything wrong?), then the live detail (what is it doing?), then
 * the geographic and chronological context (where, and what just happened?).
 *
 * The page is a client component because every panel on it is live. There is
 * no meaningful server-rendered version of a console whose entire content is
 * generated in the browser — so rather than pretend otherwise, the shell
 * renders a skeleton until the fleet is seeded.
 */
export default function DashboardPage() {
  return (
    <FleetReadyGate>
      <div className="mx-auto max-w-[120rem] space-y-5 p-4 sm:p-5">
        <FleetKpis />

        {/* Live telemetry gets two thirds: it is the most information-dense
            panel and the one an operator watches. */}
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <LiveTelemetryPanel />
          </div>
          <HealthPanel />
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <MapPanel />
          </div>
          <AlertSummaryPanel />
        </div>

        <Panel flush>
          <PanelHeader
            title="Activity"
            description="Status changes, alerts, rule firings, commands and system events"
            icon={<Activity className="size-4" />}
          />
          <PanelBody flush className="max-h-[28rem] overflow-y-auto">
            <ActivityFeed limit={40} />
          </PanelBody>
        </Panel>
      </div>
    </FleetReadyGate>
  );
}
