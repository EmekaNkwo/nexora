import type { NexoraEventName } from "./events";

export type ActivityKind =
  | "telemetry"
  | "connectivity"
  | "status"
  | "alert"
  | "rule"
  | "command"
  | "firmware"
  | "provisioning"
  | "simulation"
  | "system";

export type ActivitySeverity = "info" | "warning" | "critical" | "success";

export interface ActivityEntry {
  readonly id: string;
  readonly at: number;
  readonly kind: ActivityKind;
  readonly severity: ActivitySeverity;
  /** Short subject, e.g. a device id or rule name. */
  readonly subject: string;
  readonly message: string;
  readonly deviceId?: string;
  readonly ruleId?: string;
  readonly alertId?: string;
  /** Originating event, so the dev panel can correlate feed ↔ bus. */
  readonly sourceEvent: NexoraEventName;
}

export interface ActivityFilters {
  readonly kinds: readonly ActivityKind[];
  readonly deviceId?: string;
  readonly search: string;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  kinds: [],
  search: "",
};

/** Rolling infrastructure KPIs computed from the event stream. */
export interface InfrastructureMetrics {
  readonly messagesPerSecond: number;
  readonly averageLatencyMs: number;
  readonly totalTelemetryEvents: number;
  readonly ingestionBytesPerSecond: number;
  readonly eventsProcessed: number;
  readonly socketConnected: boolean;
  readonly droppedFrames: number;
}

export const EMPTY_INFRASTRUCTURE_METRICS: InfrastructureMetrics = {
  messagesPerSecond: 0,
  averageLatencyMs: 0,
  totalTelemetryEvents: 0,
  ingestionBytesPerSecond: 0,
  eventsProcessed: 0,
  socketConnected: false,
  droppedFrames: 0,
};
