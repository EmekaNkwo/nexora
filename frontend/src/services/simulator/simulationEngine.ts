import { EventBus, eventBus as defaultBus } from "@/services/events/eventBus";
import {
  advanceState,
  generateFleet,
  readValues,
  type DeviceSimState,
} from "@/services/simulator/deviceFactory";
import { SITES, type SiteDescriptor } from "@/services/simulator/locations";
import type { MetricProfile } from "@/services/simulator/profiles";
import { MockSocket, mockSocket as defaultSocket } from "@/services/websocket/mockSocket";
import type { CommandType } from "@/types/commands";
import type { Device, DeviceLocation } from "@/types/device";
import type {
  EventRate,
  FailureKind,
  SimulationConfig,
  SimulationFeatures,
  SimulationStats,
} from "@/types/simulation";
import { DEFAULT_SIMULATION_CONFIG, EVENT_RATE_PROFILES } from "@/types/simulation";
import type { MetricKey, TelemetryFrame } from "@/types/telemetry";
import { createRng, type Rng } from "@/utils/random";

/** A device's generative model, read-only, for history synthesis. */
export interface DeviceModelInfo {
  readonly deviceId: string;
  readonly site: SiteDescriptor;
  readonly profile: MetricProfile;
  readonly metrics: readonly MetricKey[];
  readonly faulty: boolean;
}

/** Live physical/actuator state for a single device. */
export interface DeviceRuntimeInfo {
  readonly connected: boolean;
  readonly fanOn: boolean;
  readonly calibrating: boolean;
  readonly muted: boolean;
  readonly faultActive: boolean;
  readonly offlineUntil: number;
  readonly messageCount: number;
  readonly errorCount: number;
}

export interface SimulationEngineOptions {
  readonly bus?: EventBus;
  readonly socket?: MockSocket;
  readonly config?: SimulationConfig;
  /** Injectable clock, so tests can drive time without waiting for it. */
  readonly now?: () => number;
  /** Injectable scheduler, so tests can step ticks manually. */
  readonly scheduler?: {
    setInterval: (fn: () => void, ms: number) => number;
    clearInterval: (handle: number) => void;
  };
}

/**
 * The device simulator.
 *
 * Owns the fleet's physical state and drives it forward in time. Three design
 * decisions shape everything here:
 *
 * 1. **Round-robin sampling.** Real fleets do not report in lockstep, and
 *    stepping 5,000 devices every 400 ms would burn the main thread for no
 *    benefit. Each tick advances a slice of the fleet, and each device's `dt`
 *    is the real elapsed time since *it* last reported — so continuity is
 *    preserved regardless of how thinly the fleet is sampled.
 *
 * 2. **Batched emission.** One tick produces one `device.telemetry.batch`
 *    event, not N telemetry events. Downstream consumers get to amortise their
 *    work, and React gets one render instead of hundreds.
 *
 * 3. **Nothing about the UI.** The engine publishes through the socket and
 *    knows nothing about stores, status derivation, alerts or rules. Status is
 *    derived downstream from the data; the engine only models the physics and
 *    the radio link.
 */
export class SimulationEngine {
  private readonly bus: EventBus;
  private readonly socket: MockSocket;
  private readonly now: () => number;
  private readonly scheduler: NonNullable<SimulationEngineOptions["scheduler"]>;
  private readonly rng: Rng;

  private config: SimulationConfig;
  private states = new Map<string, DeviceSimState>();
  private deviceIds: string[] = [];
  private cursor = 0;
  private handle: number | null = null;
  private tick = 0;
  private framesEmitted = 0;
  private lastTickDurationMs = 0;
  private lastTickFrameCount = 0;
  private startedAt: number | null = null;
  private outageUntil = 0;
  private outageRegion: string | null = null;

  constructor(options: SimulationEngineOptions = {}) {
    this.bus = options.bus ?? defaultBus;
    this.socket = options.socket ?? defaultSocket;
    this.config = options.config ?? DEFAULT_SIMULATION_CONFIG;
    this.now = options.now ?? (() => Date.now());
    this.scheduler =
      options.scheduler ??
      ({
        setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
        clearInterval: (handle) => clearInterval(handle),
      } satisfies NonNullable<SimulationEngineOptions["scheduler"]>);
    this.rng = createRng(this.config.seed ^ 0x51e1);
  }

  /** Builds the fleet. Returns the devices for the store to seed itself with. */
  initialise(): readonly Device[] {
    const now = this.now();
    const fleet = generateFleet(this.config.deviceCount, this.config.seed, now);
    this.states = fleet.states;
    this.deviceIds = fleet.devices.map((device) => device.id);
    this.cursor = 0;
    return fleet.devices;
  }

