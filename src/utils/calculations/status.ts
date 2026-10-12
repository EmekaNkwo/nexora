import type { BreachLevel } from "@/types/alerts";
import type { DeviceStatus } from "@/types/device";
import { CONNECTED_STATUSES } from "@/types/device";

/**
 * Device status derivation.
 *
 * Status is *derived*, not stored-and-hoped-for. Two classes of status exist
 * and they must not fight each other:
 *
 * - **Lifecycle** statuses (`maintenance`, `updating`) are asserted by an
 *   operator or a rollout. They are sticky and win over telemetry, because a
 *   device mid-firmware-update reporting an odd temperature should read as
 *   "updating", not "critical".
 * - **Condition** statuses (`online`, `warning`, `critical`, `offline`) are
 *   recomputed from connectivity and threshold breaches on every snapshot.
 */

export interface StatusInputs {
  readonly connected: boolean;
  readonly breach: BreachLevel;
  /** Set while a lifecycle state is asserted. */
  readonly lifecycle?: Extract<DeviceStatus, "maintenance" | "updating">;
}

export function deriveStatus(inputs: StatusInputs): DeviceStatus {
  if (inputs.lifecycle) return inputs.lifecycle;
  if (!inputs.connected) return "offline";
  if (inputs.breach === "critical") return "critical";
  if (inputs.breach === "warning") return "warning";
  return "online";
}

export function isConnectedStatus(status: DeviceStatus): boolean {
  return CONNECTED_STATUSES.includes(status);
}

/** Lifecycle statuses that telemetry must not override. */
export function isLifecycleStatus(
  status: DeviceStatus,
): status is Extract<DeviceStatus, "maintenance" | "updating"> {
  return status === "maintenance" || status === "updating";
}

/** Ranking used to sort "worst first" in tables and group rollups. */
export const STATUS_SEVERITY: Readonly<Record<DeviceStatus, number>> = {
  critical: 5,
  offline: 4,
  warning: 3,
  updating: 2,
  maintenance: 1,
  online: 0,
};

export function compareStatusSeverity(a: DeviceStatus, b: DeviceStatus): number {
  return STATUS_SEVERITY[b] - STATUS_SEVERITY[a];
}

/** Human-readable transition reason, used by the activity feed. */
export function describeStatusChange(
  from: DeviceStatus,
  to: DeviceStatus,
  context?: { readonly metric?: string; readonly value?: number },
): string {
  if (to === "offline") return "Device went offline";
  if (from === "offline") return "Device came back online";
  if (to === "critical" && context?.metric) {
    return `Critical: ${context.metric} at ${context.value}`;
  }
  if (to === "warning" && context?.metric) {
    return `Warning: ${context.metric} at ${context.value}`;
  }
  if (to === "updating") return "Firmware update started";
  if (to === "maintenance") return "Device placed in maintenance";
  if (to === "online") return "Device recovered to normal";
  return `Status changed from ${from} to ${to}`;
}
