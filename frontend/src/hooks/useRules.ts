"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useDevice } from "@/hooks/useDevices";
import { useRuleStore } from "@/stores/ruleStore";
import type { Rule, RuleTrigger } from "@/types/rules";

export function useRules(): readonly Rule[] {
  return useRuleStore((state) => state.rules);
}

export function useRule(ruleId: string | null | undefined): Rule | undefined {
  const rules = useRuleStore((state) => state.rules);
  return useMemo(
    () => (ruleId ? rules.find((rule) => rule.id === ruleId) : undefined),
    [rules, ruleId],
  );
}

export function useRuleTriggers(limit = 50): readonly RuleTrigger[] {
  const triggers = useRuleStore((state) => state.triggers);
  return useMemo(() => triggers.slice(0, limit), [triggers, limit]);
}

/** Firings for one rule — the execution timeline on the rule detail view. */
export function useTriggersForRule(ruleId: string, limit = 25): readonly RuleTrigger[] {
  const triggers = useRuleStore((state) => state.triggers);
  return useMemo(
    () => triggers.filter((trigger) => trigger.ruleId === ruleId).slice(0, limit),
    [triggers, ruleId, limit],
  );
}

/** Firings that touched one device — shown on the device page. */
export function useTriggersForDevice(
  deviceId: string | null | undefined,
  limit = 15,
): readonly RuleTrigger[] {
  const triggers = useRuleStore((state) => state.triggers);
  return useMemo(() => {
    if (!deviceId) return [];
    return triggers.filter((trigger) => trigger.deviceId === deviceId).slice(0, limit);
  }, [triggers, deviceId, limit]);
}

/**
 * Rules that could apply to a device, by scope.
 *
 * Shown on the device page so an operator can see which automation governs the
 * device they are looking at without cross-referencing the rules list.
 */
export function useRulesForDevice(deviceId: string | null | undefined): readonly Rule[] {
  const rules = useRuleStore((state) => state.rules);
  const device = useDevice(deviceId);

  return useMemo(() => {
    if (!device) return [];
    return rules.filter((rule) => {
      switch (rule.scope.kind) {
        case "all":
          return true;
        case "group":
          return rule.scope.groupId === device.groupId;
        case "type":
          return rule.scope.deviceType === device.type;
        case "device":
          return rule.scope.deviceId === device.id;
      }
    });
  }, [rules, device]);
}

export interface RuleActions {
  readonly createRule: ReturnType<typeof useRuleStore.getState>["createRule"];
  readonly updateRule: ReturnType<typeof useRuleStore.getState>["updateRule"];
  readonly deleteRule: (ruleId: string) => void;
  readonly setEnabled: (ruleId: string, enabled: boolean) => void;
  readonly duplicateRule: (ruleId: string) => void;
  readonly resetToDefaults: () => void;
}

export function useRuleActions(): RuleActions {
  return useRuleStore(
    useShallow((state) => ({
      createRule: state.createRule,
      updateRule: state.updateRule,
      deleteRule: state.deleteRule,
      setEnabled: state.setEnabled,
      duplicateRule: state.duplicateRule,
      resetToDefaults: state.resetToDefaults,
    })),
  );
}

export interface RuleStats {
  readonly total: number;
  readonly enabled: number;
  readonly totalTriggers: number;
}

export function useRuleStats(): RuleStats {
  const rules = useRuleStore((state) => state.rules);
  return useMemo(
    () => ({
      total: rules.length,
      enabled: rules.filter((rule) => rule.enabled).length,
      totalTriggers: rules.reduce((sum, rule) => sum + rule.triggerCount, 0),
    }),
    [rules],
  );
}
