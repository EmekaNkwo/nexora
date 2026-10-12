"use client";

import { Terminal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { IssueCommandDialog } from "@/components/commands/IssueCommandDialog";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/useClock";
import {
  commandProgress,
  useCommandActions,
  useCommandCounts,
  useCommands,
} from "@/hooks/useCommands";
import {
  COMMAND_DESCRIPTORS,
  TERMINAL_COMMAND_STATUSES,
  type CommandStatus,
} from "@/types/commands";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeTime, formatTime } from "@/utils/formatting";

const STATUS_FILTERS: readonly (CommandStatus | "all")[] = [
  "all",
  "queued",
  "sent",
  "acknowledged",
  "completed",
  "failed",
  "timeout",
];

/**
 * Command console.
 *
 * The lifecycle rail per row is the point of this screen. A command that is
 * "sent" but not acknowledged is materially different from one that completed,
 * and conflating them — as a simple success/failure list would — hides the
 * most common real failure mode: a device that never answers.
 */
export default function CommandsPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <CommandsContent />
    </FleetReadyGate>
  );
}

function CommandsContent() {
  const counts = useCommandCounts();
  const commands = useCommands(200);
  const actions = useCommandActions();
  const now = useNow();

  const [statusFilter, setStatusFilter] = useState<CommandStatus | "all">("all");
  const [issueOpen, setIssueOpen] = useState(false);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return commands;
    return commands.filter((command) => command.status === statusFilter);
  }, [commands, statusFilter]);

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Commands</h2>
          <p className="text-xs text-muted-foreground">
            Remote actions dispatched to devices, with their full lifecycle.
          </p>
        </div>
        <Button size="sm" onClick={() => setIssueOpen(true)} className="gap-1.5">
          <Terminal className="size-3.5" aria-hidden="true" />
          Issue command
        </Button>
      </div>

      <KpiGroup minTileWidth={150}>
        <KpiTile label="Queued" value={counts.queued} hint="Awaiting dispatch" />
        <KpiTile
          label="In flight"
          value={counts.inFlight}
          tone="info"
          hint="Sent or acknowledged"
        />
        <KpiTile label="Completed" value={counts.completed} tone="online" />
        <KpiTile
          label="Failed"
          value={counts.failed}
          tone={counts.failed > 0 ? "critical" : "neutral"}
          hint="Rejected or timed out"
        />
        <KpiTile label="Total" value={counts.total} hint="This session" />
      </KpiGroup>

      <div className="grid gap-5">
        <Panel flush>
          <PanelHeader
            title="Command history"
            description="Each row shows its position in the queued → sent → acknowledged → completed lifecycle"
            icon={<Terminal className="size-4" />}
            actions={
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
                {STATUS_FILTERS.map((status) => (
                  <Button
                    key={status}
                    size="xs"
                    variant={statusFilter === status ? "secondary" : "ghost"}
                    onClick={() => setStatusFilter(status)}
                    aria-pressed={statusFilter === status}
                    className="text-[0.7rem] capitalize"
                  >
                    {status}
                  </Button>
                ))}
              </div>
            }
          />

          <PanelBody flush className="max-h-[36rem] overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={Terminal}
                title="No commands to show"
                description="Issue a command from the panel on the right, from a device page, or let a rule send one."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((command) => {
                  const descriptor = COMMAND_DESCRIPTORS[command.type];
                  const failed = TERMINAL_COMMAND_STATUSES.includes(command.status) &&
                    command.status !== "completed";
                  const progress = commandProgress(command);

                  return (
                    <li key={command.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {descriptor.label}
                          </span>
                          <Link
                            href={`/devices/${command.deviceId}`}
                            className="ops-mono text-xs text-muted-foreground hover:underline"
                          >
                            {command.deviceId}
                          </Link>
                          <Badge variant="outline" className="text-[0.62rem] capitalize">
                            {command.origin}
                          </Badge>
                          {command.ruleId ? (
                            <Link href={`/rules/${command.ruleId}`}>
                              <Badge
                                variant="secondary"
                                className="bg-status-updating/15 text-[0.62rem] text-status-updating"
                              >
                                by rule
                              </Badge>
                            </Link>
                          ) : null}
                          {command.batchId ? (
                            <Badge variant="outline" className="text-[0.62rem]">
                              bulk
                            </Badge>
                          ) : null}
                        </div>
                        <span className="tabular shrink-0 text-[0.7rem] text-muted-foreground">
                          {now === 0
                            ? formatTime(command.issuedAt)
                            : formatRelativeTime(command.issuedAt, now)}
                        </span>
                      </div>

                      {/* The lifecycle rail. */}
                      <div className="flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn(
                              "block h-full rounded-full transition-[width] duration-300",
                              failed ? "bg-status-critical" : "bg-status-online",
                            )}
                            style={{ width: `${progress * 100}%` }}
                          />
                        </span>
                        <span
                          className={cn(
                            "w-24 shrink-0 text-right text-[0.65rem] uppercase tracking-wide",
                            failed ? "text-status-critical" : "text-muted-foreground",
                          )}
                        >
                          {command.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
                        <span>
                          {command.latencyMs !== undefined
                            ? `settled in ${formatDuration(command.latencyMs)}`
                            : "in flight"}
                        </span>
                        {command.sentAt ? (
                          <span>sent {formatTime(command.sentAt)}</span>
                        ) : null}
                        {command.acknowledgedAt ? (
                          <span>acknowledged {formatTime(command.acknowledgedAt)}</span>
                        ) : null}
                        {command.error ? (
                          <span className="text-status-critical">{command.error}</span>
                        ) : null}
                        {command.status === "queued" ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-5 px-1.5 text-[0.65rem]"
                            onClick={() => actions.cancel(command.id)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelBody>

          <PanelFooter>
            <span>
              Latency, acknowledgement and failure are all simulated by the transport —
              an unreachable device times out rather than failing instantly.
            </span>
          </PanelFooter>
        </Panel>
      </div>

      <IssueCommandDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        onSend={(deviceId, type) => actions.send(deviceId, type)}
      />
    </div>
  );
}