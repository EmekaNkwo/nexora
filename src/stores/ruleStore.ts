import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_RULES } from "@/services/rules/defaultRules";
import type { Rule, RuleDraft, RuleTrigger } from "@/types/rules";
import { createRuleId } from "@/utils/ids";
import { persistConfig, STORAGE_KEYS } from "@/utils/persistence";

/** Recent firings kept for the execution timeline. */
const TRIGGER_HISTORY_LIMIT = 300;

export interface RuleStoreState {
  readonly rules: readonly Rule[];
  readonly triggers: readonly RuleTrigger[];
  /** ruleId → firing count, so rule rows avoid scanning the trigger log. */
  readonly triggerCounts: ReadonlyMap<string, number>;
  readonly version: number;

  createRule: (draft: RuleDraft) => Rule;
  updateRule: (ruleId: string, draft: RuleDraft) => void;
  deleteRule: (ruleId: string) => void;
  setEnabled: (ruleId: string, enabled: boolean) => void;
  duplicateRule: (ruleId: string) => Rule | undefined;
  recordTrigger: (trigger: RuleTrigger) => void;
  clearTriggers: () => void;
  resetToDefaults: () => void;
}

export const useRuleStore = create<RuleStoreState>()(
  persist(
    (set, get) => ({
  rules: DEFAULT_RULES,
  triggers: [],
  triggerCounts: new Map(),
  version: 0,

  createRule: (draft) => {
    const now = Date.now();
    const rule: Rule = {
      ...draft,
      id: draft.id || createRuleId(),
      createdAt: now,
      updatedAt: now,
      triggerCount: 0,
    };
    set((state) => ({ rules: [...state.rules, rule], version: state.version + 1 }));
    return rule;
  },

  updateRule: (ruleId, draft) => {
    set((state) => ({
      rules: state.rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, ...draft, id: rule.id, updatedAt: Date.now() }
          : rule,
      ),
      version: state.version + 1,
    }));
  },

  deleteRule: (ruleId) => {
    set((state) => ({
      rules: state.rules.filter((rule) => rule.id !== ruleId),
      version: state.version + 1,
    }));
  },

  setEnabled: (ruleId, enabled) => {
    set((state) => ({
      rules: state.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled, updatedAt: Date.now() } : rule,
      ),
      version: state.version + 1,
    }));
  },

  duplicateRule: (ruleId) => {
    const source = get().rules.find((rule) => rule.id === ruleId);
    if (!source) return undefined;
    const now = Date.now();
    const copy: Rule = {
      ...source,
      id: createRuleId(),
      name: `${source.name} (copy)`,
      enabled: false,
      createdAt: now,
      updatedAt: now,
      triggerCount: 0,
      lastTriggeredAt: undefined,
    };
    set((state) => ({ rules: [...state.rules, copy], version: state.version + 1 }));
    return copy;
  },

  recordTrigger: (trigger) => {
    set((state) => {
      const counts = new Map(state.triggerCounts);
      counts.set(trigger.ruleId, (counts.get(trigger.ruleId) ?? 0) + 1);
      return {
        triggers: [trigger, ...state.triggers].slice(0, TRIGGER_HISTORY_LIMIT),
        triggerCounts: counts,
        rules: state.rules.map((rule) =>
          rule.id === trigger.ruleId
            ? {
                ...rule,
                triggerCount: rule.triggerCount + 1,
                lastTriggeredAt: trigger.triggeredAt,
              }
            : rule,
        ),
        // Deliberately not bumping `version`: a firing does not change rule
        // definitions, and the rule engine only needs to re-index when they do.
      };
    });
  },

  clearTriggers: () => set({ triggers: [], triggerCounts: new Map() }),

  resetToDefaults: () =>
    set((state) => ({
      rules: DEFAULT_RULES,
      triggers: [],
      triggerCounts: new Map(),
      version: state.version + 1,
    })),
    }),
    /**
     * Only the rule definitions are persisted. Firing history is a log of what
     * a *past* session's simulated fleet did — restoring it would show the
     * operator a timeline of events that, after the reload, never happened.
     * `triggerCounts` is derived from it and is a `Map`, which JSON cannot
     * carry anyway.
     */
    persistConfig<RuleStoreState, { readonly rules: readonly Rule[] }>(
      STORAGE_KEYS.rules,
      1,
      (state) => ({ rules: state.rules }),
    ),
  ),
);

export function getRule(ruleId: string): Rule | undefined {
  return useRuleStore.getState().rules.find((rule) => rule.id === ruleId);
}
