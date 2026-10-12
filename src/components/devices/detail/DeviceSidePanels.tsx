"use client";

import {
  BellRing,
  GitBranch,
  HeartPulse,
  Info,
  Terminal,
} from "lucide-react";
import Link from "next/link";

import { DeviceActivityList } from "@/components/activity/ActivityFeed";
import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { StatBlock } from "@/components/shared/KpiTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/useClock";
import { useAlertActions, useDeviceAlerts } from "@/hooks/useAlerts";
import { useDeviceActivity } from "@/hooks/useActivity";
import { useDeviceCommandActions, useDeviceCommands, commandProgress } from "@/hooks/useCommands";
import { useDeviceHealthBreakdown } from "@/hooks/useDeviceHealth";
import { useRulesForDevice, useTriggersForDevice } from "@/hooks/useRules";
import { describeRule } from "@/services/rules/evaluators";
import type { Device } from "@/types/device";
import { COMMAND_DESCRIPTORS, type CommandType } from "@/types/commands";
import { cn } from "@/lib/utils";
import {
  formatCoordinates,
  formatDuration,
  formatMetricValue,
  formatRelativeTime,
  formatTime,
} from "@/utils/formatting";

/** Commands offered on the device page, in the order an operator reaches for. */
const QUICK_COMMANDS: readonly CommandType[] = [
  "device.restart",
  "fan.on",
  "fan.off",
  "telemetry.request",
  "device.calibrate",
];

/**
 * Health score, broken down.
 *
 * The number alone is not actionable — "62" tells an operator something is
 * wrong but not what. Listing the penalties is the difference between a metric
 * and a diagnosis.
 */
