"use client";

import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { bulkResolveAlerts, resolveAlert } from "@/services/platform/platform";
import { useAlertStore } from "@/stores/alertStore";
import type { Alert, AlertCounts, AlertFilters } from "@/types/alerts";
import { paginate, type PageResult } from "@/utils/pagination";

/** Who acknowledgements are attributed to. A real app would use the session. */
export const CURRENT_OPERATOR = "ops.engineer";

export function useAlertCounts(): AlertCounts {
  return useAlertStore((state) => state.counts);
}

export function useOpenAlerts(): readonly Alert[] {
  return useAlertStore((state) => state.open);
}

/** Open alerts for one device, newest first. */
export function useDeviceAlerts(deviceId: string | null | undefined): readonly Alert[] {
  const open = useAlertStore((state) => state.open);
  return useMemo(() => {
    if (!deviceId) return [];
    return open.filter((alert) => alert.deviceId === deviceId);
  }, [open, deviceId]);
}

export function useDeviceAlertCount(deviceId: string): number {
  return useAlertStore((state) => state.openByDevice.get(deviceId)?.length ?? 0);
}

export interface AlertListView {
  readonly alerts: readonly Alert[];
  readonly filters: AlertFilters;
  readonly filteredCount: number;
}

/**
 * The filtered alert list.
 *
 * Severity ordering is applied after filtering rather than keeping the store
 * sorted: a critical alert must appear above a warning regardless of when each
 * arrived, but the store's insertion order is still the right tiebreak.
 */
export function useAlertList(deviceId?: string): AlertListView {
  const { open, resolved, filters } = useAlertStore(
    useShallow((state) => ({
      open: state.open,
      resolved: state.resolved,
      filters: state.filters,
    })),
  );

  return useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    const severities = filters.severities.length > 0 ? new Set(filters.severities) : null;
    const statuses = filters.statuses.length > 0 ? new Set(filters.statuses) : null;
    const sources = filters.sources.length > 0 ? new Set(filters.sources) : null;
    const targetDevice = deviceId ?? filters.deviceId;

    // Only read the resolved history when the filter actually asks for it.
    const pool = statuses?.has("resolved") ? [...open, ...resolved] : open;

    const matched = pool.filter((alert) => {
      if (severities && !severities.has(alert.severity)) return false;
      if (statuses && !statuses.has(alert.status)) return false;
      if (sources && !sources.has(alert.source)) return false;
      if (targetDevice && alert.deviceId !== targetDevice) return false;
      if (needle.length > 0) {
        const haystack =
          `${alert.deviceId} ${alert.deviceName} ${alert.title} ${alert.message}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    const sorted = [...matched].sort((a, b) => {
      const rank = severityRank[a.severity] - severityRank[b.severity];
      if (rank !== 0) return rank;
      return b.createdAt - a.createdAt;
    });

    return { alerts: sorted, filters, filteredCount: sorted.length };
  }, [open, resolved, filters, deviceId]);
}

export interface AlertPageView {
  /** The current page's alerts, plus its bounds and totals. */
  readonly page: PageResult<Alert>;
  readonly pageSize: number;
  readonly filters: AlertFilters;
  /** Total matching the filters, across all pages. */
  readonly filteredCount: number;
  /** Ids of every matching alert, not just the visible page. */
  readonly matchingIds: readonly string[];
  /** Every matching alert, for actions that span pages — export, bulk triage. */
  readonly matching: readonly Alert[];
  readonly setPage: (page: number) => void;
  readonly setPageSize: (pageSize: number) => void;
}

/**
 * The paged alert list.
 *
 * Deliberately separate from `useAlertList`, which stays unpaged: the dashboard
 * summary panel reads the same query and takes the top few, and threading a
 * page index through there would couple an unrelated surface to the alerts
 * table's paging state.
 *
 * `matchingIds` is exposed so a bulk action can span the whole result set
 * rather than only the rows currently on screen.
 */
export function useAlertPage(deviceId?: string): AlertPageView {
  const { alerts, filters, filteredCount } = useAlertList(deviceId);
  const { page, pageSize, setPage, setPageSize } = useAlertStore(
    useShallow((state) => ({
      page: state.page,
      pageSize: state.pageSize,
      setPage: state.setPage,
      setPageSize: state.setPageSize,
    })),
  );

  return useMemo(
    () => ({
      page: paginate(alerts, page, pageSize),
      pageSize,
      filters,
      filteredCount,
      matchingIds: alerts.map((alert) => alert.id),
      matching: alerts,
      setPage,
      setPageSize,
    }),
    [alerts, page, pageSize, filters, filteredCount, setPage, setPageSize],
  );
}

export interface AlertActions {
  readonly acknowledge: (alertId: string) => void;
  readonly resolve: (alertId: string) => void;
  readonly snooze: (alertId: string, minutes: number) => void;
  readonly assign: (alertId: string, assignee: string) => void;
  readonly acknowledgeMany: (alertIds: readonly string[]) => void;
  readonly resolveMany: (alertIds: readonly string[]) => void;
  readonly setFilters: (filters: Partial<AlertFilters>) => void;
  readonly resetFilters: () => void;
}

/**
 * Operator actions on alerts.
 *
 * Resolution goes through the platform rather than straight to the store,
 * because the alert engine also has to forget the dedupe key — otherwise a
 * condition that is still breaching would never raise a new alert.
 */
export function useAlertActions(): AlertActions {
  const acknowledge = useAlertStore((state) => state.acknowledge);
  const snoozeAlert = useAlertStore((state) => state.snooze);
  const assign = useAlertStore((state) => state.assign);
  const bulkAcknowledge = useAlertStore((state) => state.bulkAcknowledge);
  const setFilters = useAlertStore((state) => state.setFilters);
  const resetFilters = useAlertStore((state) => state.resetFilters);

  return useMemo(
    () => ({
      acknowledge: (alertId: string) => acknowledge(alertId, CURRENT_OPERATOR),
      resolve: resolveAlert,
      snooze: (alertId: string, minutes: number) =>
        snoozeAlert(alertId, Date.now() + minutes * 60_000),
      assign,
      acknowledgeMany: (alertIds: readonly string[]) =>
        bulkAcknowledge(alertIds, CURRENT_OPERATOR),
      resolveMany: bulkResolveAlerts,
      setFilters,
      resetFilters,
    }),
    [acknowledge, snoozeAlert, assign, bulkAcknowledge, setFilters, resetFilters],
  );
}

/** Convenience for a single alert row. */
export function useAlertRowActions(alertId: string): {
  acknowledge: () => void;
  resolve: () => void;
  snooze: (minutes: number) => void;
} {
  const actions = useAlertActions();
  return {
    acknowledge: useCallback(() => actions.acknowledge(alertId), [actions, alertId]),
    resolve: useCallback(() => actions.resolve(alertId), [actions, alertId]),
    snooze: useCallback(
      (minutes: number) => actions.snooze(alertId, minutes),
      [actions, alertId],
    ),
  };
}
