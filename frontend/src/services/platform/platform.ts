import { AlertEngine } from "@/services/alerts/alertEngine";
import { CommandService } from "@/services/commands/commandService";
import { eventBus } from "@/services/events/eventBus";
import { FirmwareService } from "@/services/firmware/firmwareService";
import { ActivityFeedBridge } from "@/services/platform/activityFeed";
import { IngestionPipeline } from "@/services/platform/ingestion";
import { ProvisioningService } from "@/services/provisioning/provisioningService";
import { RuleEngine, type RuleActionExecutor } from "@/services/rules/ruleEngine";
import { simulationEngine } from "@/services/simulator/simulationEngine";
import { telemetryRepository } from "@/services/telemetry/telemetryRepository";
import { mockSocket } from "@/services/websocket/mockSocket";
import { useActivityStore } from "@/stores/activityStore";
import {
  getCriticalAlertCount,
  getOpenAlertCount,
  useAlertStore,
} from "@/stores/alertStore";
import { useCommandStore } from "@/stores/commandStore";
import {
  getDeviceName,
  getFirmwareVersion,
  getOfflineSince,
  isDeviceReachable,
  useDeviceStore,
} from "@/stores/deviceStore";
import { useFirmwareStore } from "@/stores/firmwareStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useSimulationStore } from "@/stores/simulationStore";
import { getThresholdProfiles, useThresholdStore } from "@/stores/thresholdStore";
import type { ProvisionRequest } from "@/types/device";
import type { CommandType } from "@/types/commands";
import type { EventRate, FailureKind, SimulationFeatures } from "@/types/simulation";

/**
 * The composition root.
 *
 * Every service is constructed here and wired to the stores through narrow
 * callbacks. This is the only module that knows about both halves of the
 * application, which is what keeps the dependency graph a DAG:
 *
 *   simulator → socket → bus → ingestion → stores → hooks → components
 *                                  ↓
 *                       alert engine, rule engine
 *                                  ↓
 *                        command / firmware services
 *                                  ↓
 *                           back to the simulator
 *
 * Services never import stores directly and stores never import services;
 * both are connected here. The practical payoff is that the entire domain can
 * be instantiated in a test with fake sinks, and the UI can be swapped without
 * touching a line of domain logic.
 */

/** How often store commits are flushed from buffered telemetry work. */
const COMMIT_INTERVAL_MS = 200;
/** How often KPI snapshots are published. */
const METRICS_INTERVAL_MS = 1000;
/** How often silent devices are swept. */
const SWEEP_INTERVAL_MS = 10_000;
/** A device reporting nothing for this long is considered stale. */
const STALE_AFTER_MS = 60_000;

export interface Platform {
  readonly alertEngine: AlertEngine;
  readonly ruleEngine: RuleEngine;
  readonly commandService: CommandService;
  readonly firmwareService: FirmwareService;
  readonly provisioningService: ProvisioningService;
  readonly ingestion: IngestionPipeline;
  readonly activityBridge: ActivityFeedBridge;
}

let platform: Platform | null = null;
let started = false;
let timers: ReturnType<typeof setInterval>[] = [];
let disposers: (() => void)[] = [];

