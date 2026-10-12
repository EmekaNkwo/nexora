"use client";

import { AlertTriangle, BellRing, Check, Clock, Search, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ExportButton } from "@/components/shared/ExportButton";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  CURRENT_OPERATOR,
  useAlertActions,
  useAlertCounts,
  useAlertPage,
} from "@/hooks/useAlerts";
import { useNow } from "@/hooks/useClock";
import { Pagination } from "@/components/shared/Pagination";
import { ALERT_PAGE_SIZE_OPTIONS } from "@/stores/alertStore";
import { useDeviceStore } from "@/stores/deviceStore";
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  type AlertSeverity,
  type AlertStatus,
} from "@/types/alerts";
import { cn } from "@/lib/utils";
import { ALERT_EXPORT_COLUMNS } from "@/utils/export/datasets";
import {
  formatMetricValue,
  formatNumber,
  formatRelativeTime,
  formatTime,
  titleCase,
} from "@/utils/formatting";

/** Operators an alert can be assigned to. */
const ASSIGNEES: readonly string[] = [
  CURRENT_OPERATOR,
  "field.service",
  "cold.chain.lead",
  "network.ops",
];

/**
 * Selection size above which a bulk action asks first.
 *
 * Not zero, because confirming two acknowledgements is friction with no
 * benefit — the operator can see both rows and there is nothing to verify.
 * The number is a screenful: past it the selection extends beyond what is
 * visible, "Select all 847 matching" is one click away, and neither action has
 * an undo.
 */
const BULK_CONFIRM_THRESHOLD = 10;

type BulkAction = "acknowledge" | "resolve";

const BULK_ACTION_COPY: Readonly<
  Record<BulkAction, { readonly title: string; readonly detail: string }>
> = {
  acknowledge: {
    title: "Acknowledge alerts",
    detail:
      "They stay open and keep tracking the condition, but drop out of the unacknowledged count.",
  },
  resolve: {
    title: "Resolve alerts",
    detail:
      "They close and leave the open list. A condition that is still breaching will raise a new alert on the next frame.",
  },
};

const SNOOZE_OPTIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
];

/**
 * Alert triage.
 *
 * Built around bulk triage rather than one-at-a-time handling, because a
 * regional outage produces a hundred correlated alerts at once and
 * acknowledging them individually is not a workflow anyone would accept.
 * Selection, acknowledge-many and resolve-many are first-class.
 */
export default function AlertsPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <AlertsContent />
    </FleetReadyGate>
  );
}

