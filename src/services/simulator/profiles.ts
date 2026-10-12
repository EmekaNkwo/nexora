import {
  ambientHumidity,
  ambientTemperature,
  type SiteDescriptor,
} from "@/services/simulator/locations";
import { DEFAULT_SIGNAL_CONFIG, type SignalConfig } from "@/services/simulator/signals";
import type { DeviceType } from "@/types/device";
import type { MetricKey } from "@/types/telemetry";
import type { Rng } from "@/utils/random";

/**
 * Per-device-type behavioural profiles.
 *
 * A cold-storage sensor and an outdoor air-quality sensor both report
 * `temperature`, but they should not behave alike: one is refrigerated and
 * tightly controlled, the other tracks the weather. These profiles are what
 * make the fleet legible — you can tell what a device *is* from its chart.
 */
export type MetricProfile = Readonly<Partial<Record<MetricKey, SignalConfig>>>;

function config(overrides: Partial<SignalConfig>): SignalConfig {
  return { ...DEFAULT_SIGNAL_CONFIG, ...overrides };
}

/** Signal strength behaves the same everywhere; indoor sites are a bit worse. */
function signalConfig(baseline: number): SignalConfig {
  return config({
    baseline,
    min: -118,
    max: -38,
    meanReversion: 0.12,
    noise: 1.1,
    spikeChance: 0.004,
    spikeMagnitude: 9,
    spikeDecay: 0.55,
    decimals: 0,
    faultCeiling: -22,
    faultRampPerSecond: -0.9,
  });
}

/** Battery: monotonic discharge, no noise upward, integer percent. */
function batteryConfig(dischargePerHour: number, startLevel: number): SignalConfig {
  return config({
    baseline: startLevel,
    min: 0,
    max: 100,
    meanReversion: 0,
    noise: 0.02,
    driftPerHour: -Math.abs(dischargePerHour),
    decimals: 0,
    monotonic: "down",
    faultCeiling: -35,
    faultRampPerSecond: -2.2,
  });
}

/**
 * Builds the signal configuration for one device.
 *
 * `rng` individualises each device — two cold-storage sensors in the same
 * room should sit at 2.3°C and 2.7°C, not both at exactly 2.5°C.
 */
