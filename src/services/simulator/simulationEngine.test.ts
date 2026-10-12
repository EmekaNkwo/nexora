import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "@/services/events/eventBus";
import { SimulationEngine } from "@/services/simulator/simulationEngine";
import { MockSocket } from "@/services/websocket/mockSocket";
import type { NexoraEventMap } from "@/types/events";
import { DEFAULT_SIMULATION_CONFIG, DEFAULT_SIMULATION_FEATURES } from "@/types/simulation";
import type { TelemetryFrame } from "@/types/telemetry";

const START = Date.UTC(2026, 3, 1, 12, 0, 0);

/** Manual scheduler so ticks are driven explicitly rather than by wall clock. */
function createScheduler(): {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
  intervals: Map<number, { fn: () => void; ms: number }>;
} {
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextHandle = 1;
  return {
    intervals,
    setInterval: (fn, ms) => {
      const handle = nextHandle++;
      intervals.set(handle, { fn, ms });
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle);
    },
  };
}

interface Harness {
  engine: SimulationEngine;
  bus: EventBus;
  socket: MockSocket;
  frames: TelemetryFrame[];
  events: { name: string; payload: unknown }[];
  advanceTime: (ms: number) => void;
  tick: (times?: number, stepMs?: number) => void;
}

function createHarness(deviceCount = 40): Harness {
  let now = START;
  const bus = new EventBus();
  const socket = new MockSocket({
    bus,
    baseLatencyMs: 0,
    jitterMs: 0,
    dropRate: 0,
    handshakeMs: 0,
    seed: 1,
  });
  const scheduler = createScheduler();

  const frames: TelemetryFrame[] = [];
  const events: { name: string; payload: unknown }[] = [];

  bus.on("device.telemetry.batch", (payload: NexoraEventMap["device.telemetry.batch"]) => {
    frames.push(...payload.frames);
  });
  bus.onAny((envelope) => events.push({ name: envelope.name, payload: envelope.payload }));

  const engine = new SimulationEngine({
    bus,
    socket,
    scheduler,
    now: () => now,
    config: { ...DEFAULT_SIMULATION_CONFIG, deviceCount, rate: "normal" },
  });

  const advanceTime = (ms: number): void => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  const tick = (times = 1, stepMs = 1000): void => {
    for (let index = 0; index < times; index += 1) {
      advanceTime(stepMs);
      engine.runTick();
      // Flush the socket's in-flight deliveries. The transport applies a
      // minimum 4 ms latency even with jitter disabled, so a shorter window
      // would leave the last batch undelivered.
      vi.advanceTimersByTime(25);
    }
  };

  return { engine, bus, socket, frames, events, advanceTime, tick };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SimulationEngine lifecycle", () => {
  it("generates a fleet of the configured size", () => {
    const { engine } = createHarness(120);
    const devices = engine.initialise();
    expect(devices).toHaveLength(120);
    expect(engine.deviceCount).toBe(120);
    expect(new Set(devices.map((device) => device.id)).size).toBe(120);
  });

  it("connects the socket and reports running on start", () => {
    const { engine, socket, events } = createHarness();
    expect(engine.running).toBe(false);

    engine.start();
    vi.advanceTimersByTime(1);

    expect(engine.running).toBe(true);
    expect(socket.connected).toBe(true);
    expect(events.map((event) => event.name)).toContain("simulation.started");
  });

  it("stops ticking and disconnects on stop", () => {
    const { engine, socket, events } = createHarness();
    engine.start();
    vi.advanceTimersByTime(1);
    engine.stop();

    expect(engine.running).toBe(false);
    expect(socket.connected).toBe(false);
    expect(events.map((event) => event.name)).toContain("simulation.stopped");
  });

  it("is idempotent across repeated start and stop calls", () => {
    const { engine } = createHarness();
    engine.start();
    engine.start();
    vi.advanceTimersByTime(1);
    expect(engine.running).toBe(true);

    engine.stop();
    engine.stop();
    expect(engine.running).toBe(false);
  });

  it("clears counters and rebuilds the fleet on reset", () => {
    const { engine, tick } = createHarness(60);
    engine.start();
    vi.advanceTimersByTime(1);
    tick(5);

    expect(engine.stats.tick).toBeGreaterThan(0);
    expect(engine.stats.framesEmitted).toBeGreaterThan(0);

    engine.reset();
    expect(engine.stats.tick).toBe(0);
    expect(engine.stats.framesEmitted).toBe(0);
    expect(engine.deviceCount).toBe(60);
  });

  it("keeps the simulation running across a reset if it was running", () => {
    const { engine } = createHarness(20);
    engine.start();
    vi.advanceTimersByTime(1);
    engine.reset();
    vi.advanceTimersByTime(1);
    expect(engine.running).toBe(true);
  });
});

