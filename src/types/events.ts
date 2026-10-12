import type { Alert } from "./alerts";
import type { DeviceCommand } from "./commands";
import type {
  Device,
  DeviceMode,
  DevicePatch,
  DeviceStatus,
  ProvisionJob,
} from "./device";
import type { FirmwareJob } from "./firmware";
import type { RuleTrigger } from "./rules";
import type { MetricKey, TelemetryFrame } from "./telemetry";

/**
 * The platform's event vocabulary. Everything downstream of the simulator —
 * stores, rule engine, alert engine, activity log, dev tools — reacts to these
 * and nothing else, which is what keeps the layers decoupled.
 */
export interface NexoraEventMap {
  /**
   * A batch of telemetry frames from one simulator tick. Batching is
   * deliberate: at 5,000 devices, per-frame store writes would thrash React.
   */
  "device.telemetry.batch": {
    readonly frames: readonly TelemetryFrame[];
    readonly tick: number;
    readonly emittedAt: number;
  };
  /** Single out-of-band reading, e.g. in response to `telemetry.request`. */
  "device.telemetry.updated": { readonly frame: TelemetryFrame };

  "device.online": { readonly deviceId: string; readonly at: number };
  "device.offline": {
    readonly deviceId: string;
    readonly at: number;
    readonly reason: "signal-loss" | "power" | "network-outage" | "injected";
  };
  "device.status.changed": {
    readonly deviceId: string;
    readonly from: DeviceStatus;
    readonly to: DeviceStatus;
    readonly at: number;
    readonly reason: string;
  };
  "device.warning": {
    readonly deviceId: string;
    readonly metric: MetricKey;
    readonly value: number;
    readonly at: number;
  };
  "device.critical": {
    readonly deviceId: string;
    readonly metric: MetricKey;
    readonly value: number;
    readonly at: number;
  };
  "device.mode.changed": {
    readonly deviceId: string;
    readonly mode: DeviceMode;
    readonly at: number;
  };
  "device.provisioning.progress": { readonly job: ProvisionJob };
  "device.provisioned": { readonly device: Device };
  "device.patch": { readonly patches: readonly DevicePatch[] };

  "device.command.queued": { readonly command: DeviceCommand };
  "device.command.sent": { readonly command: DeviceCommand };
  "device.command.acknowledged": { readonly command: DeviceCommand };
  "device.command.completed": { readonly command: DeviceCommand };
  "device.command.failed": { readonly command: DeviceCommand };

  "device.firmware.progress": { readonly job: FirmwareJob };
  "device.firmware.updated": {
    readonly deviceId: string;
    readonly version: string;
    readonly at: number;
  };
  "device.firmware.failed": {
    readonly deviceId: string;
    readonly error: string;
    readonly at: number;
  };

  "rule.triggered": { readonly trigger: RuleTrigger };

  "alert.created": { readonly alert: Alert };
  "alert.updated": { readonly alert: Alert };
  "alert.resolved": { readonly alert: Alert };

  "simulation.started": { readonly at: number; readonly deviceCount: number };
  "simulation.stopped": { readonly at: number };
  "simulation.reset": { readonly at: number };
  "simulation.scaled": { readonly deviceCount: number };
  "simulation.tick": {
    readonly tick: number;
    readonly frameCount: number;
    readonly durationMs: number;
  };

  "socket.connected": { readonly at: number };
  "socket.disconnected": { readonly at: number; readonly reason: string };
  "system.network.outage": {
    readonly at: number;
    readonly durationMs: number;
    readonly affectedDevices: number;
  };
  "system.network.restored": { readonly at: number };
}

export type NexoraEventName = keyof NexoraEventMap;

export type NexoraEventPayload<K extends NexoraEventName> = NexoraEventMap[K];

/** Envelope used by wildcard listeners (activity feed, dev-mode inspector). */
export interface NexoraEnvelope<K extends NexoraEventName = NexoraEventName> {
  readonly name: K;
  readonly payload: NexoraEventMap[K];
  readonly at: number;
  readonly seq: number;
}

export type EventListener<K extends NexoraEventName> = (
  payload: NexoraEventMap[K],
) => void;

export type WildcardListener = (envelope: NexoraEnvelope) => void;

export type Unsubscribe = () => void;
