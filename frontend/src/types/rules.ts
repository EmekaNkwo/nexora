import type { AlertSeverity } from "./alerts";
import type { CommandType } from "./commands";
import type { DeviceMode, DeviceStatus, DeviceType } from "./device";
import type { MetricKey } from "./telemetry";

export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
  ">",
  ">=",
  "<",
  "<=",
  "==",
  "!=",
] as const;

export const OPERATOR_LABELS: Readonly<Record<ComparisonOperator, string>> = {
  ">": "is greater than",
  ">=": "is at least",
  "<": "is less than",
  "<=": "is at most",
  "==": "equals",
  "!=": "does not equal",
};

/** A condition on a numeric telemetry metric. */
export interface MetricCondition {
  readonly id: string;
  readonly kind: "metric";
  readonly metric: MetricKey;
  readonly operator: ComparisonOperator;
  readonly value: number;
  /**
   * Require the condition to hold continuously for this long before the rule
   * fires. Zero means fire on the first matching sample.
   */
  readonly forSeconds: number;
}

/** A condition on connectivity / lifecycle state. */
export interface StatusCondition {
  readonly id: string;
  readonly kind: "status";
  readonly status: DeviceStatus;
}

/** A condition on how stale the device's last report is. */
export interface SilenceCondition {
  readonly id: string;
  readonly kind: "silence";
  readonly forSeconds: number;
}

export type RuleCondition = MetricCondition | StatusCondition | SilenceCondition;

export type RuleConditionKind = RuleCondition["kind"];

export interface SendAlertAction {
  readonly id: string;
  readonly type: "send_alert";
  readonly severity: AlertSeverity;
  readonly message: string;
}

export interface SendCommandAction {
  readonly id: string;
  readonly type: "send_command";
  readonly command: CommandType;
}

export interface SetStatusAction {
  readonly id: string;
  readonly type: "set_device_status";
  readonly status: DeviceStatus;
}

export interface SetModeAction {
  readonly id: string;
  readonly type: "set_device_mode";
  readonly mode: DeviceMode;
}

export interface CreateIncidentAction {
  readonly id: string;
  readonly type: "create_incident";
  readonly title: string;
  readonly assignee: string;
}

export type RuleAction =
  | SendAlertAction
  | SendCommandAction
  | SetStatusAction
  | SetModeAction
  | CreateIncidentAction;

export type RuleActionType = RuleAction["type"];

export const RULE_ACTION_TYPES: readonly RuleActionType[] = [
  "send_alert",
  "send_command",
  "set_device_status",
  "set_device_mode",
  "create_incident",
] as const;

export const RULE_ACTION_LABELS: Readonly<Record<RuleActionType, string>> = {
  send_alert: "Send Alert",
  send_command: "Send Command",
  set_device_status: "Change Device State",
  set_device_mode: "Change Device Mode",
  create_incident: "Create Incident",
};

/** All conditions must match (`all`) or any single one may (`any`). */
export type RuleLogic = "all" | "any";

/** Which devices a rule applies to. */
export type RuleScope =
  | { readonly kind: "all" }
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "type"; readonly deviceType: DeviceType }
  | { readonly kind: "device"; readonly deviceId: string };

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly logic: RuleLogic;
  readonly scope: RuleScope;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
  /** Minimum gap between firings for the same device. */
  readonly cooldownSeconds: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastTriggeredAt?: number;
  readonly triggerCount: number;
}

/** Draft shape used by the visual builder before a rule is saved. */
export type RuleDraft = Omit<
  Rule,
  "createdAt" | "updatedAt" | "triggerCount" | "lastTriggeredAt"
>;

/** Per-device bookkeeping the engine needs between evaluations. */
export interface RuleRuntimeState {
  /** When each `forSeconds` condition first started matching. */
  readonly pendingSince: Readonly<Record<string, number>>;
  readonly lastFiredAt: number;
}

export interface RuleEvaluationContext {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceType: DeviceType;
  readonly groupId: string;
  readonly status: DeviceStatus;
  readonly values: Readonly<Partial<Record<MetricKey, number>>>;
  readonly lastSeen: number;
  readonly now: number;
}

export interface ConditionResult {
  readonly conditionId: string;
  readonly matched: boolean;
  /** Human-readable rendering, e.g. `temperature 38.7 > 35`. */
  readonly detail: string;
  /** Present when the condition is waiting out its `forSeconds` window. */
  readonly pendingMs?: number;
}

export interface RuleEvaluation {
  readonly ruleId: string;
  readonly deviceId: string;
  readonly matched: boolean;
  readonly suppressedByCooldown: boolean;
  readonly conditions: readonly ConditionResult[];
  readonly nextState: RuleRuntimeState;
}

/** Record of a rule firing, shown in the rule execution timeline. */
export interface RuleTrigger {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly triggeredAt: number;
  readonly conditions: readonly ConditionResult[];
  readonly actions: readonly TriggeredActionRecord[];
}

export interface TriggeredActionRecord {
  readonly type: RuleActionType;
  readonly summary: string;
  /** Alert or command id produced by the action, when it created one. */
  readonly resultId?: string;
}