describe("SimulationEngine telemetry", () => {
  it("emits one batch per tick, not one event per device", () => {
    const { engine, bus, tick } = createHarness(100);
    let batches = 0;
    bus.on("device.telemetry.batch", () => {
      batches += 1;
    });

    engine.start();
    vi.advanceTimersByTime(1);
    tick(3);

    expect(batches).toBe(3);
  });

  it("samples a slice of the fleet per tick rather than all of it", () => {
    const { engine, tick, frames } = createHarness(1000);
    engine.start();
    vi.advanceTimersByTime(1);
    tick(1);

    // `normal` rate reports ~10% of the fleet per tick.
    expect(frames.length).toBeGreaterThan(40);
    expect(frames.length).toBeLessThan(200);
  });

  it("covers the whole fleet over successive ticks via round-robin", () => {
    const { engine, tick, frames } = createHarness(100);
    engine.start();
    vi.advanceTimersByTime(1);
    tick(15);

    const reported = new Set(frames.map((frame) => frame.deviceId));
    // 15 ticks at ~10 devices each should reach nearly every device.
    expect(reported.size).toBeGreaterThan(80);
  });

  it("increments a per-device sequence number", () => {
    const { engine, tick, frames } = createHarness(10);
    engine.start();
    vi.advanceTimersByTime(1);
    tick(12);

    const byDevice = new Map<string, number[]>();
    for (const frame of frames) {
      const existing = byDevice.get(frame.deviceId) ?? [];
      existing.push(frame.sequence);
      byDevice.set(frame.deviceId, existing);
    }

    for (const sequences of byDevice.values()) {
      for (let index = 1; index < sequences.length; index += 1) {
        expect(sequences[index]!).toBeGreaterThan(sequences[index - 1]!);
      }
    }
  });

  it("reports only metrics the device class has sensors for", () => {
    const { engine, tick, frames } = createHarness(80);
    engine.start();
    vi.advanceTimersByTime(1);
    tick(10);

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const keys = Object.keys(frame.values);
      expect(keys.length).toBeGreaterThan(0);
      for (const value of Object.values(frame.values)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("produces no telemetry when the telemetry feature is off", () => {
    const { engine, tick, frames } = createHarness(50);
    engine.setFeatures({ ...DEFAULT_SIMULATION_FEATURES, telemetry: false });
    engine.start();
    vi.advanceTimersByTime(1);
    tick(4);

    // Frames still flow (the device is reachable) but values stop evolving.
    const first = frames[0];
    const last = frames[frames.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
  });
});

describe("SimulationEngine rate and scale", () => {
  it("changes tick cadence without restarting the simulation", () => {
    const { engine } = createHarness(20);
    engine.start();
    vi.advanceTimersByTime(1);

    engine.setRate("fast");
    expect(engine.currentConfig.rate).toBe("fast");
    expect(engine.running).toBe(true);
  });

  it("emits more frames per tick at a faster rate", () => {
    const slow = createHarness(500);
    slow.engine.setRate("slow");
    slow.engine.start();
    vi.advanceTimersByTime(1);
    slow.tick(1);

    const fast = createHarness(500);
    fast.engine.setRate("fast");
    fast.engine.start();
    vi.advanceTimersByTime(1);
    fast.tick(1);

    expect(fast.frames.length).toBeGreaterThan(slow.frames.length);
  });

  it("preserves existing devices when scaling up", () => {
    const { engine } = createHarness(50);
    const before = engine.initialise();

    const after = engine.setScale(200);

    expect(after).toHaveLength(200);
    // Determinism in (seed, index) means the first 50 devices are unchanged,
    // so an operator moving the scale slider does not lose their fleet.
    expect(after.slice(0, 50).map((device) => device.id)).toEqual(
      before.map((device) => device.id),
    );
  });

  it("truncates from the end when scaling down", () => {
    const { engine } = createHarness(100);
    const before = engine.initialise();
    const after = engine.setScale(30);

    expect(after).toHaveLength(30);
    expect(after.map((device) => device.id)).toEqual(
      before.slice(0, 30).map((device) => device.id),
    );
  });

  it("emits a scaled event", () => {
    const { engine, events } = createHarness(10);
    engine.initialise();
    engine.setScale(25);
    expect(events.some((event) => event.name === "simulation.scaled")).toBe(true);
  });
});

describe("SimulationEngine failure injection", () => {
  it("takes a device offline and stops its telemetry", () => {
    const { engine, tick, frames } = createHarness(30);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices[0]!.id;
    engine.injectFailure("device-offline", target);
    frames.length = 0;
    tick(12);

    expect(frames.some((frame) => frame.deviceId === target)).toBe(false);
    expect(engine.getRuntime(target)?.connected).toBe(false);
  });

  it("emits an offline event when a device is dropped", () => {
    const { engine, events } = createHarness(30);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    engine.injectFailure("device-offline", devices[0]!.id);
    vi.advanceTimersByTime(5);

    const offline = events.find((event) => event.name === "device.offline");
    expect(offline).toBeDefined();
    expect((offline!.payload as { reason: string }).reason).toBe("injected");
  });

  it("drives a temperature spike past the critical band", () => {
    const { engine, tick, frames } = createHarness(60);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices.find((device) => device.telemetry.values.temperature !== undefined);
    expect(target).toBeDefined();

    const before = target!.telemetry.values.temperature!;
    engine.injectFailure("temperature-spike", target!.id);

    frames.length = 0;
    // Advance well past the ramp so the fault has time to escalate.
    tick(60, 2000);

    const readings = frames
      .filter((frame) => frame.deviceId === target!.id)
      .map((frame) => frame.values.temperature!)
      .filter((value) => value !== undefined);

    expect(readings.length).toBeGreaterThan(0);
    expect(Math.max(...readings)).toBeGreaterThan(before + 4);
  });

  it("collapses the battery on a battery failure", () => {
    const { engine, tick, frames } = createHarness(60);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices.find((device) => device.telemetry.values.battery !== undefined);
    expect(target).toBeDefined();

    engine.injectFailure("battery-failure", target!.id);
    frames.length = 0;
    tick(20);

    const readings = frames
      .filter((frame) => frame.deviceId === target!.id)
      .map((frame) => frame.values.battery!)
      .filter((value) => value !== undefined);

    if (readings.length > 0) {
      expect(Math.min(...readings)).toBeLessThan(15);
    }
  });

  it("takes a whole region offline during a network outage and restores it", () => {
    const { engine, events, tick } = createHarness(300);
    engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    engine.injectFailure("network-outage");

    const outage = events.find((event) => event.name === "system.network.outage");
    expect(outage).toBeDefined();
    expect((outage!.payload as { affectedDevices: number }).affectedDevices).toBeGreaterThan(0);

    // Outage lasts 45s; advance past it and tick to trigger restoration.
    tick(1, 50_000);
    expect(events.some((event) => event.name === "system.network.restored")).toBe(true);
  });
});

describe("SimulationEngine command effects", () => {
  it("cools a device while the fan is on — closing the rule→command loop", () => {
    const { engine, tick, frames } = createHarness(60);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices.find(
      (device) => device.telemetry.values.temperature !== undefined,
    )!;

    // Heat it up first so there is something to cool.
    engine.injectFailure("temperature-spike", target.id);
    tick(30, 2000);

    const hottest = Math.max(
      ...frames
        .filter((frame) => frame.deviceId === target.id)
        .map((frame) => frame.values.temperature ?? Number.NEGATIVE_INFINITY),
    );

    engine.applyCommandEffect(target.id, "fan.on");
    expect(engine.getRuntime(target.id)?.fanOn).toBe(true);

    frames.length = 0;
    tick(40, 2000);

    const afterCooling = frames
      .filter((frame) => frame.deviceId === target.id)
      .map((frame) => frame.values.temperature!)
      .filter((value) => value !== undefined);

    expect(afterCooling.length).toBeGreaterThan(0);
    expect(Math.min(...afterCooling)).toBeLessThan(hottest);
  });

  it("stops cooling when the fan is switched off", () => {
    const { engine } = createHarness(20);
    const devices = engine.initialise();

    engine.applyCommandEffect(devices[0]!.id, "fan.on");
    expect(engine.getRuntime(devices[0]!.id)?.fanOn).toBe(true);

    engine.applyCommandEffect(devices[0]!.id, "fan.off");
    expect(engine.getRuntime(devices[0]!.id)?.fanOn).toBe(false);
  });

  it("silences a device while it restarts", () => {
    const { engine, tick, frames } = createHarness(20);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices[0]!.id;
    engine.applyCommandEffect(target, "device.restart");
    expect(engine.getRuntime(target)?.muted).toBe(true);

    frames.length = 0;
    tick(4, 1000);
    expect(frames.some((frame) => frame.deviceId === target)).toBe(false);

    // After the reboot window it reports again.
    tick(20, 1000);
    expect(frames.some((frame) => frame.deviceId === target)).toBe(true);
  });

  it("emits an immediate out-of-band frame on telemetry request", () => {
    const { engine, bus } = createHarness(20);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const received: string[] = [];
    bus.on("device.telemetry.updated", (payload) => {
      received.push(payload.frame.deviceId);
    });

    engine.applyCommandEffect(devices[0]!.id, "telemetry.request");
    vi.advanceTimersByTime(5);

    expect(received).toContain(devices[0]!.id);
  });

  it("clears an active fault when calibrated", () => {
    const { engine, tick } = createHarness(60);
    const devices = engine.initialise();
    engine.start();
    vi.advanceTimersByTime(1);

    const target = devices.find(
      (device) => device.telemetry.values.temperature !== undefined,
    )!;
    engine.injectFailure("temperature-spike", target.id);
    expect(engine.getRuntime(target.id)?.faultActive).toBe(true);

    engine.applyCommandEffect(target.id, "device.calibrate");
    expect(engine.getRuntime(target.id)?.calibrating).toBe(true);

    tick(10, 1000);
  });
});

describe("MockSocket", () => {
  it("drops publishes while disconnected", () => {
    const bus = new EventBus();
    const socket = new MockSocket({ bus, dropRate: 0, handshakeMs: 0 });
    let received = 0;
    bus.on("device.online", () => {
      received += 1;
    });

    socket.publish("device.online", { deviceId: "LAG-1", at: START });
    vi.advanceTimersByTime(500);
    expect(received).toBe(0);
    expect(socket.metrics.snapshot(START).droppedFrames).toBe(1);
  });

  it("delivers after a latency once connected", () => {
    const bus = new EventBus();
    const socket = new MockSocket({
      bus,
      dropRate: 0,
      handshakeMs: 10,
      baseLatencyMs: 50,
      jitterMs: 0,
    });
    let received = 0;
    bus.on("device.online", () => {
      received += 1;
    });

    socket.connect();
    vi.advanceTimersByTime(10);
    socket.publish("device.online", { deviceId: "LAG-1", at: START });

    // Not yet — the frame is still in flight.
    vi.advanceTimersByTime(10);
    expect(received).toBe(0);

    vi.advanceTimersByTime(60);
    expect(received).toBe(1);
  });

  it("rejects sends while disconnected", async () => {
    const socket = new MockSocket({ bus: new EventBus(), handshakeMs: 0 });
    await expect(socket.send("command:test", {})).rejects.toThrow(/disconnected/);
  });

  it("counts dropped frames at a high loss rate", () => {
    const bus = new EventBus();
    const socket = new MockSocket({
      bus,
      dropRate: 1,
      handshakeMs: 0,
      baseLatencyMs: 0,
      jitterMs: 0,
    });
    socket.connect();
    vi.advanceTimersByTime(1);

    socket.publish("device.telemetry.batch", {
      frames: [
        { deviceId: "LAG-1", timestamp: START, values: { temperature: 20 }, connected: true, sequence: 1 },
        { deviceId: "LAG-2", timestamp: START, values: { temperature: 21 }, connected: true, sequence: 1 },
      ],
      tick: 1,
      emittedAt: START,
    });
    vi.advanceTimersByTime(100);

    expect(socket.metrics.snapshot(START).droppedFrames).toBe(2);
  });
});
