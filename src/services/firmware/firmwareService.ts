import { EventBus, eventBus as defaultBus } from "@/services/events/eventBus";
import type {
  FirmwareJob,
  FirmwareRollout,
  FirmwareStage,
  FirmwareVersion,
} from "@/types/firmware";
import { createJobId, createRolloutId } from "@/utils/ids";
import { clamp, createRng, type Rng } from "@/utils/random";

/** Firmware catalogue. Newest last, which `latestVersion` relies on. */
export const FIRMWARE_CATALOGUE: readonly FirmwareVersion[] = [
  {
    version: "v2.1.4",
    releasedAt: Date.UTC(2025, 2, 11),
    channel: "stable",
    notes: ["Baseline LTS release", "MQTT keep-alive fixes"],
    sizeMb: 6.2,
  },
  {
    version: "v2.2.0",
    releasedAt: Date.UTC(2025, 5, 4),
    channel: "stable",
    notes: ["Lower idle power draw", "Improved signal reacquisition"],
    sizeMb: 6.8,
  },
  {
    version: "v2.3.1",
    releasedAt: Date.UTC(2025, 8, 22),
    channel: "stable",
    notes: ["Sensor drift compensation", "Faster cold boot"],
    sizeMb: 7.1,
  },
  {
    version: "v2.3.4",
    releasedAt: Date.UTC(2025, 11, 2),
    channel: "stable",
    notes: ["Security patch for provisioning handshake", "Battery gauge accuracy"],
    sizeMb: 7.3,
  },
  {
    version: "v2.4.0",
    releasedAt: Date.UTC(2026, 1, 18),
    channel: "beta",
    notes: [
      "Adaptive sampling reduces uplink volume by ~30%",
      "On-device threshold evaluation",
      "New calibration routine",
    ],
    sizeMb: 8.4,
  },
];

export function latestVersion(channel?: "stable" | "beta"): FirmwareVersion {
  const candidates = channel
    ? FIRMWARE_CATALOGUE.filter((entry) => entry.channel === channel)
    : FIRMWARE_CATALOGUE;
  return candidates[candidates.length - 1] ?? FIRMWARE_CATALOGUE[0]!;
}

/** Semver-ish comparison across the `vX.Y.Z` strings used here. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isOutdated(version: string, target = latestVersion("stable").version): boolean {
  return compareVersions(version, target) < 0;
}

/** Stage weights, so the overall progress bar advances at a believable pace. */
const STAGE_WEIGHTS: Readonly<Record<FirmwareStage, number>> = {
  pending: 0,
  downloading: 0.6,
  installing: 0.3,
  rebooting: 0.1,
  completed: 0,
  failed: 0,
};

const STAGE_ORDER: readonly FirmwareStage[] = [
  "downloading",
  "installing",
  "rebooting",
  "completed",
];

export interface FirmwareServiceOptions {
  readonly bus?: EventBus;
  readonly seed?: number;
  readonly now?: () => number;
  readonly onJobUpdate: (job: FirmwareJob) => void;
  readonly onRolloutUpdate: (rollout: FirmwareRollout) => void;
  /** Puts the device into/out of the `updating` lifecycle status. */
  readonly setDeviceUpdating: (deviceId: string, updating: boolean) => void;
  /** Commits the new version to the device record on success. */
  readonly applyVersion: (deviceId: string, version: string) => void;
  /** Suppresses telemetry while the device installs and reboots. */
  readonly muteDevice: (deviceId: string, durationMs: number) => void;
  readonly resolveName: (deviceId: string) => string;
  readonly resolveVersion: (deviceId: string) => string;
  /** Probability a given device's update fails. */
  readonly failureChance?: number;
}

/**
 * Over-the-air firmware rollouts.
 *
 * Rollouts are *windowed*, not parallel: real fleets do not update 2,000
 * devices at once, both because the uplink cannot carry it and because an
 * operator wants a chance to abort after the first failures. A rollout here
 * keeps `concurrency` jobs in flight and admits the next device as each one
 * finishes, which is also what makes the progress UI interesting — you watch a
 * queue drain rather than a single bar fill.
 *
 * Devices enter the `updating` status for the duration and go quiet while they
 * install and reboot, so the dashboard reflects an update the way it would in
 * production.
 */
