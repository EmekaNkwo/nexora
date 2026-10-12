import { create } from "zustand";

import type {
  Device,
  DeviceLocation,
  DeviceMode,
  DevicePatch,
  DeviceStatus,
  DeviceStatusCounts,
  HealthDistribution,
  ProvisionJob,
} from "@/types/device";
import { EMPTY_STATUS_COUNTS } from "@/types/device";
import { healthBand } from "@/utils/calculations/health";

/**
 * Fleet state.
 *
 * Two performance decisions dominate this store:
 *
 * 1. **Devices live in a `Map`, not an array.** Telemetry arrives keyed by
 *    device id, and an array would mean an O(n) scan per frame — at 1,000
 *    frames a second across 5,000 devices that is unusable. A stable `order`
 *    array alongside the map preserves deterministic iteration for tables.
 *
 * 2. **Aggregates are maintained incrementally.** Status counts and the health
 *    distribution are updated by diffing each patch's before/after values
 *    rather than recomputed by sweeping the fleet. A sweep per batch would be
 *    ~5,000 iterations every 250 ms for numbers that barely change; the
 *    incremental version costs one decrement and one increment per changed
 *    device.
 *
 * `version` increments on every mutation so components that need coarse
 * "something changed" notification can subscribe to a single number instead of
 * to the map itself.
 */

interface MutableCounts {
  online: number;
  offline: number;
  warning: number;
  critical: number;
  maintenance: number;
  updating: number;
  total: number;
}

interface MutableHealth {
  healthy: number;
  degraded: number;
  critical: number;
  total: number;
  /** Running sum, so the mean is O(1) rather than a fleet sweep. */
  sum: number;
}

export interface DeviceStoreState {
  readonly devices: ReadonlyMap<string, Device>;
  /** Stable device order — provisioned devices append to the end. */
  readonly order: readonly string[];
  readonly statusCounts: DeviceStatusCounts;
  readonly healthDistribution: HealthDistribution;
  /** Lifecycle overrides asserted by operators or rollouts. */
  readonly lifecycleOverrides: ReadonlyMap<string, Extract<DeviceStatus, "maintenance" | "updating">>;
  /**
   * When the transport last reported each device as disconnected.
   *
   * Connectivity is established by the transport, never inferred from a
   * reading, so this acts as a connection epoch: telemetry stamped at or
   * before it belongs to the previous connection and must not revive the
   * device. Cleared when the device comes back.
   */
  readonly offlineSince: ReadonlyMap<string, number>;
  readonly provisionJobs: readonly ProvisionJob[];
  readonly version: number;
  readonly initialised: boolean;

  setFleet: (devices: readonly Device[]) => void;
  applyPatches: (patches: readonly DevicePatch[]) => void;
  upsertDevice: (device: Device) => void;
  removeDevice: (deviceId: string) => void;
  setLifecycle: (
    deviceId: string,
    lifecycle: Extract<DeviceStatus, "maintenance" | "updating"> | null,
  ) => void;
  /** Records a transport-reported disconnect and marks the device offline. */
  markOffline: (deviceId: string, at: number) => void;
  /** Clears the disconnect epoch and brings the device back online. */
  markOnline: (deviceId: string, at: number) => void;
  setMode: (deviceId: string, mode: DeviceMode) => void;
  setFirmwareVersion: (deviceId: string, version: string) => void;
  setLocation: (deviceId: string, location: DeviceLocation) => void;
  upsertProvisionJob: (job: ProvisionJob) => void;
  clearProvisionJobs: () => void;
  reset: () => void;
}

function toCounts(counts: MutableCounts): DeviceStatusCounts {
  return {
    online: counts.online,
    offline: counts.offline,
    warning: counts.warning,
    critical: counts.critical,
    maintenance: counts.maintenance,
    updating: counts.updating,
    total: counts.total,
  };
}

function toHealth(health: MutableHealth): HealthDistribution {
  return {
    healthy: health.healthy,
    degraded: health.degraded,
    critical: health.critical,
    total: health.total,
    average: health.total === 0 ? 0 : Math.round(health.sum / health.total),
  };
}

function emptyCounts(): MutableCounts {
  return { ...EMPTY_STATUS_COUNTS };
}

function emptyHealth(): MutableHealth {
  return { healthy: 0, degraded: 0, critical: 0, total: 0, sum: 0 };
}

/**
 * Mutable aggregate accumulators held outside React state.
 *
 * They are the authoritative tallies; the immutable snapshots published into
 * the store are derived from them on each commit. Keeping the accumulators
 * mutable avoids rebuilding two objects per device per batch.
 */
let counts = emptyCounts();
let health = emptyHealth();

function addDevice(device: Device): void {
  counts[device.status] += 1;
  counts.total += 1;
  health[healthBand(device.healthScore)] += 1;
  health.total += 1;
  health.sum += device.healthScore;
}