  get currentConfig(): SimulationConfig {
    return this.config;
  }

  get stats(): SimulationStats {
    return {
      tick: this.tick,
      running: this.handle !== null,
      startedAt: this.startedAt,
      framesEmitted: this.framesEmitted,
      lastTickDurationMs: this.lastTickDurationMs,
      lastTickFrameCount: this.lastTickFrameCount,
    };
  }

  get running(): boolean {
    return this.handle !== null;
  }

  get deviceCount(): number {
    return this.deviceIds.length;
  }

  start(): void {
    if (this.handle !== null) return;
    if (this.deviceIds.length === 0) this.initialise();
    this.socket.connect();
    this.startedAt = this.now();
    const { tickMs } = EVENT_RATE_PROFILES[this.config.rate];
    this.handle = this.scheduler.setInterval(() => this.runTick(), tickMs);
    this.bus.emit("simulation.started", {
      at: this.startedAt,
      deviceCount: this.deviceIds.length,
    });
  }

  stop(): void {
    if (this.handle === null) return;
    this.scheduler.clearInterval(this.handle);
    this.handle = null;
    this.socket.disconnect("simulation stopped");
    this.bus.emit("simulation.stopped", { at: this.now() });
  }

  /** Rebuilds the fleet from scratch and returns the new devices. */
  reset(): readonly Device[] {
    const wasRunning = this.running;
    if (wasRunning) this.stop();
    this.tick = 0;
    this.framesEmitted = 0;
    this.lastTickFrameCount = 0;
    this.lastTickDurationMs = 0;
    this.outageUntil = 0;
    this.outageRegion = null;
    this.socket.setDropRate(0.001);
    this.socket.metrics.reset();
    const devices = this.initialise();
    this.bus.emit("simulation.reset", { at: this.now() });
    if (wasRunning) this.start();
    return devices;
  }

  setRate(rate: EventRate): void {
    if (this.config.rate === rate) return;
    this.config = { ...this.config, rate };
    if (this.handle !== null) {
      // Restart the interval so the new cadence takes effect immediately,
      // without emitting start/stop lifecycle events.
      this.scheduler.clearInterval(this.handle);
      this.handle = this.scheduler.setInterval(
        () => this.runTick(),
        EVENT_RATE_PROFILES[rate].tickMs,
      );
    }
  }

  setFeatures(features: SimulationFeatures): void {
    this.config = { ...this.config, features };
  }

  /**
   * Changes fleet size. Devices are deterministic in (seed, index), so scaling
   * up preserves every existing device and only appends new ones; scaling down
   * truncates from the end.
   */
  setScale(deviceCount: number): readonly Device[] {
    this.config = { ...this.config, deviceCount };
    const now = this.now();
    const fleet = generateFleet(deviceCount, this.config.seed, now, this.states);
    this.states = fleet.states;
    this.deviceIds = fleet.devices.map((device) => device.id);
    this.cursor = Math.min(this.cursor, Math.max(0, this.deviceIds.length - 1));
    this.bus.emit("simulation.scaled", { deviceCount });
    return fleet.devices;
  }

  /** Registers an externally provisioned device with the simulator. */
  registerDevice(device: Device, state: DeviceSimState): void {
    if (!this.states.has(device.id)) this.deviceIds.push(device.id);
    this.states.set(device.id, state);
  }

  removeDevice(deviceId: string): void {
    this.states.delete(deviceId);
    const index = this.deviceIds.indexOf(deviceId);
    if (index >= 0) this.deviceIds.splice(index, 1);
  }

  /**
   * Exposes a device's generative model so the history service can synthesise
   * plausible long-range telemetry from the same physics that produced the
   * live data, rather than from unrelated noise.
   */
  getModel(deviceId: string): DeviceModelInfo | undefined {
    const state = this.states.get(deviceId);
    if (!state) return undefined;
    return {
      deviceId,
      site: state.site,
      profile: state.profile,
      metrics: state.metrics,
      faulty: state.faulty,
    };
  }

  /** Live actuator/fault state, surfaced on the device detail page. */
  getRuntime(deviceId: string): DeviceRuntimeInfo | undefined {
    const state = this.states.get(deviceId);
    if (!state) return undefined;
    const now = this.now();
    return {
      connected: state.connected,
      fanOn: state.coolingUntil > now,
      calibrating: state.calibratingUntil > now,
      muted: state.mutedUntil > now,
      faultActive: state.faultActive && state.faultUntil > now,
      offlineUntil: state.offlineUntil,
      messageCount: state.messageCount,
      errorCount: state.errorCount,
    };
  }

