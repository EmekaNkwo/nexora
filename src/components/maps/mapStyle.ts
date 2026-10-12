import type { StyleSpecification } from "maplibre-gl";

/**
 * Map style.
 *
 * Built inline rather than fetched from a style server, for two reasons: there
 * is no API key to manage, and the basemap can be tuned to the console's dark
 * palette instead of fighting it. A default vendor basemap would put saturated
 * greens and blues underneath status markers whose entire job is to be the only
 * saturated thing on screen.
 *
 * Raster tiles come from OpenStreetMap, which needs no key. If tiles fail to
 * load — offline, blocked, rate-limited — the map still renders: the background
 * layer and all device markers are local, so the geospatial view degrades to a
 * coordinate plot rather than breaking.
 */

export const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function buildMapStyle(theme: "dark" | "light"): StyleSpecification {
  const background = theme === "dark" ? "#14171d" : "#eef1f5";

  return {
    version: 8,
    // No `glyphs` key at all. A glyph endpoint is only needed for symbol
    // (text) layers, and this style has none: cluster counts are rendered as
    // DOM markers instead, which keeps the style free of any font dependency
    // and lets the labels use the app's own typography. MapLibre validates
    // `glyphs` as a string, so declaring it as `undefined` is an error rather
    // than an opt-out.
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: TILE_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": background },
      },
      {
        id: "osm-tiles",
        type: "raster",
        source: "osm",
        paint: {
          // Heavily desaturated and dimmed on dark so the basemap reads as
          // context, never as content.
          "raster-opacity": theme === "dark" ? 0.38 : 0.72,
          "raster-saturation": theme === "dark" ? -0.75 : -0.35,
          "raster-contrast": theme === "dark" ? -0.15 : 0,
          "raster-brightness-min": theme === "dark" ? 0.02 : 0.1,
          "raster-brightness-max": theme === "dark" ? 0.55 : 1,
        },
      },
    ],
  };
}

/** Marker colours, matching the status tokens used everywhere else. */
export const STATUS_MARKER_COLORS: Readonly<Record<string, string>> = {
  online: "#34d399",
  warning: "#fbbf24",
  critical: "#f87171",
  offline: "#64748b",
  maintenance: "#a78bfa",
  updating: "#38bdf8",
};

/**
 * MapLibre expression that colours a device marker by its status.
 *
 * Expressed as a data-driven style expression rather than as per-feature
 * properties so recolouring happens on the GPU — at 5,000 markers, setting a
 * paint property per feature would be unusable.
 */
export const STATUS_COLOR_EXPRESSION = [
  "match",
  ["get", "status"],
  "online",
  STATUS_MARKER_COLORS.online,
  "warning",
  STATUS_MARKER_COLORS.warning,
  "critical",
  STATUS_MARKER_COLORS.critical,
  "maintenance",
  STATUS_MARKER_COLORS.maintenance,
  "updating",
  STATUS_MARKER_COLORS.updating,
  STATUS_MARKER_COLORS.offline,
] as const;

/**
 * Cluster colour by worst contained status.
 *
 * A cluster of 142 devices containing one critical must not read as healthy,
 * so the cluster carries aggregated counts and is coloured by the most severe
 * status inside it — not by its size.
 */
export const CLUSTER_COLOR_EXPRESSION = [
  "case",
  [">", ["get", "criticalCount"], 0],
  STATUS_MARKER_COLORS.critical,
  [">", ["get", "offlineCount"], 0],
  STATUS_MARKER_COLORS.offline,
  [">", ["get", "warningCount"], 0],
  STATUS_MARKER_COLORS.warning,
  STATUS_MARKER_COLORS.online,
] as const;

/** Cluster radius scales with contained count, with a sane ceiling. */
export const CLUSTER_RADIUS_EXPRESSION = [
  "step",
  ["get", "point_count"],
  14,
  10,
  18,
  50,
  22,
  200,
  27,
  1000,
  33,
] as const;
