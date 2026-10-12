"use client";

import { ArrowUpRight, BellRing, Check } from "lucide-react";
import Link from "next/link";

import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useAlertActions, useAlertList } from "@/hooks/useAlerts";
import { useNow } from "@/hooks/useClock";
import { cn } from "@/lib/utils";
import { formatMetricValue, formatRelativeTime } from "@/utils/formatting";

/**
 * Most urgent open alerts.
 *
 * Capped at a handful — the dashboard's job is to say "these are the things on
 * fire", not to be the alerts page. Each row can be acknowledged inline,
 * because the most common action on a critical alert is to claim it, and making
 * that a page navigation adds friction to the one moment that matters.
 */

const MAX_ROWS = 6;

export function AlertSummaryPanel() {
  const { alerts, filteredCount } = useAlertList();
  const actions = useAlertActions();
  const now = useNow();
  const visible = alerts.slice(0, MAX_ROWS);

  return (
    <Panel flush className="h-full">
      <PanelHeader
        title="Priority alerts"
        description={
          filteredCount === 0
            ? "Nothing open"
            : `${filteredCount} open · showing the ${Math.min(MAX_ROWS, filteredCount)} most severe`
        }
        icon={<BellRing className="size-4" />}
        actions={
          <Link
            href="/alerts"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            All alerts <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        }
      />

      <PanelBody flush className="min-h-0 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={Check}
            title="No open alerts"
            description="Thresholds and rules are being evaluated continuously. Anything that breaches will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((alert) => (
              <li key={alert.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    alert.severity === "critical" && "bg-status-critical",
                    alert.severity === "warning" && "bg-status-warning",
                    alert.severity === "info" && "bg-status-updating",
                  )}
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/devices/${alert.deviceId}`}
                      className="ops-mono truncate font-medium hover:underline"
                    >
                      {alert.deviceId}
                    </Link>
                    <span className="tabular shrink-0 text-[0.7rem] text-muted-foreground">
                      {now === 0 ? "" : formatRelativeTime(alert.createdAt, now)}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-xs">{alert.title}</p>
                  <p className="truncate text-[0.7rem] text-muted-foreground">
                    {alert.metric && alert.value !== undefined
                      ? `Current ${formatMetricValue(alert.metric, alert.value)}`
                      : alert.message}
                  </p>

                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide",
                        alert.severity === "critical" &&
                          "bg-status-critical/15 text-status-critical",
                        alert.severity === "warning" &&
                          "bg-status-warning/15 text-status-warning",
                        alert.severity === "info" &&
                          "bg-status-updating/15 text-status-updating",
                      )}
                    >
                      {alert.severity}
                    </span>
                    {alert.status === "active" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => actions.acknowledge(alert.id)}
                        className="h-5 px-1.5 text-[0.65rem]"
                      >
                        Acknowledge
                      </Button>
                    ) : (
                      <span className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                        {alert.status}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