function buildPlatform(): Platform {
  const alertEngine = new AlertEngine({
    onCreated: (alert) => {
      useAlertStore.getState().ingestCreated(alert);
      eventBus.emit("alert.created", { alert });
    },
    onUpdated: (alert) => {
      useAlertStore.getState().ingestUpdated(alert);
    },
    onResolved: (alert) => {
      useAlertStore.getState().ingestResolved(alert);
      eventBus.emit("alert.resolved", { alert });
    },
  });
  alertEngine.setThresholdProfiles(getThresholdProfiles());

  const commandService = new CommandService({
    onUpdate: (command) => useCommandStore.getState().ingest(command),
    // The simulator is where a command becomes physics.
    applyEffect: (deviceId, type) => {
      simulationEngine.applyCommandEffect(deviceId, type);
      if (type === "fan.on" || type === "fan.off") {
        const device = useDeviceStore.getState().devices.get(deviceId);
        if (device) {
          useDeviceStore.getState().applyPatches([
            {
              id: deviceId,
              actuators: { ...device.actuators, fan: type === "fan.on" },
            },
          ]);
        }
      }
    },
    isReachable: isDeviceReachable,
  });

  /**
   * Rule actions, bound to the concrete services. The rule engine only knows
   * this interface, which is why it can be unit-tested with a recorder.
   */
  const executor: RuleActionExecutor = {
    sendAlert: (ctx, action, rule) =>
      alertEngine.raiseRuleAlert({
        deviceId: ctx.deviceId,
        deviceName: ctx.deviceName,
        severity: action.severity,
        message: action.message,
        ruleId: rule.id,
        ruleName: rule.name,
        now: ctx.now,
      }),

    sendCommand: (ctx, action, rule) =>
      commandService.issue({
        deviceId: ctx.deviceId,
        deviceName: ctx.deviceName,
        type: action.command,
        origin: "rule",
        ruleId: rule.id,
      }).id,

    setDeviceStatus: (ctx, action) => {
      if (action.status === "maintenance" || action.status === "updating") {
        useDeviceStore.getState().setLifecycle(ctx.deviceId, action.status);
      }
    },

    setDeviceMode: (ctx, action) => {
      useDeviceStore.getState().setMode(ctx.deviceId, action.mode);
      eventBus.emit("device.mode.changed", {
        deviceId: ctx.deviceId,
        mode: action.mode,
        at: ctx.now,
      });
    },

    createIncident: (ctx, action, rule) =>
      alertEngine.raiseSystemAlert({
        deviceId: ctx.deviceId,
        deviceName: ctx.deviceName,
        severity: "warning",
        title: action.title,
        message: `Incident opened by rule "${rule.name}" and assigned to ${action.assignee}`,
        assignee: action.assignee,
        now: ctx.now,
        dedupeSuffix: `incident:${rule.id}`,
      }),
  };

  const ruleEngine = new RuleEngine({
    executor,
    onTrigger: (trigger) => {
      useRuleStore.getState().recordTrigger(trigger);
      eventBus.emit("rule.triggered", { trigger });
    },
  });
  ruleEngine.setRules(useRuleStore.getState().rules);

  const firmwareService = new FirmwareService({
    onJobUpdate: (job) => useFirmwareStore.getState().ingestJob(job),
    onRolloutUpdate: (rollout) => useFirmwareStore.getState().ingestRollout(rollout),
    setDeviceUpdating: (deviceId, updating) =>
      useDeviceStore.getState().setLifecycle(deviceId, updating ? "updating" : null),
    applyVersion: (deviceId, version) =>
      useDeviceStore.getState().setFirmwareVersion(deviceId, version),
    muteDevice: (deviceId, durationMs) =>
      simulationEngine.muteDevice(deviceId, durationMs),
    resolveName: getDeviceName,
    resolveVersion: getFirmwareVersion,
  });

  const provisioningService = new ProvisioningService({
    onJobUpdate: (job) => useDeviceStore.getState().upsertProvisionJob(job),
    onProvisioned: (device, state) => {
      useDeviceStore.getState().upsertDevice(device);
      simulationEngine.registerDevice(device, state);
    },
    deviceExists: (deviceId) => useDeviceStore.getState().devices.has(deviceId),
  });

  const ingestion = new IngestionPipeline({
    repository: telemetryRepository,
    alertEngine,
    ruleEngine,
    getDevice: (deviceId) => useDeviceStore.getState().devices.get(deviceId),
    getLifecycle: (deviceId) =>
      useDeviceStore.getState().lifecycleOverrides.get(deviceId),
    getOfflineSince,
    getThresholdProfiles,
    getOpenAlertCount,
    getCriticalAlertCount,
  });

  const activityBridge = new ActivityFeedBridge({
    bus: eventBus,
    flush: (entries) => useActivityStore.getState().pushEntries(entries),
    resolveDeviceName: getDeviceName,
  });

  return {
    alertEngine,
    ruleEngine,
    commandService,
    firmwareService,
    provisioningService,
    ingestion,
    activityBridge,
  };
}

export function getPlatform(): Platform {
  if (!platform) platform = buildPlatform();
  return platform;
}

/**
 * Starts the platform: seeds the fleet, subscribes to the bus, and begins the
 * commit/metrics/sweep intervals. Idempotent, so React Strict Mode's double
 * effect invocation is harmless.
 */