function AlertsContent() {
  const counts = useAlertCounts();
  const {
    page,
    pageSize,
    filters,
    filteredCount,
    matchingIds,
    matching,
    setPage,
    setPageSize,
  } = useAlertPage();
  const actions = useAlertActions();
  const now = useNow();
  const devices = useDeviceStore((state) => state.devices);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);

  const alerts = page.items;
  const selectedIds = useMemo(() => [...selected], [selected]);

  // Selection is scoped to the visible page by default. With paging, an
  // unqualified "select all" over 25 of 143 rows is actively misleading — so
  // the header checkbox covers the page, and selecting the whole result set is
  // a separate, explicitly labelled action.
  const pageSelectedCount = alerts.filter((alert) => selected.has(alert.id)).length;
  const pageAllSelected = alerts.length > 0 && pageSelectedCount === alerts.length;
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected;
  const allMatchingSelected =
    matchingIds.length > 0 && selected.size === matchingIds.length;

  const toggle = (alertId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(alertId)) next.delete(alertId);
      else next.add(alertId);
      return next;
    });
  };

  /** Adds or removes just this page's alerts, leaving other pages untouched. */
  const togglePage = (): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (pageAllSelected) {
        for (const alert of alerts) next.delete(alert.id);
      } else {
        for (const alert of alerts) next.add(alert.id);
      }
      return next;
    });
  };

  const applyBulk = (action: BulkAction): void => {
    if (action === "acknowledge") actions.acknowledgeMany(selectedIds);
    else actions.resolveMany(selectedIds);
    setSelected(new Set());
    setPendingBulk(null);
  };

  /** Confirms first when the selection is bigger than the operator can see. */
  const requestBulk = (action: BulkAction): void => {
    if (selectedIds.length > BULK_CONFIRM_THRESHOLD) {
      setPendingBulk(action);
      return;
    }
    applyBulk(action);
  };

  const toggleSeverity = (severity: AlertSeverity): void => {
    const next = filters.severities.includes(severity)
      ? filters.severities.filter((entry) => entry !== severity)
      : [...filters.severities, severity];
    actions.setFilters({ severities: next });
  };

  const toggleStatus = (status: AlertStatus): void => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((entry) => entry !== status)
      : [...filters.statuses, status];
    actions.setFilters({ statuses: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-5">
      <KpiGroup minTileWidth={140}>
        <KpiTile
          label="Critical"
          value={counts.critical}
          tone="critical"
          icon={<BellRing className="size-3.5" />}
          hint="Open, highest severity"
          onClick={() => actions.setFilters({ severities: ["critical"] })}
          selected={filters.severities.length === 1 && filters.severities[0] === "critical"}
        />
        <KpiTile
          label="Warning"
          value={counts.warning}
          tone="warning"
          hint="Open"
          onClick={() => actions.setFilters({ severities: ["warning"] })}
          selected={filters.severities.length === 1 && filters.severities[0] === "warning"}
        />
        <KpiTile label="Unacknowledged" value={counts.active} tone="neutral" hint="Needs an owner" />
        <KpiTile label="Acknowledged" value={counts.acknowledged} tone="info" hint="Being worked" />
        <KpiTile label="Snoozed" value={counts.snoozed} tone="neutral" hint="Will re-open" />
        <KpiTile label="Resolved" value={counts.resolved} tone="online" hint="This session" />
      </KpiGroup>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchDraft}
            onChange={(event) => {
              setSearchDraft(event.target.value);
              actions.setFilters({ search: event.target.value });
            }}
            placeholder="Search alerts, devices…"
            aria-label="Search alerts"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Filter by severity">
          {ALERT_SEVERITIES.map((severity) => {
            const active = filters.severities.includes(severity);
            return (
              <Button
                key={severity}
                size="xs"
                variant={active ? "secondary" : "ghost"}
                onClick={() => toggleSeverity(severity)}
                aria-pressed={active}
                className="gap-1.5"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    severity === "critical" && "bg-status-critical",
                    severity === "warning" && "bg-status-warning",
                    severity === "info" && "bg-status-updating",
                  )}
                  aria-hidden="true"
                />
                <span className="text-[0.7rem] capitalize">{severity}</span>
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Filter by status">
          {ALERT_STATUSES.map((status) => {
            const active = filters.statuses.includes(status);
            return (
              <Button
                key={status}
                size="xs"
                variant={active ? "secondary" : "ghost"}
                onClick={() => toggleStatus(status)}
                aria-pressed={active}
                className="text-[0.7rem] capitalize"
              >
                {status}
              </Button>
            );
          })}
        </div>

        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            actions.resetFilters();
            setSearchDraft("");
          }}
          className="text-[0.7rem]"
        >
          Reset
        </Button>

        {/* Exports every alert matching the filters, across all pages. */}
        <ExportButton
          filePrefix="nexora-alerts"
          rows={matching}
          columns={ALERT_EXPORT_COLUMNS}
          noun="alerts"
          className="ml-auto"
        />
      </div>

      {selected.size > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
          role="region"
          aria-label="Bulk alert actions"
        >
          <span className="text-xs font-medium">
            {formatNumber(selected.size)} selected
          </span>

          {/* Only offered when it would actually widen the selection. */}
          {!allMatchingSelected && filteredCount > alerts.length ? (
            <Button
              size="xs"
              variant="ghost"
              className="text-[0.7rem]"
              onClick={() => setSelected(new Set(matchingIds))}
            >
              Select all {formatNumber(filteredCount)} matching
            </Button>
          ) : null}

          <Button
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => requestBulk("acknowledge")}
          >
            <Check className="size-3" aria-hidden="true" /> Acknowledge
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => requestBulk("resolve")}
          >
            <X className="size-3" aria-hidden="true" /> Resolve
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
            aria-label="Clear alert selection"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader
          title="Alerts"
          description={
            filteredCount === 0
              ? "None matching"
              : `${formatNumber(filteredCount)} matching · page ${page.page + 1} of ${page.pageCount}`
          }
          icon={<BellRing className="size-4" />}
          actions={
            alerts.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={pageAllSelected}
                  indeterminate={pageSomeSelected}
                  onCheckedChange={togglePage}
                />
                Select page
              </label>
            ) : null
          }
        />

        <PanelBody flush className="min-h-0 overflow-y-auto">
          {alerts.length === 0 ? (
            <EmptyState
              icon={Check}
              title="No alerts match these filters"
              description="Thresholds and rules are evaluated on every telemetry frame. Try widening the filters, or inject a failure from the simulator panel."
            />
          ) : (
            <ul className="divide-y divide-border">
              {alerts.map((alert) => {
                const device = devices.get(alert.deviceId);
                return (
                  <li
                    key={alert.id}
                    className={cn(
                      "flex gap-3 px-4 py-3",
                      selected.has(alert.id) && "bg-primary/5",
                    )}
                  >
                    <Checkbox
                      checked={selected.has(alert.id)}
                      onCheckedChange={() => toggle(alert.id)}
                      aria-label={`Select alert ${alert.title}`}
                      className="mt-1"
                    />

                    <span
                      className={cn(
                        "mt-1.5 w-0.5 shrink-0 self-stretch rounded-full",
                        alert.severity === "critical" && "bg-status-critical",
                        alert.severity === "warning" && "bg-status-warning",
                        alert.severity === "info" && "bg-status-updating",
                      )}
                      aria-hidden="true"
                    />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            href={`/devices/${alert.deviceId}`}
                            className="ops-mono truncate font-medium hover:underline"
                          >
                            {alert.deviceId}
                          </Link>
                          {device ? <StatusIndicator status={device.status} compact /> : null}
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[0.62rem] uppercase",
                              alert.severity === "critical" &&
                                "bg-status-critical/15 text-status-critical",
                              alert.severity === "warning" &&
                                "bg-status-warning/15 text-status-warning",
                            )}
                          >
                            {alert.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[0.62rem]">
                            {alert.source}
                          </Badge>
                          <Badge variant="outline" className="text-[0.62rem] capitalize">
                            {alert.status}
                          </Badge>
                        </div>
                        <time
                          dateTime={new Date(alert.createdAt).toISOString()}
                          className="tabular shrink-0 text-[0.7rem] text-muted-foreground"
                          title={formatTime(alert.createdAt)}
                        >
                          {now === 0
                            ? formatTime(alert.createdAt)
                            : formatRelativeTime(alert.createdAt, now)}
                        </time>
                      </div>

                      <p className="text-sm">{alert.title}</p>
                      <p className="text-xs text-muted-foreground">{alert.message}</p>

                      {alert.metric && alert.value !== undefined ? (
                        <p className="tabular text-xs">
                          Current{" "}
                          <span className="font-medium">
                            {formatMetricValue(alert.metric, alert.value)}
                          </span>
                          {alert.threshold !== undefined
                            ? ` · threshold ${formatMetricValue(alert.metric, alert.threshold)}`
                            : ""}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {alert.status === "active" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => actions.acknowledge(alert.id)}
                          >
                            <Check className="size-3" aria-hidden="true" /> Acknowledge
                          </Button>
                        ) : null}

                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => actions.resolve(alert.id)}
                        >
                          Resolve
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button size="xs" variant="ghost" className="gap-1.5">
                                <Clock className="size-3" aria-hidden="true" /> Snooze
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start" className="w-40">
                            {SNOOZE_OPTIONS.map((option) => (
                              <DropdownMenuItem
                                key={option.minutes}
                                onClick={() => actions.snooze(alert.id, option.minutes)}
                              >
                                {option.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button size="xs" variant="ghost" className="gap-1.5">
                                <UserPlus className="size-3" aria-hidden="true" />
                                {alert.assignee ? titleCase(alert.assignee) : "Assign"}
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start" className="w-44">
                            {/* The label is a `Menu.GroupLabel`, which Base UI
                                requires to sit inside a `Menu.Group` — it is
                                what the group is named by, so without the
                                group there is nothing for it to label. */}
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="ops-label">
                                Assign to
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {ASSIGNEES.map((assignee) => (
                                <DropdownMenuItem
                                  key={assignee}
                                  onClick={() => actions.assign(alert.id, assignee)}
                                >
                                  {assignee}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {alert.acknowledgedBy ? (
                          <span className="text-[0.68rem] text-muted-foreground">
                            Acknowledged by {alert.acknowledgedBy}
                          </span>
                        ) : null}
                        {alert.snoozedUntil && now > 0 ? (
                          <span className="text-[0.68rem] text-muted-foreground">
                            Re-opens {formatRelativeTime(alert.snoozedUntil, now)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>

        {filteredCount > 0 ? (
          <PanelFooter>
            <Pagination
              page={page.page}
              pageCount={page.pageCount}
              total={page.total}
              from={page.from}
              to={page.to}
              pageSize={pageSize}
              pageSizeOptions={ALERT_PAGE_SIZE_OPTIONS}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="alerts"
              className="w-full"
            />
          </PanelFooter>
        ) : null}

        <PanelFooter>
          <span>
            Threshold alerts auto-resolve once the reading crosses back past the recovery
            level. Rule alerts stay open until an operator closes them.
          </span>
        </PanelFooter>
      </Panel>

      <Dialog
        open={pendingBulk !== null}
        onOpenChange={(open) => !open && setPendingBulk(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-status-warning" aria-hidden="true" />
              {pendingBulk ? BULK_ACTION_COPY[pendingBulk].title : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {pendingBulk ? (
                <>
                  This applies to {formatNumber(selectedIds.length)} alert
                  {selectedIds.length === 1 ? "" : "s"}
                  {allMatchingSelected ? " — every alert matching the current filters" : ""}
                  . {BULK_ACTION_COPY[pendingBulk].detail} There is no undo.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingBulk(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => pendingBulk && applyBulk(pendingBulk)}
            >
              {pendingBulk === "resolve" ? "Resolve" : "Acknowledge"}{" "}
              {formatNumber(selectedIds.length)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
