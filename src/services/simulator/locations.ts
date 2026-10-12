import type { DeviceGroup } from "@/types/groups";
import type { DeviceType } from "@/types/device";

/**
 * Physical sites the simulated fleet is deployed across.
 *
 * Each site carries a climate profile. Ambient temperature is what makes
 * telemetry feel real: an outdoor sensor in Lagos and one in Rotterdam should
 * not drift around the same number, and both should follow a daily cycle.
 */
export interface SiteDescriptor {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly region: string;
  readonly lat: number;
  readonly lng: number;
  /** Radius in km that devices are scattered within. */
  readonly spreadKm: number;
  /** Mean outdoor temperature in °C. */
  readonly ambientMean: number;
  /** Half the peak-to-trough daily swing, in °C. */
  readonly ambientAmplitude: number;
  /** Mean outdoor relative humidity, %. */
  readonly humidityMean: number;
  /** Local offset from UTC in hours, so the daily cycle peaks mid-afternoon. */
  readonly utcOffsetHours: number;
  /** Device classes this site actually hosts. */
  readonly deviceTypes: readonly DeviceType[];
  /** Relative share of the fleet deployed here. */
  readonly weight: number;
  /** Logical groups devices at this site can belong to. */
  readonly groupIds: readonly string[];
}

export const LOGICAL_GROUPS: readonly DeviceGroup[] = [
  {
    id: "grp-cold-storage",
    name: "Cold Storage",
    kind: "logical",
    description: "Refrigerated units under continuous temperature compliance monitoring.",
    createdAt: 0,
  },
  {
    id: "grp-delivery-fleet",
    name: "Delivery Fleet",
    kind: "fleet",
    description: "Vehicle and asset trackers in transit.",
    createdAt: 0,
  },
  {
    id: "grp-factory-floor",
    name: "Factory Floor",
    kind: "logical",
    description: "Production-line gateways, meters and environmental sensors.",
    createdAt: 0,
  },
  {
    id: "grp-energy",
    name: "Energy & Metering",
    kind: "logical",
    description: "Smart meters and energy monitors feeding consumption analytics.",
    createdAt: 0,
  },
  {
    id: "grp-building",
    name: "Building Services",
    kind: "logical",
    description: "HVAC, occupancy and air-quality sensors in offices and retail.",
    createdAt: 0,
  },
  {
    id: "grp-agriculture",
    name: "Agriculture",
    kind: "logical",
    description: "Field sensors across open-air agricultural sites.",
    createdAt: 0,
  },
] as const;

export const SITES: readonly SiteDescriptor[] = [
  {
    id: "site-lagos-cold",
    name: "Lagos Cold Storage",
    city: "Lagos",
    region: "West Africa",
    lat: 6.4541,
    lng: 3.3947,
    spreadKm: 1.6,
    ambientMean: 28.5,
    ambientAmplitude: 3.8,
    humidityMean: 78,
    utcOffsetHours: 1,
    deviceTypes: [
      "cold-storage-sensor",
      "temperature-sensor",
      "humidity-sensor",
      "industrial-gateway",
      "energy-monitor",
    ],
    weight: 16,
    groupIds: ["grp-cold-storage", "grp-energy"],
  },
  {
    id: "site-lagos-warehouse",
    name: "Lagos Warehouse",
    city: "Lagos",
    region: "West Africa",
    lat: 6.5244,
    lng: 3.3792,
    spreadKm: 2.4,
    ambientMean: 28.9,
    ambientAmplitude: 4.2,
    humidityMean: 76,
    utcOffsetHours: 1,
    deviceTypes: [
      "temperature-sensor",
      "humidity-sensor",
      "motion-sensor",
      "industrial-gateway",
      "smart-meter",
      "air-quality-sensor",
    ],
    weight: 14,
    groupIds: ["grp-factory-floor", "grp-building"],
  },
  {
    id: "site-ikeja-fleet",
    name: "Ikeja Distribution Hub",
    city: "Ikeja",
    region: "West Africa",
    lat: 6.6018,
    lng: 3.3515,
    spreadKm: 14,
    ambientMean: 29.4,
    ambientAmplitude: 4.6,
    humidityMean: 72,
    utcOffsetHours: 1,
    deviceTypes: ["vehicle-tracker", "gps-tracker", "cold-storage-sensor"],
    weight: 13,
    groupIds: ["grp-delivery-fleet", "grp-cold-storage"],
  },
  {
    id: "site-rotterdam-port",
    name: "Rotterdam Port Terminal",
    city: "Rotterdam",
    region: "Western Europe",
    lat: 51.9244,
    lng: 4.4777,
    spreadKm: 6.5,
    ambientMean: 11.2,
    ambientAmplitude: 5.4,
    humidityMean: 81,
    utcOffsetHours: 2,
    deviceTypes: [
      "cold-storage-sensor",
      "industrial-gateway",
      "gps-tracker",
      "energy-monitor",
      "air-quality-sensor",
    ],
    weight: 12,
    groupIds: ["grp-cold-storage", "grp-energy"],
  },
  {
    id: "site-munich-factory",
    name: "Munich Factory Floor",
    city: "Munich",
    region: "Central Europe",
    lat: 48.1351,
    lng: 11.582,
    spreadKm: 1.1,
    ambientMean: 10.8,
    ambientAmplitude: 7.2,
    humidityMean: 68,
    utcOffsetHours: 2,
    deviceTypes: [
      "industrial-gateway",
      "temperature-sensor",
      "smart-meter",
      "energy-monitor",
      "motion-sensor",
    ],
    weight: 13,
    groupIds: ["grp-factory-floor", "grp-energy"],
  },
  {
    id: "site-nairobi-agri",
    name: "Nairobi Agricultural Site",
    city: "Nairobi",
    region: "East Africa",
    lat: -1.2921,
    lng: 36.8219,
    spreadKm: 22,
    ambientMean: 20.6,
    ambientAmplitude: 7.8,
    humidityMean: 62,
    utcOffsetHours: 3,
    deviceTypes: [
      "temperature-sensor",
      "humidity-sensor",
      "air-quality-sensor",
      "gps-tracker",
    ],
    weight: 9,
    groupIds: ["grp-agriculture"],
  },
  {
    id: "site-singapore-retail",
    name: "Singapore Retail Network",
    city: "Singapore",
    region: "Southeast Asia",
    lat: 1.3521,
    lng: 103.8198,
    spreadKm: 11,
    ambientMean: 27.8,
    ambientAmplitude: 2.6,
    humidityMean: 84,
    utcOffsetHours: 8,
    deviceTypes: [
      "temperature-sensor",
      "humidity-sensor",
      "motion-sensor",
      "air-quality-sensor",
      "smart-meter",
      "cold-storage-sensor",
    ],
    weight: 11,
    groupIds: ["grp-building", "grp-cold-storage"],
  },
  {
    id: "site-austin-office",
    name: "Austin Operations Office",
    city: "Austin",
    region: "North America",
    lat: 30.2672,
    lng: -97.7431,
    spreadKm: 0.8,
    ambientMean: 21.4,
    ambientAmplitude: 8.6,
    humidityMean: 59,
    utcOffsetHours: -5,
    deviceTypes: [
      "temperature-sensor",
      "motion-sensor",
      "air-quality-sensor",
      "energy-monitor",
      "industrial-gateway",
    ],
    weight: 12,
    groupIds: ["grp-building", "grp-energy"],
  },
] as const;

