"use client";

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  injectFailure,
  resetSimulation,
  setSimulationFeatures,
  setSimulationRate,
  setSimulationScale,
  startPlatform,
  startSimulation,
  stopSimulation,
} from "@/services/platform/platform";
import type { SocketState } from "@/services/websocket/mockSocket";
import { useSimulationStore } from "@/stores/simulationStore";
import { useActivityStore } from "@/stores/activityStore";
import type { InfrastructureMetrics } from "@/types/activity";
import type {
  EventRate,
  FailureKind,
  SimulationConfig,
  SimulationFeatures,
  SimulationStats,
} from "@/types/simulation";

/**
 * Boots the platform.
 *
 * Mounted once, at the app shell. `startPlatform` is idempotent, so React
 * Strict Mode's double-invoked effect is harmless — and the platform is
 * deliberately *not* torn down on unmount: the shell lives for the whole
 * session, and stopping the simulator on a route change would reset the fleet
 * every time the operator navigated.
 */
export function usePlatformBootstrap(): void {
  useEffect(() => {
    startPlatform();
  }, []);
}

export interface SimulatorState {
  readonly config: SimulationConfig;
  readonly stats: SimulationStats;
  readonly socketState: SocketState;
  readonly metrics: InfrastructureMetrics;
  readonly running: boolean;
}

export function useSimulatorState(): SimulatorState {
  const { config, stats, socketState } = useSimulationStore(
    useShallow((state) => ({
      config: state.config,
      stats: state.stats,
      socketState: state.socketState,
    })),
  );
  const metrics = useActivityStore((state) => state.metrics);

  return { config, stats, socketState, metrics, running: stats.running };
}

export interface SimulatorControls {
  readonly start: () => void;
  readonly stop: () => void;
  readonly toggle: () => void;
  readonly reset: () => void;
  readonly setRate: (rate: EventRate) => void;
  readonly setScale: (deviceCount: number) => void;
  readonly setFeature: (feature: keyof SimulationFeatures, enabled: boolean) => void;
  readonly inject: (kind: FailureKind, deviceId?: string) => string | null;
}

/**
 * Simulator controls.
 *
 * Every action goes through the platform composition root rather than touching
 * the engine, because a change like "scale to 5,000 devices" has to update the
 * engine *and* reseed the device store, and the UI should not be responsible
 * for knowing that.
 */
export function useSimulatorControls(): SimulatorControls {
  const running = useSimulationStore((state) => state.stats.running);

  return useMemo(
    () => ({
      start: startSimulation,
      stop: stopSimulation,
      toggle: () => (running ? stopSimulation() : startSimulation()),
      reset: resetSimulation,
      setRate: setSimulationRate,
      setScale: setSimulationScale,
      setFeature: (feature, enabled) => setSimulationFeatures({ [feature]: enabled }),
      inject: injectFailure,
    }),
    [running],
  );
}

export function useInfrastructureMetrics(): InfrastructureMetrics {
  return useActivityStore((state) => state.metrics);
}

export function useSocketState(): SocketState {
  return useSimulationStore((state) => state.socketState);
}

export function useLastInjection(): {
  kind: string;
  deviceId: string | null;
  at: number;
} | null {
  return useSimulationStore((state) => state.lastInjection);
}
