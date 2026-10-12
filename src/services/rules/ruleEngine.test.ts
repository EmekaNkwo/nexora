import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeRule, evaluateRule } from "@/services/rules/evaluators";
import { RuleEngine, type RuleActionExecutor } from "@/services/rules/ruleEngine";
import type { Rule, RuleEvaluationContext } from "@/types/rules";
import { resetIdCounters } from "@/utils/ids";

const NOW = Date.UTC(2026, 3, 1, 12, 0, 0);

function context(overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext {
  return {
    deviceId: "LAG-2048",
    deviceName: "Cold Chain 2048",
    deviceType: "cold-storage-sensor",
    groupId: "grp-cold-storage",
    status: "online",
    values: { temperature: 36, battery: 80 },
    lastSeen: NOW,
    now: NOW,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    name: "Cold Storage Critical",
    description: "",
    enabled: true,
    logic: "all",
    scope: { kind: "all" },
    conditions: [
      {
        id: "c1",
        kind: "metric",
        metric: "temperature",
        operator: ">",
        value: 35,
        forSeconds: 0,
      },
    ],
    actions: [
      { id: "a1", type: "send_alert", severity: "critical", message: "Too hot" },
      { id: "a2", type: "send_command", command: "fan.on" },
    ],
    cooldownSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
    triggerCount: 0,
    ...overrides,
  };
}

function createExecutor(): RuleActionExecutor & {
  alerts: string[];
  commands: string[];
  statuses: string[];
  modes: string[];
  incidents: string[];
} {
  const alerts: string[] = [];
  const commands: string[] = [];
  const statuses: string[] = [];
  const modes: string[] = [];
  const incidents: string[] = [];
  return {
    alerts,
    commands,
    statuses,
    modes,
    incidents,
    sendAlert: (_ctx, action) => {
      alerts.push(action.message);
      return `alert-${alerts.length}`;
    },
    sendCommand: (_ctx, action) => {
      commands.push(action.command);
      return `cmd-${commands.length}`;
    },
    setDeviceStatus: (_ctx, action) => {
      statuses.push(action.status);
    },
    setDeviceMode: (_ctx, action) => {
      modes.push(action.mode);
    },
    createIncident: (_ctx, action) => {
      incidents.push(action.title);
      return `inc-${incidents.length}`;
    },
  };
}

beforeEach(() => {
  resetIdCounters();
});

describe("evaluateRule", () => {
  it("matches a single metric condition", () => {
    const result = evaluateRule(rule(), context());
    expect(result.matched).toBe(true);
    expect(result.conditions[0]!.detail).toContain("36.0°C > 35°C");
  });

  it("does not match when the metric is below the threshold", () => {
    expect(evaluateRule(rule(), context({ values: { temperature: 30 } })).matched).toBe(
      false,
    );
  });

  it("does not match when the device never reports the metric", () => {
    const result = evaluateRule(rule(), context({ values: { battery: 50 } }));
    expect(result.matched).toBe(false);
    expect(result.conditions[0]!.detail).toContain("not reported");
  });

  it("requires every condition under `all` logic", () => {
    const multi = rule({
      logic: "all",
      conditions: [
        { id: "c1", kind: "metric", metric: "temperature", operator: ">", value: 35, forSeconds: 0 },
        { id: "c2", kind: "metric", metric: "battery", operator: "<", value: 20, forSeconds: 0 },
      ],
    });

    expect(evaluateRule(multi, context()).matched).toBe(false);
    expect(
      evaluateRule(multi, context({ values: { temperature: 36, battery: 12 } })).matched,
    ).toBe(true);
  });

  it("requires only one condition under `any` logic", () => {
    const multi = rule({
      logic: "any",
      conditions: [
        { id: "c1", kind: "metric", metric: "temperature", operator: ">", value: 35, forSeconds: 0 },
        { id: "c2", kind: "metric", metric: "battery", operator: "<", value: 20, forSeconds: 0 },
      ],
    });

    expect(evaluateRule(multi, context()).matched).toBe(true);
  });

  it("holds a sustained condition until its window elapses", () => {
    const sustained = rule({
      conditions: [
        {
          id: "c1",
          kind: "metric",
          metric: "temperature",
          operator: ">",
          value: 35,
          forSeconds: 60,
        },
      ],
    });

    // First sample starts the clock but must not fire.
    const first = evaluateRule(sustained, context());
    expect(first.matched).toBe(false);
    expect(first.conditions[0]!.pendingMs).toBe(0);

    // Still inside the window.
    const mid = evaluateRule(
      sustained,
      context({ now: NOW + 30_000 }),
      first.nextState,
    );
    expect(mid.matched).toBe(false);

    // Window satisfied.
    const fired = evaluateRule(
      sustained,
      context({ now: NOW + 61_000 }),
      mid.nextState,
    );
    expect(fired.matched).toBe(true);
  });

  it("forgets sustain progress when the condition stops matching", () => {
    const sustained = rule({
      conditions: [
        {
          id: "c1",
          kind: "metric",
          metric: "temperature",
          operator: ">",
          value: 35,
          forSeconds: 60,
        },
      ],
    });

    const started = evaluateRule(sustained, context());
    const dipped = evaluateRule(
      sustained,
      context({ now: NOW + 30_000, values: { temperature: 20 } }),
      started.nextState,
    );
    expect(dipped.nextState.pendingSince).toEqual({});

    // Back above threshold — the clock restarts rather than resuming.
    const restarted = evaluateRule(
      sustained,
      context({ now: NOW + 40_000 }),
      dipped.nextState,
    );
    expect(restarted.matched).toBe(false);
  });

  it("suppresses repeat firings inside the cooldown window", () => {
    const cooling = rule({ cooldownSeconds: 300 });

    const first = evaluateRule(cooling, context());
    expect(first.matched).toBe(true);

    const suppressed = evaluateRule(
      cooling,
      context({ now: NOW + 60_000 }),
      first.nextState,
    );
    expect(suppressed.matched).toBe(false);
    expect(suppressed.suppressedByCooldown).toBe(true);

    const allowed = evaluateRule(
      cooling,
      context({ now: NOW + 301_000 }),
      suppressed.nextState,
    );
    expect(allowed.matched).toBe(true);
  });

  it("evaluates status and silence conditions", () => {
    const offline = rule({
      conditions: [{ id: "c1", kind: "status", status: "offline" }],
    });
    expect(evaluateRule(offline, context({ status: "offline" })).matched).toBe(true);
    expect(evaluateRule(offline, context({ status: "online" })).matched).toBe(false);

    const silent = rule({
      conditions: [{ id: "c1", kind: "silence", forSeconds: 120 }],
    });
    expect(
      evaluateRule(silent, context({ lastSeen: NOW - 200_000 })).matched,
    ).toBe(true);
    expect(evaluateRule(silent, context({ lastSeen: NOW - 10_000 })).matched).toBe(
      false,
    );
  });

  it("never matches a rule with no conditions", () => {
    expect(evaluateRule(rule({ conditions: [] }), context()).matched).toBe(false);
  });

  it("uses tolerant equality so float readings are comparable", () => {
    const equality = rule({
      conditions: [
        { id: "c1", kind: "metric", metric: "temperature", operator: "==", value: 36, forSeconds: 0 },
      ],
    });
    expect(
      evaluateRule(equality, context({ values: { temperature: 36.0000001 } })).matched,
    ).toBe(true);
  });
});

describe("RuleEngine", () => {
  it("executes every action of a rule that fires", () => {
    const executor = createExecutor();
    const onTrigger = vi.fn();
    const engine = new RuleEngine({ executor, onTrigger });
    engine.setRules([rule()]);

    engine.evaluateDevice(context());

    expect(executor.alerts).toEqual(["Too hot"]);
    expect(executor.commands).toEqual(["fan.on"]);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    const trigger = onTrigger.mock.calls[0]![0];
    expect(trigger.ruleName).toBe("Cold Storage Critical");
    expect(trigger.deviceId).toBe("LAG-2048");
    expect(trigger.actions.map((a: { type: string }) => a.type)).toEqual([
      "send_alert",
      "send_command",
    ]);
    // The trigger record carries the ids the actions produced, which is what
    // lets the UI link a rule firing to the alert and command it created.
    expect(trigger.actions[0]!.resultId).toBe("alert-1");
    expect(trigger.actions[1]!.resultId).toBe("cmd-1");
  });

  it("skips disabled rules", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    engine.setRules([rule({ enabled: false })]);
    engine.evaluateDevice(context());
    expect(executor.alerts).toHaveLength(0);
  });

  it("honours rule scope", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });

    engine.setRules([rule({ scope: { kind: "type", deviceType: "smart-meter" } })]);
    engine.evaluateDevice(context());
    expect(executor.alerts).toHaveLength(0);

    engine.setRules([
      rule({ scope: { kind: "group", groupId: "grp-cold-storage" } }),
    ]);
    engine.evaluateDevice(context());
    expect(executor.alerts).toHaveLength(1);

    engine.setRules([rule({ scope: { kind: "device", deviceId: "LAG-9999" } })]);
    engine.evaluateDevice(context());
    expect(executor.alerts).toHaveLength(1);
  });

  it("only evaluates rules whose metrics appear in the frame", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    engine.setRules([
      rule({
        id: "humidity-rule",
        conditions: [
          { id: "c1", kind: "metric", metric: "humidity", operator: ">", value: 1, forSeconds: 0 },
        ],
      }),
    ]);

    // Frame carries no humidity, so the humidity rule must not be evaluated.
    engine.evaluateDevice(context({ values: { temperature: 40 } }));
    expect(engine.diagnostics.evaluations).toBe(0);

    engine.evaluateDevice(context({ values: { humidity: 90 } }));
    expect(engine.diagnostics.evaluations).toBe(1);
  });

  it("always evaluates state-only rules regardless of reported metrics", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    engine.setRules([
      rule({
        conditions: [{ id: "c1", kind: "status", status: "offline" }],
        actions: [{ id: "a1", type: "set_device_mode", mode: "safe" }],
      }),
    ]);

    engine.evaluateDevice(context({ status: "offline", values: {} }));
    expect(executor.modes).toEqual(["safe"]);
  });

  it("keeps per-device cooldowns independent", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    engine.setRules([rule({ cooldownSeconds: 600 })]);

    engine.evaluateDevice(context({ deviceId: "LAG-1" }));
    engine.evaluateDevice(context({ deviceId: "LAG-2" }));
    // Same rule, two devices: both fire. A shared cooldown would drop one.
    expect(executor.alerts).toHaveLength(2);

    engine.evaluateDevice(context({ deviceId: "LAG-1", now: NOW + 1000 }));
    expect(executor.alerts).toHaveLength(2);
  });

  it("drops runtime state for rules that are deleted", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    const cooling = rule({ cooldownSeconds: 3600 });

    engine.setRules([cooling]);
    engine.evaluateDevice(context());
    expect(executor.alerts).toHaveLength(1);

    // Delete, then recreate with the same id: the stale cooldown must be gone.
    engine.setRules([]);
    engine.setRules([cooling]);
    engine.evaluateDevice(context({ now: NOW + 1000 }));
    expect(executor.alerts).toHaveLength(2);
  });

  it("dryRun evaluates without executing actions", () => {
    const executor = createExecutor();
    const engine = new RuleEngine({ executor });
    const candidate = rule();
    engine.setRules([candidate]);

    const result = engine.dryRun(candidate, context());
    expect(result.matched).toBe(true);
    expect(executor.alerts).toHaveLength(0);
  });
});

describe("describeRule", () => {
  it("renders conditions as a readable sentence", () => {
    expect(describeRule(rule())).toBe("Temperature > 35°C");
    expect(
      describeRule(
        rule({
          logic: "any",
          conditions: [
            { id: "c1", kind: "metric", metric: "battery", operator: "<", value: 20, forSeconds: 0 },
            { id: "c2", kind: "status", status: "offline" },
          ],
        }),
      ),
    ).toBe("Battery < 20% OR status is offline");
  });

  it("includes the sustain window when a condition has one", () => {
    expect(
      describeRule(
        rule({
          conditions: [
            {
              id: "c1",
              kind: "metric",
              metric: "temperature",
              operator: ">",
              value: 35,
              forSeconds: 120,
            },
          ],
        }),
      ),
    ).toBe("Temperature > 35°C for 2m");
  });
});
