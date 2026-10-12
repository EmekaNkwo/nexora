import type { DeviceMode } from "./device";

export type CommandType =
  | "device.restart"
  | "fan.on"
  | "fan.off"
  | "telemetry.request"
  | "device.calibrate"
  | "device.set_mode"
  | "firmware.update";

export const COMMAND_TYPES: readonly CommandType[] = [
  "device.restart",
  "fan.on",
  "fan.off",
  "telemetry.request",
  "device.calibrate",
  "device.set_mode",
  "firmware.update",
] as const;

export type CommandStatus =
  | "queued"
  | "sent"
  | "acknowledged"
  | "completed"
  | "failed"
  | "timeout";

export const COMMAND_LIFECYCLE: readonly CommandStatus[] = [
  "queued",
  "sent",
  "acknowledged",
  "completed",
] as const;

export const TERMINAL_COMMAND_STATUSES: readonly CommandStatus[] = [
  "completed",
  "failed",
  "timeout",
] as const;

/** Who or what issued the command — shown in the audit trail. */
export type CommandOrigin = "operator" | "rule" | "bulk" | "firmware" | "system";

export interface CommandDescriptor {
  readonly type: CommandType;
  readonly label: string;
  readonly description: string;
  /** Destructive commands require explicit confirmation in the UI. */
  readonly destructive: boolean;
  /** Typical round-trip in ms, before jitter. */
  readonly baseLatencyMs: number;
  /** Probability the device fails to carry out the command. */
  readonly failureChance: number;
}

export const COMMAND_DESCRIPTORS: Readonly<Record<CommandType, CommandDescriptor>> = {
  "device.restart": {
    type: "device.restart",
    label: "Restart Device",
    description: "Power-cycles the device firmware. Telemetry pauses briefly.",
    destructive: true,
    baseLatencyMs: 4200,
    failureChance: 0.03,
  },
  "fan.on": {
    type: "fan.on",
    label: "Turn Fan ON",
    description: "Engages active cooling. Temperature begins to fall.",
    destructive: false,
    baseLatencyMs: 900,
    failureChance: 0.02,
  },
  "fan.off": {
    type: "fan.off",
    label: "Turn Fan OFF",
    description: "Disengages active cooling.",
    destructive: false,
    baseLatencyMs: 900,
    failureChance: 0.02,
  },
  "telemetry.request": {
    type: "telemetry.request",
    label: "Request Telemetry",
    description: "Forces an immediate out-of-band telemetry report.",
    destructive: false,
    baseLatencyMs: 650,
    failureChance: 0.01,
  },
  "device.calibrate": {
    type: "device.calibrate",
    label: "Trigger Calibration",
    description: "Recalibrates sensors. Readings settle toward baseline.",
    destructive: false,
    baseLatencyMs: 6500,
    failureChance: 0.05,
  },
  "device.set_mode": {
    type: "device.set_mode",
    label: "Change Device Mode",
    description: "Switches the device operating mode.",
    destructive: false,
    baseLatencyMs: 1100,
    failureChance: 0.02,
  },
  "firmware.update": {
    type: "firmware.update",
    label: "Update Firmware",
    description: "Starts an over-the-air firmware rollout for this device.",
    destructive: true,
    baseLatencyMs: 1500,
    failureChance: 0.0,
  },
};

export interface CommandPayload {
  readonly mode?: DeviceMode;
  readonly firmwareVersion?: string;
  readonly [key: string]: unknown;
}

export interface DeviceCommand {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly type: CommandType;
  readonly status: CommandStatus;
  readonly origin: CommandOrigin;
  readonly issuedAt: number;
  readonly sentAt?: number;
  readonly acknowledgedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
  readonly payload?: CommandPayload;
  /** Set when a rule issued the command, for traceability in the UI. */
  readonly ruleId?: string;
  /** Groups commands issued together by a bulk action. */
  readonly batchId?: string;
  /** Measured round-trip latency once the command settles. */
  readonly latencyMs?: number;
}

export interface CommandCounts {
  readonly queued: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly failed: number;
  readonly total: number;
}

export const EMPTY_COMMAND_COUNTS: CommandCounts = {
  queued: 0,
  inFlight: 0,
  completed: 0,
  failed: 0,
  total: 0,
};

/** A queued bulk operation across many devices. */
export interface BulkOperation {
  readonly id: string;
  readonly type: CommandType;
  readonly deviceIds: readonly string[];
  readonly createdAt: number;
  readonly payload?: CommandPayload;
}