export function buildMetricProfile(
  type: DeviceType,
  site: SiteDescriptor,
  rng: Rng,
  faulty: boolean,
): MetricProfile {
  const indoorSignal = signalConfig(rng.gaussian(-72, 7));
  const outdoorSignal = signalConfig(rng.gaussian(-82, 9));
  const faultBoost = faulty ? 1 : 0;

  switch (type) {
    case "cold-storage-sensor": {
      // Refrigerated: narrow band, strong control loop, barely feels ambient.
      const setPoint = rng.pick([2.5, 3.0, 4.0, -18.0]);
      return {
        temperature: config({
          baseline: setPoint,
          min: setPoint - 14,
          max: setPoint + 46,
          meanReversion: 0.45,
          noise: 0.11,
          ambientCoupling: 0.035,
          spikeChance: 0.0008 + faultBoost * 0.012,
          spikeMagnitude: 1.4 + faultBoost * 4.5,
          spikeDecay: 0.6,
          decimals: 1,
          faultCeiling: 26,
          faultRampPerSecond: 0.75,
        }),
        humidity: config({
          baseline: rng.range(58, 72),
          min: 20,
          max: 100,
          meanReversion: 0.2,
          noise: 0.5,
          ambientCoupling: 0.08,
          decimals: 0,
          faultCeiling: 22,
        }),
        battery: batteryConfig(rng.range(0.35, 1.1), rng.range(62, 100)),
        signalStrength: indoorSignal,
      };
    }

    case "temperature-sensor": {
      const outdoor = site.id === "site-nairobi-agri";
      return {
        temperature: config({
          baseline: outdoor ? site.ambientMean : rng.range(19.5, 24.5),
          min: -30,
          max: 85,
          meanReversion: outdoor ? 0.05 : 0.14,
          noise: outdoor ? 0.22 : 0.1,
          ambientCoupling: outdoor ? 0.92 : 0.28,
          spikeChance: 0.0012 + faultBoost * 0.014,
          spikeMagnitude: 2.2 + faultBoost * 5.5,
          decimals: 1,
          faultCeiling: 24,
          faultRampPerSecond: 0.7,
        }),
        humidity: config({
          baseline: outdoor ? site.humidityMean : rng.range(38, 56),
          min: 5,
          max: 100,
          meanReversion: 0.1,
          noise: 0.6,
          ambientCoupling: outdoor ? 0.85 : 0.2,
          decimals: 0,
        }),
        battery: batteryConfig(rng.range(0.25, 0.85), rng.range(55, 100)),
        signalStrength: outdoor ? outdoorSignal : indoorSignal,
      };
    }

    case "humidity-sensor":
      return {
        humidity: config({
          baseline: site.humidityMean + rng.range(-8, 8),
          min: 0,
          max: 100,
          meanReversion: 0.09,
          noise: 0.75,
          ambientCoupling: 0.7,
          spikeChance: 0.001 + faultBoost * 0.01,
          spikeMagnitude: 7 + faultBoost * 14,
          decimals: 0,
          faultCeiling: 30,
        }),
        temperature: config({
          baseline: site.ambientMean,
          min: -30,
          max: 70,
          meanReversion: 0.06,
          noise: 0.16,
          ambientCoupling: 0.8,
          decimals: 1,
          faultCeiling: 16,
        }),
        battery: batteryConfig(rng.range(0.3, 0.9), rng.range(50, 100)),
        signalStrength: indoorSignal,
      };

    case "gps-tracker":
      return {
        battery: batteryConfig(rng.range(1.4, 3.2), rng.range(28, 100)),
        signalStrength: outdoorSignal,
        temperature: config({
          baseline: site.ambientMean,
          min: -30,
          max: 80,
          meanReversion: 0.05,
          noise: 0.3,
          ambientCoupling: 0.9,
          decimals: 1,
          faultCeiling: 18,
        }),
      };

    case "vehicle-tracker":
      return {
        battery: batteryConfig(rng.range(0.9, 2.4), rng.range(32, 100)),
        signalStrength: outdoorSignal,
        temperature: config({
          // Cabin temperature: warmer than ambient, engine heat included.
          baseline: site.ambientMean + rng.range(3, 9),
          min: -25,
          max: 95,
          meanReversion: 0.07,
          noise: 0.35,
          ambientCoupling: 0.62,
          spikeChance: 0.002 + faultBoost * 0.015,
          spikeMagnitude: 4 + faultBoost * 7,
          decimals: 1,
          faultCeiling: 30,
          faultRampPerSecond: 0.9,
        }),
        powerConsumption: config({
          baseline: rng.range(0.4, 1.3),
          min: 0,
          max: 6,
          meanReversion: 0.2,
          noise: 0.07,
          ambientCoupling: 0.35,
          decimals: 2,
        }),
      };

    case "smart-meter":
    case "energy-monitor": {
      const scale = type === "smart-meter" ? rng.range(4, 14) : rng.range(9, 26);
      return {
        powerConsumption: config({
          baseline: scale,
          min: 0,
          max: scale * 3.5,
          meanReversion: 0.11,
          noise: scale * 0.03,
          // Coupled to the site activity curve, so load peaks in work hours.
          ambientCoupling: 0.55,
          spikeChance: 0.003 + faultBoost * 0.01,
          spikeMagnitude: scale * 0.5,
          decimals: 2,
          faultCeiling: scale * 1.4,
        }),
        temperature: config({
          baseline: rng.range(26, 36),
          min: -10,
          max: 110,
          meanReversion: 0.1,
          noise: 0.2,
          ambientCoupling: 0.3,
          decimals: 1,
          faultCeiling: 34,
          faultRampPerSecond: 1.1,
        }),
        signalStrength: indoorSignal,
      };
    }

    case "industrial-gateway":
      return {
        temperature: config({
          // Enclosure temperature: runs hot and is a genuine failure mode.
          baseline: rng.range(31, 42),
          min: -5,
          max: 115,
          meanReversion: 0.1,
          noise: 0.3,
          ambientCoupling: 0.35,
          spikeChance: 0.002 + faultBoost * 0.016,
          spikeMagnitude: 3.5 + faultBoost * 8,
          decimals: 1,
          faultCeiling: 38,
          faultRampPerSecond: 1.2,
        }),
        powerConsumption: config({
          baseline: rng.range(1.6, 4.2),
          min: 0,
          max: 14,
          meanReversion: 0.15,
          noise: 0.1,
          ambientCoupling: 0.4,
          decimals: 2,
        }),
        pressure: config({
          baseline: rng.range(1004, 1018),
          min: 940,
          max: 1060,
          meanReversion: 0.03,
          noise: 0.18,
          decimals: 0,
          faultCeiling: -40,
        }),
        signalStrength: signalConfig(rng.gaussian(-64, 5)),
      };

    case "motion-sensor":
      return {
        motion: config({
          // Occupancy: event counts, floored at zero, driven by the activity
          // curve so corridors are busy at noon and empty at 03:00.
          baseline: rng.range(0.4, 1.6),
          min: 0,
          max: 12,
          meanReversion: 0.35,
          noise: 0.5,
          ambientCoupling: 0.75,
          spikeChance: 0.02,
          spikeMagnitude: 3,
          spikeDecay: 0.25,
          decimals: 0,
          faultCeiling: 7,
        }),
        battery: batteryConfig(rng.range(0.2, 0.7), rng.range(48, 100)),
        signalStrength: indoorSignal,
        temperature: config({
          baseline: rng.range(19, 25),
          min: -10,
          max: 60,
          meanReversion: 0.12,
          noise: 0.1,
          ambientCoupling: 0.25,
          decimals: 1,
        }),
      };

    case "air-quality-sensor":
      return {
        airQuality: config({
          baseline: rng.range(32, 78),
          min: 0,
          max: 500,
          meanReversion: 0.045,
          noise: 1.6,
          ambientCoupling: 0.4,
          spikeChance: 0.0035 + faultBoost * 0.012,
          spikeMagnitude: 55 + faultBoost * 90,
          spikeDecay: 0.72,
          decimals: 0,
          faultCeiling: 180,
          faultRampPerSecond: 5,
        }),
        temperature: config({
          baseline: site.ambientMean,
          min: -30,
          max: 70,
          meanReversion: 0.05,
          noise: 0.2,
          ambientCoupling: 0.88,
          decimals: 1,
        }),
        humidity: config({
          baseline: site.humidityMean,
          min: 0,
          max: 100,
          meanReversion: 0.07,
          noise: 0.7,
          ambientCoupling: 0.8,
          decimals: 0,
        }),
        battery: batteryConfig(rng.range(0.4, 1.2), rng.range(45, 100)),
        signalStrength: outdoorSignal,
      };
  }
}

