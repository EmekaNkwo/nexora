import type { DeviceStatusCounts } from "./device";

/**
 * `site` groups are physical locations, `logical` groups cut across sites
 * (e.g. "Cold Storage"), and `fleet` groups are mobile asset pools.
 */
export type GroupKind = "site" | "logical" | "fleet";

export interface DeviceGroup {
  readonly id: string;
  readonly name: string;
  readonly kind: GroupKind;
  readonly description: string;
  readonly createdAt: number;
}

/** Group metrics are always derived from current members, never stored. */
export interface GroupMetrics {
  readonly groupId: string;
  readonly deviceCount: number;
  readonly statusCounts: DeviceStatusCounts;
  readonly averageHealth: number;
  readonly averageBattery: number;
  readonly activeAlerts: number;
  readonly criticalAlerts: number;
}
