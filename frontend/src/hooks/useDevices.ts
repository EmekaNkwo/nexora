"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { queryDevices, toSummary } from "@/services/devices/deviceQuery";
import { paginate, type PageResult } from "@/utils/pagination";
import { useAlertStore } from "@/stores/alertStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import type {
  Device,
  DeviceStatusCounts,
  DeviceSummary,
  HealthDistribution,
} from "@/types/device";

/**
 * Device reads for the UI.
 *
 * Each hook subscribes to the narrowest slice it can. That is the whole reason
 * the device store keeps separate `version`, `statusCounts` and
 * `healthDistribution` fields: a KPI tile can subscribe to a counts object
 * that changes only when a device actually changes status, rather than to the
 * device map that changes several times a second.
 */

/** Stable empty map, so an unused alert subscription never changes identity. */
const EMPTY_ALERT_INDEX: ReadonlyMap<string, readonly string[]> = new Map();

export function useDeviceCount(): number {
  return useDeviceStore((state) => state.devices.size);
}

export function useStatusCounts(): DeviceStatusCounts {
  return useDeviceStore((state) => state.statusCounts);
}

export function useHealthDistribution(): HealthDistribution {
  return useDeviceStore((state) => state.healthDistribution);
}

export function useFleetReady(): boolean {
  return useDeviceStore((state) => state.initialised);
}

export function useDevice(deviceId: string | null | undefined): Device | undefined {
  return useDeviceStore((state) =>
    deviceId ? state.devices.get(deviceId) : undefined,
  );
}

export interface DeviceQueryView {
  /** The visible slice — one page, or the whole set in continuous-scroll mode. */
  readonly rows: readonly DeviceSummary[];
  /**
   * Every device matching the filters, across all pages. What export and
   * cross-page bulk actions operate on; `rows` would silently narrow them to
   * whatever page happened to be open.
   */
  readonly matching: readonly DeviceSummary[];
  readonly page: PageResult<DeviceSummary>;
  readonly filteredCount: number;
  readonly totalCount: number;
  /** Ids of every device matching the filter, not just the current page. */
  readonly matchingIds: readonly string[];
  /** Ids on the visible page — what the header checkbox acts on. */
  readonly pageIds: readonly string[];
  /** True when rows are delivered as one scrollable set rather than pages. */
  readonly virtualised: boolean;
}

/**
 * The filtered, sorted, paged device list the table renders.
 *
 * Memoised on `(version, filters, sort, paging)`. `version` only increments on
 * an actual device mutation, so scrolling or opening a dropdown never re-runs
 * the sort over thousands of rows.
 */
export function useDeviceQuery(): DeviceQueryView {
  // No `version` here: the store publishes a fresh Map on every content
  // change, so Map identity is already the precise invalidation signal.
  const { devices, order } = useDeviceStore(
    useShallow((state) => ({ devices: state.devices, order: state.order })),
  );

  const { filters, sortKey, sortDirection, page, pageSize, virtualised } =
    useDeviceViewStore(
      useShallow((state) => ({
        filters: state.filters,
        sortKey: state.sortKey,
        sortDirection: state.sortDirection,
        page: state.page,
        pageSize: state.pageSize,
        virtualised: state.virtualised,
      })),
    );

  // Only subscribe to the alert index when a filter actually depends on it.
  const alertCounts = useAlertStore((state) =>
    filters.onlyWithActiveAlerts ? state.openByDevice : EMPTY_ALERT_INDEX,
  );

  return useMemo(() => {
    const result = queryDevices(devices, order, filters, sortKey, sortDirection, {
      alertCounts,
    });

    const summaries = result.devices.map(toSummary);
    // Virtualised mode renders the whole filtered set and lets the virtualiser
    // window it; paginated mode slices. Both paths share one query.
    const pageResult = virtualised
      ? {
          items: summaries,
          page: 0,
          pageCount: 1,
          total: summaries.length,
          from: summaries.length === 0 ? 0 : 1,
          to: summaries.length,
        }
      : paginate(summaries, page, pageSize);

    return {
      rows: pageResult.items,
      matching: summaries,
      page: pageResult,
      filteredCount: result.filteredCount,
      totalCount: result.total,
      matchingIds: result.devices.map((device) => device.id),
      pageIds: pageResult.items.map((device) => device.id),
      virtualised,
    };

  }, [
    devices,
    order,
    filters,
    sortKey,
    sortDirection,
    page,
    pageSize,
    virtualised,
    alertCounts,
  ]);
}

/** Lightweight summaries for every device — used by the map and by search. */
export function useDeviceSummaries(): readonly DeviceSummary[] {
  const { devices, order } = useDeviceStore(
    useShallow((state) => ({ devices: state.devices, order: state.order })),
  );

  return useMemo(() => {
    const summaries: DeviceSummary[] = [];
    for (const id of order) {
      const device = devices.get(id);
      if (device) summaries.push(toSummary(device));
    }
    return summaries;
  }, [devices, order]);
}

export function useSelectedDeviceIds(): readonly string[] {
  const selectedIds = useDeviceViewStore((state) => state.selectedIds);
  return useMemo(() => [...selectedIds], [selectedIds]);
}

export function useSelectionCount(): number {
  return useDeviceViewStore((state) => state.selectedIds.size);
}

/** Resolves selected ids to device records, skipping any that vanished. */
export function useSelectedDevices(): readonly Device[] {
  const selectedIds = useDeviceViewStore((state) => state.selectedIds);
  const devices = useDeviceStore((state) => state.devices);

  return useMemo(() => {
    const result: Device[] = [];
    for (const id of selectedIds) {
      const device = devices.get(id);
      if (device) result.push(device);
    }
    return result;
  }, [selectedIds, devices]);
}
