"use client";

import { useMemo } from "react";

import { simulationEngine, type DeviceRuntimeInfo } from "@/services/simulator/simulationEngine";
import { telemetryRepository } from "@/services/telemetry/telemetryRepository";
import { useAlertStore } from "@/stores/alertStore";
import { useCoarseNow } from "@/hooks/useClock";
import { useDevice } from "@/hooks/useDevices";
import { useTelemetryRevisionSignal } from "@/hooks/useTelemetry";
import type { HealthBreakdown } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { calculateHealth } from "@/utils/calculations/health";
import { coefficientOfVariation } from "@/utils/calculations/stats";

/**
 * The explained health score for one device.
 *
 * The device record already carries a `healthScore` — this hook recomputes the
 * same number *with its breakdown*, so the device page can show which factors
 * cost the device points. Recomputing rather than storing the breakdown keeps
 * the hot path cheap: the ingestion pipeline only needs the number, and the
 * explanation is built lazily for the one device being looked at.
 */
export function useDeviceHealthBreakdown(
  deviceId: string | null | undefined,
): HealthBreakdown | null {
  const device = useDevice(deviceId);
  const revision = useTelemetryRevisionSignal();
  // The reporting-gap penalty needs the current time; reading it from the
  // shared clock keeps the render pure and re-evaluates the score every 5 s.
  const now = useCoarseNow(5000);
  const openIds = useAlertStore((state) =>
    deviceId ? state.openByDevice.get(deviceId) : undefined,
  );
  const alertsById = useAlertStore((state) => state.byId);

  return useMemo(() => {
    void revision;
    if (!device) return null;

    const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
    const stats = telemetryRepository.getStats(device.id, descriptor.primaryMetric);

    let criticalAlerts = 0;
    for (const id of openIds ?? []) {
      if (alertsById.get(id)?.severity === "critical") criticalAlerts += 1;
    }

    return calculateHealth({
      status: device.status,
      battery: device.battery,
      signalStrength: device.signalStrength,
      mainsPowered: descriptor.mainsPowered,
      telemetryInstability: coefficientOfVariation(stats),
      errorCount: device.errorCount,
      messageCount: Math.max(device.messageCount, 1),
      activeAlerts: openIds?.length ?? 0,
      criticalAlerts,
      msSinceLastSeen: now === 0 ? 0 : now - device.lastSeen,
    });
  }, [device, openIds, alertsById, revision, now]);
}

/**
 * Live physical state straight from the simulator — fan, calibration, fault.
 *
 * This is the one place the UI reads the simulator directly. It is deliberate:
 * actuator state is not domain data that belongs in a store, it is a property
 * of the simulated device, and the device page wants to show it.
 */
export function useDeviceRuntime(
  deviceId: string | null | undefined,
): DeviceRuntimeInfo | null {
  const revision = useTelemetryRevisionSignal();

  return useMemo(() => {
    // `revision` is the signal that the simulator has advanced.
    void revision;
    if (!deviceId) return null;
    return simulationEngine.getRuntime(deviceId) ?? null;
  }, [deviceId, revision]);
}

/** Model metadata (site, profile, metrics) for the device page's detail panel. */
export function useDeviceModel(deviceId: string | null | undefined) {
  return useMemo(() => {
    if (!deviceId) return null;
    return simulationEngine.getModel(deviceId) ?? null;
  }, [deviceId]);
}
