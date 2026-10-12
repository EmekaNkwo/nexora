import {
  SITES,
  offsetByKm,
  type SiteDescriptor,
} from "@/services/simulator/locations";
import {
  FAULTY_DEVICE_SHARE,
  FIRMWARE_VERSION_POOL,
  ambientForMetric,
  buildMetricProfile,
  type MetricProfile,
} from "@/services/simulator/profiles";
import {
  createSignalState,
  readSignal,
  stepSignal,
  type SignalState,
} from "@/services/simulator/signals";
import {
  BUILT_IN_THRESHOLD_PROFILES,
  evaluateSnapshot,
  resolveThresholds,
  worstLevel,
} from "@/services/telemetry/thresholds";
import type {
  Device,
  DeviceLocation,
  DeviceType,
  ProvisionRequest,
} from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { MetricKey, MetricValues } from "@/types/telemetry";
import { calculateHealthScore } from "@/utils/calculations/health";
import { deriveStatus } from "@/utils/calculations/status";
import { createRng, deriveSeed, type Rng } from "@/utils/random";

/**
 * Per-device simulation state.
 *
 * This object is **deliberately mutable**, which is the one place the codebase
 * departs from its immutable-data default. At 5,000 devices and 10 Hz the
 * simulator would otherwise allocate tens of thousands of objects per second
 * purely to be discarded. The boundary is strict: everything that leaves the
 * simulator — telemetry frames, device patches, events — is frozen-by-contract
 * immutable data, and nothing outside `services/simulator` ever sees this type.
 */
export interface DeviceSimState {
  readonly deviceId: string;
  readonly site: SiteDescriptor;
  readonly type: DeviceType;
  readonly profile: MetricProfile;
  readonly metrics: readonly MetricKey[];
  readonly rng: Rng;
  signals: Partial<Record<MetricKey, SignalState>>;
  /** Transport-level connectivity, independent of displayed status. */
  connected: boolean;
  /** While set in the future, the device stays offline. */
  offlineUntil: number;
  /** Seeded as faulty — raises spike rates and enables escalation. */
  readonly faulty: boolean;
  /** A fault episode is currently escalating. */
  faultActive: boolean;
  faultUntil: number;
  /** Cooling actuation while a fan runs, in units/second. */
  coolingUntil: number;
  calibratingUntil: number;
  /** Suppresses telemetry while restarting or updating firmware. */
  mutedUntil: number;
  sequence: number;
  lastStepAt: number;
  lat: number;
  lng: number;
  /** Heading in degrees and speed in km/h, for mobile assets. */
  heading: number;
  speedKmh: number;
  readonly mobile: boolean;
  messageCount: number;
  errorCount: number;
}

export interface GeneratedFleet {
  readonly devices: readonly Device[];
  readonly states: Map<string, DeviceSimState>;
}

/** Cumulative site weights, computed once for weighted selection. */
const SITE_CUMULATIVE: readonly number[] = (() => {
  const cumulative: number[] = [];
  let running = 0;
  for (const site of SITES) {
    running += site.weight;
    cumulative.push(running);
  }
  return cumulative;
})();

const SITE_TOTAL_WEIGHT = SITE_CUMULATIVE[SITE_CUMULATIVE.length - 1] ?? 1;

function pickSite(rng: Rng): SiteDescriptor {
  const target = rng.next() * SITE_TOTAL_WEIGHT;
  for (let index = 0; index < SITE_CUMULATIVE.length; index += 1) {
    if (target < SITE_CUMULATIVE[index]!) return SITES[index]!;
  }
  return SITES[SITES.length - 1]!;
}

const CITY_CODES: Readonly<Record<string, string>> = {
  Lagos: "LAG",
  Ikeja: "IKJ",
  Rotterdam: "ROT",
  Munich: "MUC",
  Nairobi: "NBO",
  Singapore: "SIN",
  Austin: "AUS",
};

function cityCode(city: string): string {
  return CITY_CODES[city] ?? city.slice(0, 3).toUpperCase();
}

/** Primary logical group for a device type. */
const TYPE_GROUP: Readonly<Record<DeviceType, string>> = {
  "cold-storage-sensor": "grp-cold-storage",
  "vehicle-tracker": "grp-delivery-fleet",
  "gps-tracker": "grp-delivery-fleet",
  "smart-meter": "grp-energy",
  "energy-monitor": "grp-energy",
  "industrial-gateway": "grp-factory-floor",
  "motion-sensor": "grp-building",
  "air-quality-sensor": "grp-building",
  "temperature-sensor": "grp-factory-floor",
  "humidity-sensor": "grp-agriculture",
};

