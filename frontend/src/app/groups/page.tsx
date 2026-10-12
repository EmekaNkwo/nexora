"use client";

import { Boxes } from "lucide-react";
import { useRouter } from "next/navigation";

import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { HealthBar } from "@/components/shared/MetricDisplay";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { useGroupRollups } from "@/hooks/useGroups";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import { cn } from "@/lib/utils";
import { formatCompact, formatPercent } from "@/utils/formatting";

/**
 * Device groups.
 *
 * Two grouping dimensions exist and both are useful: *sites* (where a device
 * physically is) and *logical groups* (what it is for). A cold-storage sensor
 * in Lagos belongs to both, so group membership is resolved per dimension
 * rather than forcing one hierarchy.
 *
 * Every number here is computed from current members on each render — a group's
 * health is whatever its devices' health is right now, and caching it would
 * guarantee it goes stale.
 */
export default function GroupsPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <GroupsContent />
    </FleetReadyGate>
  );
}

function GroupsContent() {
  const rollups = useGroupRollups();
  const router = useRouter();
  const setFilters = useDeviceViewStore((state) => state.setFilters);

  const logical = rollups.filter((rollup) => rollup.group.kind !== "site");
  const sites = rollups.filter((rollup) => rollup.group.kind === "site");

  const openGroup = (groupId: string, kind: string): void => {
    // Site groups filter by nothing the device table understands directly, so
    // they route to the map instead, which is the right view for a place.
    if (kind === "site") {
      const name = rollups.find((r) => r.group.id === groupId)?.group.name;
      router.push(`/map?site=${encodeURIComponent(name ?? "")}`);
      return;
    }
    setFilters({ groupIds: [groupId], statuses: [], search: "" });
    router.push("/devices");
  };

  return (
    <div className="mx-auto max-w-[110rem] space-y-5 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Groups</h2>
        <p className="text-xs text-muted-foreground">
          Logical groups cut across sites; site groups are physical locations. All
          metrics are derived from current members.
        </p>
      </div>

      <GroupSection
        title="Logical groups"
        description="What a device is for"
        rollups={logical}
        onOpen={openGroup}
      />

      <GroupSection
        title="Sites"
        description="Where a device physically is"
        rollups={sites}
        onOpen={openGroup}
      />
    </div>
  );
}

interface GroupSectionProps {
  readonly title: string;
  readonly description: string;
  readonly rollups: ReturnType<typeof useGroupRollups>;
  readonly onOpen: (groupId: string, kind: string) => void;
}

function GroupSection({ title, description, rollups, onOpen }: GroupSectionProps) {
  if (rollups.length === 0) {
    return (
      <Panel flush>
        <PanelHeader title={title} description={description} icon={<Boxes className="size-4" />} />
        <PanelBody>
          <EmptyState compact title="No groups" />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel flush>
      <PanelHeader
        title={title}
        description={description}
        icon={<Boxes className="size-4" />}
      />
      <PanelBody>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(17rem, 100%), 1fr))" }}
        >
          {rollups.map((rollup) => {
            const { group, statusCounts, deviceCount } = rollup;
            const problem = statusCounts.critical + statusCounts.offline;
            const healthyShare =
              deviceCount === 0 ? 0 : (statusCounts.online / deviceCount) * 100;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onOpen(group.id, group.kind)}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.description}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[0.62rem]">
                    {group.kind}
                  </Badge>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="tabular text-2xl font-semibold tracking-tight">
                    {formatCompact(deviceCount)}
                  </span>
                  <span className="text-xs text-muted-foreground">devices</span>
                  {problem > 0 ? (
                    <span className="tabular ml-auto text-xs font-medium text-status-critical">
                      {problem} need attention
                    </span>
                  ) : null}
                </div>

                {/* Stacked status bar: parts of one whole. */}
                <div
                  className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${statusCounts.online} online, ${statusCounts.warning} warning, ${statusCounts.critical} critical, ${statusCounts.offline} offline`}
                >
                  {(
                    [
                      ["online", statusCounts.online, "bg-status-online"],
                      ["warning", statusCounts.warning, "bg-status-warning"],
                      ["critical", statusCounts.critical, "bg-status-critical"],
                      ["updating", statusCounts.updating, "bg-status-updating"],
                      ["maintenance", statusCounts.maintenance, "bg-status-maintenance"],
                      ["offline", statusCounts.offline, "bg-status-offline"],
                    ] as const
                  ).map(([key, count, colour]) =>
                    count === 0 ? null : (
                      <span
                        key={key}
                        className={cn("h-full", colour)}
                        style={{ width: `${(count / Math.max(deviceCount, 1)) * 100}%` }}
                      />
                    ),
                  )}
                </div>

                <dl className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="ops-label">Health</dt>
                    <dd className="mt-1">
                      <HealthBar score={rollup.averageHealth} width="2.5rem" />
                    </dd>
                  </div>
                  <div>
                    <dt className="ops-label">Battery</dt>
                    <dd className="tabular mt-1 text-xs font-medium">
                      {rollup.averageBattery}%
                    </dd>
                  </div>
                  <div>
                    <dt className="ops-label">Alerts</dt>
                    <dd
                      className={cn(
                        "tabular mt-1 text-xs font-medium",
                        rollup.criticalAlerts > 0 && "text-status-critical",
                      )}
                    >
                      {rollup.activeAlerts}
                    </dd>
                  </div>
                </dl>

                <p className="text-[0.7rem] text-muted-foreground">
                  {formatPercent(healthyShare)} fully online
                </p>
              </button>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}
