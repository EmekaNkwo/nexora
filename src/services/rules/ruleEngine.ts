import {
  EMPTY_RUNTIME_STATE,
  evaluateRule,
  isStateOnlyRule,
  ruleAppliesTo,
  ruleMetrics,
} from "@/services/rules/evaluators";
import type {
  Rule,
  RuleAction,
  RuleEvaluation,
  RuleEvaluationContext,
  RuleRuntimeState,
  RuleTrigger,
  TriggeredActionRecord,
} from "@/types/rules";
import { createTriggerId } from "@/utils/ids";

/**
 * Side effects a rule can produce.
 *
 * The engine does not know how to raise an alert or send a command — it only
 * decides that one should happen. The concrete implementations are injected,
 * which keeps the engine free of dependencies on the alert and command
 * services (and therefore free of the dependency cycle that would otherwise
 * exist, since those services feed data back into rule evaluation).
 */
export interface RuleActionExecutor {
  sendAlert(
    ctx: RuleEvaluationContext,
    action: Extract<RuleAction, { type: "send_alert" }>,
    rule: Rule,
  ): string | undefined;
  sendCommand(
    ctx: RuleEvaluationContext,
    action: Extract<RuleAction, { type: "send_command" }>,
    rule: Rule,
  ): string | undefined;
  setDeviceStatus(
    ctx: RuleEvaluationContext,
    action: Extract<RuleAction, { type: "set_device_status" }>,
    rule: Rule,
  ): void;
  setDeviceMode(
    ctx: RuleEvaluationContext,
    action: Extract<RuleAction, { type: "set_device_mode" }>,
    rule: Rule,
  ): void;
  createIncident(
    ctx: RuleEvaluationContext,
    action: Extract<RuleAction, { type: "create_incident" }>,
    rule: Rule,
  ): string | undefined;
}

export interface RuleEngineOptions {
  readonly executor: RuleActionExecutor;
  /** Called for each firing so the store can record it and the bus can emit. */
  readonly onTrigger?: (trigger: RuleTrigger) => void;
  /** Hard cap on firings per evaluation pass, as a runaway-rule backstop. */
  readonly maxTriggersPerPass?: number;
}

/**
 * Evaluates rules against device state.
 *
 * Performance shape: rules are indexed by the metrics they read, so a batch of
 * temperature frames only wakes temperature rules. Without that index, 1,000
 * frames × 20 rules would be 20,000 evaluations per tick regardless of
 * relevance.
 *
 * Runtime state (sustain windows, cooldowns) is keyed by rule + device and
 * lives here rather than in the store — it is engine bookkeeping, nothing
 * renders it, and keeping it out of React state avoids pointless re-renders.
 */
export class RuleEngine {
  private rules: readonly Rule[] = [];
  private readonly runtime = new Map<string, RuleRuntimeState>();
  /** metric → rules that read it; `*` → rules with no metric conditions. */
  private index = new Map<string, Rule[]>();
  private readonly executor: RuleActionExecutor;
  private readonly onTrigger?: (trigger: RuleTrigger) => void;
  private readonly maxTriggersPerPass: number;
  private evaluationCount = 0;
  private triggerCount = 0;

  constructor(options: RuleEngineOptions) {
    this.executor = options.executor;
    this.onTrigger = options.onTrigger;
    this.maxTriggersPerPass = options.maxTriggersPerPass ?? 250;
  }

  setRules(rules: readonly Rule[]): void {
    this.rules = rules;
    this.rebuildIndex();
    // Drop runtime state for rules that no longer exist, so a deleted rule
    // cannot resurrect a stale cooldown if it is recreated with the same id.
    const live = new Set(rules.map((rule) => rule.id));
    for (const key of [...this.runtime.keys()]) {
      const ruleId = key.slice(0, key.indexOf(RUNTIME_KEY_SEPARATOR));
      if (!live.has(ruleId)) this.runtime.delete(key);
    }
  }

  get activeRuleCount(): number {
    return this.rules.filter((rule) => rule.enabled).length;
  }

  get diagnostics(): { evaluations: number; triggers: number; indexedMetrics: number } {
    return {
      evaluations: this.evaluationCount,
      triggers: this.triggerCount,
      indexedMetrics: this.index.size,
    };
  }

