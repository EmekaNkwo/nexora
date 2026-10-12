"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useActivityStore } from "@/stores/activityStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useHealthDistribution, useStatusCounts } from "@/hooks/useDevices";
import { useAlertCounts } from "@/hooks/useAlerts";
import type { ActivityEntry, ActivityFilters, InfrastructureMetrics } from "@/types/activity";
import type { DeviceStatusCounts, HealthDistribution } from "@/types/device";
import type { AlertCounts } from "@/types/alerts";

/** Applies the feed's kind/device/text filters. */
function filterActivity(
  entries: readonly ActivityEntry[],
  filters: ActivityFilters,
): readonly ActivityEntry[] {
  const needle = filters.search.trim().toLowerCase();
  if (filters.kinds.length === 0 && !filters.deviceId && needle.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    if (filters.kinds.length > 0 && !filters.kinds.includes(entry.kind)) return false;
    if (filters.deviceId && entry.deviceId !== filters.deviceId) return false;
    if (needle.length > 0) {
      const haystack = `${entry.subject} ${entry.message}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function useActivityFeed(limit = 60): readonly ActivityEntry[] {
  const entries = useActivityStore((state) => state.entries);
  const filters = useActivityStore((state) => state.filters);

  return useMemo(
    () => filterActivity(entries, filters).slice(0, limit),
    [entries, filters, limit],
  );
}

export function useDeviceActivity(
  deviceId: string | null | undefined,
  limit = 30,
): readonly ActivityEntry[] {
  const entries = useActivityStore((state) => state.entries);

  return useMemo(() => {
    if (!deviceId) return [];
    const matched: ActivityEntry[] = [];
    for (const entry of entries) {
      if (entry.deviceId !== deviceId) continue;
      matched.push(entry);
      if (matched.length >= limit) break;
    }
    return matched;
  }, [entries, deviceId, limit]);
}

export function useActivityFilters(): {
  filters: ActivityFilters;
  setFilters: (filters: Partial<ActivityFilters>) => void;
} {
  return useActivityStore(
    useShallow((state) => ({ filters: state.filters, setFilters: state.setFilters })),
  );
}

export interface DashboardKpis {
  readonly statusCounts: DeviceStatusCounts;
  readonly health: HealthDistribution;
  readonly alerts: AlertCounts;
  readonly infrastructure: InfrastructureMetrics;
  readonly deviceCount: number;
}

/**
 * Every headline number the dashboard shows, in one subscription set.
 *
 * Each field comes from a store slice that only changes when the underlying
 * aggregate changes — not on every telemetry frame — so the KPI row re-renders
 * when the numbers move rather than at the ingestion rate.
 */
export function useDashboardKpis(): DashboardKpis {
  const statusCounts = useStatusCounts();
  const health = useHealthDistribution();
  const alerts = useAlertCounts();
  const infrastructure = useActivityStore((state) => state.metrics);
  const deviceCount = useDeviceStore((state) => state.devices.size);

  return { statusCounts, health, alerts, infrastructure, deviceCount };
}
