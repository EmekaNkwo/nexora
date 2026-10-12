import { create } from "zustand";

import type {
  Alert,
  AlertCounts,
  AlertFilters,
  AlertStatus,
} from "@/types/alerts";
import { DEFAULT_ALERT_FILTERS, EMPTY_ALERT_COUNTS } from "@/types/alerts";

/**
 * Alert state.
 *
 * Open and resolved alerts are kept in separate collections. Operators spend
 * all their time in the open list, and keeping an unbounded resolved history
 * in the same array would mean every filter and sort paying for records nobody
 * is looking at. Resolved alerts are capped — this is a console, not an audit
 * database, and a real deployment would page them from the server.
 */

const RESOLVED_HISTORY_LIMIT = 400;

export const ALERT_PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100] as const;
const DEFAULT_ALERT_PAGE_SIZE = 25;

export interface AlertStoreState {
  /** Alerts that still need attention, newest first. */
  readonly open: readonly Alert[];
  readonly resolved: readonly Alert[];
  readonly byId: ReadonlyMap<string, Alert>;
  /** deviceId → open alert ids, for per-device badges without a scan. */
  readonly openByDevice: ReadonlyMap<string, readonly string[]>;
  readonly counts: AlertCounts;
  readonly filters: AlertFilters;
  /** Zero-based page index for the alerts table. */
  readonly page: number;
  readonly pageSize: number;
  readonly version: number;

