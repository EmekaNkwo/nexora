import { create } from "zustand";

import type {
  FirmwareAdoption,
  FirmwareJob,
  FirmwareRollout,
  FirmwareRolloutProgress,
} from "@/types/firmware";
import { isOutdated } from "@/services/firmware/firmwareService";

export interface FirmwareStoreState {
  readonly rollouts: readonly FirmwareRollout[];
  readonly jobs: readonly FirmwareJob[];
  readonly jobsById: ReadonlyMap<string, FirmwareJob>;
  /** deviceId → its most recent job, for the device page badge. */
  readonly jobByDevice: ReadonlyMap<string, FirmwareJob>;
  readonly version: number;

  ingestJob: (job: FirmwareJob) => void;
  ingestRollout: (rollout: FirmwareRollout) => void;
  clear: () => void;
}

export const useFirmwareStore = create<FirmwareStoreState>((set, get) => ({
  rollouts: [],
  jobs: [],
  jobsById: new Map(),
  jobByDevice: new Map(),
  version: 0,

  ingestJob: (job) => {
    const state = get();
    const index = state.jobs.findIndex((entry) => entry.id === job.id);
    const jobs = index >= 0 ? [...state.jobs] : [job, ...state.jobs];
    if (index >= 0) jobs[index] = job;

    const jobsById = new Map(state.jobsById);
    jobsById.set(job.id, job);
    const jobByDevice = new Map(state.jobByDevice);
    jobByDevice.set(job.deviceId, job);

    set({ jobs, jobsById, jobByDevice, version: state.version + 1 });
  },

  ingestRollout: (rollout) => {
    const state = get();
    const index = state.rollouts.findIndex((entry) => entry.id === rollout.id);
    const rollouts = index >= 0 ? [...state.rollouts] : [rollout, ...state.rollouts];
    if (index >= 0) rollouts[index] = rollout;
    set({ rollouts, version: state.version + 1 });
  },

  clear: () =>
    set((state) => ({
      rollouts: [],
      jobs: [],
      jobsById: new Map(),
      jobByDevice: new Map(),
      version: state.version + 1,
    })),
}));

/** Rollout progress, derived from its jobs rather than stored on the rollout. */
export function selectRolloutProgress(
  state: FirmwareStoreState,
  rollout: FirmwareRollout,
): FirmwareRolloutProgress {
  let completed = 0;
  let failed = 0;
  let inFlight = 0;

  for (const job of state.jobs) {
    if (job.rolloutId !== rollout.id) continue;
    if (job.stage === "completed") completed += 1;
    else if (job.stage === "failed") failed += 1;
    else inFlight += 1;
  }

  const total = rollout.deviceIds.length;
  const settled = completed + failed;
  return {
    rolloutId: rollout.id,
    total,
    completed,
    failed,
    inFlight,
    pending: Math.max(0, total - settled - inFlight),
    progress: total === 0 ? 0 : settled / total,
  };
}

/** Firmware spread across the fleet, for the firmware overview. */
export function computeAdoption(
  versions: readonly string[],
  targetVersion: string,
): readonly FirmwareAdoption[] {
  const counts = new Map<string, number>();
  for (const version of versions) {
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }

  const total = versions.length || 1;
  return [...counts.entries()]
    .map(([version, deviceCount]) => ({
      version,
      deviceCount,
      share: deviceCount / total,
      outdated: isOutdated(version, targetVersion),
    }))
    .sort((a, b) => b.deviceCount - a.deviceCount);
}
