import { create } from "zustand";

import type {
  DemoLogEntry,
  DemoState,
  DemoStep,
  EventRate,
  SimulationConfig,
  SimulationFeatures,
  SimulationStats,
} from "@/types/simulation";
import {
  DEFAULT_SIMULATION_CONFIG,
  EMPTY_SIMULATION_STATS,
} from "@/types/simulation";
import type { SocketState } from "@/services/websocket/mockSocket";

export interface SimulationStoreState {
  readonly config: SimulationConfig;
  readonly stats: SimulationStats;
  readonly socketState: SocketState;
  readonly demo: DemoState;
  /** Last failure the operator injected, for UI feedback. */
  readonly lastInjection: { kind: string; deviceId: string | null; at: number } | null;

  setConfig: (config: Partial<SimulationConfig>) => void;
  setRate: (rate: EventRate) => void;
  setFeatures: (features: Partial<SimulationFeatures>) => void;
  setDeviceCount: (deviceCount: number) => void;
  setStats: (stats: SimulationStats) => void;
  setSocketState: (socketState: SocketState) => void;
  setDemo: (demo: Partial<DemoState>) => void;
  pushDemoLog: (entry: DemoLogEntry) => void;
  resetDemo: () => void;
  recordInjection: (kind: string, deviceId: string | null) => void;
}

const IDLE_DEMO: DemoState = {
  step: "idle",
  deviceId: null,
  startedAt: null,
  log: [],
};

export const useSimulationStore = create<SimulationStoreState>((set) => ({
  config: DEFAULT_SIMULATION_CONFIG,
  stats: EMPTY_SIMULATION_STATS,
  socketState: "disconnected",
  demo: IDLE_DEMO,
  lastInjection: null,

  setConfig: (config) => set((state) => ({ config: { ...state.config, ...config } })),

  setRate: (rate) => set((state) => ({ config: { ...state.config, rate } })),

  setFeatures: (features) =>
    set((state) => ({
      config: { ...state.config, features: { ...state.config.features, ...features } },
    })),

  setDeviceCount: (deviceCount) =>
    set((state) => ({ config: { ...state.config, deviceCount } })),

  setStats: (stats) => set({ stats }),
  setSocketState: (socketState) => set({ socketState }),

  setDemo: (demo) => set((state) => ({ demo: { ...state.demo, ...demo } })),

  pushDemoLog: (entry) =>
    set((state) => ({
      demo: { ...state.demo, log: [...state.demo.log, entry] },
    })),

  resetDemo: () => set({ demo: IDLE_DEMO }),

  recordInjection: (kind, deviceId) =>
    set({ lastInjection: { kind, deviceId, at: Date.now() } }),
}));

/** Human-readable captions for the guided walkthrough. */
export const DEMO_STEP_LABELS: Readonly<Record<DemoStep, string>> = {
  idle: "Not running",
  arming: "Selecting a cold-storage device and arming the scenario",
  heating: "Temperature climbing toward the warning threshold",
  warning: "Warning threshold crossed — alert raised",
  critical: "Critical threshold crossed",
  "rule-fired": "Rule triggered — cooling command dispatched",
  cooling: "Device acknowledged the command; temperature falling",
  resolved: "Temperature recovered — alert resolved automatically",
};

export const DEMO_STEP_ORDER: readonly DemoStep[] = [
  "arming",
  "heating",
  "warning",
  "critical",
  "rule-fired",
  "cooling",
  "resolved",
];
