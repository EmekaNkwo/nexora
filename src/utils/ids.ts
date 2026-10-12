/**
 * Monotonic id generation.
 *
 * `crypto.randomUUID` is avoided on the hot path — the simulator can mint
 * thousands of ids per second and a counter is both faster and easier to read
 * in the dev-mode event inspector.
 */

const counters = new Map<string, number>();

export function nextId(prefix: string): string {
  const current = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, current);
  return `${prefix}_${current.toString(36)}`;
}

/** Test helper — resets all counters so ids are deterministic per test. */
export function resetIdCounters(): void {
  counters.clear();
}

export const createAlertId = (): string => nextId("alr");
export const createCommandId = (): string => nextId("cmd");
export const createRuleId = (): string => nextId("rule");
export const createActivityId = (): string => nextId("act");
export const createJobId = (): string => nextId("job");
export const createRolloutId = (): string => nextId("roll");
export const createTriggerId = (): string => nextId("trg");
export const createBatchId = (): string => nextId("batch");
export const createConditionId = (): string => nextId("cond");
export const createActionId = (): string => nextId("actn");
