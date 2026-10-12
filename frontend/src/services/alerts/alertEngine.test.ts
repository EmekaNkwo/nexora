import { beforeEach, describe, expect, it } from "vitest";

import { AlertEngine } from "@/services/alerts/alertEngine";
import {
  BUILT_IN_THRESHOLD_PROFILES,
  DEFAULT_THRESHOLDS,
  evaluateMetric,
  evaluateSnapshot,
  recovered,
  resolveThresholds,
  worstLevel,
} from "@/services/telemetry/thresholds";
import type { Alert } from "@/types/alerts";
import type { Device } from "@/types/device";
import { resetIdCounters } from "@/utils/ids";

const NOW = Date.UTC(2026, 3, 1, 12, 0, 0);

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "LAG-2048",
    name: "Cold Chain 2048",
    type: "cold-storage-sensor",
    model: "NX-CS40",
    status: "online",
    location: {
      lat: 6.45,
      lng: 3.39,
      site: "Lagos Cold Storage",
      city: "Lagos",
      region: "West Africa",
    },
    groupId: "grp-cold-storage",
    telemetry: { timestamp: NOW, values: {} },
    battery: 84,
    signalStrength: -67,
    firmwareVersion: "v2.3.1",
    lastSeen: NOW,
    healthScore: 96,
    createdAt: 0,
    mode: "normal",
    actuators: { fan: false, calibrating: false },
    errorCount: 0,
    messageCount: 100,
    tags: [],
    faulty: false,
    ...overrides,
  };
}

interface Recorder {
  created: Alert[];
  updated: Alert[];
  resolved: Alert[];
}

function createEngine(): { engine: AlertEngine; recorder: Recorder } {
  const recorder: Recorder = { created: [], updated: [], resolved: [] };
  const engine = new AlertEngine({
    onCreated: (alert) => recorder.created.push(alert),
    onUpdated: (alert) => recorder.updated.push(alert),
    onResolved: (alert) => recorder.resolved.push(alert),
  });
  engine.setThresholdProfiles(BUILT_IN_THRESHOLD_PROFILES);
  return { engine, recorder };
}

beforeEach(() => {
  resetIdCounters();
});

describe("threshold evaluation", () => {
  it("classifies above-direction breaches", () => {
    const temperature = DEFAULT_THRESHOLDS.temperature!;
    expect(evaluateMetric(25, temperature)).toBeNull();
    expect(evaluateMetric(32, temperature)).toBe("warning");
    expect(evaluateMetric(38.7, temperature)).toBe("critical");
  });

  it("classifies below-direction breaches", () => {
    const battery = DEFAULT_THRESHOLDS.battery!;
    expect(evaluateMetric(50, battery)).toBeNull();
    expect(evaluateMetric(18, battery)).toBe("warning");
    expect(evaluateMetric(8, battery)).toBe("critical");
  });

  it("ignores disabled thresholds", () => {
    expect(evaluateMetric(2000, DEFAULT_THRESHOLDS.motion)).toBeNull();
  });

  it("resolves tighter bands for cold-chain devices", () => {
    const fleet = resolveThresholds(
      { type: "temperature-sensor", groupId: "grp-factory-floor" },
      BUILT_IN_THRESHOLD_PROFILES,
    );
    const coldChain = resolveThresholds(
      { type: "cold-storage-sensor", groupId: "grp-cold-storage" },
      BUILT_IN_THRESHOLD_PROFILES,
    );

    expect(fleet.temperature!.critical).toBe(35);
    expect(coldChain.temperature!.critical).toBe(8);
    // Overrides are per metric: battery falls back to the fleet default.
    expect(coldChain.battery!.critical).toBe(DEFAULT_THRESHOLDS.battery!.critical);
  });

  it("detects recovery past the hysteresis level, not the firing level", () => {
    const temperature = DEFAULT_THRESHOLDS.temperature!;
    expect(recovered(29, temperature)).toBe(false);
    expect(recovered(27, temperature)).toBe(true);
  });

  it("reports the worst level across a snapshot", () => {
    const evaluations = evaluateSnapshot(
      { temperature: 32, battery: 8 },
      DEFAULT_THRESHOLDS,
    );
    expect(worstLevel(evaluations)).toBe("critical");
    expect(worstLevel(evaluateSnapshot({ temperature: 20 }, DEFAULT_THRESHOLDS))).toBeNull();
  });

  it("only returns entries for metrics that have enabled thresholds", () => {
    const evaluations = evaluateSnapshot(
      { temperature: 20, motion: 5 },
      DEFAULT_THRESHOLDS,
    );
    expect(evaluations.map((entry) => entry.metric)).toEqual(["temperature"]);
  });
});

