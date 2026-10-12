/**
 * Telemetry domain types.
 *
 * A telemetry *snapshot* is the set of metric values a device reported at a
 * single instant. Snapshots are the unit of transport (one socket frame per
 * device per tick) and the unit of storage (one ring-buffer slot).
 */

/** Every metric the platform can ingest. */
export type MetricKey =
  | "temperature"
  | "humidity"
  | "battery"
  | "signalStrength"
  | "powerConsumption"
  | "pressure"
  | "airQuality"
  | "motion";

export const METRIC_KEYS: readonly MetricKey[] = [
  "temperature",
  "humidity",
  "battery",
  "signalStrength",
  "powerConsumption",
  "pressure",
  "airQuality",
  "motion",
] as const;

/** Sparse map of metric values — a device only reports what its sensors have. */
export type MetricValues = Partial<Record<MetricKey, number>>;

export interface TelemetrySnapshot {
  readonly timestamp: number;
  readonly values: MetricValues;
}

/** A single device's reading, as it travels over the simulated socket. */
export interface TelemetryFrame {
  readonly deviceId: string;
  readonly timestamp: number;
  readonly values: MetricValues;
  /** Transport-level connectivity for this frame's device. */
  readonly connected: boolean;
  readonly sequence: number;
}

/** Presentation metadata for a metric, used by charts, gauges and tables. */
export interface MetricDescriptor {
  readonly key: MetricKey;
  readonly label: string;
  readonly unit: string;
  readonly decimals: number;
  /** Expected display domain. Charts widen this when data exceeds it. */
  readonly domain: readonly [number, number];
  /** Whether a higher value is better (battery, signal) or worse (temperature). */
  readonly polarity: "higher-better" | "lower-better" | "neutral";
  readonly chartColor: string;
}

export const METRIC_DESCRIPTORS: Readonly<Record<MetricKey, MetricDescriptor>> = {
  temperature: {
    key: "temperature",
    label: "Temperature",
    unit: "°C",
    decimals: 1,
    domain: [-25, 60],
    polarity: "lower-better",
    chartColor: "var(--metric-temperature)",
  },
  humidity: {
    key: "humidity",
    label: "Humidity",
    unit: "%",
    decimals: 0,
    domain: [0, 100],
    polarity: "neutral",
    chartColor: "var(--metric-humidity)",
  },
  battery: {
    key: "battery",
    label: "Battery",
    unit: "%",
    decimals: 0,
    domain: [0, 100],
    polarity: "higher-better",
    chartColor: "var(--metric-battery)",
  },
  signalStrength: {
    key: "signalStrength",
    label: "Signal",
    unit: "dBm",
    decimals: 0,
    domain: [-120, -40],
    polarity: "higher-better",
    chartColor: "var(--metric-signal)",
  },
  powerConsumption: {
    key: "powerConsumption",
    label: "Power",
    unit: "kW",
    decimals: 2,
    domain: [0, 40],
    polarity: "lower-better",
    chartColor: "var(--metric-power)",
  },
  pressure: {
    key: "pressure",
    label: "Pressure",
    unit: "hPa",
    decimals: 0,
    domain: [950, 1050],
    polarity: "neutral",
    chartColor: "var(--metric-pressure)",
  },
  airQuality: {
    key: "airQuality",
    label: "Air Quality",
    unit: "AQI",
    decimals: 0,
    domain: [0, 300],
    polarity: "lower-better",
    chartColor: "var(--metric-air)",
  },
  motion: {
    key: "motion",
    label: "Motion",
    unit: "events",
    decimals: 0,
    domain: [0, 10],
    polarity: "neutral",
    chartColor: "var(--metric-motion)",
  },
};

/** Selectable history windows. */
export type TimeRangeKey = "1H" | "6H" | "24H" | "7D" | "30D";

export interface TimeRange {
  readonly key: TimeRangeKey;
  readonly label: string;
  readonly durationMs: number;
  /** Target number of rendered points after aggregation. */
  readonly buckets: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const TIME_RANGES: Readonly<Record<TimeRangeKey, TimeRange>> = {
  "1H": { key: "1H", label: "1H", durationMs: HOUR, buckets: 120 },
  "6H": { key: "6H", label: "6H", durationMs: 6 * HOUR, buckets: 144 },
  "24H": { key: "24H", label: "24H", durationMs: DAY, buckets: 144 },
  "7D": { key: "7D", label: "7D", durationMs: 7 * DAY, buckets: 168 },
  "30D": { key: "30D", label: "30D", durationMs: 30 * DAY, buckets: 180 },
};

export const TIME_RANGE_ORDER: readonly TimeRangeKey[] = ["1H", "6H", "24H", "7D", "30D"];

/**
 * One aggregated chart point. Keeping min/max alongside the mean lets the
 * chart show an envelope so downsampling never hides a spike.
 */
export interface AggregatedPoint {
  readonly timestamp: number;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

export interface MetricSeries {
  readonly metric: MetricKey;
  readonly deviceId: string;
  readonly range: TimeRangeKey;
  readonly points: readonly AggregatedPoint[];
}

export interface MetricStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly last: number;
  readonly stdDev: number;
  readonly count: number;
  /** Signed change between the first and last sample in the window. */
  readonly delta: number;
}