export class FirmwareService {
  private readonly bus: EventBus;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly options: FirmwareServiceOptions;
  private readonly rollouts = new Map<string, FirmwareRollout>();
  private readonly jobs = new Map<string, FirmwareJob>();
  /** rolloutId → device ids not yet started. */
  private readonly queues = new Map<string, string[]>();
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly failureChance: number;

  constructor(options: FirmwareServiceOptions) {
    this.options = options;
    this.bus = options.bus ?? defaultBus;
    this.rng = createRng(options.seed ?? 0xf1dd);
    this.now = options.now ?? (() => Date.now());
    this.failureChance = options.failureChance ?? 0.04;
  }

  get activeRollouts(): readonly FirmwareRollout[] {
    return [...this.rollouts.values()].filter((rollout) => !rollout.finishedAt);
  }

  startRollout(input: {
    readonly deviceIds: readonly string[];
    readonly toVersion: string;
    readonly concurrency?: number;
  }): FirmwareRollout {
    const rollout: FirmwareRollout = {
      id: createRolloutId(),
      toVersion: input.toVersion,
      deviceIds: [...input.deviceIds],
      createdAt: this.now(),
      concurrency: input.concurrency ?? 8,
      cancelled: false,
    };

    this.rollouts.set(rollout.id, rollout);
    this.queues.set(rollout.id, [...input.deviceIds]);
    this.options.onRolloutUpdate(rollout);
    this.admitNext(rollout.id);
    return rollout;
  }