  /** Current simulated location, used when a device patch needs coordinates. */
  getLocation(deviceId: string): DeviceLocation | undefined {
    const state = this.states.get(deviceId);
    if (!state) return undefined;
    return {
      lat: state.lat,
      lng: state.lng,
      site: state.site.name,
      city: state.site.city,
      region: state.site.region,
    };
  }

  /**
   * Applies a command's physical side effect.
   *
   * This is the half of the rule → command → telemetry loop that makes the
   * whole platform coherent: switching a fan on genuinely changes the
   * temperature the sensor then reports, which is what eventually resolves the
   * alert that triggered the rule.
   */
  applyCommandEffect(deviceId: string, command: CommandType): void {
    const state = this.states.get(deviceId);
    if (!state) return;
    const now = this.now();

    switch (command) {
      case "fan.on":
        // Cooling runs for 10 minutes unless switched off sooner.
        state.coolingUntil = now + 600_000;
        // Active cooling also ends the fault episode that caused the heat.
        state.faultActive = false;
        state.faultUntil = 0;
        break;
      case "fan.off":
        state.coolingUntil = 0;
        break;
      case "device.restart":
        // Telemetry pauses while the device reboots, then comes back clean.
        state.mutedUntil = now + 8000;
        state.faultActive = false;
        state.faultUntil = 0;
        state.errorCount = 0;
        break;
      case "device.calibrate":
        state.calibratingUntil = now + 7000;
        break;
      case "telemetry.request":
        this.emitImmediateFrame(deviceId);
        break;
      case "firmware.update":
      case "device.set_mode":
        break;
    }
  }

  /** Forces an out-of-band reading, outside the round-robin schedule. */
  emitImmediateFrame(deviceId: string): void {
    const state = this.states.get(deviceId);
    if (!state) return;
    const now = this.now();
    const dtSeconds = Math.max(0.25, (now - state.lastStepAt) / 1000);
    advanceState(state, now, dtSeconds);
    state.sequence += 1;
    state.messageCount += 1;
    this.socket.publish("device.telemetry.updated", {
      frame: {
        deviceId,
        timestamp: now,
        values: readValues(state),
        connected: state.connected,
        sequence: state.sequence,
      },
    });
  }

  /** Suppresses telemetry for a device, e.g. for the duration of a reboot. */
  muteDevice(deviceId: string, durationMs: number): void {
    const state = this.states.get(deviceId);
    if (state) state.mutedUntil = this.now() + durationMs;
  }

  injectFailure(kind: FailureKind, deviceId?: string): string | null {
    const now = this.now();
    const target = deviceId ?? this.pickRandomDeviceId();
    if (!target && kind !== "network-outage") return null;

    switch (kind) {
      case "device-offline": {
        const state = this.states.get(target!);
        if (!state) return null;
        state.connected = false;
        state.offlineUntil = now + 240_000;
        this.socket.publish("device.offline", {
          deviceId: target!,
          at: now,
          reason: "injected",
        });
        return target!;
      }
      case "temperature-spike": {
        const state = this.states.get(target!);
        if (!state || !state.profile.temperature) {
          // Not every device measures temperature — retarget to one that does.
          const fallback = this.pickDeviceWithMetric("temperature");
          if (!fallback) return null;
          return this.injectFailure("temperature-spike", fallback);
        }
        state.faultActive = true;
        state.faultUntil = now + 180_000;
        state.coolingUntil = 0;
        return target!;
      }
      case "battery-failure": {
        const state = this.states.get(target!);
        if (!state || !state.profile.battery) {
          const fallback = this.pickDeviceWithMetric("battery");
          if (!fallback) return null;
          return this.injectFailure("battery-failure", fallback);
        }
        const config = state.profile.battery;
        const signal = state.signals.battery;
        if (config && signal) {
          // Collapse the cell rather than waiting out a realistic discharge.
          state.signals.battery = { ...signal, value: 6, faultRamp: 0, spike: 0 };
        }
        state.faultActive = true;
        state.faultUntil = now + 120_000;
        return target!;
      }
      case "network-outage": {
        const site = this.rng.pick(SITES);
        this.outageRegion = site.region;
        this.outageUntil = now + 45_000;
        this.socket.setDropRate(0.55);
        let affected = 0;
        for (const state of this.states.values()) {
          if (state.site.region !== site.region) continue;
          state.connected = false;
          state.offlineUntil = this.outageUntil;
          affected += 1;
        }
        this.bus.emit("system.network.outage", {
          at: now,
          durationMs: 45_000,
          affectedDevices: affected,
        });
        return null;
      }
      case "firmware-failure":
        // Owned by the firmware service; the engine only degrades the device.
        {
          const state = this.states.get(target!);
          if (state) {
            state.faultActive = true;
            state.faultUntil = now + 120_000;
            state.errorCount += 5;
          }
        }
        return target!;
    }
  }

