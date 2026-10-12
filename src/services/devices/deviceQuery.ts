import type {
  Device,
  DeviceFilters,
  DeviceSortKey,
  DeviceSummary,
  SortDirection,
} from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { STATUS_SEVERITY } from "@/utils/calculations/status";

/**
 * Device querying — filtering, sorting and paging.
 *
 * Pure functions over a device collection, kept out of both the store and the
 * components. That matters for two reasons: it is directly testable without
 * mounting anything, and it can be memoised on `(deviceVersion, filters)` so a
 * telemetry batch that changes no device's *identity* does not re-run a
 * 5,000-element sort.
 */

/** Builds the flattened row shape the table and map markers render. */
export function toSummary(device: Device): DeviceSummary {
  const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    status: device.status,
    site: device.location.site,
    groupId: device.groupId,
    healthScore: device.healthScore,
    battery: device.battery,
    signalStrength: device.signalStrength,
    lastSeen: device.lastSeen,
    firmwareVersion: device.firmwareVersion,
    primaryMetric: descriptor.primaryMetric,
    primaryValue: device.telemetry.values[descriptor.primaryMetric],
    values: device.telemetry.values,
    location: device.location,
  };
}

export interface FilterContext {
  /** Open-alert count per device, for the "has alerts" filter. */
  readonly alertCounts: ReadonlyMap<string, readonly string[]>;
}

/**
 * Applies filters. Search matches id, name, model, site, city and tags — an
 * operator searching "LAG" or "cold" or "NX-CS40" should all work.
 */
export function filterDevices(
  devices: Iterable<Device>,
  filters: DeviceFilters,
  context?: FilterContext,
): Device[] {
  const needle = filters.search.trim().toLowerCase();
  const statuses = filters.statuses.length > 0 ? new Set(filters.statuses) : null;
  const types = filters.types.length > 0 ? new Set(filters.types) : null;
  const groups = filters.groupIds.length > 0 ? new Set(filters.groupIds) : null;
  const [minHealth, maxHealth] = filters.healthRange;
  const checkHealth = minHealth > 0 || maxHealth < 100;

  const result: Device[] = [];

  for (const device of devices) {
    if (statuses && !statuses.has(device.status)) continue;
    if (types && !types.has(device.type)) continue;
    if (groups && !groups.has(device.groupId)) continue;
    if (checkHealth && (device.healthScore < minHealth || device.healthScore > maxHealth)) {
      continue;
    }
    if (filters.onlyWithActiveAlerts) {
      const alerts = context?.alertCounts.get(device.id);
      if (!alerts || alerts.length === 0) continue;
    }
    if (needle.length > 0 && !matchesSearch(device, needle)) continue;
    result.push(device);
  }

  return result;
}

function matchesSearch(device: Device, needle: string): boolean {
  if (device.id.toLowerCase().includes(needle)) return true;
  if (device.name.toLowerCase().includes(needle)) return true;
  if (device.model.toLowerCase().includes(needle)) return true;
  if (device.location.site.toLowerCase().includes(needle)) return true;
  if (device.location.city.toLowerCase().includes(needle)) return true;
  if (DEVICE_TYPE_DESCRIPTORS[device.type].label.toLowerCase().includes(needle)) {
    return true;
  }
  for (const tag of device.tags) {
    if (tag.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Comparable value for a sort key. Strings sort lexically, numbers numerically. */
function sortValue(device: Device, key: DeviceSortKey): string | number {
  switch (key) {
    case "name":
      return device.name.toLowerCase();
    case "type":
      return DEVICE_TYPE_DESCRIPTORS[device.type].label.toLowerCase();
    case "site":
      return device.location.site.toLowerCase();
    case "status":
      return STATUS_SEVERITY[device.status];
    case "primaryMetric": {
      const metric = DEVICE_TYPE_DESCRIPTORS[device.type].primaryMetric;
      // Devices without the metric sort last in either direction.
      return device.telemetry.values[metric] ?? Number.NEGATIVE_INFINITY;
    }
    case "battery":
      return device.battery;
    case "signalStrength":
      return device.signalStrength;
    case "lastSeen":
      return device.lastSeen;
    case "healthScore":
      return device.healthScore;
  }
}

export function sortDevices(
  devices: Device[],
  key: DeviceSortKey,
  direction: SortDirection,
): Device[] {
  const sign = direction === "asc" ? 1 : -1;

  // Sorts in place on the array produced by `filterDevices`, which is already
  // a fresh array — the caller's collection is never mutated.
  devices.sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === right) {
      // Stable tiebreak on id, so equal rows do not shuffle between renders.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    if (typeof left === "string" || typeof right === "string") {
      return sign * (String(left) < String(right) ? -1 : 1);
    }
    return sign * (left < right ? -1 : 1);
  });

  return devices;
}

export interface DeviceQueryResult {
  readonly devices: readonly Device[];
  readonly total: number;
  readonly filteredCount: number;
}

/** One-shot filter + sort, for callers that page separately. */
export function queryDevices(
  devices: ReadonlyMap<string, Device>,
  order: readonly string[],
  filters: DeviceFilters,
  sortKey: DeviceSortKey,
  sortDirection: SortDirection,
  context?: FilterContext,
): DeviceQueryResult {
  // Iterate `order` rather than the map so results are deterministic and
  // reflect provisioning order before sorting is applied.
  const ordered: Device[] = [];
  for (const id of order) {
    const device = devices.get(id);
    if (device) ordered.push(device);
  }

  const filtered = filterDevices(ordered, filters, context);
  sortDevices(filtered, sortKey, sortDirection);

  return { devices: filtered, total: devices.size, filteredCount: filtered.length };
}

/** Group membership. Site groups match by location; logical groups by id. */
export function isDeviceInGroup(
  device: Device,
  group: { readonly id: string; readonly kind: string; readonly name: string },
): boolean {
  if (group.kind === "site") return device.location.site === group.name;
  return device.groupId === group.id;
}
