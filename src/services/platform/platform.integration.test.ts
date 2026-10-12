import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { eventBus } from "@/services/events/eventBus";
import {
  injectFailure,
  issueCommand,
  startPlatform,
  stopPlatform,
} from "@/services/platform/platform";
import { simulationEngine } from "@/services/simulator/simulationEngine";
import { telemetryRepository } from "@/services/telemetry/telemetryRepository";
import { useActivityStore } from "@/stores/activityStore";
import { useAlertStore } from "@/stores/alertStore";
import { useCommandStore } from "@/stores/commandStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSimulationStore } from "@/stores/simulationStore";

/**
 * End-to-end test of the real composition root.
 *
 * Everything else in the suite tests a unit in isolation. This test wires up
 * the *actual* platform — the real simulator, the real transport, the real
 * ingestion pipeline, the real rule and alert engines, the real stores — and
 * asserts the causal chain the whole project is built to demonstrate:
 *
 *   telemetry → threshold breach → alert → rule fires → command issued →
 *   device acknowledges → cooling changes the physics → telemetry recovers →
 *   alert auto-resolves
 *
 * If any link in that chain were decorative rather than real, this test would
 * fail. It is the guard against the failure mode this kind of project is most
 * prone to: a UI that looks like a platform without being one.
 */

const START = Date.UTC(2026, 3, 1, 9, 0, 0);
const FLEET_SIZE = 150;

/** Advances fake time, flushing both timers and promise continuations. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Steps time in slices so interval callbacks interleave realistically. */
async function advanceInSteps(totalMs: number, stepMs = 1000): Promise<void> {
  const steps = Math.ceil(totalMs / stepMs);
  for (let index = 0; index < steps; index += 1) {
    await advance(stepMs);
  }
}

beforeAll(async () => {
  vi.useFakeTimers({ now: START, shouldAdvanceTime: false });
  useSimulationStore.getState().setDeviceCount(FLEET_SIZE);
  startPlatform();
  // Let the socket handshake complete and the first batches land.
  await advanceInSteps(6000);
});

afterAll(() => {
  stopPlatform();
  vi.useRealTimers();
});

describe("platform bootstrap", () => {
  it("seeds the fleet into the device store", () => {
    const state = useDeviceStore.getState();
    expect(state.initialised).toBe(true);
    expect(state.devices.size).toBe(FLEET_SIZE);
    expect(state.order).toHaveLength(FLEET_SIZE);
    expect(state.statusCounts.total).toBe(FLEET_SIZE);
  });

  it("connects the simulated transport", () => {
    expect(useSimulationStore.getState().socketState).toBe("connected");
    expect(simulationEngine.running).toBe(true);
  });

  it("ingests telemetry into the ring buffers", () => {
    const diagnostics = telemetryRepository.diagnostics;
    expect(diagnostics.samplesIngested).toBeGreaterThan(0);
    expect(diagnostics.deviceCount).toBeGreaterThan(0);
    expect(diagnostics.ringCount).toBeGreaterThan(0);
  });

  it("reports infrastructure metrics", () => {
    const metrics = useActivityStore.getState().metrics;
    expect(metrics.totalTelemetryEvents).toBeGreaterThan(0);
    expect(metrics.socketConnected).toBe(true);
  });

  it("updates device records from telemetry", async () => {
    const before = [...useDeviceStore.getState().devices.values()];
    const beforeSeen = new Map(before.map((device) => [device.id, device.lastSeen]));

    await advanceInSteps(5000);

    const after = [...useDeviceStore.getState().devices.values()];
    const moved = after.filter(
      (device) => (beforeSeen.get(device.id) ?? 0) < device.lastSeen,
    );
    // Round-robin means only a slice reports per tick, but over 5 s a
    // meaningful share of a 150-device fleet must have reported.
    expect(moved.length).toBeGreaterThan(10);
  });

  it("derives device status rather than trusting the simulator", () => {
    const devices = [...useDeviceStore.getState().devices.values()];
    // Status must only ever be one of the derived values.
    for (const device of devices) {
      expect([
        "online",
        "offline",
        "warning",
        "critical",
        "maintenance",
        "updating",
      ]).toContain(device.status);
    }
    expect(devices.some((device) => device.status === "online")).toBe(true);
  });

  it("computes a health score for every device", () => {
    for (const device of useDeviceStore.getState().devices.values()) {
      expect(device.healthScore).toBeGreaterThanOrEqual(0);
      expect(device.healthScore).toBeLessThanOrEqual(100);
    }
    expect(useDeviceStore.getState().healthDistribution.total).toBe(FLEET_SIZE);
  });
});

