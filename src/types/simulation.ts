/** Simulator tuning exposed through the operator-facing control panel. */
export type EventRate = "slow" | "normal" | "fast";

export interface EventRateProfile {
  readonly rate: EventRate;
  readonly label: string;
  readonly tickMs: number;
  /**
   * Fraction of the fleet that reports on each tick. Real fleets do not report
   * in lockstep, and sampling is what keeps 5,000 devices affordable.
   */
  readonly fleetFractionPerTick: number;
}

export const EVENT_RATE_PROFILES: Readonly<Record<EventRate, EventRateProfile>> = {
  slow: { rate: "slow", label: "Slow", tickMs: 2000, fleetFractionPerTick: 0.04 },
  normal: { rate: "normal", label: "Normal", tickMs: 1000, fleetFractionPerTick: 0.1 },
  fast: { rate: "fast", label: "Fast", tickMs: 400, fleetFractionPerTick: 0.22 },
};

export const SIMULATION_SCALES: readonly number[] = [100, 500, 1000, 2500, 5000] as const;

/** Toggles for which classes of behaviour the simulator produces. */
export interface SimulationFeatures {
  readonly telemetry: boolean;
  readonly connectivity: boolean;
  readonly battery: boolean;
  readonly alerts: boolean;
  readonly failures: boolean;
}

export const DEFAULT_SIMULATION_FEATURES: SimulationFeatures = {
  telemetry: true,
  connectivity: true,
  battery: true,
  alerts: true,
  failures: true,
};

export type FailureKind =
  | "device-offline"
  | "temperature-spike"
  | "battery-failure"
  | "network-outage"
  | "firmware-failure";

export interface FailureDescriptor {
  readonly kind: FailureKind;
  readonly label: string;
  readonly description: string;
  /** Whether the injection targets one device or the whole fleet. */
  readonly target: "device" | "fleet";
}

export const FAILURE_DESCRIPTORS: Readonly<Record<FailureKind, FailureDescriptor>> = {
  "device-offline": {
    kind: "device-offline",
    label: "Simulate Offline Device",
    description: "Drops a device's connection. Offline detection and alerting fire.",
    target: "device",
  },
  "temperature-spike": {
    kind: "temperature-spike",
    label: "Simulate Temperature Spike",
    description: "Pushes temperature past the critical threshold over ~20s.",
    target: "device",
  },
  "battery-failure": {
    kind: "battery-failure",
    label: "Simulate Battery Failure",
    description: "Collapses the battery to a critical level within seconds.",
    target: "device",
  },
  "network-outage": {
    kind: "network-outage",
    label: "Simulate Network Outage",
    description: "Takes a whole region offline, then restores it.",
    target: "fleet",
  },
  "firmware-failure": {
    kind: "firmware-failure",
    label: "Simulate Firmware Failure",
    description: "Fails an in-flight firmware job and leaves the device degraded.",
    target: "device",
  },
};

export interface SimulationConfig {
  readonly rate: EventRate;
  readonly deviceCount: number;
  readonly features: SimulationFeatures;
  /** Seed for the PRNG, so a given fleet is reproducible across reloads. */
  readonly seed: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  rate: "normal",
  deviceCount: 1000,
  features: DEFAULT_SIMULATION_FEATURES,
  seed: 20_481,
};

export interface SimulationStats {
  readonly tick: number;
  readonly running: boolean;
  readonly startedAt: number | null;
  readonly framesEmitted: number;
  readonly lastTickDurationMs: number;
  readonly lastTickFrameCount: number;
}

export const EMPTY_SIMULATION_STATS: SimulationStats = {
  tick: 0,
  running: false,
  startedAt: null,
  framesEmitted: 0,
  lastTickDurationMs: 0,
  lastTickFrameCount: 0,
};

/** Steps of the guided portfolio walkthrough. */
export type DemoStep =
  | "idle"
  | "arming"
  | "heating"
  | "warning"
  | "critical"
  | "rule-fired"
  | "cooling"
  | "resolved";

export interface DemoState {
  readonly step: DemoStep;
  readonly deviceId: string | null;
  readonly startedAt: number | null;
  readonly log: readonly DemoLogEntry[];
}

export interface DemoLogEntry {
  readonly at: number;
  readonly step: DemoStep;
  readonly message: string;
}