describe("AlertEngine", () => {
  it("creates one alert for a breach", () => {
    const { engine, recorder } = createEngine();
    const target = device();

    engine.reconcile(target, evaluateSnapshot({ temperature: 12 }, resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES)), NOW);

    expect(recorder.created).toHaveLength(1);
    expect(recorder.created[0]!.severity).toBe("critical");
    expect(recorder.created[0]!.source).toBe("threshold");
    expect(recorder.created[0]!.message).toContain("Temperature exceeded 8°C");
  });

  it("deduplicates an ongoing condition instead of spamming alerts", () => {
    const { engine, recorder } = createEngine();
    const target = device();
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    for (let index = 0; index < 50; index += 1) {
      engine.reconcile(
        target,
        evaluateSnapshot({ temperature: 12 + index * 0.01 }, thresholds),
        NOW + index * 1000,
      );
    }

    expect(recorder.created).toHaveLength(1);
    expect(recorder.updated).toHaveLength(49);
    expect(engine.openCount).toBe(1);
  });

  it("holds the alert open until the value crosses the recovery level", () => {
    const { engine, recorder } = createEngine();
    const target = device();
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    engine.reconcile(target, evaluateSnapshot({ temperature: 12 }, thresholds), NOW);
    expect(engine.openCount).toBe(1);

    // Below critical (8) but above recovery (5) — must stay open.
    engine.reconcile(
      target,
      evaluateSnapshot({ temperature: 6 }, thresholds),
      NOW + 1000,
    );
    expect(recorder.resolved).toHaveLength(0);

    // Past recovery — now it closes.
    engine.reconcile(
      target,
      evaluateSnapshot({ temperature: 4 }, thresholds),
      NOW + 2000,
    );
    expect(recorder.resolved).toHaveLength(1);
    expect(recorder.resolved[0]!.status).toBe("resolved");
    expect(engine.openCount).toBe(0);
  });

  it("escalates a warning to a critical rather than keeping both open", () => {
    const { engine, recorder } = createEngine();
    const target = device({ type: "temperature-sensor", groupId: "grp-factory-floor" });
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    engine.reconcile(target, evaluateSnapshot({ temperature: 32 }, thresholds), NOW);
    expect(recorder.created[0]!.severity).toBe("warning");

    engine.reconcile(
      target,
      evaluateSnapshot({ temperature: 38.7 }, thresholds),
      NOW + 1000,
    );

    expect(recorder.created).toHaveLength(2);
    expect(recorder.created[1]!.severity).toBe("critical");
    expect(recorder.resolved).toHaveLength(1);
    expect(recorder.resolved[0]!.severity).toBe("warning");
    expect(engine.openCount).toBe(1);
  });

  it("tracks alerts per device and metric independently", () => {
    const { engine } = createEngine();
    const a = device({ id: "LAG-1" });
    const b = device({ id: "LAG-2" });
    const thresholds = resolveThresholds(a, BUILT_IN_THRESHOLD_PROFILES);

    engine.reconcile(a, evaluateSnapshot({ temperature: 12, battery: 5 }, thresholds), NOW);
    engine.reconcile(b, evaluateSnapshot({ temperature: 12 }, thresholds), NOW);

    expect(engine.countForDevice("LAG-1")).toBe(2);
    expect(engine.countForDevice("LAG-2")).toBe(1);
    expect(engine.criticalCountForDevice("LAG-1")).toBe(2);
  });

  it("raises a connectivity alert once and clears it on reconnect", () => {
    const { engine, recorder } = createEngine();
    const target = device();

    expect(engine.raiseConnectivityAlert(target, "signal-loss", NOW)).toBeDefined();
    expect(engine.raiseConnectivityAlert(target, "signal-loss", NOW + 1000)).toBeUndefined();
    expect(recorder.created).toHaveLength(1);

    engine.clearConnectivityAlert(target.id, NOW + 5000);
    expect(recorder.resolved).toHaveLength(1);
  });

  it("does not auto-resolve rule alerts", () => {
    const { engine, recorder } = createEngine();
    const target = device();
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    engine.raiseRuleAlert({
      deviceId: target.id,
      deviceName: target.name,
      severity: "critical",
      message: "Temperature exceeded 8°C",
      ruleId: "rule-1",
      ruleName: "Cold Storage Critical",
      now: NOW,
    });

    // Telemetry returns to normal; a threshold alert would close here.
    engine.reconcile(target, evaluateSnapshot({ temperature: 2 }, thresholds), NOW + 1000);

    expect(recorder.resolved).toHaveLength(0);
    expect(engine.openCount).toBe(1);
  });

  it("re-raises a condition after an operator resolves it by hand", () => {
    const { engine, recorder } = createEngine();
    const target = device();
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    engine.reconcile(target, evaluateSnapshot({ temperature: 12 }, thresholds), NOW);
    const key = recorder.created[0]!.dedupeKey;

    engine.forget(key);
    engine.reconcile(
      target,
      evaluateSnapshot({ temperature: 12 }, thresholds),
      NOW + 1000,
    );

    expect(recorder.created).toHaveLength(2);
  });

  it("forgets every alert for a removed device", () => {
    const { engine } = createEngine();
    const target = device();
    const thresholds = resolveThresholds(target, BUILT_IN_THRESHOLD_PROFILES);

    engine.reconcile(target, evaluateSnapshot({ temperature: 12, battery: 5 }, thresholds), NOW);
    engine.forgetDevice(target.id);

    expect(engine.openCount).toBe(0);
    expect(engine.countForDevice(target.id)).toBe(0);
  });
});