function removeDeviceFromAggregates(device: Device): void {
  counts[device.status] -= 1;
  counts.total -= 1;
  health[healthBand(device.healthScore)] -= 1;
  health.total -= 1;
  health.sum -= device.healthScore;
}

function updateAggregates(previous: Device, next: Device): void {
  if (previous.status !== next.status) {
    counts[previous.status] -= 1;
    counts[next.status] += 1;
  }
  if (previous.healthScore !== next.healthScore) {
    const previousBand = healthBand(previous.healthScore);
    const nextBand = healthBand(next.healthScore);
    if (previousBand !== nextBand) {
      health[previousBand] -= 1;
      health[nextBand] += 1;
    }
    health.sum += next.healthScore - previous.healthScore;
  }
}

/** Applies a patch to a device, returning the same object when nothing moved. */
function mergePatch(device: Device, patch: DevicePatch): Device {
  let changed = false;
  const next: Record<string, unknown> = { ...device };

  const assign = <K extends keyof Device>(key: K, value: Device[K] | undefined): void => {
    if (value === undefined || value === device[key]) return;
    next[key as string] = value;
    changed = true;
  };

  assign("status", patch.status);
  assign("battery", patch.battery);
  assign("signalStrength", patch.signalStrength);
  assign("lastSeen", patch.lastSeen);
  assign("healthScore", patch.healthScore);
  assign("firmwareVersion", patch.firmwareVersion);
  assign("mode", patch.mode);
  assign("errorCount", patch.errorCount);
  assign("messageCount", patch.messageCount);

  // Telemetry, location and actuators are object-valued: compare identity and
  // replace wholesale rather than attempting a deep merge.
  if (patch.telemetry && patch.telemetry !== device.telemetry) {
    next.telemetry = patch.telemetry;
    changed = true;
  }
  if (patch.location && patch.location !== device.location) {
    next.location = patch.location;
    changed = true;
  }
  if (patch.actuators && patch.actuators !== device.actuators) {
    next.actuators = patch.actuators;
    changed = true;
  }

  return changed ? (next as unknown as Device) : device;
}

