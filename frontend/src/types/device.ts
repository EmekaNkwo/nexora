import type { MetricKey, MetricValues, TelemetrySnapshot } from "./telemetry";

export type DeviceStatus =
  | "online"
  | "offline"
  | "warning"
  | "critical"
  | "maintenance"
  | "updating";

export const DEVICE_STATUSES: readonly DeviceStatus[] = [
  "online",
  "offline",
  "warning",
  "critical",
  "maintenance",
  "updating",
] as const;

/**
 * Statuses that represent a device actively reporting. `warning` and
 * `critical` devices are still connected — they are online *with* a problem.
 */
export const CONNECTED_STATUSES: readonly DeviceStatus[] = [
  "online",
  "warning",
  "critical",
  "updating",
] as const;

export type DeviceType =
  | "temperature-sensor"
  | "humidity-sensor"
  | "gps-tracker"
  | "smart-meter"
  | "industrial-gateway"
  | "cold-storage-sensor"
  | "vehicle-tracker"
  | "motion-sensor"
  | "air-quality-sensor"
  | "energy-monitor";

export const DEVICE_TYPES: readonly DeviceType[] = [
  "temperature-sensor",
  "humidity-sensor",
  "gps-tracker",
  "smart-meter",
  "industrial-gateway",
  "cold-storage-sensor",
  "vehicle-tracker",
  "motion-sensor",
  "air-quality-sensor",
  "energy-monitor",
] as const;

export interface DeviceTypeDescriptor {
  readonly type: DeviceType;
  readonly label: string;
  readonly shortLabel: string;
  /** Metrics this device class reports. Drives table columns and charts. */
  readonly metrics: readonly MetricKey[];
  /** The metric most worth showing as this type's headline value. */
  readonly primaryMetric: MetricKey;
  readonly models: readonly string[];
  /** Whether the device physically moves (affects location simulation). */
  readonly mobile: boolean;
  /** Mains-powered devices do not drain a battery. */
  readonly mainsPowered: boolean;
}

export const DEVICE_TYPE_DESCRIPTORS: Readonly<
  Record<DeviceType, DeviceTypeDescriptor>
> = {
  "temperature-sensor": {
    type: "temperature-sensor",
    label: "Temperature Sensor",
    shortLabel: "Temp",
    metrics: ["temperature", "humidity", "battery", "signalStrength"],
    primaryMetric: "temperature",
    models: ["NX-T100", "NX-T220", "ThermoLink 3"],
    mobile: false,
    mainsPowered: false,
  },
  "humidity-sensor": {
    type: "humidity-sensor",
    label: "Humidity Sensor",
    shortLabel: "Humidity",
    metrics: ["humidity", "temperature", "battery", "signalStrength"],
    primaryMetric: "humidity",
    models: ["NX-H80", "HygroSense 2"],
    mobile: false,
    mainsPowered: false,
  },
  "gps-tracker": {
    type: "gps-tracker",
    label: "GPS Tracker",
    shortLabel: "GPS",
    metrics: ["battery", "signalStrength", "temperature"],
    primaryMetric: "battery",
    models: ["NX-GPS4", "TrackPoint Mini"],
    mobile: true,
    mainsPowered: false,
  },
  "smart-meter": {
    type: "smart-meter",
    label: "Smart Meter",
    shortLabel: "Meter",
    metrics: ["powerConsumption", "temperature", "signalStrength"],
    primaryMetric: "powerConsumption",
    models: ["NX-M500", "GridSense E2"],
    mobile: false,
    mainsPowered: true,
  },
  "industrial-gateway": {
    type: "industrial-gateway",
    label: "Industrial Gateway",
    shortLabel: "Gateway",
    metrics: ["temperature", "powerConsumption", "signalStrength", "pressure"],
    primaryMetric: "temperature",
    models: ["NX-GW900", "NX-GW910", "EdgeCore X"],
    mobile: false,
    mainsPowered: true,
  },
  "cold-storage-sensor": {
    type: "cold-storage-sensor",
    label: "Cold Storage Sensor",
    shortLabel: "Cold Chain",
    metrics: ["temperature", "humidity", "battery", "signalStrength"],
    primaryMetric: "temperature",
    models: ["NX-CS40", "CryoWatch 5"],
    mobile: false,
    mainsPowered: false,
  },
  "vehicle-tracker": {
    type: "vehicle-tracker",
    label: "Vehicle Tracker",
    shortLabel: "Vehicle",
    metrics: ["battery", "signalStrength", "temperature", "powerConsumption"],
    primaryMetric: "battery",
    models: ["NX-VT7", "FleetBeacon Pro"],
    mobile: true,
    mainsPowered: false,
  },
  "motion-sensor": {
    type: "motion-sensor",
    label: "Motion Sensor",
    shortLabel: "Motion",
    metrics: ["motion", "battery", "signalStrength", "temperature"],
    primaryMetric: "motion",
    models: ["NX-PIR2", "MoveGuard 1"],
    mobile: false,
    mainsPowered: false,
  },
  "air-quality-sensor": {
    type: "air-quality-sensor",
    label: "Air Quality Sensor",
    shortLabel: "Air",
    metrics: ["airQuality", "temperature", "humidity", "battery", "signalStrength"],
    primaryMetric: "airQuality",
    models: ["NX-AQ30", "AeroSense 4"],
    mobile: false,
    mainsPowered: false,
  },
  "energy-monitor": {
    type: "energy-monitor",
    label: "Energy Monitor",
    shortLabel: "Energy",
    metrics: ["powerConsumption", "temperature", "signalStrength"],
    primaryMetric: "powerConsumption",
    models: ["NX-E200", "WattWatch 3"],
    mobile: false,
    mainsPowered: true,
  },
};

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface DeviceLocation extends GeoPoint {
  /** Human-readable site name, e.g. "Lagos Cold Storage". */
  readonly site: string;
  readonly city: string;
  readonly region: string;
}

