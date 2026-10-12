import { create } from "zustand";

import type {
  ActivityEntry,
  ActivityFilters,
  InfrastructureMetrics,
} from "@/types/activity";
import {
  DEFAULT_ACTIVITY_FILTERS,
  EMPTY_INFRASTRUCTURE_METRICS,
} from "@/types/activity";

/**
 * Activity feed and infrastructure KPIs.
 *
 * The feed is a bounded window, not a log. Telemetry alone produces thousands
 * of events a minute; retaining them would exhaust memory for data that is
 * only ever read as "the last couple of hundred things that happened". The
 * ingestion pipeline is also selective about what reaches here — routine
 * telemetry is summarised into the KPIs, and only notable events (status
 * changes, alerts, rule firings, commands) become feed entries.
 *
 * Entries are *buffered* and flushed on an interval. A burst of 40 events in
 * one tick must cost one render, not forty.
 */

const FEED_LIMIT = 250;

export interface ActivityStoreState {
  readonly entries: readonly ActivityEntry[];
  readonly filters: ActivityFilters;
  readonly metrics: InfrastructureMetrics;
  /** Frames-per-second estimate, sampled by the dev-mode panel. */
  readonly fps: number;

  /** Appends several entries in one commit. Newest first. */
  pushEntries: (entries: readonly ActivityEntry[]) => void;
  setMetrics: (metrics: InfrastructureMetrics) => void;
  setFps: (fps: number) => void;
  setFilters: (filters: Partial<ActivityFilters>) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityStoreState>((set) => ({
  entries: [],
  filters: DEFAULT_ACTIVITY_FILTERS,
  metrics: EMPTY_INFRASTRUCTURE_METRICS,
  fps: 60,

  pushEntries: (entries) => {
    if (entries.length === 0) return;
    set((state) => ({
      entries: [...entries, ...state.entries].slice(0, FEED_LIMIT),
    }));
  },

  setMetrics: (metrics) => set({ metrics }),
  setFps: (fps) => set({ fps }),

  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),

  clear: () => set({ entries: [] }),
}));

export function selectFilteredActivity(
  state: ActivityStoreState,
): readonly ActivityEntry[] {
  const { kinds, deviceId, search } = state.filters;
  const needle = search.trim().toLowerCase();

  if (kinds.length === 0 && !deviceId && needle.length === 0) return state.entries;

  return state.entries.filter((entry) => {
    if (kinds.length > 0 && !kinds.includes(entry.kind)) return false;
    if (deviceId && entry.deviceId !== deviceId) return false;
    if (needle.length > 0) {
      const haystack = `${entry.subject} ${entry.message}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function selectDeviceActivity(
  state: ActivityStoreState,
  deviceId: string,
  limit = 40,
): readonly ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const entry of state.entries) {
    if (entry.deviceId !== deviceId) continue;
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
