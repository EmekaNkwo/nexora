"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { isDeviceInGroup } from "@/services/devices/deviceQuery";
import { ALL_GROUPS, LOGICAL_GROUPS, SITE_GROUPS } from "@/services/simulator/locations";
import { useAlertStore } from "@/stores/alertStore";
import { useDeviceStore } from "@/stores/deviceStore";
import type { DeviceStatus } from "@/types/device";
import { EMPTY_STATUS_COUNTS } from "@/types/device";
import type { DeviceGroup, GroupMetrics } from "@/types/groups";

export function useGroups(): readonly DeviceGroup[] {
  return ALL_GROUPS;
}

export function useLogicalGroups(): readonly DeviceGroup[] {
  return LOGICAL_GROUPS;
}

export function useSiteGroups(): readonly DeviceGroup[] {
  return SITE_GROUPS;
}

export function useGroup(groupId: string | null | undefined): DeviceGroup | undefined {
  return useMemo(
    () => (groupId ? ALL_GROUPS.find((group) => group.id === groupId) : undefined),
    [groupId],
  );
}

export interface GroupRollup extends GroupMetrics {
  readonly group: DeviceGroup;
  readonly deviceIds: readonly string[];
}

/**
 * Group metrics, computed from current members.
 *
 * Group totals are never stored — a group's health is whatever its devices'
 * health is right now, and caching it would guarantee it drifts out of date.
 * One pass over the fleet fills every group's tallies, so this is O(devices ×
 * groups-matched) rather than a pass per group.
 */
export function useGroupRollups(): readonly GroupRollup[] {
  // Map identity is the invalidation signal — the store never mutates in place.
  const { devices, order } = useDeviceStore(
    useShallow((state) => ({ devices: state.devices, order: state.order })),
  );
  const openByDevice = useAlertStore((state) => state.openByDevice);
  const alertsById = useAlertStore((state) => state.byId);

  return useMemo(() => {
    interface Accumulator {
      deviceIds: string[];
      counts: Record<DeviceStatus, number> & { total: number };
      healthSum: number;
      batterySum: number;
      batteryCount: number;
      activeAlerts: number;
      criticalAlerts: number;
    }

    const accumulators = new Map<string, Accumulator>();
    for (const group of ALL_GROUPS) {
      accumulators.set(group.id, {
        deviceIds: [],
        counts: { ...EMPTY_STATUS_COUNTS },
        healthSum: 0,
        batterySum: 0,
        batteryCount: 0,
        activeAlerts: 0,
        criticalAlerts: 0,
      });
    }

    for (const id of order) {
      const device = devices.get(id);
      if (!device) continue;

      const openIds = openByDevice.get(device.id);
      let critical = 0;
      for (const alertId of openIds ?? []) {
        if (alertsById.get(alertId)?.severity === "critical") critical += 1;
      }

      for (const group of ALL_GROUPS) {
        if (!isDeviceInGroup(device, group)) continue;
        const accumulator = accumulators.get(group.id)!;
        accumulator.deviceIds.push(device.id);
        accumulator.counts[device.status] += 1;
        accumulator.counts.total += 1;
        accumulator.healthSum += device.healthScore;
        // Mains-powered devices report 100 and would skew the group average.
        if (device.battery < 100) {
          accumulator.batterySum += device.battery;
          accumulator.batteryCount += 1;
        }
        accumulator.activeAlerts += openIds?.length ?? 0;
        accumulator.criticalAlerts += critical;
      }
    }

    return ALL_GROUPS.map((group) => {
      const accumulator = accumulators.get(group.id)!;
      const count = accumulator.counts.total;
      return {
        group,
        groupId: group.id,
        deviceIds: accumulator.deviceIds,
        deviceCount: count,
        statusCounts: accumulator.counts,
        averageHealth: count === 0 ? 0 : Math.round(accumulator.healthSum / count),
        averageBattery:
          accumulator.batteryCount === 0
            ? 100
            : Math.round(accumulator.batterySum / accumulator.batteryCount),
        activeAlerts: accumulator.activeAlerts,
        criticalAlerts: accumulator.criticalAlerts,
      };
    }).sort((a, b) => b.deviceCount - a.deviceCount);

  }, [devices, order, openByDevice, alertsById]);
}

export function useGroupRollup(groupId: string): GroupRollup | undefined {
  const rollups = useGroupRollups();
  return useMemo(
    () => rollups.find((rollup) => rollup.group.id === groupId),
    [rollups, groupId],
  );
}

/** Group name lookup for table cells and labels. */
export function useGroupNames(): ReadonlyMap<string, string> {
  return useMemo(
    () => new Map(ALL_GROUPS.map((group) => [group.id, group.name])),
    [],
  );
}
