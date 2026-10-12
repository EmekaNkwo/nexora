"use client";

import { useEffect, useMemo } from "react";

import {
  resetDemoScenario,
  startDemoScenario,
  stopDemoScenario,
} from "@/services/platform/demoScenario";
import { DEMO_STEP_ORDER, useSimulationStore } from "@/stores/simulationStore";
import type { DemoState, DemoStep } from "@/types/simulation";

export interface DemoController {
  readonly state: DemoState;
  readonly start: () => void;
  readonly stop: () => void;
  readonly reset: () => void;
  readonly running: boolean;
  /** Index of the current step within the scripted order, or -1 when idle. */
  readonly stepIndex: number;
  readonly completed: boolean;
}

export function useDemoScenario(): DemoController {
  const state = useSimulationStore((simulation) => simulation.demo);

  // Tear the scenario's subscriptions down if the panel unmounts mid-run,
  // otherwise its interval would keep polling for a device nobody is watching.
  useEffect(() => () => stopDemoScenario(), []);

  return useMemo(() => {
    const stepIndex = DEMO_STEP_ORDER.indexOf(state.step);
    return {
      state,
      start: startDemoScenario,
      stop: stopDemoScenario,
      reset: resetDemoScenario,
      running: state.step !== "idle" && state.step !== "resolved",
      stepIndex,
      completed: state.step === "resolved",
    };
  }, [state]);
}

/** Whether a step has been reached, for rendering the progress rail. */
export function isStepReached(current: DemoStep, candidate: DemoStep): boolean {
  const currentIndex = DEMO_STEP_ORDER.indexOf(current);
  const candidateIndex = DEMO_STEP_ORDER.indexOf(candidate);
  if (currentIndex < 0 || candidateIndex < 0) return false;
  return candidateIndex <= currentIndex;
}