  ingestCreated: (alert: Alert) => void;
  ingestUpdated: (alert: Alert) => void;
  ingestResolved: (alert: Alert) => void;
  acknowledge: (alertId: string, by: string) => Alert | undefined;
  resolve: (alertId: string) => Alert | undefined;
  snooze: (alertId: string, untilMs: number) => Alert | undefined;
  assign: (alertId: string, assignee: string) => Alert | undefined;
  bulkAcknowledge: (alertIds: readonly string[], by: string) => void;
  bulkResolve: (alertIds: readonly string[]) => readonly Alert[];
  /** Moves snoozed alerts whose window has elapsed back to active. */
  wakeSnoozed: (now: number) => void;
  setFilters: (filters: Partial<AlertFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  reset: () => void;
}

function countAlerts(open: readonly Alert[], resolved: readonly Alert[]): AlertCounts {
  let critical = 0;
  let warning = 0;
  let info = 0;
  let active = 0;
  let acknowledged = 0;
  let snoozed = 0;

  for (const alert of open) {
    if (alert.severity === "critical") critical += 1;
    else if (alert.severity === "warning") warning += 1;
    else info += 1;

    if (alert.status === "active") active += 1;
    else if (alert.status === "acknowledged") acknowledged += 1;
    else if (alert.status === "snoozed") snoozed += 1;
  }

  return {
    critical,
    warning,
    info,
    active,
    acknowledged,
    snoozed,
    resolved: resolved.length,
    total: open.length + resolved.length,
  };
}

function indexByDevice(open: readonly Alert[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const alert of open) {
    const existing = index.get(alert.deviceId);
    if (existing) existing.push(alert.id);
    else index.set(alert.deviceId, [alert.id]);
  }
  return index;
}

/** Rebuilds derived collections after any change to `open`/`resolved`. */
function commit(
  open: readonly Alert[],
  resolved: readonly Alert[],
  version: number,
): Pick<
  AlertStoreState,
  "open" | "resolved" | "byId" | "openByDevice" | "counts" | "version"
> {
  const byId = new Map<string, Alert>();
  for (const alert of open) byId.set(alert.id, alert);
  for (const alert of resolved) byId.set(alert.id, alert);

  return {
    open,
    resolved,
    byId,
    openByDevice: indexByDevice(open),
    counts: countAlerts(open, resolved),
    version: version + 1,
  };
}

export const useAlertStore = create<AlertStoreState>((set, get) => ({
  open: [],
  resolved: [],
  byId: new Map(),
  openByDevice: new Map(),
  counts: EMPTY_ALERT_COUNTS,
  filters: DEFAULT_ALERT_FILTERS,
  page: 0,
  pageSize: DEFAULT_ALERT_PAGE_SIZE,
  version: 0,

  ingestCreated: (alert) => {
    const state = get();
    if (state.byId.has(alert.id)) return;
    set(commit([alert, ...state.open], state.resolved, state.version));
  },

  /**
   * Refreshes the live value on an already-open alert. Does not reorder the
   * list: an alert that keeps updating must not jump to the top every tick.
   */
  ingestUpdated: (alert) => {
    const state = get();
    const index = state.open.findIndex((entry) => entry.id === alert.id);
    if (index < 0) return;

    const existing = state.open[index]!;
    // Preserve operator decisions — the engine only knows about the condition.
    const merged: Alert = {
      ...alert,
      status: existing.status,
      acknowledgedAt: existing.acknowledgedAt,
      acknowledgedBy: existing.acknowledgedBy,
      snoozedUntil: existing.snoozedUntil,
      assignee: existing.assignee ?? alert.assignee,
    };

    const open = [...state.open];
    open[index] = merged;
    set(commit(open, state.resolved, state.version));
  },

  ingestResolved: (alert) => {
    const state = get();
    const open = state.open.filter((entry) => entry.id !== alert.id);
    if (open.length === state.open.length && !state.byId.has(alert.id)) return;
    const resolved = [alert, ...state.resolved].slice(0, RESOLVED_HISTORY_LIMIT);
    set(commit(open, resolved, state.version));
  },

  acknowledge: (alertId, by) => {
    const state = get();
    const index = state.open.findIndex((entry) => entry.id === alertId);
    if (index < 0) return undefined;
    const now = Date.now();
    const updated: Alert = {
      ...state.open[index]!,
      status: "acknowledged",
      acknowledgedAt: now,
      acknowledgedBy: by,
      snoozedUntil: undefined,
      updatedAt: now,
    };
    const open = [...state.open];
    open[index] = updated;
    set(commit(open, state.resolved, state.version));
    return updated;
  },

  resolve: (alertId) => {
    const state = get();
    const existing = state.open.find((entry) => entry.id === alertId);
    if (!existing) return undefined;
    const now = Date.now();
    const updated: Alert = {
      ...existing,
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    };
    set(
      commit(
        state.open.filter((entry) => entry.id !== alertId),
        [updated, ...state.resolved].slice(0, RESOLVED_HISTORY_LIMIT),
        state.version,
      ),
    );
    return updated;
  },

  snooze: (alertId, untilMs) => {
    const state = get();
    const index = state.open.findIndex((entry) => entry.id === alertId);
    if (index < 0) return undefined;
    const updated: Alert = {
      ...state.open[index]!,
      status: "snoozed",
      snoozedUntil: untilMs,
      updatedAt: Date.now(),
    };
    const open = [...state.open];
    open[index] = updated;
    set(commit(open, state.resolved, state.version));
    return updated;
  },

  assign: (alertId, assignee) => {
    const state = get();
    const index = state.open.findIndex((entry) => entry.id === alertId);
    if (index < 0) return undefined;
    const updated: Alert = {
      ...state.open[index]!,
      assignee,
      updatedAt: Date.now(),
    };
    const open = [...state.open];
    open[index] = updated;
    set(commit(open, state.resolved, state.version));
    return updated;
  },

  bulkAcknowledge: (alertIds, by) => {
    const state = get();
    const targets = new Set(alertIds);
    if (targets.size === 0) return;
    const now = Date.now();
    const open = state.open.map((alert) =>
      targets.has(alert.id) && alert.status !== "acknowledged"
        ? {
            ...alert,
            status: "acknowledged" as AlertStatus,
            acknowledgedAt: now,
            acknowledgedBy: by,
            snoozedUntil: undefined,
            updatedAt: now,
          }
        : alert,
    );
    set(commit(open, state.resolved, state.version));
  },

  bulkResolve: (alertIds) => {
    const state = get();
    const targets = new Set(alertIds);
    if (targets.size === 0) return [];
    const now = Date.now();
    const closed: Alert[] = [];
    const open: Alert[] = [];

    for (const alert of state.open) {
      if (targets.has(alert.id)) {
        closed.push({ ...alert, status: "resolved", resolvedAt: now, updatedAt: now });
      } else {
        open.push(alert);
      }
    }

    set(
      commit(
        open,
        [...closed, ...state.resolved].slice(0, RESOLVED_HISTORY_LIMIT),
        state.version,
      ),
    );
    return closed;
  },

  wakeSnoozed: (now) => {
    const state = get();
    let changed = false;
    const open = state.open.map((alert) => {
      if (
        alert.status === "snoozed" &&
        alert.snoozedUntil !== undefined &&
        alert.snoozedUntil <= now
      ) {
        changed = true;
        return {
          ...alert,
          status: "active" as AlertStatus,
          snoozedUntil: undefined,
          updatedAt: now,
        };
      }
      return alert;
    });
    if (!changed) return;
    set(commit(open, state.resolved, state.version));
  },

  // Any filter change returns to the first page. Staying on page 7 of a
  // result set that now has two pages is the classic paging bug.
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters }, page: 0 })),

  resetFilters: () => set({ filters: DEFAULT_ALERT_FILTERS, page: 0 }),

  setPage: (page) => set({ page: Math.max(0, page) }),
  setPageSize: (pageSize) => set({ pageSize, page: 0 }),

  reset: () =>
    set((state) => ({
      ...commit([], [], state.version),
      filters: DEFAULT_ALERT_FILTERS,
      page: 0,
    })),
}));

/** Non-reactive helpers for the ingestion pipeline. */
export function getOpenAlertCount(deviceId: string): number {
  return useAlertStore.getState().openByDevice.get(deviceId)?.length ?? 0;
}

export function getCriticalAlertCount(deviceId: string): number {
  const state = useAlertStore.getState();
  const ids = state.openByDevice.get(deviceId);
  if (!ids) return 0;
  let count = 0;
  for (const id of ids) {
    if (state.byId.get(id)?.severity === "critical") count += 1;
  }
  return count;
}
