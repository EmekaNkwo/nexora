"use client";

import { ArrowLeft, GitBranch, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { RuleBuilderDialog } from "@/components/rules/RuleBuilderDialog";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/useClock";
import { useRule, useRuleActions, useTriggersForRule } from "@/hooks/useRules";
import { describeRule } from "@/services/rules/evaluators";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { RULE_ACTION_LABELS } from "@/types/rules";
import { formatRelativeTime, formatSeconds, formatTime } from "@/utils/formatting";

/**
 * Rule detail.
 *
 * The execution timeline is the substance of this page. For each firing it
 * records which conditions matched *with their actual values* and what each
 * action produced — so "why did this fire at 10:42?" is answerable from the
 * UI rather than requiring a mental replay of the telemetry.
 */
export default function RuleDetailPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <Suspense fallback={<ListSkeleton />}>
        <RuleDetail />
      </Suspense>
    </FleetReadyGate>
  );
}

function RuleDetail() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const rule = useRule(params.ruleId);
  const triggers = useTriggersForRule(params.ruleId, 40);
  const actions = useRuleActions();
  const now = useNow();
  const [editing, setEditing] = useState(false);

  if (!rule) {
    return (
      <div className="p-4 sm:p-5">
        <EmptyState
          icon={GitBranch}
          title="Rule not found"
          description="It may have been deleted, or the rules were reset to defaults."
          action={
            <Button size="sm" variant="outline" render={<Link href="/rules" />}>
              Back to rules
            </Button>
          }
        />
      </div>
    );
  }

  const scopeLabel =
    rule.scope.kind === "all"
      ? "All devices"
      : rule.scope.kind === "type"
        ? DEVICE_TYPE_DESCRIPTORS[rule.scope.deviceType].label
        : rule.scope.kind === "group"
          ? rule.scope.groupId.replace("grp-", "")
          : rule.scope.deviceId;

  return (
    <div className="mx-auto max-w-[100rem] space-y-5 p-4 sm:p-5">
      <Link
        href="/rules"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All rules
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold tracking-tight">{rule.name}</h2>
            <Badge variant="outline" className="text-[0.62rem]">
              {scopeLabel}
            </Badge>
          </div>
          {rule.description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{rule.description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={rule.enabled}
              onCheckedChange={(checked) => actions.setEnabled(rule.id, checked)}
            />
            {rule.enabled ? "Enabled" : "Disabled"}
          </label>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
            <Pencil className="size-3.5" aria-hidden="true" /> Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              actions.deleteRule(rule.id);
              router.push("/rules");
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      <KpiGroup minTileWidth={150}>
        <KpiTile
          label="Firings"
          value={rule.triggerCount}
          tone={rule.triggerCount > 0 ? "info" : "neutral"}
          hint="Since session start"
        />
        <KpiTile
          label="Last fired"
          value={
            rule.lastTriggeredAt && now > 0
              ? formatRelativeTime(rule.lastTriggeredAt, now)
              : "Never"
          }
        />
        <KpiTile label="Cooldown" value={formatSeconds(rule.cooldownSeconds)} hint="Per device" />
        <KpiTile
          label="Logic"
          value={rule.logic === "all" ? "Match all" : "Match any"}
          hint={`${rule.conditions.length} condition${rule.conditions.length === 1 ? "" : "s"}`}
        />
      </KpiGroup>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel flush>
          <PanelHeader title="IF" headingLevel={3} description={describeRule(rule)} />
          <PanelBody>
            <ul className="space-y-2">
              {rule.conditions.map((condition, index) => (
                <li
                  key={condition.id}
                  className="rounded-md border-l-2 border-l-status-warning bg-muted/25 px-3 py-2 text-xs"
                >
                  {index > 0 ? (
                    <span className="ops-label mr-1.5">
                      {rule.logic === "all" ? "AND" : "OR"}
                    </span>
                  ) : null}
                  {condition.kind === "metric"
                    ? `${condition.metric} ${condition.operator} ${condition.value}${condition.forSeconds > 0 ? ` for ${formatSeconds(condition.forSeconds)}` : ""}`
                    : condition.kind === "status"
                      ? `status is ${condition.status}`
                      : `no telemetry for ${formatSeconds(condition.forSeconds)}`}
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>

        <Panel flush>
          <PanelHeader title="THEN" headingLevel={3} description="Executed in order" />
          <PanelBody>
            <ol className="space-y-2">
              {rule.actions.map((action, index) => (
                <li
                  key={action.id}
                  className="rounded-md border-l-2 border-l-status-critical bg-muted/25 px-3 py-2 text-xs"
                >
                  <span className="ops-label mr-1.5">{index + 1}</span>
                  <span className="font-medium">{RULE_ACTION_LABELS[action.type]}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {action.type === "send_alert"
                      ? `${action.severity} — “${action.message}”`
                      : action.type === "send_command"
                        ? action.command
                        : action.type === "set_device_status"
                          ? `→ ${action.status}`
                          : action.type === "set_device_mode"
                            ? `→ ${action.mode}`
                            : `“${action.title}” → ${action.assignee}`}
                  </span>
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
      </div>

      <Panel flush>
        <PanelHeader
          title="Execution timeline"
          description="Each firing, with the condition values that caused it"
          icon={<GitBranch className="size-4" />}
        />
        <PanelBody flush className="max-h-[32rem] overflow-y-auto">
          {triggers.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="This rule has not fired yet"
              description={
                rule.enabled
                  ? "It is being evaluated on every matching telemetry frame. Inject a failure from the simulator panel to provoke it."
                  : "The rule is disabled, so it is not being evaluated."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {triggers.map((trigger) => (
                <li key={trigger.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/devices/${trigger.deviceId}`}
                      className="ops-mono text-sm font-medium hover:underline"
                    >
                      {trigger.deviceId}
                    </Link>
                    <span className="tabular text-[0.7rem] text-muted-foreground">
                      {formatTime(trigger.triggeredAt)}
                      {now > 0 ? ` · ${formatRelativeTime(trigger.triggeredAt, now)}` : ""}
                    </span>
                  </div>

                  <ul className="space-y-0.5">
                    {trigger.conditions.map((condition) => (
                      <li
                        key={condition.conditionId}
                        className={
                          condition.matched
                            ? "text-xs text-status-warning"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {condition.matched ? "✓" : "✕"} {condition.detail}
                      </li>
                    ))}
                  </ul>

                  <ul className="space-y-0.5">
                    {trigger.actions.map((action, index) => (
                      <li
                        key={`${action.type}-${index}`}
                        className="text-xs text-muted-foreground"
                      >
                        → {action.summary}
                        {action.resultId ? (
                          <span className="ml-1.5 text-[0.65rem] opacity-70">
                            ({action.resultId})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
        <PanelFooter>
          <span>
            Action ids link a firing to the alert or command it produced, so the whole
            causal chain is traceable.
          </span>
        </PanelFooter>
      </Panel>

      <RuleBuilderDialog
        open={editing}
        onOpenChange={setEditing}
        rule={rule}
        onSave={(draft) => {
          actions.updateRule(rule.id, draft);
          setEditing(false);
        }}
      />
    </div>
  );
}