  destroy(): void {
    this.stop();
    this.states.clear();
    this.deviceIds = [];
  }

  /** Exposed for tests: advances exactly one tick. */
  runTick(): void {
    const started =
      typeof performance !== "undefined" ? performance.now() : this.now();
    const now = this.now();
    this.tick += 1;

    if (this.outageUntil > 0 && now > this.outageUntil) {
      this.outageUntil = 0;
      this.outageRegion = null;
      this.socket.setDropRate(0.001);
      this.bus.emit("system.network.restored", { at: now });
    }

    const profile = EVENT_RATE_PROFILES[this.config.rate];
    const total = this.deviceIds.length;
    if (total === 0) return;

    const sliceSize = Math.max(1, Math.round(total * profile.fleetFractionPerTick));
    const frames: TelemetryFrame[] = [];

    for (let processed = 0; processed < sliceSize; processed += 1) {
      const deviceId = this.deviceIds[this.cursor % total]!;
      this.cursor = (this.cursor + 1) % total;
      const frame = this.stepDevice(deviceId, now);
      if (frame) frames.push(frame);
    }

    if (frames.length > 0) {
      this.framesEmitted += frames.length;
      this.socket.publish("device.telemetry.batch", {
        frames,
        tick: this.tick,
        emittedAt: now,
      });
    }

    this.lastTickFrameCount = frames.length;
    this.lastTickDurationMs =
      (typeof performance !== "undefined" ? performance.now() : this.now()) - started;

    this.bus.emit("simulation.tick", {
      tick: this.tick,
      frameCount: frames.length,
      durationMs: this.lastTickDurationMs,
    });
  }

  /** Advances one device and returns its frame, or null if it stays silent. */
  private stepDevice(deviceId: string, now: number): TelemetryFrame | null {
    const state = this.states.get(deviceId);
    if (!state) return null;

    const { features } = this.config;

    // Reconnect devices whose outage window has elapsed.
    if (!state.connected && state.offlineUntil > 0 && now >= state.offlineUntil) {
      const regionStillDown =
        this.outageRegion !== null && state.site.region === this.outageRegion;
      if (!regionStillDown) {
        state.connected = true;
        state.offlineUntil = 0;
        this.socket.publish("device.online", { deviceId, at: now });
      }
    }

    if (!state.connected) return null;
    if (state.mutedUntil > now) return null;

    const dtSeconds = Math.min(600, Math.max(0.2, (now - state.lastStepAt) / 1000));

    if (features.telemetry) {
      advanceState(state, now, dtSeconds);
    } else {
      state.lastStepAt = now;
    }

    // Fault episodes: faulty devices periodically degrade, then recover.
    if (features.failures && state.faulty) {
      if (!state.faultActive && state.rng.chance(0.0025 * dtSeconds)) {
        state.faultActive = true;
        state.faultUntil = now + state.rng.range(60_000, 240_000);
      } else if (state.faultActive && now > state.faultUntil) {
        state.faultActive = false;
      }
    }

    const values = readValues(state);

    // Connectivity: dropout probability rises as signal and battery fall,
    // which is why a device usually goes quiet *after* looking unwell.
    if (features.connectivity) {
      const signal = values.signalStrength ?? -70;
      const battery = features.battery ? (values.battery ?? 100) : 100;
      let dropChance = 0.00025;
      if (signal < -100) dropChance += 0.004;
      else if (signal < -92) dropChance += 0.0012;
      if (battery < 5) dropChance += 0.02;
      else if (battery < 12) dropChance += 0.003;
      if (state.faulty) dropChance *= 2.4;

      if (state.rng.chance(1 - Math.exp(-dropChance * dtSeconds))) {
        state.connected = false;
        state.offlineUntil = now + state.rng.range(20_000, 480_000);
        state.errorCount += 1;
        this.socket.publish("device.offline", {
          deviceId,
          at: now,
          reason: battery < 12 ? "power" : "signal-loss",
        });
        return null;
      }
    }

    state.sequence += 1;
    state.messageCount += 1;

    return {
      deviceId,
      timestamp: now,
      values,
      connected: true,
      sequence: state.sequence,
    };
  }

  private pickRandomDeviceId(): string | undefined {
    if (this.deviceIds.length === 0) return undefined;
    return this.deviceIds[Math.floor(this.rng.next() * this.deviceIds.length)];
  }

  private pickDeviceWithMetric(metric: "temperature" | "battery"): string | undefined {
    for (const [deviceId, state] of this.states) {
      if (state.profile[metric] && state.connected) return deviceId;
    }
    return undefined;
  }
}

export const simulationEngine = new SimulationEngine();