function resolveGroup(type: DeviceType, site: SiteDescriptor): string {
  const preferred = TYPE_GROUP[type];
  if (site.groupIds.includes(preferred)) return preferred;
  // Fall back to a group the site actually hosts, then to the site itself.
  return site.groupIds[0] ?? `grp-${site.id}`;
}

/**
 * Builds the simulation state for device `index`.
 *
 * Deterministic in `(seed, index)`: scaling the fleet from 1,000 to 5,000
 * keeps the first 1,000 devices byte-identical, so the operator does not watch
 * their whole fleet get replaced when they move a slider.
 */
function createSimState(
  index: number,
  seed: number,
  now: number,
): { state: DeviceSimState; device: Device } {
  const rng = createRng(deriveSeed(seed, `device:${index}`));
  const site = pickSite(rng);
  const type = rng.pick(site.deviceTypes);
  const descriptor = DEVICE_TYPE_DESCRIPTORS[type];
  const faulty = rng.chance(FAULTY_DEVICE_SHARE);
  const profile = buildMetricProfile(type, site, rng, faulty);
  const metrics = Object.keys(profile) as MetricKey[];

  const deviceId = `${cityCode(site.city)}-${1000 + index}`;
  const model = rng.pick(descriptor.models);

  const scatter = offsetByKm(
    site.lat,
    site.lng,
    rng.gaussian(0, site.spreadKm / 2),
    rng.gaussian(0, site.spreadKm / 2),
  );

  const signals: Partial<Record<MetricKey, SignalState>> = {};
  for (const metric of metrics) {
    const config = profile[metric];
    if (config) signals[metric] = createSignalState(config, rng);
  }

  const state: DeviceSimState = {
    deviceId,
    site,
    type,
    profile,
    metrics,
    rng,
    signals,
    connected: true,
    offlineUntil: 0,
    faulty,
    faultActive: false,
    faultUntil: 0,
    coolingUntil: 0,
    calibratingUntil: 0,
    mutedUntil: 0,
    sequence: 0,
    lastStepAt: now,
    lat: scatter.lat,
    lng: scatter.lng,
    heading: rng.range(0, 360),
    speedKmh: descriptor.mobile ? rng.range(12, 72) : 0,
    mobile: descriptor.mobile,
    messageCount: 0,
    errorCount: 0,
  };

  // A small share of the fleet starts offline or in maintenance so the
  // dashboard is not a wall of green on first paint.
  if (rng.chance(0.035)) {
    state.connected = false;
    state.offlineUntil = now + rng.range(30_000, 600_000);
  }

  // Settle the signals so devices do not all start exactly at baseline.
  for (let step = 0; step < 12; step += 1) {
    const at = now - (12 - step) * 5000;
    advanceState(state, at, 5);
  }

  const values = readValues(state);
  const location: DeviceLocation = {
    lat: state.lat,
    lng: state.lng,
    site: site.name,
    city: site.city,
    region: site.region,
  };

  const thresholds = resolveThresholds(
    { type, groupId: resolveGroup(type, site) },
    BUILT_IN_THRESHOLD_PROFILES,
  );
  const breach = worstLevel(evaluateSnapshot(values, thresholds));
  const maintenance = rng.chance(0.012);
  const status = deriveStatus({
    connected: state.connected,
    breach,
    lifecycle: maintenance ? "maintenance" : undefined,
  });

  const battery = values.battery ?? 100;
  const signalStrength = values.signalStrength ?? -70;
  const healthScore = calculateHealthScore({
    status,
    battery,
    signalStrength,
    mainsPowered: descriptor.mainsPowered,
    telemetryInstability: faulty ? 0.12 : 0.02,
    errorCount: 0,
    messageCount: 1,
    activeAlerts: 0,
    criticalAlerts: 0,
    msSinceLastSeen: 0,
  });

  const device: Device = {
    id: deviceId,
    name: `${descriptor.shortLabel} ${1000 + index}`,
    type,
    model,
    status,
    location,
    groupId: resolveGroup(type, site),
    telemetry: { timestamp: now, values },
    battery,
    signalStrength,
    firmwareVersion: rng.pick(FIRMWARE_VERSION_POOL),
    lastSeen: state.connected ? now : now - rng.range(60_000, 900_000),
    healthScore,
    createdAt: now - rng.range(7, 420) * 86_400_000,
    mode: "normal",
    actuators: { fan: false, calibrating: false },
    errorCount: 0,
    messageCount: 0,
    tags: buildTags(type, site, faulty),
    faulty,
  };

  return { state, device };
}

