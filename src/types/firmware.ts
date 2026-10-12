export type FirmwareChannel = "stable" | "beta";

export interface FirmwareVersion {
  readonly version: string;
  readonly releasedAt: number;
  readonly channel: FirmwareChannel;
  readonly notes: readonly string[];
  /** Size in megabytes — drives the simulated download duration. */
  readonly sizeMb: number;
}

export type FirmwareStage =
  | "pending"
  | "downloading"
  | "installing"
  | "rebooting"
  | "completed"
  | "failed";

export const FIRMWARE_STAGES: readonly FirmwareStage[] = [
  "pending",
  "downloading",
  "installing",
  "rebooting",
  "completed",
] as const;

export const FIRMWARE_STAGE_LABELS: Readonly<Record<FirmwareStage, string>> = {
  pending: "Pending",
  downloading: "Downloading",
  installing: "Installing",
  rebooting: "Rebooting",
  completed: "Completed",
  failed: "Failed",
};

export interface FirmwareJob {
  readonly id: string;
  readonly rolloutId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly stage: FirmwareStage;
  /** Progress within the current stage, 0-1. */
  readonly stageProgress: number;
  /** Overall progress across all stages, 0-1. */
  readonly progress: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly error?: string;
}

export interface FirmwareRollout {
  readonly id: string;
  readonly toVersion: string;
  readonly deviceIds: readonly string[];
  readonly createdAt: number;
  readonly finishedAt?: number;
  /** How many devices update at once. */
  readonly concurrency: number;
  readonly cancelled: boolean;
}

export interface FirmwareRolloutProgress {
  readonly rolloutId: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly inFlight: number;
  readonly pending: number;
  readonly progress: number;
}

/** Firmware adoption across the fleet, for the firmware overview screen. */
export interface FirmwareAdoption {
  readonly version: string;
  readonly deviceCount: number;
  readonly share: number;
  readonly outdated: boolean;
}