export const SITE_GROUPS: readonly DeviceGroup[] = SITES.map((site) => ({
  id: `grp-${site.id}`,
  name: site.name,
  kind: "site" as const,
  description: `${site.city}, ${site.region}`,
  createdAt: 0,
}));

export const ALL_GROUPS: readonly DeviceGroup[] = [...SITE_GROUPS, ...LOGICAL_GROUPS];

const SITES_BY_ID = new Map(SITES.map((site) => [site.id, site]));

export function getSite(siteId: string): SiteDescriptor | undefined {
  return SITES_BY_ID.get(siteId);
}

/** Total weight, precomputed for weighted site selection. */
export const TOTAL_SITE_WEIGHT = SITES.reduce((sum, site) => sum + site.weight, 0);

/** Degrees of latitude per kilometre. Longitude is scaled by cos(lat). */
const KM_PER_DEGREE_LAT = 110.574;

/**
 * Offsets a point by a distance in km. Used to scatter devices around a site
 * centre, and to walk mobile devices along their route.
 */
export function offsetByKm(
  lat: number,
  lng: number,
  northKm: number,
  eastKm: number,
): { lat: number; lng: number } {
  const latitude = lat + northKm / KM_PER_DEGREE_LAT;
  const lngScale = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const longitude = lng + eastKm / Math.max(lngScale, 1e-6);
  return { lat: latitude, lng: longitude };
}

/**
 * Site-local ambient temperature for a given instant.
 *
 * Models the daily cycle as a sinusoid peaking around 15:00 local time, plus a
 * slow seasonal term so a long-range chart does not look perfectly periodic.
 */
export function ambientTemperature(site: SiteDescriptor, timestamp: number): number {
  const localHours = (timestamp / 3_600_000 + site.utcOffsetHours) % 24;
  const dailyPhase = ((localHours - 15) / 24) * Math.PI * 2;
  const daily = Math.cos(dailyPhase) * site.ambientAmplitude;
  const dayOfYear = (timestamp / 86_400_000) % 365.25;
  const seasonal = Math.sin((dayOfYear / 365.25) * Math.PI * 2) * site.ambientAmplitude * 0.35;
  return site.ambientMean + daily + seasonal;
}

/** Site-local ambient humidity; inversely correlated with temperature. */
export function ambientHumidity(site: SiteDescriptor, timestamp: number): number {
  const localHours = (timestamp / 3_600_000 + site.utcOffsetHours) % 24;
  const dailyPhase = ((localHours - 15) / 24) * Math.PI * 2;
  return site.humidityMean - Math.cos(dailyPhase) * 7;
}