function buildTags(
  type: DeviceType,
  site: SiteDescriptor,
  faulty: boolean,
): readonly string[] {
  const tags = [site.region.toLowerCase().replace(/\s+/g, "-"), type];
  if (DEVICE_TYPE_DESCRIPTORS[type].mobile) tags.push("mobile");
  if (DEVICE_TYPE_DESCRIPTORS[type].mainsPowered) tags.push("mains");
  if (faulty) tags.push("needs-service");
  return tags;
}

/** Reads every metric's current reportable value. */
export function readValues(state: DeviceSimState): MetricValues {
  const values: Record<string, number> = {};
  for (const metric of state.metrics) {
    const config = state.profile[metric];
    const signal = state.signals[metric];
    if (config && signal) values[metric] = readSignal(config, signal);
  }
  return values as MetricValues;
}

/**
 * Advances every signal on a device by `dtSeconds`.
 *
 * Mutates `state.signals` in place — see the note on `DeviceSimState`.
 */
export function advanceState(
  state: DeviceSimState,
  now: number,
  dtSeconds: number,
): void {
  const cooling = state.coolingUntil > now;
  const calibrating = state.calibratingUntil > now;
  const faultActive = state.faultActive && state.faultUntil > now;

  for (const metric of state.metrics) {
    const config = state.profile[metric];
    const signal = state.signals[metric];
    if (!config || !signal) continue;

    // The fan only cools, and only *toward the set point* — a fan cannot
    // refrigerate a freezer below its thermostat target. Cooling is therefore
    // proportional to how far above baseline the device currently is, and the
    // per-step removal is capped at the excess itself so a long tick can never
    // overshoot into physically impossible territory.
    const actuation =
      cooling && metric === "temperature"
        ? coolingRate(config.baseline, signal.value, dtSeconds)
        : undefined;

    state.signals[metric] = stepSignal(config, signal, {
      dtSeconds,
      rng: state.rng,
      ambient: ambientForMetric(metric, state.site, now, config),
      actuation,
      faultActive,
      recalibrate: calibrating,
    });
  }

  if (state.mobile && state.speedKmh > 0) {
    advanceLocation(state, dtSeconds);
  }

  state.lastStepAt = now;
}

/** Cooling time constant. Higher pulls the device to set point faster. */
const COOLING_RATE_PER_SECOND = 0.09;

/**
 * Cooling actuation in units per second, or `undefined` when the device is
 * already at or below its set point.
 *
 * Two properties matter here, and getting either wrong produces visibly
 * unphysical telemetry:
 *
 * - **It is proportional to the excess above set point**, expressed as
 *   exponential decay — `excess × (1 − e^(−k·dt)) / dt`. Cooling therefore
 *   slows as the device approaches target and asymptotically stops at it. A
 *   fixed rate would sail straight through the set point and pin the device to
 *   its lower clamp, which is what a fan cannot do: it removes heat, it does
 *   not refrigerate below the thermostat.
 *
 * - **It is tick-rate independent.** Dividing the decayed amount by `dt` means
 *   a 1-second tick and a 10-second tick remove the same *fraction* of the
 *   excess per unit of simulated time.
 */
function coolingRate(
  baseline: number,
  value: number,
  dtSeconds: number,
): number | undefined {
  // Measured against the underlying process value, not the reported reading.
  // Spike and fault contributions are separate disturbances that decay on
  // their own; subtracting them here too would double-count the recovery.
  const excess = value - baseline;
  if (excess <= 0.05) return undefined;
  const dt = Math.max(dtSeconds, 0.001);
  const removed = excess * (1 - Math.exp(-COOLING_RATE_PER_SECOND * dt));
  return -(removed / dt);
}

/** Moves a mobile asset along a gently curving heading. */
function advanceLocation(state: DeviceSimState, dtSeconds: number): void {
  state.heading = (state.heading + state.rng.gaussian(0, 6) * dtSeconds * 0.1) % 360;
  const distanceKm = (state.speedKmh / 3600) * dtSeconds;
  const radians = (state.heading * Math.PI) / 180;
  const moved = offsetByKm(
    state.lat,
    state.lng,
    Math.cos(radians) * distanceKm,
    Math.sin(radians) * distanceKm,
  );

  // Keep assets within a plausible radius of their depot by steering back
  // when they stray, rather than letting trackers wander off the map.
  const driftKm = haversineKm(moved.lat, moved.lng, state.site.lat, state.site.lng);
  if (driftKm > state.site.spreadKm * 2.5) {
    state.heading = (bearingTo(moved.lat, moved.lng, state.site.lat, state.site.lng) + state.rng.range(-25, 25) + 360) % 360;
  }

  state.lat = moved.lat;
  state.lng = moved.lng;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * toRad) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Generates `count` devices. Pass `existing` when scaling up so already-live
 * devices keep their accumulated state instead of being rebuilt.
 */