  /**
   * Evaluates every applicable rule for one device and executes the actions of
   * any that fire. Returns the evaluations so callers can show "why" in the UI.
   */
  evaluateDevice(ctx: RuleEvaluationContext): readonly RuleEvaluation[] {
    const candidates = this.candidatesFor(ctx);
    if (candidates.length === 0) return [];

    const evaluations: RuleEvaluation[] = [];
    let fired = 0;

    for (const rule of candidates) {
      if (!rule.enabled) continue;
      if (!ruleAppliesTo(rule, ctx)) continue;

      const key = runtimeKey(rule.id, ctx.deviceId);
      const state = this.runtime.get(key) ?? EMPTY_RUNTIME_STATE;
      const evaluation = evaluateRule(rule, ctx, state);
      this.evaluationCount += 1;
      this.runtime.set(key, evaluation.nextState);
      evaluations.push(evaluation);

      if (evaluation.matched && fired < this.maxTriggersPerPass) {
        fired += 1;
        this.triggerCount += 1;
        this.fire(rule, ctx, evaluation);
      }
    }

    return evaluations;
  }

  /** Evaluates without executing — powers the rule builder's live preview. */
  dryRun(rule: Rule, ctx: RuleEvaluationContext): RuleEvaluation {
    return evaluateRule(rule, ctx, this.runtime.get(runtimeKey(rule.id, ctx.deviceId)));
  }

  /** Clears cooldowns and sustain windows. Used on simulation reset. */
  resetRuntime(): void {
    this.runtime.clear();
    this.evaluationCount = 0;
    this.triggerCount = 0;
  }

  private fire(
    rule: Rule,
    ctx: RuleEvaluationContext,
    evaluation: RuleEvaluation,
  ): void {
    const actions: TriggeredActionRecord[] = [];

    for (const action of rule.actions) {
      switch (action.type) {
        case "send_alert": {
          const resultId = this.executor.sendAlert(ctx, action, rule);
          actions.push({
            type: action.type,
            summary: `${action.severity} alert — ${action.message}`,
            resultId,
          });
          break;
        }
        case "send_command": {
          const resultId = this.executor.sendCommand(ctx, action, rule);
          actions.push({
            type: action.type,
            summary: `command ${action.command}`,
            resultId,
          });
          break;
        }
        case "set_device_status":
          this.executor.setDeviceStatus(ctx, action, rule);
          actions.push({
            type: action.type,
            summary: `status → ${action.status}`,
          });
          break;
        case "set_device_mode":
          this.executor.setDeviceMode(ctx, action, rule);
          actions.push({
            type: action.type,
            summary: `mode → ${action.mode}`,
          });
          break;
        case "create_incident": {
          const resultId = this.executor.createIncident(ctx, action, rule);
          actions.push({
            type: action.type,
            summary: `incident "${action.title}" → ${action.assignee}`,
            resultId,
          });
          break;
        }
      }
    }

    const trigger: RuleTrigger = {
      id: createTriggerId(),
      ruleId: rule.id,
      ruleName: rule.name,
      deviceId: ctx.deviceId,
      deviceName: ctx.deviceName,
      triggeredAt: ctx.now,
      conditions: evaluation.conditions,
      actions,
    };

    this.onTrigger?.(trigger);
  }

  /** Rules worth evaluating for this device's reported metrics. */
  private candidatesFor(ctx: RuleEvaluationContext): readonly Rule[] {
    const seen = new Set<string>();
    const candidates: Rule[] = [];

    const push = (rules: Rule[] | undefined): void => {
      if (!rules) return;
      for (const rule of rules) {
        if (seen.has(rule.id)) continue;
        seen.add(rule.id);
        candidates.push(rule);
      }
    };

    for (const metric in ctx.values) push(this.index.get(metric));
    push(this.index.get("*"));

    return candidates;
  }

  private rebuildIndex(): void {
    const index = new Map<string, Rule[]>();
    for (const rule of this.rules) {
      if (isStateOnlyRule(rule)) {
        const bucket = index.get("*") ?? [];
        bucket.push(rule);
        index.set("*", bucket);
        continue;
      }
      for (const metric of ruleMetrics(rule)) {
        const bucket = index.get(metric) ?? [];
        bucket.push(rule);
        index.set(metric, bucket);
      }
    }
    this.index = index;
  }
}

/**
 * Runtime state is keyed by rule + device. The separator is a NUL because no
 * generated rule id or device id can contain one, so keys can never collide
 * and `setRules` can recover the rule id by slicing at the first separator.
 */
const RUNTIME_KEY_SEPARATOR = "\u0000";

function runtimeKey(ruleId: string, deviceId: string): string {
  return `${ruleId}${RUNTIME_KEY_SEPARATOR}${deviceId}`;
}