export function DeviceHealthPanel({ device }: { readonly device: Device }) {
  const breakdown = useDeviceHealthBreakdown(device.id);

  return (
    <Panel flush>
      <PanelHeader
        title="Health breakdown"
        description={`${breakdown?.score ?? device.healthScore} / 100`}
        icon={<HeartPulse className="size-4" />}
        headingLevel={3}
      />
      <PanelBody>
        {!breakdown || breakdown.factors.length === 0 ? (
          <EmptyState
            compact
            icon={HeartPulse}
            title="No health deductions"
            description="Connectivity, battery, signal, telemetry stability and error rate are all within normal bounds."
          />
        ) : (
          <ul className="space-y-2.5">
            {breakdown.factors.map((factor) => (
              <li key={factor.label} className="flex items-start gap-3">
                <span className="tabular w-9 shrink-0 text-right text-sm font-medium text-status-critical">
                  {factor.penalty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{factor.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {factor.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Command console scoped to one device, with its lifecycle history. */
export function DeviceCommandPanel({ device }: { readonly device: Device }) {
  const actions = useDeviceCommandActions(device.id);
  const commands = useDeviceCommands(device.id, 12);
  const now = useNow();

  return (
    <Panel flush>
      <PanelHeader
        title="Commands"
        description="Queued → sent → acknowledged → completed, with simulated latency"
        icon={<Terminal className="size-4" />}
        headingLevel={3}
      />

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
        {QUICK_COMMANDS.map((type) => {
          const descriptor = COMMAND_DESCRIPTORS[type];
          return (
            <Button
              key={type}
              size="xs"
              variant={descriptor.destructive ? "destructive" : "outline"}
              onClick={() => actions.send(type)}
              title={descriptor.description}
            >
              {descriptor.label}
            </Button>
          );
        })}
      </div>

      <PanelBody flush className="max-h-72 overflow-y-auto">
        {commands.length === 0 ? (
          <EmptyState
            compact
            icon={Terminal}
            title="No commands issued"
            description="Send a command above to watch its full lifecycle, including latency and acknowledgement."
          />
        ) : (
          <ul className="divide-y divide-border">
            {commands.map((command) => {
              const progress = commandProgress(command);
              const failed =
                command.status === "failed" || command.status === "timeout";
              return (
                <li key={command.id} className="space-y-1.5 px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {COMMAND_DESCRIPTORS[command.type].label}
                    </span>
                    <span className="tabular shrink-0 text-[0.7rem] text-muted-foreground">
                      {now === 0
                        ? formatTime(command.issuedAt)
                        : formatRelativeTime(command.issuedAt, now)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`Command ${command.status}`}
                    >
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
                        "shrink-0 text-[0.65rem] uppercase tracking-wide",
                        failed ? "text-status-critical" : "text-muted-foreground",
                      )}
                    >
                      {command.status}
                    </span>
                  </div>

                  <p className="text-[0.7rem] text-muted-foreground">
                    {command.origin === "rule" ? "Issued by rule · " : ""}
                    {command.origin === "bulk" ? "Bulk action · " : ""}
                    {command.latencyMs !== undefined
                      ? `settled in ${formatDuration(command.latencyMs)}`
                      : "in flight"}
                    {command.error ? ` · ${command.error}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Open alerts for this device, with inline triage. */
export function DeviceAlertsPanel({ device }: { readonly device: Device }) {
  const alerts = useDeviceAlerts(device.id);
  const actions = useAlertActions();
  const now = useNow();

  return (
    <Panel flush>
      <PanelHeader
        title="Alerts"
        description={alerts.length === 0 ? "None open" : `${alerts.length} open`}
        icon={<BellRing className="size-4" />}
        headingLevel={3}
      />
      <PanelBody flush className="max-h-72 overflow-y-auto">
        {alerts.length === 0 ? (
          <EmptyState
            compact
            icon={BellRing}
            title="No open alerts"
            description="This device is within all of its configured thresholds."
          />
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li key={alert.id} className="space-y-1.5 px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium">{alert.title}</span>
                  <span className="tabular shrink-0 text-[0.7rem] text-muted-foreground">
                    {now === 0 ? "" : formatRelativeTime(alert.createdAt, now)}
                  </span>
                </div>
                <p className="text-[0.7rem] text-muted-foreground">
                  {alert.metric && alert.value !== undefined
                    ? `Current ${formatMetricValue(alert.metric, alert.value)}`
                    : alert.message}
                </p>
                <div className="flex items-center gap-1.5">
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
                  {alert.status === "active" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-5 px-1.5 text-[0.65rem]"
                      onClick={() => actions.acknowledge(alert.id)}
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-5 px-1.5 text-[0.65rem]"
                    onClick={() => actions.resolve(alert.id)}
                  >
                    Resolve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * Rules governing this device, and their recent firings.
 *
 * Scope resolution happens here so an operator can see *which* automation
 * applies to the device in front of them, rather than reading the rules list
 * and working it out.
 */
export function DeviceRulesPanel({ device }: { readonly device: Device }) {
  const rules = useRulesForDevice(device.id);
  const triggers = useTriggersForDevice(device.id, 8);
  const now = useNow();

  return (
    <Panel flush>
      <PanelHeader
        title="Automation"
        description={`${rules.filter((rule) => rule.enabled).length} of ${rules.length} applicable rules enabled`}
        icon={<GitBranch className="size-4" />}
        headingLevel={3}
      />
      <PanelBody className="space-y-4">
        {rules.length === 0 ? (
          <EmptyState
            compact
            icon={GitBranch}
            title="No rules apply"
            description="No rule's scope covers this device."
          />
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    rule.enabled ? "bg-status-online" : "bg-status-offline",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/rules/${rule.id}`}
                    className="block truncate text-xs font-medium hover:underline"
                  >
                    {rule.name}
                  </Link>
                  <span className="block truncate text-[0.7rem] text-muted-foreground">
                    {describeRule(rule)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {triggers.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="ops-label">Recent firings</p>
            <ul className="space-y-2">
              {triggers.map((trigger) => (
                <li key={trigger.id} className="text-[0.7rem] leading-snug">
                  <span className="tabular text-muted-foreground">
                    {now === 0
                      ? formatTime(trigger.triggeredAt)
                      : formatRelativeTime(trigger.triggeredAt, now)}
                  </span>{" "}
                  <span className="font-medium">{trigger.ruleName}</span>
                  <span className="block text-muted-foreground">
                    {trigger.conditions
                      .filter((condition) => condition.matched)
                      .map((condition) => condition.detail)
                      .join("; ")}
                  </span>
                  <span className="block text-muted-foreground">
                    →{" "}
                    {trigger.actions.map((action) => action.summary).join(", ") ||
                      "no actions"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** Device metadata and deployment detail. */
export function DeviceMetadataPanel({ device }: { readonly device: Device }) {
  return (
    <Panel flush>
      <PanelHeader title="Device" icon={<Info className="size-4" />} headingLevel={3} />
      <PanelBody>
        <dl className="grid grid-cols-2 gap-4">
          <StatBlock label="Model" value={device.model} />
          <StatBlock label="Firmware" value={device.firmwareVersion} />
          <StatBlock label="Site" value={device.location.site} />
          <StatBlock label="Region" value={device.location.region} />
          <StatBlock
            label="Coordinates"
            value={
              <span className="ops-mono text-[0.7rem]">
                {formatCoordinates(device.location.lat, device.location.lng)}
              </span>
            }
            className="col-span-2"
          />
          <StatBlock label="Messages" value={device.messageCount.toLocaleString("en-US")} />
          <StatBlock
            label="Errors"
            value={device.errorCount}
            tone={device.errorCount > 0 ? "warning" : "neutral"}
          />
        </dl>

        {device.tags.length > 0 ? (
          <div className="mt-4 space-y-1.5">
            <p className="ops-label">Tags</p>
            <div className="flex flex-wrap gap-1">
              {device.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[0.62rem]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** Activity scoped to this device. */
export function DeviceActivityPanel({ device }: { readonly device: Device }) {
  const entries = useDeviceActivity(device.id, 30);

  return (
    <Panel flush>
      <PanelHeader
        title="Device activity"
        description="Events produced by this device in the current session"
        headingLevel={3}
      />
      <PanelBody flush className="max-h-80 overflow-y-auto">
        <DeviceActivityList entries={entries} />
      </PanelBody>
    </Panel>
  );
}