export function startPlatform(): void {
  if (started) return;
  started = true;

  const services = getPlatform();
  const deviceStore = useDeviceStore.getState();
  const simulationStore = useSimulationStore.getState();

  // Seed the fleet from the simulator before any telemetry arrives.
  simulationEngine.setScale(simulationStore.config.deviceCount);
  deviceStore.setFleet(simulationEngine.initialise());

  // Buffered store writes. Telemetry arrives far faster than React should
  // re-render, so patches accumulate here and commit on an interval.
  let pendingPatches: ReturnType<IngestionPipeline["ingestBatch"]>["patches"][] = [];

  const commit = (): void => {
    if (pendingPatches.length === 0) return;
    const flat = pendingPatches.flat();
    pendingPatches = [];
    if (flat.length > 0) useDeviceStore.getState().applyPatches(flat);
  };

  disposers.push(
    eventBus.on("device.telemetry.batch", ({ frames, emittedAt }) => {
      const result = services.ingestion.ingestBatch(frames, emittedAt);
      pendingPatches.push(result.patches);
      services.activityBridge.append(result.activity);
    }),
  );

  disposers.push(
    eventBus.on("device.telemetry.updated", ({ frame }) => {
      const result = services.ingestion.ingestFrame(frame, frame.timestamp);
      pendingPatches.push(result.patches);
      services.activityBridge.append(result.activity);
    }),
  );

  // Connectivity is handled outside the telemetry path: an offline device
  // sends nothing, so its status change has to come from the event.
  disposers.push(
    eventBus.on("device.offline", ({ deviceId, at, reason }) => {
      const device = useDeviceStore.getState().devices.get(deviceId);
      if (!device) return;
      useDeviceStore.getState().markOffline(deviceId, at);
      services.alertEngine.raiseConnectivityAlert(device, reason, at);
    }),
  );

  disposers.push(
    eventBus.on("device.online", ({ deviceId, at }) => {
      useDeviceStore.getState().markOnline(deviceId, at);
      services.alertEngine.clearConnectivityAlert(deviceId, at);
    }),
  );

  // Keep the engines in step with user-editable configuration.
  disposers.push(
    useRuleStore.subscribe((state, previous) => {
      if (state.version !== previous.version) services.ruleEngine.setRules(state.rules);
    }),
  );

  disposers.push(
    useThresholdStore.subscribe((state, previous) => {
      if (state.version !== previous.version) {
        services.alertEngine.setThresholdProfiles(state.profiles);
      }
    }),
  );

  disposers.push(
    mockSocket.onStateChange((socketState) => {
      useSimulationStore.getState().setSocketState(socketState);
    }),
  );

  services.activityBridge.start();

  timers.push(setInterval(commit, COMMIT_INTERVAL_MS));

  timers.push(
    setInterval(() => {
      const now = Date.now();
      useActivityStore.getState().setMetrics(mockSocket.metrics.snapshot(now));
      useSimulationStore.getState().setStats(simulationEngine.stats);
      useAlertStore.getState().wakeSnoozed(now);
    }, METRICS_INTERVAL_MS),
  );

  timers.push(
    setInterval(() => {
      const now = Date.now();
      const result = services.ingestion.sweepSilentDevices(
        useDeviceStore.getState().devices.values(),
        now,
        STALE_AFTER_MS,
      );
      if (result.patches.length > 0) {
        useDeviceStore.getState().applyPatches(result.patches);
      }
    }, SWEEP_INTERVAL_MS),
  );

  simulationEngine.start();
}

export function stopPlatform(): void {
  if (!started) return;
  started = false;

  simulationEngine.stop();
  platform?.activityBridge.stop();

  for (const timer of timers) clearInterval(timer);
  timers = [];
  for (const dispose of disposers) dispose();
  disposers = [];
}

export function isPlatformRunning(): boolean {
  return started;
}

/* ------------------------------------------------------------------ */
/* Operator-facing commands. The UI calls these; it never touches the */
/* services directly.                                                 */
/* ------------------------------------------------------------------ */

export function startSimulation(): void {
  simulationEngine.start();
  useSimulationStore.getState().setStats(simulationEngine.stats);
}

export function stopSimulation(): void {
  simulationEngine.stop();
  useSimulationStore.getState().setStats(simulationEngine.stats);
}

export function resetSimulation(): void {
  const services = getPlatform();
  services.alertEngine.reset();
  services.ruleEngine.resetRuntime();
  telemetryRepository.clear();
  useAlertStore.getState().reset();
  useCommandStore.getState().clear();
  useFirmwareStore.getState().clear();
  useActivityStore.getState().clear();
  useRuleStore.getState().clearTriggers();
  useSimulationStore.getState().resetDemo();
  useDeviceStore.getState().setFleet(simulationEngine.reset());
}

export function setSimulationRate(rate: EventRate): void {
  simulationEngine.setRate(rate);
  useSimulationStore.getState().setRate(rate);
}

