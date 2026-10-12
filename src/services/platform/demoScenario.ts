import { eventBus } from "@/services/events/eventBus";
import { injectFailure } from "@/services/platform/platform";
import { telemetryRepository } from "@/services/telemetry/telemetryRepository";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSimulationStore } from "@/stores/simulationStore";
import type { Unsubscribe } from "@/types/events";
import type { DemoStep } from "@/types/simulation";

/**
 * The guided walkthrough.
 *
 * Rather than scripting a canned animation, this drives the *real* system and
 * then narrates what it observes. It injects one temperature fault on one
 * cold-storage device and advances its step machine purely from genuine
 * platform events — a rule actually firing, a command actually completing, an
 * alert actually auto-resolving once the fan has cooled the device.
 *
 * That distinction is the point of the feature: a reviewer watching the
 * narration is watching the platform work, not a slideshow of it. If the rule
 * engine were broken, the walkthrough would visibly stall at "critical".
 */

/** Cold-chain critical threshold, mirrored from the built-in profile. */
const COLD_CRITICAL = 8;
const COLD_WARNING = 6;

/** Abandon the scenario if the chain stalls for this long. */
const STEP_TIMEOUT_MS = 120_000;

let unsubscribers: Unsubscribe[] = [];
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let releaseObservation: (() => void) | null = null;

function log(step: DemoStep, message: string): void {
  useSimulationStore.getState().pushDemoLog({ at: Date.now(), step, message });
}

function advance(step: DemoStep, message: string): void {
  useSimulationStore.getState().setDemo({ step });
  log(step, message);
}

/** Picks the best candidate: an online cold-storage sensor reporting cold. */
function selectCandidate(): string | null {
  const { devices, order } = useDeviceStore.getState();
  let fallback: string | null = null;

  for (const id of order) {
    const device = devices.get(id);
    if (!device) continue;
    if (device.type !== "cold-storage-sensor") continue;
    if (device.status === "offline" || device.status === "updating") continue;

    const temperature = device.telemetry.values.temperature;
    if (temperature === undefined) continue;
    // Prefer a device comfortably below the warning band, so the whole climb
    // is visible rather than starting halfway up.
    if (temperature < COLD_WARNING - 2) return device.id;
    if (fallback === null) fallback = device.id;
  }

  return fallback;
}

export function startDemoScenario(): string | null {
  stopDemoScenario();

  const deviceId = selectCandidate();
  if (!deviceId) {
    useSimulationStore.getState().setDemo({ step: "idle", deviceId: null });
    log("idle", "No suitable cold-storage device is online. Start the simulation first.");
    return null;
  }

  const store = useSimulationStore.getState();
  store.setDemo({ step: "arming", deviceId, startedAt: Date.now(), log: [] });
  log(
    "arming",
    `Selected ${deviceId} — a cold-storage sensor holding its set point. Injecting a sensor fault.`,
  );

  // Promote the device so its chart has full resolution for the walkthrough.
  releaseObservation = telemetryRepository.observe(deviceId);

  // One real fault injection. Everything after this is the platform reacting.
  injectFailure("temperature-spike", deviceId);
  advance("heating", "Fault injected. Temperature is now climbing above the set point.");

  subscribe(deviceId);
  armTimeout();
  return deviceId;
}

function subscribe(deviceId: string): void {
  // Threshold crossings are observed from telemetry rather than assumed, so
  // the narration cannot claim a crossing that did not happen.
  pollHandle = setInterval(() => {
    const step = useSimulationStore.getState().demo.step;
    const temperature = telemetryRepository.getLatest(deviceId, "temperature");
    if (temperature === undefined) return;

    if (step === "heating" && temperature > COLD_WARNING) {
      advance(
        "warning",
        `Temperature reached ${temperature.toFixed(1)}°C — past the ${COLD_WARNING}°C warning threshold. A warning alert has been raised.`,
      );
      return;
    }

    if (step === "warning" && temperature > COLD_CRITICAL) {
      advance(
        "critical",
        `Temperature reached ${temperature.toFixed(1)}°C — past the ${COLD_CRITICAL}°C critical threshold. The cold-chain rule should now evaluate.`,
      );
    }
  }, 1000);

  unsubscribers.push(
    eventBus.on("rule.triggered", ({ trigger }) => {
      if (trigger.deviceId !== deviceId) return;
      const step = useSimulationStore.getState().demo.step;
      if (step !== "critical" && step !== "warning") return;
      const actions = trigger.actions.map((action) => action.summary).join(" and ");
      advance(
        "rule-fired",
        `Rule "${trigger.ruleName}" fired → ${actions}. The cooling command is queued.`,
      );
      armTimeout();
    }),
  );

  unsubscribers.push(
    eventBus.on("device.command.completed", ({ command }) => {
      if (command.deviceId !== deviceId || command.type !== "fan.on") return;
      if (useSimulationStore.getState().demo.step !== "rule-fired") return;
      advance(
        "cooling",
        `${deviceId} acknowledged and executed fan.on in ${command.latencyMs ?? 0}ms. Temperature is now falling.`,
      );
      armTimeout();
    }),
  );

  unsubscribers.push(
    eventBus.on("alert.resolved", ({ alert }) => {
      if (alert.deviceId !== deviceId) return;
      if (useSimulationStore.getState().demo.step !== "cooling") return;
      advance(
        "resolved",
        `Temperature recovered below the hysteresis level and the alert auto-resolved. Full loop complete: telemetry → threshold → rule → command → device → telemetry → resolution.`,
      );
      finish();
    }),
  );
}

function armTimeout(): void {
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  timeoutHandle = setTimeout(() => {
    const { step } = useSimulationStore.getState().demo;
    if (step === "resolved" || step === "idle") return;
    log(
      step,
      "The scenario stalled — the simulation may be paused, or the relevant rule disabled.",
    );
    finish();
  }, STEP_TIMEOUT_MS);
}

function finish(): void {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

export function stopDemoScenario(): void {
  finish();
  releaseObservation?.();
  releaseObservation = null;
}

export function resetDemoScenario(): void {
  stopDemoScenario();
  useSimulationStore.getState().resetDemo();
}
