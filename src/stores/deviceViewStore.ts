import { create } from "zustand";

import type {
  DeviceFilters,
  DeviceSortKey,
  DeviceStatus,
  DeviceType,
  SortDirection,
} from "@/types/device";
import { DEFAULT_DEVICE_FILTERS } from "@/types/device";

/**
 * Device table view state — filters, sorting, selection, columns, paging.
 *
 * Kept separate from `deviceStore` on purpose. The device store is written to
 * several times a second by telemetry ingestion; view state changes only when
 * a human interacts. Combining them would mean every filter chip re-rendering
 * on every telemetry batch, and every telemetry batch invalidating memoised
 * selectors that depend on the filter.
 */

export type DeviceColumnKey =
  | "device"
  | "type"
  | "location"
  | "status"
  | "primary"
  | "battery"
  | "signal"
  | "lastSeen"
  | "health"
  | "actions";

export interface DeviceColumn {
  readonly key: DeviceColumnKey;
  readonly label: string;
  /** Columns the table cannot function without. */
  readonly locked: boolean;
  /** Hidden below this viewport width, in px. */
  readonly minWidth: number;
}

export const DEVICE_COLUMNS: readonly DeviceColumn[] = [
  { key: "device", label: "Device", locked: true, minWidth: 0 },
  { key: "type", label: "Type", locked: false, minWidth: 1024 },
  { key: "location", label: "Location", locked: false, minWidth: 1280 },
  { key: "status", label: "Status", locked: true, minWidth: 0 },
  { key: "primary", label: "Reading", locked: false, minWidth: 640 },
  { key: "battery", label: "Battery", locked: false, minWidth: 900 },
  { key: "signal", label: "Signal", locked: false, minWidth: 1440 },
  { key: "lastSeen", label: "Last Seen", locked: false, minWidth: 1100 },
  { key: "health", label: "Health", locked: false, minWidth: 768 },
  { key: "actions", label: "", locked: true, minWidth: 0 },
];

const DEFAULT_VISIBLE: readonly DeviceColumnKey[] = DEVICE_COLUMNS.map(
  (column) => column.key,
);

export const PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100, 250] as const;

export interface DeviceViewStoreState {
  readonly filters: DeviceFilters;
  readonly sortKey: DeviceSortKey;
  readonly sortDirection: SortDirection;
  readonly visibleColumns: readonly DeviceColumnKey[];
  readonly selectedIds: ReadonlySet<string>;
  readonly page: number;
  readonly pageSize: number;
  /**
   * Row delivery mode.
   *
   * `false` — paginated: the table shows one page at a time with a pager.
   * `true` — continuous scroll: the whole filtered set in one scroll container,
   * windowed by the virtualiser.
   *
   * Both exist because they answer different questions. Paging is better for
   * working a list down methodically — position is nameable ("page 3 of 24"),
   * shareable, and you can tell when you have seen everything. Continuous
   * scroll is better for scanning a filtered set for an outlier, where page
   * boundaries are just friction. Paged is the default because triage is the
   * more common task.
   */
  readonly virtualised: boolean;

  setSearch: (search: string) => void;
  toggleStatus: (status: DeviceStatus) => void;
  toggleType: (type: DeviceType) => void;
  toggleGroup: (groupId: string) => void;
  setHealthRange: (range: readonly [number, number]) => void;
  setOnlyWithAlerts: (value: boolean) => void;
  setFilters: (filters: Partial<DeviceFilters>) => void;
  resetFilters: () => void;

  setSort: (key: DeviceSortKey) => void;
  toggleColumn: (key: DeviceColumnKey) => void;
  resetColumns: () => void;

  toggleSelected: (deviceId: string) => void;
  selectMany: (deviceIds: readonly string[]) => void;
  selectOnly: (deviceIds: readonly string[]) => void;
  clearSelection: () => void;

  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setVirtualised: (virtualised: boolean) => void;
}