export function setSimulationFeatures(features: Partial<SimulationFeatures>): void {
  const store = useSimulationStore.getState();
  store.setFeatures(features);
  simulationEngine.setFeatures(useSimulationStore.getState().config.features);
}

export function setSimulationScale(deviceCount: number): void {
  useSimulationStore.getState().setDeviceCount(deviceCount);
  useDeviceStore.getState().setFleet(simulationEngine.setScale(deviceCount));
}

export function injectFailure(kind: FailureKind, deviceId?: string): string | null {
  const services = getPlatform();

  if (kind === "firmware-failure") {
    const failed = services.firmwareService.failNextJob();
    useSimulationStore.getState().recordInjection(kind, failed);
    return failed;
  }

  const target = simulationEngine.injectFailure(kind, deviceId);
  useSimulationStore.getState().recordInjection(kind, target);
  return target;
}

export function issueCommand(input: {
  readonly deviceId: string;
  readonly type: CommandType;
  readonly payload?: Record<string, unknown>;
}): string {
  const services = getPlatform();
  return services.commandService.issue({
    deviceId: input.deviceId,
    deviceName: getDeviceName(input.deviceId),
    type: input.type,
    origin: "operator",
    payload: input.payload,
  }).id;
}

export function issueBulkCommand(input: {
  readonly deviceIds: readonly string[];
  readonly type: CommandType;
}): string {
  const services = getPlatform();
  return services.commandService.issueBulk({
    deviceIds: input.deviceIds,
    resolveName: getDeviceName,
    type: input.type,
  }).batchId;
}

export function cancelCommand(commandId: string): boolean {
  return getPlatform().commandService.cancel(commandId);
}

export function startFirmwareRollout(input: {
  readonly deviceIds: readonly string[];
  readonly toVersion: string;
  readonly concurrency?: number;
}): string {
  return getPlatform().firmwareService.startRollout(input).id;
}

export function cancelFirmwareRollout(rolloutId: string): void {
  getPlatform().firmwareService.cancelRollout(rolloutId);
}

export function provisionDevice(request: ProvisionRequest): void {
  getPlatform().provisioningService.provision(request);
}

export function validateProvisionRequest(
  request: Partial<ProvisionRequest>,
): { valid: boolean; errors: Readonly<Record<string, string>> } {
  return getPlatform().provisioningService.validate(request);
}

/** Resolving an alert by hand must also clear the engine's dedupe entry. */
export function resolveAlert(alertId: string): void {
  const alert = useAlertStore.getState().resolve(alertId);
  if (alert) getPlatform().alertEngine.forget(alert.dedupeKey);
}

export function bulkResolveAlerts(alertIds: readonly string[]): void {
  const resolved = useAlertStore.getState().bulkResolve(alertIds);
  const engine = getPlatform().alertEngine;
  for (const alert of resolved) engine.forget(alert.dedupeKey);
}

export function setDeviceMaintenance(deviceId: string, inMaintenance: boolean): void {
  useDeviceStore.getState().setLifecycle(deviceId, inMaintenance ? "maintenance" : null);
}

export interface PlatformDiagnostics {
  readonly alerts: { readonly open: number; readonly created: number; readonly resolved: number };
  readonly rules: {
    readonly evaluations: number;
    readonly triggers: number;
    readonly indexedMetrics: number;
    readonly active: number;
  };
  readonly commands: {
    readonly issued: number;
    readonly completed: number;
    readonly failed: number;
    readonly inFlight: number;
  };
  readonly ingestion: {
    readonly frames: number;
    readonly statusChanges: number;
    readonly staleFramesDropped: number;
  };
  readonly telemetry: {
    readonly deviceCount: number;
    readonly hotDeviceCount: number;
    readonly ringCount: number;
    readonly samplesIngested: number;
    readonly approximateBytes: number;
  };
  readonly bus: { readonly eventsEmitted: number; readonly listeners: number };
  readonly running: boolean;
}

/** Aggregated diagnostics for the dev-mode panel. */
export function platformDiagnostics(): PlatformDiagnostics {
  const services = getPlatform();
  return {
    alerts: services.alertEngine.diagnostics,
    rules: {
      ...services.ruleEngine.diagnostics,
      active: services.ruleEngine.activeRuleCount,
    },
    commands: services.commandService.diagnostics,
    ingestion: services.ingestion.diagnostics,
    telemetry: telemetryRepository.diagnostics,
    bus: { eventsEmitted: eventBus.eventsEmitted, listeners: eventBus.listenerCount() },
    running: started,
  };
}