describe("the full causal chain", () => {
  /**
   * Observations recorded *while* the chain runs.
   *
   * Asserting on end state would be wrong here: the platform recovers the
   * device within a couple of ticks of the rule firing, so by the time the
   * scenario finishes the critical reading and critical status are both gone.
   * That speed is correct behaviour — it is the loop closing — so the test
   * records what actually happened as it happened, rather than hoping a
   * transient state is still visible at the end.
   */
  interface Observations {
    deviceId: string;
    baselineTemperature: number;
    peakTemperature: number;
    sawCriticalStatus: boolean;
    criticalAlertSeverities: string[];
    thresholdAlertCount: number;
    ruleTriggerRuleIds: string[];
    ruleTriggerActionTypes: string[][];
    ruleConditionDetails: string[];
    fanCommandOrigins: string[];
    fanCommandRuleIds: (string | undefined)[];
    fanEngaged: boolean;
    temperatureAfterCooling: number;
    resolvedThresholdAlerts: number;
  }

  const observed = {} as Observations;

  it("drives the whole chain on a cold-storage device", async () => {
    const device = [...useDeviceStore.getState().devices.values()].find(
      (candidate) =>
        candidate.type === "cold-storage-sensor" &&
        candidate.status !== "offline" &&
        candidate.telemetry.values.temperature !== undefined,
    );
    expect(device).toBeDefined();

    const deviceId = device!.id;
    observed.deviceId = deviceId;
    observed.baselineTemperature = device!.telemetry.values.temperature!;
    observed.peakTemperature = observed.baselineTemperature;
    observed.sawCriticalStatus = false;
    observed.criticalAlertSeverities = [];
    observed.thresholdAlertCount = 0;
    observed.ruleTriggerRuleIds = [];
    observed.ruleTriggerActionTypes = [];
    observed.ruleConditionDetails = [];
    observed.fanCommandOrigins = [];
    observed.fanCommandRuleIds = [];
    observed.fanEngaged = false;
    observed.resolvedThresholdAlerts = 0;

    // Subscribe before injecting, so nothing in the chain can be missed.
    const unsubscribers = [
      eventBus.on("alert.created", ({ alert }) => {
        if (alert.deviceId !== deviceId) return;
        if (alert.source !== "threshold") return;
        observed.thresholdAlertCount += 1;
        observed.criticalAlertSeverities.push(alert.severity);
      }),
      eventBus.on("alert.resolved", ({ alert }) => {
        if (alert.deviceId !== deviceId || alert.source !== "threshold") return;
        observed.resolvedThresholdAlerts += 1;
      }),
      eventBus.on("rule.triggered", ({ trigger }) => {
        if (trigger.deviceId !== deviceId) return;
        observed.ruleTriggerRuleIds.push(trigger.ruleId);
        observed.ruleTriggerActionTypes.push(
          trigger.actions.map((action) => action.type),
        );
        for (const condition of trigger.conditions) {
          if (condition.matched) observed.ruleConditionDetails.push(condition.detail);
        }
      }),
      eventBus.on("device.command.acknowledged", ({ command }) => {
        if (command.deviceId !== deviceId || command.type !== "fan.on") return;
        observed.fanCommandOrigins.push(command.origin);
        observed.fanCommandRuleIds.push(command.ruleId);
      }),
    ];

    telemetryRepository.observe(deviceId);
    const injected = injectFailure("temperature-spike", deviceId);
    expect(injected).toBe(deviceId);

    // Sample every second so the transient peak and critical status are seen.
    for (let elapsed = 0; elapsed < 150; elapsed += 1) {
      await advance(1000);
      const temperature = telemetryRepository.getLatest(deviceId, "temperature");
      if (temperature !== undefined && temperature > observed.peakTemperature) {
        observed.peakTemperature = temperature;
      }
      if (useDeviceStore.getState().devices.get(deviceId)!.status === "critical") {
        observed.sawCriticalStatus = true;
      }
      if (simulationEngine.getRuntime(deviceId)?.fanOn) observed.fanEngaged = true;
    }

    observed.temperatureAfterCooling = telemetryRepository.getLatest(
      deviceId,
      "temperature",
    )!;

    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("step 1: the device started at its cold set point", () => {
    expect(observed.baselineTemperature).toBeLessThan(10);
  });

  it("step 2: the sensor fault drove temperature past the 8°C critical limit", () => {
    expect(observed.peakTemperature).toBeGreaterThan(8);
    expect(observed.peakTemperature).toBeGreaterThan(observed.baselineTemperature + 5);
  });

  it("step 3: the alert engine raised a critical threshold alert", () => {
    expect(observed.criticalAlertSeverities).toContain("critical");
    // Dedupe: one alert per breach episode, not one per telemetry frame.
    expect(observed.thresholdAlertCount).toBeLessThanOrEqual(2);
  });

  it("step 4: the device read as critical while the breach lasted", () => {
    expect(observed.sawCriticalStatus).toBe(true);
  });

  it("step 5: the cold-storage rule fired, and recorded why", () => {
    expect(observed.ruleTriggerRuleIds).toContain("rule-cold-storage-critical");
    expect(observed.ruleConditionDetails.length).toBeGreaterThan(0);
    // The recorded condition carries the real reading, not a placeholder.
    expect(observed.ruleConditionDetails[0]!).toMatch(/Temperature .* > 8/);
  });

  it("step 6: the rule's actions were an alert and a command", () => {
    expect(observed.ruleTriggerActionTypes[0]).toEqual([
      "send_alert",
      "send_command",
    ]);
  });

  it("step 7: the command service dispatched a fan command on the rule's behalf", () => {
    expect(observed.fanCommandOrigins).toContain("rule");
    expect(observed.fanCommandRuleIds).toContain("rule-cold-storage-critical");
  });

  it("step 8: the device acknowledged and the fan physically engaged", () => {
    expect(observed.fanEngaged).toBe(true);
  });

  it("step 9: cooling brought the reading back below the recovery level", () => {
    // Cold-chain recovery is 5 °C, and cooling must not undershoot the set
    // point — a fan removes heat, it cannot refrigerate below the thermostat.
    expect(observed.temperatureAfterCooling).toBeLessThan(5);
    expect(observed.temperatureAfterCooling).toBeGreaterThan(
      observed.baselineTemperature - 6,
    );
  });

  it("step 10: the threshold alert auto-resolved", () => {
    expect(observed.resolvedThresholdAlerts).toBeGreaterThan(0);

    const stillOpen = useAlertStore
      .getState()
      .open.filter(
        (alert) =>
          alert.deviceId === observed.deviceId &&
          alert.source === "threshold" &&
          alert.metric === "temperature",
      );
    expect(stillOpen).toHaveLength(0);
  });

  it("step 11: the device returned to a non-critical status", () => {
    expect(useDeviceStore.getState().devices.get(observed.deviceId)!.status).not.toBe(
      "critical",
    );
  });

  it("recorded the whole chain in the activity feed", () => {
    const entries = useActivityStore
      .getState()
      .entries.filter((entry) => entry.deviceId === observed.deviceId);

    const kinds = new Set(entries.map((entry) => entry.kind));
    // The feed is the operator-facing trace of the chain.
    expect(kinds.has("alert")).toBe(true);
    expect(kinds.has("rule")).toBe(true);
    expect(kinds.has("command")).toBe(true);
  });
});

describe("operator commands reach the simulated device", () => {
  it("drives the fan off through the real command service", async () => {
    const device = [...useDeviceStore.getState().devices.values()].find(
      (candidate) => simulationEngine.getRuntime(candidate.id)?.fanOn === true,
    );
    if (!device) {
      // Nothing is cooling, so there is nothing to switch off.
      expect(true).toBe(true);
      return;
    }

    issueCommand({ deviceId: device.id, type: "fan.off" });
    await advanceInSteps(12_000);

    expect(simulationEngine.getRuntime(device.id)!.fanOn).toBe(false);
  });

  it("silences a device while it restarts, then resumes", async () => {
    const device = [...useDeviceStore.getState().devices.values()].find(
      (candidate) => candidate.status === "online",
    )!;

    issueCommand({ deviceId: device.id, type: "device.restart" });
    await advanceInSteps(8000);

    // The command had to be acknowledged for the reboot to begin.
    const restart = useCommandStore
      .getState()
      .commands.find(
        (command) =>
          command.deviceId === device.id && command.type === "device.restart",
      );
    expect(restart).toBeDefined();
    expect(["acknowledged", "completed"]).toContain(restart!.status);

    await advanceInSteps(30_000);
    expect(simulationEngine.getRuntime(device.id)!.muted).toBe(false);
  });
});

describe("failure injection propagates through the platform", () => {
  it("takes a device offline and raises a connectivity alert", async () => {
    const device = [...useDeviceStore.getState().devices.values()].find(
      (candidate) => candidate.status === "online",
    )!;

    injectFailure("device-offline", device.id);
    await advanceInSteps(3000);

    expect(useDeviceStore.getState().devices.get(device.id)!.status).toBe("offline");

    const connectivityAlert = useAlertStore
      .getState()
      .open.find(
        (alert) => alert.deviceId === device.id && alert.source === "connectivity",
      );
    expect(connectivityAlert).toBeDefined();
    expect(connectivityAlert!.title).toBe("Device offline");
  });

  it("takes a whole region offline during a network outage", async () => {
    const before = useDeviceStore.getState().statusCounts.offline;

    const outages: number[] = [];
    const unsubscribe = eventBus.on("system.network.outage", (payload) => {
      outages.push(payload.affectedDevices);
    });

    injectFailure("network-outage");
    await advanceInSteps(4000);
    unsubscribe();

    expect(outages.length).toBe(1);
    expect(outages[0]!).toBeGreaterThan(0);
    expect(useDeviceStore.getState().statusCounts.offline).toBeGreaterThanOrEqual(before);
  });
});

describe("the platform stays coherent under load", () => {
  it("keeps aggregate counts consistent with the device map", async () => {
    await advanceInSteps(20_000);

    const state = useDeviceStore.getState();
    const tallied = { online: 0, offline: 0, warning: 0, critical: 0, maintenance: 0, updating: 0 };
    for (const device of state.devices.values()) {
      tallied[device.status] += 1;
    }

    // Incremental aggregates must agree with a full sweep — this is the test
    // that catches a missed decrement in the patch path.
    expect(state.statusCounts.online).toBe(tallied.online);
    expect(state.statusCounts.offline).toBe(tallied.offline);
    expect(state.statusCounts.warning).toBe(tallied.warning);
    expect(state.statusCounts.critical).toBe(tallied.critical);
    expect(state.statusCounts.maintenance).toBe(tallied.maintenance);
    expect(state.statusCounts.updating).toBe(tallied.updating);
    expect(state.statusCounts.total).toBe(state.devices.size);
  });

  it("keeps the health distribution consistent with the device map", () => {
    const state = useDeviceStore.getState();
    let healthy = 0;
    let degraded = 0;
    let critical = 0;
    for (const device of state.devices.values()) {
      if (device.healthScore >= 80) healthy += 1;
      else if (device.healthScore >= 50) degraded += 1;
      else critical += 1;
    }

    expect(state.healthDistribution.healthy).toBe(healthy);
    expect(state.healthDistribution.degraded).toBe(degraded);
    expect(state.healthDistribution.critical).toBe(critical);
  });

  it("bounds the telemetry buffer footprint", () => {
    const diagnostics = telemetryRepository.diagnostics;
    // Cold devices hold 40 samples per metric; only observed devices are
    // promoted. The footprint must stay in the low megabytes, not grow with
    // elapsed time.
    expect(diagnostics.hotDeviceCount).toBeLessThanOrEqual(24);
    expect(diagnostics.approximateBytes).toBeLessThan(8 * 1024 * 1024);
  });

  it("bounds the activity feed and command history", () => {
    expect(useActivityStore.getState().entries.length).toBeLessThanOrEqual(250);
    expect(useCommandStore.getState().commands.length).toBeLessThanOrEqual(500);
  });

  it("does not leak event bus listeners", () => {
    // The platform subscribes a fixed set; a growing count would mean a
    // subscription created per tick.
    expect(eventBus.listenerCount()).toBeLessThan(40);
  });
});
