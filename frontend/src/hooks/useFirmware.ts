"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  FIRMWARE_CATALOGUE,
  isOutdated,
  latestVersion,
} from "@/services/firmware/firmwareService";
import {
  cancelFirmwareRollout,
  startFirmwareRollout,
} from "@/services/platform/platform";
import { useDeviceStore } from "@/stores/deviceStore";
import {
  computeAdoption,
  selectRolloutProgress,
  useFirmwareStore,
} from "@/stores/firmwareStore";
import { useCatalogueStore } from "@/stores/catalogueStore";
import type {
  FirmwareAdoption,
  FirmwareJob,
  FirmwareRollout,
  FirmwareRolloutProgress,
  FirmwareVersion,
} from "@/types/firmware";

export function useFirmwareCatalogue(): readonly FirmwareVersion[] {
  // Reads the store rather than the constant, so firmware the operator
  // uploaded appears everywhere the catalogue is offered.
  return useCatalogueStore((state) => state.versions);
}

export function useLatestFirmware(): FirmwareVersion {
  return latestVersion("stable");
}

export interface FirmwareOverview {
  readonly adoption: readonly FirmwareAdoption[];
  readonly outdatedDeviceIds: readonly string[];
  readonly upToDateCount: number;
  readonly targetVersion: string;
}

/**
 * Fleet-wide firmware adoption.
 *
 * Recomputed only when the device store version changes — firmware versions
 * change rarely, but this hook reads every device, so it must not re-run on
 * each telemetry batch.
 */
export function useFirmwareOverview(targetVersion?: string): FirmwareOverview {
  const { devices, order } = useDeviceStore(
    useShallow((state) => ({ devices: state.devices, order: state.order })),
  );

  const target = targetVersion ?? latestVersion("stable").version;

  return useMemo(() => {
    const versions: string[] = [];
    const outdated: string[] = [];

    for (const id of order) {
      const device = devices.get(id);
      if (!device) continue;
      versions.push(device.firmwareVersion);
      if (isOutdated(device.firmwareVersion, target)) outdated.push(device.id);
    }

    return {
      adoption: computeAdoption(versions, target),
      outdatedDeviceIds: outdated,
      upToDateCount: versions.length - outdated.length,
      targetVersion: target,
    };

  }, [devices, order, target]);
}

export function useRollouts(): readonly FirmwareRollout[] {
  return useFirmwareStore((state) => state.rollouts);
}

export function useRolloutProgress(
  rollout: FirmwareRollout,
): FirmwareRolloutProgress {
  return useFirmwareStore((state) => selectRolloutProgress(state, rollout));
}

/** Jobs belonging to one rollout, in-flight first so progress is visible. */
export function useRolloutJobs(rolloutId: string): readonly FirmwareJob[] {
  const jobs = useFirmwareStore((state) => state.jobs);
  return useMemo(() => {
    const matched = jobs.filter((job) => job.rolloutId === rolloutId);
    const rank = (job: FirmwareJob): number =>
      job.stage === "failed" ? 0 : job.stage === "completed" ? 2 : 1;
    return matched.sort((a, b) => rank(a) - rank(b));
  }, [jobs, rolloutId]);
}

export function useDeviceFirmwareJob(
  deviceId: string | null | undefined,
): FirmwareJob | undefined {
  return useFirmwareStore((state) =>
    deviceId ? state.jobByDevice.get(deviceId) : undefined,
  );
}

export interface FirmwareActions {
  readonly startRollout: (
    deviceIds: readonly string[],
    toVersion: string,
    concurrency?: number,
  ) => string;
  readonly cancelRollout: (rolloutId: string) => void;
}

export function useFirmwareActions(): FirmwareActions {
  return useMemo(
    () => ({
      startRollout: (deviceIds, toVersion, concurrency) =>
        startFirmwareRollout({ deviceIds, toVersion, concurrency }),
      cancelRollout: cancelFirmwareRollout,
    }),
    [],
  );
}