  cancelRollout(rolloutId: string): void {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) return;
    // Jobs already in flight finish; only the queue is dropped.
    this.queues.set(rolloutId, []);
    const cancelled: FirmwareRollout = { ...rollout, cancelled: true };
    this.rollouts.set(rolloutId, cancelled);
    this.options.onRolloutUpdate(cancelled);
    this.settleRolloutIfDone(rolloutId);
  }

  /** Forces the next in-flight job of a rollout to fail — failure injection. */
  failNextJob(rolloutId?: string): string | null {
    for (const job of this.jobs.values()) {
      if (job.stage === "completed" || job.stage === "failed") continue;
      if (rolloutId && job.rolloutId !== rolloutId) continue;
      this.failJob(job, "Injected firmware failure: image verification failed");
      return job.deviceId;
    }
    return null;
  }

  destroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.jobs.clear();
    this.rollouts.clear();
    this.queues.clear();
  }

  private admitNext(rolloutId: string): void {
    const rollout = this.rollouts.get(rolloutId);
    const queue = this.queues.get(rolloutId);
    if (!rollout || !queue) return;

    const inFlight = [...this.jobs.values()].filter(
      (job) =>
        job.rolloutId === rolloutId &&
        job.stage !== "completed" &&
        job.stage !== "failed",
    ).length;

    let admitted = inFlight;
    while (admitted < rollout.concurrency && queue.length > 0) {
      const deviceId = queue.shift()!;
      this.startJob(rollout, deviceId);
      admitted += 1;
    }

    this.settleRolloutIfDone(rolloutId);
  }

  private startJob(rollout: FirmwareRollout, deviceId: string): void {
    const fromVersion = this.options.resolveVersion(deviceId);
    const job: FirmwareJob = {
      id: createJobId(),
      rolloutId: rollout.id,
      deviceId,
      deviceName: this.options.resolveName(deviceId),
      fromVersion,
      toVersion: rollout.toVersion,
      stage: "downloading",
      stageProgress: 0,
      progress: 0,
      startedAt: this.now(),
    };

    this.jobs.set(job.id, job);
    this.options.setDeviceUpdating(deviceId, true);
    this.publish(job);
    this.runJob(job.id);
  }

  /**
   * Drives one job through its stages on a 250 ms interval. Stage durations
   * are randomised per device so a rollout shows a realistic spread rather
   * than every bar moving in lockstep.
   */
  private runJob(jobId: string): void {
    const durations: Record<"downloading" | "installing" | "rebooting", number> = {
      downloading: this.rng.range(3200, 8200),
      installing: this.rng.range(2600, 5400),
      rebooting: this.rng.range(1800, 3600),
    };
    const willFail = this.rng.chance(this.failureChance);
    const failAt = willFail ? this.rng.pick(["downloading", "installing"] as const) : null;
    const failAtProgress = this.rng.range(0.3, 0.9);

    const stepMs = 250;
    let elapsedInStage = 0;

    const timer = setInterval(() => {
      const current = this.jobs.get(jobId);
      if (!current || current.stage === "completed" || current.stage === "failed") {
        clearInterval(timer);
        this.timers.delete(timer);
        return;
      }

      const stage = current.stage as "downloading" | "installing" | "rebooting";
      elapsedInStage += stepMs;
      const stageProgress = clamp(elapsedInStage / durations[stage], 0, 1);

      if (failAt === stage && stageProgress >= failAtProgress) {
        clearInterval(timer);
        this.timers.delete(timer);
        this.failJob(current, `Update failed during ${stage}`);
        return;
      }

      if (stageProgress >= 1) {
        const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1] ?? "completed";
        elapsedInStage = 0;

        if (nextStage === "completed") {
          clearInterval(timer);
          this.timers.delete(timer);
          this.completeJob(current);
          return;
        }

        if (nextStage === "rebooting") {
          // The device genuinely goes dark while it reboots.
          this.options.muteDevice(current.deviceId, durations.rebooting + 600);
        }

        const advanced: FirmwareJob = {
          ...current,
          stage: nextStage,
          stageProgress: 0,
          progress: overallProgress(nextStage, 0),
        };
        this.jobs.set(jobId, advanced);
        this.publish(advanced);
        return;
      }

      const updated: FirmwareJob = {
        ...current,
        stageProgress,
        progress: overallProgress(stage, stageProgress),
      };
      this.jobs.set(jobId, updated);
      this.publish(updated);
    }, stepMs);

    this.timers.add(timer);
  }

  private completeJob(job: FirmwareJob): void {
    const at = this.now();
    const completed: FirmwareJob = {
      ...job,
      stage: "completed",
      stageProgress: 1,
      progress: 1,
      finishedAt: at,
    };
    this.jobs.set(job.id, completed);
    this.options.applyVersion(job.deviceId, job.toVersion);
    this.options.setDeviceUpdating(job.deviceId, false);
    this.publish(completed);
    this.bus.emit("device.firmware.updated", {
      deviceId: job.deviceId,
      version: job.toVersion,
      at,
    });
    this.admitNext(job.rolloutId);
  }

  private failJob(job: FirmwareJob, error: string): void {
    const at = this.now();
    const failed: FirmwareJob = {
      ...job,
      stage: "failed",
      finishedAt: at,
      error,
    };
    this.jobs.set(job.id, failed);
    // A failed update leaves the device on its old firmware, not updating.
    this.options.setDeviceUpdating(job.deviceId, false);
    this.publish(failed);
    this.bus.emit("device.firmware.failed", { deviceId: job.deviceId, error, at });
    this.admitNext(job.rolloutId);
  }

  private settleRolloutIfDone(rolloutId: string): void {
    const rollout = this.rollouts.get(rolloutId);
    const queue = this.queues.get(rolloutId);
    if (!rollout || rollout.finishedAt) return;
    if (queue && queue.length > 0) return;

    const stillRunning = [...this.jobs.values()].some(
      (job) =>
        job.rolloutId === rolloutId &&
        job.stage !== "completed" &&
        job.stage !== "failed",
    );
    if (stillRunning) return;

    const finished: FirmwareRollout = { ...rollout, finishedAt: this.now() };
    this.rollouts.set(rolloutId, finished);
    this.options.onRolloutUpdate(finished);
  }

  private publish(job: FirmwareJob): void {
    this.options.onJobUpdate(job);
    this.bus.emit("device.firmware.progress", { job });
  }
}

/** Weighted progress across all stages. */
export function overallProgress(stage: FirmwareStage, stageProgress: number): number {
  let total = 0;
  for (const candidate of STAGE_ORDER) {
    if (candidate === stage) {
      total += STAGE_WEIGHTS[candidate] * stageProgress;
      break;
    }
    total += STAGE_WEIGHTS[candidate];
  }
  return clamp(total, 0, 1);
}