/**
 * Human-occupancy / load curve for a site, 0-1, peaking in the working day.
 *
 * Power draw and motion events follow people, not temperature, so they are
 * coupled to this rather than to the thermal ambient.
 */
export function activityLevel(site: SiteDescriptor, timestamp: number): number {
  const localHours = (timestamp / 3_600_000 + site.utcOffsetHours) % 24;
  const dayOfWeek = Math.floor(timestamp / 86_400_000 + 4) % 7;
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;
  // Gaussian bump centred on 13:00 with a ~5h standard deviation.
  const bump = Math.exp(-((localHours - 13) ** 2) / (2 * 5 ** 2));
  const base = weekend ? 0.22 : 0.18;
  return base + bump * (weekend ? 0.3 : 0.82);
}

/**
 * Resolves the ambient value a metric should be pulled toward at this site
 * and instant. Returning `undefined` means "no external coupling".
 */
export function ambientForMetric(
  metric: MetricKey,
  site: SiteDescriptor,
  timestamp: number,
  config: SignalConfig,
): number | undefined {
  if (config.ambientCoupling <= 0) return undefined;
  switch (metric) {
    case "temperature":
      return ambientTemperature(site, timestamp);
    case "humidity":
      return ambientHumidity(site, timestamp);
    case "airQuality":
      // Pollution tracks traffic, which tracks activity.
      return config.baseline * (0.55 + activityLevel(site, timestamp) * 1.1);
    case "powerConsumption":
    case "motion":
      return config.baseline * (0.25 + activityLevel(site, timestamp) * 1.6);
    default:
      return undefined;
  }
}

export const FIRMWARE_VERSION_POOL: readonly string[] = [
  "v2.1.4",
  "v2.2.0",
  "v2.3.1",
  "v2.3.4",
  "v2.4.0",
] as const;

/** Share of the fleet seeded as intentionally faulty. */
export const FAULTY_DEVICE_SHARE = 0.022;
