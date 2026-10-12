"use client";

import { Copy, GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RuleBuilderDialog } from "@/components/rules/RuleBuilderDialog";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/useClock";
import { useRuleActions, useRuleStats, useRuleTriggers, useRules } from "@/hooks/useRules";
import { describeRule } from "@/services/rules/evaluators";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { Rule, RuleDraft, RuleScope } from "@/types/rules";
import { cn } from "@/lib/utils";
import { formatCompact, formatRelativeTime, formatSeconds, formatTime } from "@/utils/formatting";

/**
 * Rules.
 *
 * The list and the execution log sit side by side on purpose: the thing an
 * operator most wants to know about a rule is not its definition but whether
 * it is actually firing, and on what. Seeing both at once is what makes the
 * automation trustworthy rather than mysterious.
 */
export default function RulesPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <RulesContent />
    </FleetReadyGate>
  );
}

function scopeLabel(scope: RuleScope): string {
  switch (scope.kind) {
    case "all":
      return "All devices";
    case "type":
      return DEVICE_TYPE_DESCRIPTORS[scope.deviceType].label;
    case "group":
      return scope.groupId.replace("grp-", "");
    case "device":
      return scope.deviceId;
  }
}

function RulesContent() {
  const rules = useRules();
  const stats = useRuleStats();
  const actions = useRuleActions();
  const triggers = useRuleTriggers(25);
  const now = useNow();

  /** `null` = closed. `{ rule: undefined }` = creating. */
  const [builder, setBuilder] = useState<{ readonly rule?: Rule } | null>(null);

  const closeBuilder = (): void => setBuilder(null);

  const saveRule = (draft: RuleDraft): void => {
    const editing = builder?.rule;
    if (editing) actions.updateRule(editing.id, draft);
    else actions.createRule(draft);
    setBuilder(null);
  };

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Automation rules</h2>
          <p className="text-xs text-muted-foreground">
            Evaluated against every telemetry frame. Rules can raise alerts, send
            commands and change device state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={actions.resetToDefaults}
            className="text-xs"
          >
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => setBuilder({})} className="gap-1.5">
            <Plus className="size-3.5" aria-hidden="true" /> New rule
          </Button>
        </div>
      </div>

      <KpiGroup minTileWidth={150}>
        <KpiTile label="Rules" value={stats.total} hint={`${stats.enabled} enabled`} />
        <KpiTile
          label="Enabled"
          value={stats.enabled}
          tone="online"
          hint="Being evaluated"
        />
        <KpiTile
          label="Total firings"
          value={formatCompact(stats.totalTriggers)}
          tone="info"
          hint="Since session start"
        />
        <KpiTile
          label="Recent firings"
          value={triggers.length}
          hint="In the execution log"
        />
      </KpiGroup>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <Panel flush>
          <PanelHeader
            title="Rules"
            icon={<GitBranch className="size-4" />}
            description={`${rules.length} defined`}
          />
          <PanelBody flush>
            {rules.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No rules defined"
                description="Create a rule to automate a response to telemetry — raise an alert, send a command, or change device state."
                action={
                  <Button size="sm" onClick={() => setBuilder({})}>
                    New rule
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap gap-3 px-4 py-3">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => actions.setEnabled(rule.id, checked)}
                      aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                      className="mt-0.5"
                    />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/rules/${rule.id}`}
                          className={cn(
                            "truncate text-sm font-medium hover:underline",
                            !rule.enabled && "text-muted-foreground",
                          )}
                        >
                          {rule.name}
                        </Link>
                        <Badge variant="outline" className="text-[0.62rem]">
                          {scopeLabel(rule.scope)}
                        </Badge>
                        {rule.triggerCount > 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-status-updating/15 text-[0.62rem] text-status-updating"
                          >
                            {rule.triggerCount} firing{rule.triggerCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        <span className="ops-label mr-1.5">IF</span>
                        {describeRule(rule)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="ops-label mr-1.5">THEN</span>
                        {rule.actions
                          .map((action) =>
                            action.type === "send_alert"
                              ? `${action.severity} alert`
                              : action.type === "send_command"
                                ? `command ${action.command}`
                                : action.type === "set_device_mode"
                                  ? `mode → ${action.mode}`
                                  : action.type === "set_device_status"
                                    ? `status → ${action.status}`
                                    : `incident “${action.title}”`,
                          )
                          .join(" · ")}
                      </p>
                      {rule.description ? (
                        <p className="text-[0.7rem] text-muted-foreground/80">
                          {rule.description}
                        </p>
                      ) : null}
                      <p className="text-[0.68rem] text-muted-foreground">
                        Cooldown {formatSeconds(rule.cooldownSeconds)}
                        {rule.lastTriggeredAt && now > 0
                          ? ` · last fired ${formatRelativeTime(rule.lastTriggeredAt, now)}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-start gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setBuilder({ rule })}
                        aria-label={`Edit ${rule.name}`}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => actions.duplicateRule(rule.id)}
                        aria-label={`Duplicate ${rule.name}`}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => actions.deleteRule(rule.id)}
                        aria-label={`Delete ${rule.name}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>

        <Panel flush className="xl:sticky xl:top-4 xl:self-start">
          <PanelHeader
            title="Execution log"
            description="Every firing, with the conditions that matched and what it did"
            headingLevel={3}
          />
          <PanelBody flush className="max-h-[36rem] overflow-y-auto">
            {triggers.length === 0 ? (
              <EmptyState
                compact
                icon={GitBranch}
                title="No rules have fired yet"
                description="Start the simulation, or inject a temperature spike from the simulator panel to see a rule trigger."
              />
            ) : (
              <ul className="divide-y divide-border">
                {triggers.map((trigger) => (
                  <li key={trigger.id} className="space-y-1 px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {trigger.ruleName}
                      </span>
                      <span className="tabular shrink-0 text-[0.7rem] text-muted-foreground">
                        {now === 0
                          ? formatTime(trigger.triggeredAt)
                          : formatRelativeTime(trigger.triggeredAt, now)}
                      </span>
                    </div>

                    <Link
                      href={`/devices/${trigger.deviceId}`}
                      className="ops-mono block text-[0.7rem] text-muted-foreground hover:underline"
                    >
                      {trigger.deviceId}
                    </Link>

                    <ul className="space-y-0.5">
                      {trigger.conditions
                        .filter((condition) => condition.matched)
                        .map((condition) => (
                          <li
                            key={condition.conditionId}
                            className="text-[0.7rem] text-status-warning"
                          >
                            ✓ {condition.detail}
                          </li>
                        ))}
                    </ul>

                    <ul className="space-y-0.5">
                      {trigger.actions.map((action, index) => (
                        <li
                          key={`${action.type}-${index}`}
                          className="text-[0.7rem] text-muted-foreground"
                        >
                          → {action.summary}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
          <PanelFooter>
            <span>Cooldowns prevent a rule firing repeatedly for one ongoing condition.</span>
          </PanelFooter>
        </Panel>
      </div>

      <RuleBuilderDialog
        open={builder !== null}
        onOpenChange={(open) => !open && closeBuilder()}
        rule={builder?.rule}
        onSave={saveRule}
      />
    </div>
  );
}