export const useDeviceStore = create<DeviceStoreState>((set, get) => ({
  devices: new Map(),
  order: [],
  statusCounts: EMPTY_STATUS_COUNTS,
  healthDistribution: { healthy: 0, degraded: 0, critical: 0, total: 0, average: 0 },
  lifecycleOverrides: new Map(),
  offlineSince: new Map(),
  provisionJobs: [],
  version: 0,
  initialised: false,

  setFleet: (devices) => {
    counts = emptyCounts();
    health = emptyHealth();
    const map = new Map<string, Device>();
    const order: string[] = [];

    for (const device of devices) {
      map.set(device.id, device);
      order.push(device.id);
      addDevice(device);
    }

    set((state) => ({
      devices: map,
      order,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      lifecycleOverrides: new Map(),
      offlineSince: new Map(),
      version: state.version + 1,
      initialised: true,
    }));
  },

  /**
   * Applies a batch of patches in a single commit.
   *
   * The map is cloned once for the whole batch rather than once per patch —
   * the difference between one allocation and a thousand per tick.
   */
  applyPatches: (patches) => {
    if (patches.length === 0) return;
    const state = get();
    let map: Map<string, Device> | null = null;

    for (const patch of patches) {
      const existing = (map ?? state.devices).get(patch.id);
      if (!existing) continue;

      // Reject out-of-order writes. Telemetry patches are buffered and
      // committed on an interval, so a patch computed before a device
      // disconnected can be flushed after the disconnect was applied —
      // silently marking an offline device as online again. Any patch carrying
      // an older `lastSeen` than the device already has is stale by
      // definition, whatever produced it.
      if (patch.lastSeen !== undefined && patch.lastSeen < existing.lastSeen) {
        continue;
      }

      const next = mergePatch(existing, patch);
      if (next === existing) continue;
      if (!map) map = new Map(state.devices);
      updateAggregates(existing, next);
      map.set(patch.id, next);
    }

    if (!map) return;

    set({
      devices: map,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  upsertDevice: (device) => {
    const state = get();
    const existing = state.devices.get(device.id);
    const map = new Map(state.devices);
    map.set(device.id, device);

    if (existing) {
      updateAggregates(existing, device);
    } else {
      addDevice(device);
    }

    set({
      devices: map,
      order: existing ? state.order : [...state.order, device.id],
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  removeDevice: (deviceId) => {
    const state = get();
    const existing = state.devices.get(deviceId);
    if (!existing) return;

    removeDeviceFromAggregates(existing);
    const map = new Map(state.devices);
    map.delete(deviceId);
    const overrides = new Map(state.lifecycleOverrides);
    overrides.delete(deviceId);
    const epochs = new Map(state.offlineSince);
    epochs.delete(deviceId);

    set({
      devices: map,
      order: state.order.filter((id) => id !== deviceId),
      lifecycleOverrides: overrides,
      offlineSince: epochs,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  /**
   * Asserts or clears a lifecycle status. Stored separately from the device so
   * the ingestion pipeline can keep deriving condition statuses from telemetry
   * without clobbering an operator's assertion.
   */
  setLifecycle: (deviceId, lifecycle) => {
    const state = get();
    const overrides = new Map(state.lifecycleOverrides);
    if (lifecycle === null) overrides.delete(deviceId);
    else overrides.set(deviceId, lifecycle);

    const existing = state.devices.get(deviceId);
    if (!existing) {
      set({ lifecycleOverrides: overrides, version: state.version + 1 });
      return;
    }

    // Applying the override immediately avoids a visible lag until the device's
    // next telemetry frame arrives.
    const nextStatus: DeviceStatus = lifecycle ?? existing.status;
    const next: Device = { ...existing, status: nextStatus };
    updateAggregates(existing, next);
    const map = new Map(state.devices);
    map.set(deviceId, next);

    set({
      devices: map,
      lifecycleOverrides: overrides,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  /**
   * Applies a transport-reported disconnect.
   *
   * Sets the status directly rather than routing through `applyPatches`, and
   * records the epoch so the ingestion pipeline can discard telemetry from the
   * connection that just ended. Without the epoch, a frame stamped in the same
   * millisecond as the disconnect would flip the device straight back online.
   */
  markOffline: (deviceId, at) => {
    const state = get();
    const existing = state.devices.get(deviceId);
    const epochs = new Map(state.offlineSince);
    epochs.set(deviceId, at);

    if (!existing) {
      set({ offlineSince: epochs, version: state.version + 1 });
      return;
    }

    const next: Device = { ...existing, status: "offline" };
    updateAggregates(existing, next);
    const map = new Map(state.devices);
    map.set(deviceId, next);

    set({
      devices: map,
      offlineSince: epochs,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  /** Clears the disconnect epoch and brings the device back online. */
  markOnline: (deviceId, at) => {
    const state = get();
    const existing = state.devices.get(deviceId);
    const epochs = new Map(state.offlineSince);
    epochs.delete(deviceId);

    if (!existing) {
      set({ offlineSince: epochs, version: state.version + 1 });
      return;
    }

    const next: Device = { ...existing, status: "online", lastSeen: at };
    updateAggregates(existing, next);
    const map = new Map(state.devices);
    map.set(deviceId, next);

    set({
      devices: map,
      offlineSince: epochs,
      statusCounts: toCounts(counts),
      healthDistribution: toHealth(health),
      version: state.version + 1,
    });
  },

  setMode: (deviceId, mode) => {
    get().applyPatches([{ id: deviceId, mode }]);
  },

  setFirmwareVersion: (deviceId, version) => {
    get().applyPatches([{ id: deviceId, firmwareVersion: version }]);
  },

  setLocation: (deviceId, location) => {
    get().applyPatches([{ id: deviceId, location }]);
  },

  upsertProvisionJob: (job) => {
    set((state) => {
      const index = state.provisionJobs.findIndex((entry) => entry.id === job.id);
      const jobs =
        index >= 0
          ? state.provisionJobs.map((entry) => (entry.id === job.id ? job : entry))
          : [job, ...state.provisionJobs].slice(0, 20);
      return { provisionJobs: jobs };
    });
  },

  clearProvisionJobs: () => set({ provisionJobs: [] }),

  reset: () => {
    counts = emptyCounts();
    health = emptyHealth();
    set((state) => ({
      devices: new Map(),
      order: [],
      statusCounts: EMPTY_STATUS_COUNTS,
      healthDistribution: { healthy: 0, degraded: 0, critical: 0, total: 0, average: 0 },
      lifecycleOverrides: new Map(),
      offlineSince: new Map(),
      provisionJobs: [],
      version: state.version + 1,
      initialised: false,
    }));
  },
}));

/** Non-reactive read, for services that must not subscribe to React state. */
export function getDevice(deviceId: string): Device | undefined {
  return useDeviceStore.getState().devices.get(deviceId);
}

export function getDeviceName(deviceId: string): string {
  return useDeviceStore.getState().devices.get(deviceId)?.name ?? deviceId;
}

export function getFirmwareVersion(deviceId: string): string {
  return useDeviceStore.getState().devices.get(deviceId)?.firmwareVersion ?? "unknown";
}

/** Connection epoch for a device, or undefined while it is connected. */
export function getOfflineSince(deviceId: string): number | undefined {
  return useDeviceStore.getState().offlineSince.get(deviceId);
}

export function isDeviceReachable(deviceId: string): boolean {
  const device = useDeviceStore.getState().devices.get(deviceId);
  if (!device) return false;
  return device.status !== "offline";
}