/** Actuator state the platform can drive via commands. */
export interface DeviceActuators {
  readonly fan: boolean;
  readonly calibrating: boolean;
}

export type DeviceMode = "normal" | "eco" | "diagnostic" | "safe";

export interface Device {
  readonly id: string;
  readonly name: string;
  readonly type: DeviceType;
  readonly model: string;
  readonly status: DeviceStatus;
  readonly location: DeviceLocation;
  readonly groupId: string;
  readonly telemetry: TelemetrySnapshot;
  readonly battery: number;
  readonly signalStrength: number;
  readonly firmwareVersion: string;
  readonly lastSeen: number;
  readonly healthScore: number;
  readonly createdAt: number;
  readonly mode: DeviceMode;
  readonly actuators: DeviceActuators;
  /** Errors observed since provisioning — feeds the health score. */
  readonly errorCount: number;
  readonly messageCount: number;
  readonly tags: readonly string[];
  /** True when this device was seeded as intentionally faulty. */
  readonly faulty: boolean;
}

/** Partial device update produced by the simulation pipeline. */
export interface DevicePatch {
  readonly id: string;
  readonly status?: DeviceStatus;
  readonly telemetry?: TelemetrySnapshot;
  readonly battery?: number;
  readonly signalStrength?: number;
  readonly lastSeen?: number;
  readonly healthScore?: number;
  readonly location?: DeviceLocation;
  readonly firmwareVersion?: string;
  readonly mode?: DeviceMode;
  readonly actuators?: DeviceActuators;
  readonly errorCount?: number;
  readonly messageCount?: number;
}

export interface DeviceStatusCounts {
  readonly online: number;
  readonly offline: number;
  readonly warning: number;
  readonly critical: number;
  readonly maintenance: number;
  readonly updating: number;
  readonly total: number;
}

export const EMPTY_STATUS_COUNTS: DeviceStatusCounts = {
  online: 0,
  offline: 0,
  warning: 0,
  critical: 0,
  maintenance: 0,
  updating: 0,
  total: 0,
};

export interface HealthDistribution {
  readonly healthy: number;
  readonly degraded: number;
  readonly critical: number;
  readonly total: number;
  /** Fleet-average health score, 0-100. */
  readonly average: number;
}

/** Inputs to the health score calculation — kept separate so it stays pure. */
export interface HealthInputs {
  readonly status: DeviceStatus;
  readonly battery: number;
  readonly signalStrength: number;
  readonly mainsPowered: boolean;
  /** Coefficient of variation of the primary metric, 0 = perfectly stable. */
  readonly telemetryInstability: number;
  readonly errorCount: number;
  readonly messageCount: number;
  readonly activeAlerts: number;
  readonly criticalAlerts: number;
  readonly msSinceLastSeen: number;
}

export interface HealthBreakdown {
  readonly score: number;
  readonly factors: readonly HealthFactor[];
}

export interface HealthFactor {
  readonly label: string;
  /** Points lost (negative) for this factor. */
  readonly penalty: number;
  readonly detail: string;
}

export type DeviceSortKey =
  | "name"
  | "type"
  | "site"
  | "status"
  | "primaryMetric"
  | "battery"
  | "signalStrength"
  | "lastSeen"
  | "healthScore";

export type SortDirection = "asc" | "desc";

export interface DeviceFilters {
  readonly search: string;
  readonly statuses: readonly DeviceStatus[];
  readonly types: readonly DeviceType[];
  readonly groupIds: readonly string[];
  /** Inclusive health score bounds. */
  readonly healthRange: readonly [number, number];
  readonly onlyWithActiveAlerts: boolean;
}

export const DEFAULT_DEVICE_FILTERS: DeviceFilters = {
  search: "",
  statuses: [],
  types: [],
  groupIds: [],
  healthRange: [0, 100],
  onlyWithActiveAlerts: false,
};

/** Describes a request to add a device through the provisioning flow. */
export interface ProvisionRequest {
  readonly id: string;
  readonly name: string;
  readonly type: DeviceType;
  readonly model: string;
  readonly groupId: string;
  readonly firmwareVersion: string;
  readonly location: DeviceLocation;
}

export type ProvisionStage =
  | "registering"
  | "authenticating"
  | "configuring"
  | "connecting"
  | "online"
  | "failed";

export const PROVISION_STAGES: readonly ProvisionStage[] = [
  "registering",
  "authenticating",
  "configuring",
  "connecting",
  "online",
] as const;

export interface ProvisionJob {
  readonly id: string;
  readonly request: ProvisionRequest;
  readonly stage: ProvisionStage;
  readonly startedAt: number;
  readonly error?: string;
}

/** Latest-value view used by table rows and map markers. */
export interface DeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly type: DeviceType;
  readonly status: DeviceStatus;
  readonly site: string;
  readonly groupId: string;
  readonly healthScore: number;
  readonly battery: number;
  readonly signalStrength: number;
  readonly lastSeen: number;
  readonly firmwareVersion: string;
  readonly primaryMetric: MetricKey;
  readonly primaryValue: number | undefined;
  readonly values: MetricValues;
  readonly location: DeviceLocation;
}