function toggleIn<T>(list: readonly T[], value: T): readonly T[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

export const useDeviceViewStore = create<DeviceViewStoreState>((set, get) => ({
  filters: DEFAULT_DEVICE_FILTERS,
  sortKey: "status",
  sortDirection: "desc",
  visibleColumns: DEFAULT_VISIBLE,
  selectedIds: new Set(),
  page: 0,
  pageSize: 50,
  virtualised: false,

  // Any filter change resets paging — staying on page 7 of a result set that
  // now has two pages is a classic table bug.
  setSearch: (search) =>
    set((state) => ({ filters: { ...state.filters, search }, page: 0 })),

  toggleStatus: (status) =>
    set((state) => ({
      filters: { ...state.filters, statuses: toggleIn(state.filters.statuses, status) },
      page: 0,
    })),

  toggleType: (type) =>
    set((state) => ({
      filters: { ...state.filters, types: toggleIn(state.filters.types, type) },
      page: 0,
    })),

  toggleGroup: (groupId) =>
    set((state) => ({
      filters: { ...state.filters, groupIds: toggleIn(state.filters.groupIds, groupId) },
      page: 0,
    })),

  setHealthRange: (healthRange) =>
    set((state) => ({
      filters: { ...state.filters, healthRange: [healthRange[0], healthRange[1]] },
      page: 0,
    })),

  setOnlyWithAlerts: (onlyWithActiveAlerts) =>
    set((state) => ({
      filters: { ...state.filters, onlyWithActiveAlerts },
      page: 0,
    })),

  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters }, page: 0 })),

  resetFilters: () => set({ filters: DEFAULT_DEVICE_FILTERS, page: 0 }),

  /** Clicking the active column flips direction; a new column starts fresh. */
  setSort: (key) => {
    const { sortKey, sortDirection } = get();
    if (sortKey === key) {
      set({ sortDirection: sortDirection === "asc" ? "desc" : "asc" });
      return;
    }
    // Text sorts ascending by default; numeric and status sorts descending,
    // because "worst first" is what an operator wants to see.
    const textual = key === "name" || key === "type" || key === "site";
    set({ sortKey: key, sortDirection: textual ? "asc" : "desc" });
  },

  toggleColumn: (key) => {
    const column = DEVICE_COLUMNS.find((entry) => entry.key === key);
    if (!column || column.locked) return;
    set((state) => ({ visibleColumns: toggleIn(state.visibleColumns, key) }));
  },

  resetColumns: () => set({ visibleColumns: DEFAULT_VISIBLE }),

  toggleSelected: (deviceId) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return { selectedIds: next };
    }),

  selectMany: (deviceIds) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      for (const deviceId of deviceIds) next.add(deviceId);
      return { selectedIds: next };
    }),

  selectOnly: (deviceIds) => set({ selectedIds: new Set(deviceIds) }),

  clearSelection: () => set({ selectedIds: new Set() }),

  setPage: (page) => set({ page: Math.max(0, page) }),
  setPageSize: (pageSize) => set({ pageSize, page: 0 }),
  setVirtualised: (virtualised) => set({ virtualised }),
}));

/** True when any filter is narrowing the result set. */
export function hasActiveFilters(filters: DeviceFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.statuses.length > 0 ||
    filters.types.length > 0 ||
    filters.groupIds.length > 0 ||
    filters.onlyWithActiveAlerts ||
    filters.healthRange[0] > 0 ||
    filters.healthRange[1] < 100
  );
}

export function countActiveFilters(filters: DeviceFilters): number {
  let count = 0;
  if (filters.search.trim().length > 0) count += 1;
  count += filters.statuses.length;
  count += filters.types.length;
  count += filters.groupIds.length;
  if (filters.onlyWithActiveAlerts) count += 1;
  if (filters.healthRange[0] > 0 || filters.healthRange[1] < 100) count += 1;
  return count;
}
