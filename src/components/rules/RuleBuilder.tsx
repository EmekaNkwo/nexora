"use client";

import {
  ArrowDown,
  GitBranch,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Panel, PanelBody, PanelHeader, SectionHeading } from "@/components/shared/Panel";
import { onSelect } from "@/components/shared/selectValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGroups } from "@/hooks/useGroups";
import { DEVICE_STATUSES, DEVICE_TYPES, DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { DeviceMode, DeviceStatus, DeviceType } from "@/types/device";
import { COMMAND_DESCRIPTORS, COMMAND_TYPES, type CommandType } from "@/types/commands";
import { ALERT_SEVERITIES, type AlertSeverity } from "@/types/alerts";
import {
  COMPARISON_OPERATORS,
  OPERATOR_LABELS,
  RULE_ACTION_LABELS,
  RULE_ACTION_TYPES,
  type ComparisonOperator,
  type Rule,
  type RuleAction,
  type RuleActionType,
  type RuleCondition,
  type RuleConditionKind,
  type RuleDraft,
  type RuleLogic,
} from "@/types/rules";
import { METRIC_DESCRIPTORS, METRIC_KEYS, type MetricKey } from "@/types/telemetry";
import { createActionId, createConditionId, createRuleId } from "@/utils/ids";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/utils/formatting";

/**
 * The visual rule builder.
 *
 * ### Why a vertical IF → THEN flow rather than a node canvas
 *
 * A free-form node graph looks impressive and is the wrong tool here. These
 * rules are not arbitrary dataflow — they are a condition set and an ordered
 * action list, which is a *linear* structure. A vertical flow makes that shape
 * legible at a glance, works identically on a phone (where a pannable canvas
 * does not), and is fully keyboard navigable because every element is a real
 * form control rather than a draggable div.
 *
 * ### The draft is structured data, not markup
 *
 * The builder edits a `RuleDraft` — the exact shape the rule engine consumes.
 * There is no translation step between "what the builder shows" and "what the
 * engine evaluates", which is what makes the live preview trustworthy.
 */

export interface RuleBuilderProps {
  /** Existing rule to edit, or undefined to create a new one. */
  readonly rule?: Rule;
  readonly onSave: (draft: RuleDraft) => void;
  readonly onCancel: () => void;
}

/**
 * Value → label maps for the selects.
 *
 * Base UI's `Select.Value` renders the raw *value* unless the root is given an
 * `items` map — so without these the trigger reads "metric", ">" and
 * "temperature" while the open popup reads "Metric value", "> greater than"
 * and "Temperature". The maps are derived from the same sources as the
 * `SelectItem` labels, so the two cannot drift apart.
 */
const CONDITION_KIND_LABELS: Record<RuleConditionKind, string> = {
  metric: "Metric value",
  status: "Device status",
  silence: "No telemetry",
};

const METRIC_LABELS: Record<string, string> = Object.fromEntries(
  METRIC_KEYS.map((metric) => [metric, METRIC_DESCRIPTORS[metric].label]),
);

/**
 * Deliberately the symbol alone, while the popup lists "> is greater than".
 * The trigger sits under an "Operator" label between a metric and a value, so
 * the symbol is unambiguous there — and spelling it out costs ~70px, which is
 * the difference between the condition row fitting on one line and wrapping.
 */
const OPERATOR_ITEM_LABELS: Record<string, string> = Object.fromEntries(
  COMPARISON_OPERATORS.map((operator) => [operator, operator]),
);

const COMMAND_LABELS: Record<string, string> = Object.fromEntries(
  COMMAND_TYPES.filter((type) => type !== "firmware.update").map((type) => [
    type,
    COMMAND_DESCRIPTORS[type].label,
  ]),
);

/** Identity maps — the label *is* the value, but `items` is still required. */
const identityLabels = (values: readonly string[]): Record<string, string> =>
  Object.fromEntries(values.map((value) => [value, value]));

const STATUS_LABELS = identityLabels(DEVICE_STATUSES);
const SEVERITY_LABELS = identityLabels(ALERT_SEVERITIES);
const SET_STATUS_LABELS = identityLabels(["maintenance", "updating"]);
const MODE_LABELS = identityLabels(["normal", "eco", "diagnostic", "safe"]);

function blankDraft(): RuleDraft {
  return {
    id: createRuleId(),
    name: "",
    description: "",
    enabled: true,
    logic: "all",
    scope: { kind: "all" },
    conditions: [
      {
        id: createConditionId(),
        kind: "metric",
        metric: "temperature",
        operator: ">",
        value: 35,
        forSeconds: 0,
      },
    ],
    actions: [
      {
        id: createActionId(),
        type: "send_alert",
        severity: "critical",
        message: "Threshold exceeded",
      },
    ],
    cooldownSeconds: 180,
  };
}

function toDraft(rule: Rule): RuleDraft {
  const { createdAt, updatedAt, triggerCount, lastTriggeredAt, ...draft } = rule;
  // Discarded deliberately: these are engine-maintained, not editable.
  void createdAt;
  void updatedAt;
  void triggerCount;
  void lastTriggeredAt;
  return draft;
}

export function RuleBuilder({ rule, onSave, onCancel }: RuleBuilderProps) {
  const groups = useGroups();
  const [draft, setDraft] = useState<RuleDraft>(() => (rule ? toDraft(rule) : blankDraft()));
  const [nameError, setNameError] = useState<string | null>(null);

  const update = (patch: Partial<RuleDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));

  const updateCondition = (id: string, patch: Partial<RuleCondition>): void => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) =>
        condition.id === id ? ({ ...condition, ...patch } as RuleCondition) : condition,
      ),
    }));
  };

  const changeConditionKind = (id: string, kind: RuleConditionKind): void => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) => {
        if (condition.id !== id) return condition;
        // Switching kind replaces the condition entirely — the shapes share
        // only an id, and carrying stale fields across would be a bug.
        switch (kind) {
          case "metric":
            return {
              id,
              kind: "metric",
              metric: "temperature",
              operator: ">",
              value: 30,
              forSeconds: 0,
            };
          case "status":
            return { id, kind: "status", status: "offline" };
          case "silence":
            return { id, kind: "silence", forSeconds: 300 };
        }
      }),
    }));
  };

  const addCondition = (): void => {
    setDraft((current) => ({
      ...current,
      conditions: [
        ...current.conditions,
        {
          id: createConditionId(),
          kind: "metric",
          metric: "battery",
          operator: "<",
          value: 20,
          forSeconds: 0,
        },
      ],
    }));
  };

  const removeCondition = (id: string): void => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((condition) => condition.id !== id),
    }));
  };

  const updateAction = (id: string, patch: Partial<RuleAction>): void => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === id ? ({ ...action, ...patch } as RuleAction) : action,
      ),
    }));
  };

  const changeActionType = (id: string, type: RuleActionType): void => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => {
        if (action.id !== id) return action;
        switch (type) {
          case "send_alert":
            return { id, type, severity: "warning", message: "Condition met" };
          case "send_command":
            return { id, type, command: "fan.on" };
          case "set_device_status":
            return { id, type, status: "maintenance" };
          case "set_device_mode":
            return { id, type, mode: "safe" };
          case "create_incident":
            return { id, type, title: "Investigate device", assignee: "Field Service" };
        }
      }),
    }));
  };

  const addAction = (): void => {
    setDraft((current) => ({
      ...current,
      actions: [
        ...current.actions,
        { id: createActionId(), type: "send_command", command: "fan.on" },
      ],
    }));
  };

  const removeAction = (id: string): void => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== id),
    }));
  };

  /** Mirrors the scope `SelectItem`s below, including the group filter. */
  const scopeItems = useMemo(() => {
    const items: Record<string, string> = { all: "All devices" };
    for (const type of DEVICE_TYPES) {
      items[`type:${type}`] = `Type · ${DEVICE_TYPE_DESCRIPTORS[type].label}`;
    }
    for (const group of groups.filter((candidate) => candidate.kind !== "site")) {
      items[`group:${group.id}`] = `Group · ${group.name}`;
    }
    return items;
  }, [groups]);

  const scopeValue = useMemo(() => {
    switch (draft.scope.kind) {
      case "all":
        return "all";
      case "group":
        return `group:${draft.scope.groupId}`;
      case "type":
        return `type:${draft.scope.deviceType}`;
      case "device":
        return `device:${draft.scope.deviceId}`;
    }
  }, [draft.scope]);

  const setScope = (value: string): void => {
    if (value === "all") {
      update({ scope: { kind: "all" } });
      return;
    }
    const [kind, rest] = value.split(":");
    if (kind === "group" && rest) update({ scope: { kind: "group", groupId: rest } });
    if (kind === "type" && rest) {
      update({ scope: { kind: "type", deviceType: rest as DeviceType } });
    }
  };

  const save = (): void => {
    if (draft.name.trim().length < 3) {
      setNameError("Give the rule a name of at least 3 characters");
      return;
    }
    if (draft.conditions.length === 0) {
      setNameError("A rule needs at least one condition");
      return;
    }
    if (draft.actions.length === 0) {
      setNameError("A rule needs at least one action");
      return;
    }
    setNameError(null);
    onSave({ ...draft, name: draft.name.trim() });
  };

  const valid =
    draft.name.trim().length >= 3 &&
    draft.conditions.length > 0 &&
    draft.actions.length > 0;

  return (
    // Fills its host — a dialog gives it a bounded height, so the body scrolls
    // and the action bar stays pinned. The title and the "what this is" copy
    // belong to the host's header, not to a section inside the form.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Scroll container and layout grid in one element. `items-start` stops
          the preview stretching to the height of a long condition list, and
          `minmax(0,1fr)` stops a wide select blowing the form column out past
          its track. */}
      <div className="grid min-h-0 flex-1 items-start gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Panel flush>
            <PanelHeader
              title="Details"
              headingLevel={3}
              icon={<GitBranch className="size-4" />}
            />
            <PanelBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-name" className="ops-label">
                    Rule name
                  </Label>
                  <Input
                    id="rule-name"
                    value={draft.name}
                    onChange={(event) => {
                      update({ name: event.target.value });
                      setNameError(null);
                    }}
                    placeholder="Cold Storage Critical"
                    aria-invalid={Boolean(nameError)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rule-scope" className="ops-label">
                    Applies to
                  </Label>
                  <Select items={scopeItems} value={scopeValue} onValueChange={onSelect(setScope)}>
                    <SelectTrigger id="rule-scope" className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All devices</SelectItem>
                      {DEVICE_TYPES.map((type) => (
                        <SelectItem key={type} value={`type:${type}`}>
                          Type · {DEVICE_TYPE_DESCRIPTORS[type].label}
                        </SelectItem>
                      ))}
                      {groups
                        .filter((group) => group.kind !== "site")
                        .map((group) => (
                          <SelectItem key={group.id} value={`group:${group.id}`}>
                            Group · {group.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-description" className="ops-label">
                  Description
                </Label>
                <Textarea
                  id="rule-description"
                  value={draft.description}
                  onChange={(event) => update({ description: event.target.value })}
                  placeholder="What this rule is for, and what an operator should expect when it fires."
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2.5 text-xs">
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(checked) => update({ enabled: checked })}
                  />
                  Enabled
                </label>

                <div className="flex items-center gap-2">
                  <Label htmlFor="rule-cooldown" className="text-xs text-muted-foreground">
                    Cooldown
                  </Label>
                  <Input
                    id="rule-cooldown"
                    type="number"
                    min={0}
                    step={30}
                    value={draft.cooldownSeconds}
                    onChange={(event) =>
                      update({ cooldownSeconds: Math.max(0, Number(event.target.value) || 0) })
                    }
                    className="tabular h-7 w-20 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">
                    s ({formatSeconds(draft.cooldownSeconds)})
                  </span>
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* The IF block. */}
          <Panel flush>
            <PanelHeader
              title="IF"
              description="Conditions that must hold for the rule to fire"
              headingLevel={3}
              actions={
                draft.conditions.length > 1 ? (
                  <div className="flex items-center gap-1" role="group" aria-label="Condition logic">
                    {(["all", "any"] as const).map((logic) => (
                      <Button
                        key={logic}
                        size="xs"
                        variant={draft.logic === logic ? "secondary" : "ghost"}
                        onClick={() => update({ logic: logic as RuleLogic })}
                        aria-pressed={draft.logic === logic}
                        className="text-[0.7rem] uppercase"
                      >
                        {logic === "all" ? "Match all" : "Match any"}
                      </Button>
                    ))}
                  </div>
                ) : null
              }
            />
            <PanelBody className="space-y-3">
              {draft.conditions.map((condition, index) => (
                <div key={condition.id} className="space-y-2">
                  {index > 0 ? (
                    <p className="ops-label pl-1">
                      {draft.logic === "all" ? "AND" : "OR"}
                    </p>
                  ) : null}

                  {/* Fields wrap among themselves inside their own flex
                      container; the remove button is a sibling, so it stays on
                      the first line at the right instead of being pushed onto
                      a line of its own once the fields fill the row. */}
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="grid flex-1 grid-cols-1 items-end gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="ops-label">Condition</Label>
                        <Select
                          items={CONDITION_KIND_LABELS}
                          value={condition.kind}
                          onValueChange={onSelect<RuleConditionKind>((value) =>
                            changeConditionKind(condition.id, value),
                          )}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="metric">Metric value</SelectItem>
                            <SelectItem value="status">Device status</SelectItem>
                            <SelectItem value="silence">No telemetry</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {condition.kind === "metric" ? (
                        <>
                          <div className="space-y-1.5">
                            <Label className="ops-label">Metric</Label>
                            <Select
                              items={METRIC_LABELS}
                              value={condition.metric}
                              onValueChange={onSelect<MetricKey>((value) =>
                                updateCondition(condition.id, { metric: value })
                              )}
                            >
                              <SelectTrigger className="h-8 w-full text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {METRIC_KEYS.map((metric) => (
                                  <SelectItem key={metric} value={metric}>
                                    {METRIC_DESCRIPTORS[metric].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="ops-label">Operator</Label>
                            <Select
                              items={OPERATOR_ITEM_LABELS}
                              value={condition.operator}
                              onValueChange={onSelect<ComparisonOperator>((value) =>
                                updateCondition(condition.id, { operator: value })
                              )}
                            >
                              <SelectTrigger className="h-8 w-full text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {COMPARISON_OPERATORS.map((operator) => (
                                  <SelectItem key={operator} value={operator}>
                                    {operator} {OPERATOR_LABELS[operator]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="ops-label">Value</Label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={condition.value}
                                onChange={(event) =>
                                  updateCondition(condition.id, {
                                    value: Number(event.target.value) || 0,
                                  })
                                }
                                className="tabular h-8 text-xs"
                                aria-label="Threshold value"
                              />
                              <span className="text-xs text-muted-foreground">
                                {METRIC_DESCRIPTORS[condition.metric].unit}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="ops-label">Sustained</Label>
                            <Input
                              type="number"
                              min={0}
                              step={15}
                              value={condition.forSeconds}
                              onChange={(event) =>
                                updateCondition(condition.id, {
                                  forSeconds: Math.max(0, Number(event.target.value) || 0),
                                })
                              }
                              className="tabular h-8 text-xs"
                              aria-label="Seconds the condition must hold"
                            />
                          </div>
                        </>
                      ) : null}

                      {condition.kind === "status" ? (
                        <div className="space-y-1.5">
                          <Label className="ops-label">Status is</Label>
                          <Select
                            items={STATUS_LABELS}
                            value={condition.status}
                            onValueChange={onSelect<DeviceStatus>((value) =>
                              updateCondition(condition.id, { status: value })
                            )}
                          >
                            <SelectTrigger className="h-8 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEVICE_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      {condition.kind === "silence" ? (
                        <div className="space-y-1.5">
                          <Label className="ops-label">Silent for (seconds)</Label>
                          <Input
                            type="number"
                            min={30}
                            step={30}
                            value={condition.forSeconds}
                            onChange={(event) =>
                              updateCondition(condition.id, {
                                forSeconds: Math.max(30, Number(event.target.value) || 30),
                              })
                            }
                            className="tabular h-8 text-xs"
                          />
                        </div>
                      ) : null}

                    </div>

                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="mt-4 shrink-0"
                      onClick={() => removeCondition(condition.id)}
                      disabled={draft.conditions.length === 1}
                      aria-label="Remove condition"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button size="sm" variant="outline" onClick={addCondition} className="gap-1.5">
                <Plus className="size-3.5" aria-hidden="true" /> Add condition
              </Button>
            </PanelBody>
          </Panel>

          <div className="flex justify-center" aria-hidden="true">
            <ArrowDown className="size-5 text-muted-foreground" />
          </div>

          {/* The THEN block. */}
          <Panel flush>
            <PanelHeader
              title="THEN"
              description="Actions run in order when the rule fires"
              headingLevel={3}
            />
            <PanelBody className="space-y-3">
              {draft.actions.map((action, index) => (
                <div
                  key={action.id}
                  className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <span className="ops-label mt-5 w-5 shrink-0">{index + 1}</span>

                  {/* As with conditions: only the fields wrap, so the ordinal
                      stays left and the remove button stays right. */}
                  <div className="grid flex-1 grid-cols-1 items-end gap-2 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="ops-label">Action</Label>
                      <Select
                        items={RULE_ACTION_LABELS}
                        value={action.type}
                        onValueChange={onSelect<RuleActionType>((value) =>
                          changeActionType(action.id, value),
                        )}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_ACTION_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {RULE_ACTION_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {action.type === "send_alert" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="ops-label">Severity</Label>
                          <Select
                            items={SEVERITY_LABELS}
                            value={action.severity}
                            onValueChange={onSelect<AlertSeverity>((value) =>
                              updateAction(action.id, { severity: value })
                            )}
                          >
                            <SelectTrigger className="h-8 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALERT_SEVERITIES.map((severity) => (
                                <SelectItem key={severity} value={severity}>
                                  {severity}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="ops-label">Message</Label>
                          <Input
                            value={action.message}
                            onChange={(event) =>
                              updateAction(action.id, { message: event.target.value })
                            }
                            className="h-8 text-xs"
                            aria-label="Alert message"
                          />
                        </div>
                      </>
                    ) : null}

                    {action.type === "send_command" ? (
                      <div className="space-y-1.5">
                        <Label className="ops-label">Command</Label>
                        <Select
                          items={COMMAND_LABELS}
                          value={action.command}
                          onValueChange={onSelect<CommandType>((value) =>
                            updateAction(action.id, { command: value })
                          )}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COMMAND_TYPES.filter((type) => type !== "firmware.update").map(
                              (type) => (
                                <SelectItem key={type} value={type}>
                                  {COMMAND_DESCRIPTORS[type].label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    {action.type === "set_device_status" ? (
                      <div className="space-y-1.5">
                        <Label className="ops-label">Set status to</Label>
                        <Select
                          items={SET_STATUS_LABELS}
                          value={action.status}
                          onValueChange={onSelect<DeviceStatus>((value) =>
                            updateAction(action.id, { status: value })
                          )}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="maintenance">maintenance</SelectItem>
                            <SelectItem value="updating">updating</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    {action.type === "set_device_mode" ? (
                      <div className="space-y-1.5">
                        <Label className="ops-label">Set mode to</Label>
                        <Select
                          items={MODE_LABELS}
                          value={action.mode}
                          onValueChange={onSelect<DeviceMode>((value) =>
                            updateAction(action.id, { mode: value })
                          )}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["normal", "eco", "diagnostic", "safe"] as const).map((mode) => (
                              <SelectItem key={mode} value={mode}>
                                {mode}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    {action.type === "create_incident" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="ops-label">Title</Label>
                          <Input
                            value={action.title}
                            onChange={(event) =>
                              updateAction(action.id, { title: event.target.value })
                            }
                            className="h-8 text-xs"
                            aria-label="Incident title"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="ops-label">Assignee</Label>
                          <Input
                            value={action.assignee}
                            onChange={(event) =>
                              updateAction(action.id, { assignee: event.target.value })
                            }
                            className="h-8 text-xs"
                            aria-label="Incident assignee"
                          />
                        </div>
                      </>
                    ) : null}

                  </div>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="mt-4 shrink-0"
                    onClick={() => removeAction(action.id)}
                    disabled={draft.actions.length === 1}
                    aria-label="Remove action"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}

              <Button size="sm" variant="outline" onClick={addAction} className="gap-1.5">
                <Plus className="size-3.5" aria-hidden="true" /> Add action
              </Button>
            </PanelBody>
          </Panel>
        </div>

        <RulePreview draft={draft} />
      </div>

      {/* Belongs to the whole form, not to the THEN section — and pinned, so
          Cancel and Create stay reachable however long the rule grows. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3">
        {nameError ? (
          <span className="text-xs text-status-critical" role="alert">
            {nameError}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Saved rules take effect immediately — the engine re-indexes on every change.
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!valid}>
            {rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Live rule summary.
 *
 * Renders the draft as the flow diagram it represents, which is the fastest
 * way to catch a mistake like "match any" where "match all" was meant.
 */
function RulePreview({ draft }: { readonly draft: RuleDraft }) {
  const scopeLabel = useMemo(() => {
    switch (draft.scope.kind) {
      case "all":
        return "All devices";
      case "type":
        return DEVICE_TYPE_DESCRIPTORS[draft.scope.deviceType].label;
      case "group":
        return draft.scope.groupId.replace("grp-", "");
      case "device":
        return draft.scope.deviceId;
    }
  }, [draft.scope]);

  return (
    <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
      <Panel flush>
        <PanelHeader title="Preview" headingLevel={3} icon={<Zap className="size-4" />} />
        <PanelBody className="space-y-3">
          <div>
            <SectionHeading>Scope</SectionHeading>
            <p className="mt-1 text-xs">{scopeLabel}</p>
          </div>

          <FlowBlock label="IF" tone="warning">
            {draft.conditions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No conditions</p>
            ) : (
              <ul className="space-y-1">
                {draft.conditions.map((condition, index) => (
                  <li key={condition.id} className="text-xs">
                    {index > 0 ? (
                      <span className="ops-label mr-1.5">
                        {draft.logic === "all" ? "AND" : "OR"}
                      </span>
                    ) : null}
                    {describeCondition(condition)}
                  </li>
                ))}
              </ul>
            )}
          </FlowBlock>

          <div className="flex justify-center" aria-hidden="true">
            <ArrowDown className="size-4 text-muted-foreground" />
          </div>

          <FlowBlock label="THEN" tone="critical">
            {draft.actions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No actions</p>
            ) : (
              <ol className="space-y-1">
                {draft.actions.map((action, index) => (
                  <li key={action.id} className="text-xs">
                    <span className="ops-label mr-1.5">{index + 1}</span>
                    {describeAction(action)}
                  </li>
                ))}
              </ol>
            )}
          </FlowBlock>

          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Fires at most once per device every {formatSeconds(draft.cooldownSeconds)}.
            {draft.enabled ? "" : " Currently disabled — it will not be evaluated."}
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function FlowBlock({
  label,
  tone,
  children,
}: {
  readonly label: string;
  readonly tone: "warning" | "critical";
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border-l-2 bg-muted/25 p-3",
        tone === "warning" ? "border-l-status-warning" : "border-l-status-critical",
      )}
    >
      <p className="ops-label mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function describeCondition(condition: RuleCondition): string {
  switch (condition.kind) {
    case "metric": {
      const descriptor = METRIC_DESCRIPTORS[condition.metric];
      const sustain =
        condition.forSeconds > 0 ? ` for ${formatSeconds(condition.forSeconds)}` : "";
      return `${descriptor.label} ${condition.operator} ${condition.value}${descriptor.unit}${sustain}`;
    }
    case "status":
      return `status is ${condition.status}`;
    case "silence":
      return `no telemetry for ${formatSeconds(condition.forSeconds)}`;
  }
}

function describeAction(action: RuleAction): string {
  switch (action.type) {
    case "send_alert":
      return `Raise ${action.severity} alert — “${action.message}”`;
    case "send_command":
      return `Send ${COMMAND_DESCRIPTORS[action.command].label}`;
    case "set_device_status":
      return `Set status to ${action.status}`;
    case "set_device_mode":
      return `Set mode to ${action.mode}`;
    case "create_incident":
      return `Open incident “${action.title}” for ${action.assignee}`;
  }
}