export function generateFleet(
  count: number,
  seed: number,
  now: number = Date.now(),
  existing?: Map<string, DeviceSimState>,
): GeneratedFleet {
  const devices: Device[] = [];
  const states = new Map<string, DeviceSimState>();

  for (let index = 0; index < count; index += 1) {
    const { state, device } = createSimState(index, seed, now);
    const preserved = existing?.get(device.id);
    states.set(device.id, preserved ?? state);
    devices.push(device);
  }

  return { devices, states };
}

/**
 * True when a requested position is the site centre rather than a real fix.
 *
 * Tolerance is ~1 m of latitude — far below the scatter, far above float error.
 */
function isSiteCentre(
  location: { readonly lat: number; readonly lng: number },
  site: SiteDescriptor,
): boolean {
  const epsilon = 1e-5;
  return (
    Math.abs(location.lat - site.lat) < epsilon && Math.abs(location.lng - site.lng) < epsilon
  );
}

/** Builds a device and its simulation state from a provisioning request. */
export function createProvisionedDevice(
  request: ProvisionRequest,
  seed: number,
  now: number = Date.now(),
): { device: Device; state: DeviceSimState } {
  const rng = createRng(deriveSeed(seed, `provisioned:${request.id}`));
  const site =
    SITES.find((candidate) => candidate.name === request.location.site) ?? SITES[0]!;
  const descriptor = DEVICE_TYPE_DESCRIPTORS[request.type];
  const profile = buildMetricProfile(request.type, site, rng, false);
  const metrics = Object.keys(profile) as MetricKey[];

  const signals: Partial<Record<MetricKey, SignalState>> = {};
  for (const metric of metrics) {
    const config = profile[metric];
    if (config) signals[metric] = createSignalState(config, rng);
  }

  // The provisioning form asks for a site, not a coordinate, so it sends the
  // site centre. Storing that verbatim stacks every device provisioned at a
  // site on one exact point — they overlap into a single dot on the map and
  // never separate however far the operator zooms in. Scatter them the way the
  // generated fleet is scattered, but only when the request really is the site
  // centre, so a caller that does supply a coordinate keeps it.
  const placement = isSiteCentre(request.location, site)
    ? offsetByKm(
        site.lat,
        site.lng,
        rng.gaussian(0, site.spreadKm / 2),
        rng.gaussian(0, site.spreadKm / 2),
      )
    : { lat: request.location.lat, lng: request.location.lng };

  const state: DeviceSimState = {
    deviceId: request.id,
    site,
    type: request.type,
    profile,
    metrics,
    rng,
    signals,
    connected: true,
    offlineUntil: 0,
    faulty: false,
    faultActive: false,
    faultUntil: 0,
    coolingUntil: 0,
    calibratingUntil: 0,
    mutedUntil: 0,
    sequence: 0,
    lastStepAt: now,
    lat: placement.lat,
    lng: placement.lng,
    heading: rng.range(0, 360),
    speedKmh: descriptor.mobile ? rng.range(12, 72) : 0,
    mobile: descriptor.mobile,
    messageCount: 0,
    errorCount: 0,
  };

  const values = readValues(state);

  const device: Device = {
    id: request.id,
    name: request.name,
    type: request.type,
    model: request.model,
    status: "online",
    // Report the scattered position, not the requested one, so the detail page,
    // the map and the simulator all agree on where the device is.
    location: { ...request.location, lat: placement.lat, lng: placement.lng },
    groupId: request.groupId,
    telemetry: { timestamp: now, values },
    battery: values.battery ?? 100,
    signalStrength: values.signalStrength ?? -70,
    firmwareVersion: request.firmwareVersion,
    lastSeen: now,
    healthScore: 100,
    createdAt: now,
    mode: "normal",
    actuators: { fan: false, calibrating: false },
    errorCount: 0,
    messageCount: 0,
    tags: buildTags(request.type, site, false),
    faulty: false,
  };

  return { device, state };
}
