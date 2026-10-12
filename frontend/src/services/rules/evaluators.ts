import type {
  ComparisonOperator,
  ConditionResult,
  MetricCondition,
  Rule,
  RuleCondition,
  RuleEvaluation,
  RuleEvaluationContext,
  RuleRuntimeState,
  SilenceCondition,
  StatusCondition,
} from "@/types/rules";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import { formatSeconds } from "@/utils/formatting";

/**
 * Rule condition evaluation — pure functions only.
 *
 * Everything here takes state in and returns state out, including the
 * `forSeconds` bookkeeping. Keeping sustain windows in a returned
 * `RuleRuntimeState` rather than in mutable engine fields is what makes rule
 * behaviour unit-testable: a test can drive a condition across a simulated
 * five minutes by threading the state through, with no clock involved.
 */

export const EMPTY_RUNTIME_STATE: RuleRuntimeState = {
  pendingSince: {},
  lastFiredAt: 0,
};

export function compare(
  left: number,
  operator: ComparisonOperator,
  right: number,
): boolean {
  switch (operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "==":
      // Tolerant equality: sensor readings are floats and exact equality on a
      // float is a bug, not a feature.
      return Math.abs(left - right) < 1e-6;
    case "!=":
      return Math.abs(left - right) >= 1e-6;
  }
}

function evaluateMetricCondition(
  condition: MetricCondition,
  ctx: RuleEvaluationContext,
): { matched: boolean; detail: string } {
  const value = ctx.values[condition.metric];
  const descriptor = METRIC_DESCRIPTORS[condition.metric];

  if (value === undefined) {
    return {
      matched: false,
      detail: `${descriptor.label} not reported by this device`,
    };
  }

  const matched = compare(value, condition.operator, condition.value);
  const unit = descriptor.unit;
  return {
    matched,
    detail: `${descriptor.label} ${value.toFixed(descriptor.decimals)}${unit} ${condition.operator} ${condition.value}${unit}`,
  };
}

function evaluateStatusCondition(
  condition: StatusCondition,
  ctx: RuleEvaluationContext,
): { matched: boolean; detail: string } {
  const matched = ctx.status === condition.status;
  return {
    matched,
    detail: `Status is ${ctx.status}${matched ? "" : ` (expected ${condition.status})`}`,
  };
}

function evaluateSilenceCondition(
  condition: SilenceCondition,
  ctx: RuleEvaluationContext,
): { matched: boolean; detail: string } {
  const silentMs = ctx.now - ctx.lastSeen;
  const matched = silentMs >= condition.forSeconds * 1000;
  return {
    matched,
    detail: `Silent for ${Math.round(silentMs / 1000)}s (threshold ${formatSeconds(condition.forSeconds)})`,
  };
}

/** Evaluates one condition, ignoring any sustain window. */
export function evaluateCondition(
  condition: RuleCondition,
  ctx: RuleEvaluationContext,
): { matched: boolean; detail: string } {
  switch (condition.kind) {
    case "metric":
      return evaluateMetricCondition(condition, ctx);
    case "status":
      return evaluateStatusCondition(condition, ctx);
    case "silence":
      return evaluateSilenceCondition(condition, ctx);
  }
}

/** Sustain window required before a condition counts as matched. */
function sustainSeconds(condition: RuleCondition): number {
  return condition.kind === "metric" ? condition.forSeconds : 0;
}

/** Whether a rule's scope covers this device. */
export function ruleAppliesTo(rule: Rule, ctx: RuleEvaluationContext): boolean {
  switch (rule.scope.kind) {
    case "all":
      return true;
    case "group":
      return ctx.groupId === rule.scope.groupId;
    case "type":
      return ctx.deviceType === rule.scope.deviceType;
    case "device":
      return ctx.deviceId === rule.scope.deviceId;
  }
}

/**
 * Evaluates a whole rule against one device.
 *
 * Returns both the decision and the next runtime state. The caller is
 * responsible for persisting that state — the evaluator never mutates.
 */
export function evaluateRule(
  rule: Rule,
  ctx: RuleEvaluationContext,
  state: RuleRuntimeState = EMPTY_RUNTIME_STATE,
): RuleEvaluation {
  const results: ConditionResult[] = [];
  const nextPending: Record<string, number> = {};

  for (const condition of rule.conditions) {
    const { matched, detail } = evaluateCondition(condition, ctx);
    const sustain = sustainSeconds(condition);

    if (!matched) {
      // Condition stopped matching — forget its sustain progress entirely.
      results.push({ conditionId: condition.id, matched: false, detail });
      continue;
    }

    if (sustain <= 0) {
      results.push({ conditionId: condition.id, matched: true, detail });
      continue;
    }

    const since = state.pendingSince[condition.id] ?? ctx.now;
    nextPending[condition.id] = since;
    const heldMs = ctx.now - since;

    if (heldMs >= sustain * 1000) {
      results.push({
        conditionId: condition.id,
        matched: true,
        detail: `${detail} for ${Math.round(heldMs / 1000)}s`,
      });
    } else {
      results.push({
        conditionId: condition.id,
        matched: false,
        detail: `${detail} — holding ${Math.round(heldMs / 1000)}s of ${formatSeconds(sustain)}`,
        pendingMs: heldMs,
      });
    }
  }

  const hasConditions = results.length > 0;
  const matched = hasConditions
    ? rule.logic === "all"
      ? results.every((result) => result.matched)
      : results.some((result) => result.matched)
    : false;

  const cooldownMs = rule.cooldownSeconds * 1000;
  const suppressedByCooldown =
    matched && cooldownMs > 0 && ctx.now - state.lastFiredAt < cooldownMs;

  return {
    ruleId: rule.id,
    deviceId: ctx.deviceId,
    matched: matched && !suppressedByCooldown,
    suppressedByCooldown,
    conditions: results,
    nextState: {
      pendingSince: nextPending,
      lastFiredAt: matched && !suppressedByCooldown ? ctx.now : state.lastFiredAt,
    },
  };
}

/** Which metrics a rule reads — lets the engine skip irrelevant frames. */
export function ruleMetrics(rule: Rule): readonly string[] {
  const metrics: string[] = [];
  for (const condition of rule.conditions) {
    if (condition.kind === "metric") metrics.push(condition.metric);
  }
  return metrics;
}

/** True when the rule can only be decided from device state, not telemetry. */
export function isStateOnlyRule(rule: Rule): boolean {
  return rule.conditions.every((condition) => condition.kind !== "metric");
}

/** Renders a rule as a sentence, for list rows and the activity feed. */
export function describeRule(rule: Rule): string {
  if (rule.conditions.length === 0) return "No conditions";
  const joiner = rule.logic === "all" ? " AND " : " OR ";
  const parts = rule.conditions.map((condition) => {
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
        return `silent for ${formatSeconds(condition.forSeconds)}`;
    }
  });
  return parts.join(joiner);
}
