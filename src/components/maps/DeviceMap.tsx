"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CLUSTER_COLOR_EXPRESSION,
  CLUSTER_RADIUS_EXPRESSION,
  STATUS_COLOR_EXPRESSION,
  buildMapStyle,
} from "@/components/maps/mapStyle";
import { useDeviceSummaries } from "@/hooks/useDevices";
import { useCoarseNow } from "@/hooks/useClock";
import type { DeviceStatus, DeviceSummary } from "@/types/device";
import { cn } from "@/lib/utils";

/**
 * The geospatial device view.
 *
 * ### Why MapLibre's native clustering
 *
 * Plotting 5,000 DOM markers is not viable — each one is a positioned element
 * the browser has to lay out on every pan. Instead the fleet is a single
 * GeoJSON source with `cluster: true`, rendered as two GPU circle layers. The
 * entire fleet is three paint operations regardless of size, and clustering
 * happens in a worker rather than on the main thread.
 *
 * ### Clusters that tell the truth
 *
 * A cluster showing "142" in green while containing a critical device would be
 * actively misleading. `clusterProperties` aggregates per-status counts as the
 * cluster is built, and the cluster is coloured by the worst status it
 * contains — so severity propagates upward through every zoom level.
 *
 * ### Updating without re-rendering
 *
 * Device data is pushed into the map by calling `setData` on the source, never
 * by re-rendering React children. The map instance lives for the component's
 * lifetime and React is not involved in the update path at all.
 */

export interface DeviceMapProps {
  readonly className?: string;
  /** Called when a device marker is selected. */
  readonly onSelectDevice?: (deviceId: string) => void;
  /** Restricts the plotted set, e.g. to one group or site. */
  readonly deviceIds?: readonly string[];
  /** Initial camera. Defaults to a world view that shows every site. */
  readonly initialCenter?: readonly [number, number];
  readonly initialZoom?: number;
  readonly interactive?: boolean;
}

interface SelectedDevice {
  readonly id: string;
  readonly status: DeviceStatus;
  readonly name: string;
  readonly site: string;
  readonly health: number;
  readonly battery: number;
  readonly primaryLabel: string;
  readonly primaryValue: string;
}

const SOURCE_ID = "devices";
const CLUSTER_LAYER = "device-clusters";
const POINT_LAYER = "device-points";

/** How often marker positions and colours are pushed to the GPU. */
const DATA_REFRESH_MS = 2000;

/**
 * Points MapLibre at its web worker.
 *
 * MapLibre resolves the worker as a sibling of its own module URL. Once a
 * bundler has rewritten that URL the sibling no longer exists, the worker
 * fails to load, and — because both tile parsing and GeoJSON clustering run
 * off the main thread — clustering silently stops working.
 *
 * `scripts/copy-maplibre-worker.mjs` copies the (self-contained) worker bundle
 * into `public/` on `predev`/`prebuild`; this points at that copy. Guarded so
 * repeated mounts and React Strict Mode do not reconfigure it.
 */
const WORKER_PATH = "/maplibre-gl-worker.mjs";

let workerConfigured = false;

function ensureWorkerUrl(): void {
  if (workerConfigured) return;
  workerConfigured = true;

  // Set unconditionally. `getWorkerUrl()` returns MapLibre's *computed* URL,
  // which under a bundler is precisely the broken one — so treating a non-empty
  // result as "already working" would skip the fix entirely. The copy served
  // from `public/` is authoritative here.
  setWorkerUrl(new URL(WORKER_PATH, window.location.origin).href);
}

/**
 * Rebuilds the cluster count labels.
 *
 * Counts are rendered as MapLibre `Marker`s rather than as a symbol layer. A
 * symbol layer would need a glyph endpoint — an external font dependency, and
 * one that cannot degrade gracefully because MapLibre rejects a style whose
 * symbol layer has no `glyphs`. DOM markers have none of that: they inherit the
 * app's typography and theme tokens, and MapLibre keeps them positioned during
 * a pan without any manual projection.
 *
 * The cost is bounded. `clusterRadius` is 52 px, so only a few dozen clusters
 * can be on screen at once however large the fleet is — the thousands of
 * individual devices stay on the GPU as circle layers.
 */
function syncClusterLabels(map: MapLibreMap, markers: Marker[]): void {
  for (const marker of markers) marker.remove();
  markers.length = 0;

  if (!map.getLayer(CLUSTER_LAYER)) return;

  const clusters = map.queryRenderedFeatures({ layers: [CLUSTER_LAYER] });

  for (const cluster of clusters) {
    const count = cluster.properties?.point_count_abbreviated;
    if (count === undefined || count === null) continue;
    const geometry = cluster.geometry as GeoJSON.Point;

    const element = document.createElement("span");
    element.textContent = String(count);
    element.className =
      "tabular pointer-events-none select-none text-[0.68rem] font-semibold text-foreground";
    // A halo keeps the count legible over both the basemap and the cluster fill.
    element.style.textShadow =
      "0 0 3px var(--background), 0 0 2px var(--background), 0 1px 2px var(--background)";

    markers.push(
      new Marker({ element, pitchAlignment: "map" })
        .setLngLat([geometry.coordinates[0]!, geometry.coordinates[1]!])
        .addTo(map),
    );
  }
}

function toFeatureCollection(
  devices: readonly DeviceSummary[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: devices.map((device) => ({
      type: "Feature",
      id: undefined,
      geometry: { type: "Point", coordinates: [device.location.lng, device.location.lat] },
      properties: {
        id: device.id,
        name: device.name,
        status: device.status,
        site: device.site,
        health: device.healthScore,
        battery: Math.round(device.battery),
        primaryMetric: device.primaryMetric,
        primaryValue: device.primaryValue ?? null,
        // Pre-computed flags so `clusterProperties` can sum them cheaply.
        isCritical: device.status === "critical" ? 1 : 0,
        isWarning: device.status === "warning" ? 1 : 0,
        isOffline: device.status === "offline" ? 1 : 0,
      },
    })),
  };
}

export function DeviceMap({
  className,
  onSelectDevice,
  deviceIds,
  initialCenter = [12, 22],
  initialZoom = 1.4,
  interactive = true,
}: DeviceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /** Live cluster count labels, owned outside React. */
  const clusterMarkersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Non-fatal MapLibre error worth surfacing to the operator. */
  const [mapError, setMapError] = useState<string | null>(null);
  /** Set when the style never finishes loading — usually a dead web worker. */
  const [stalled, setStalled] = useState(false);
  const [selected, setSelected] = useState<SelectedDevice | null>(null);

  const allDevices = useDeviceSummaries();
  // Coarse clock: markers move slowly, and repainting 5,000 points four times
  // a second would be pure waste.
  const refreshTick = useCoarseNow(DATA_REFRESH_MS);

  const devices = useMemo(() => {
    if (!deviceIds) return allDevices;
    const allowed = new Set(deviceIds);
    return allDevices.filter((device) => allowed.has(device.id));
  }, [allDevices, deviceIds]);

  const handleFeatureClick = useCallback(
    (feature: MapGeoJSONFeature) => {
      const properties = feature.properties as Record<string, unknown>;
      const id = String(properties.id);
      const primaryMetric = String(properties.primaryMetric ?? "");
      const rawValue = properties.primaryValue;

      setSelected({
        id,
        name: String(properties.name ?? id),
        status: String(properties.status ?? "offline") as DeviceStatus,
        site: String(properties.site ?? ""),
        health: Number(properties.health ?? 0),
        battery: Number(properties.battery ?? 0),
        primaryLabel: primaryMetric,
        primaryValue:
          rawValue === null || rawValue === undefined ? "—" : String(rawValue),
      });
    },
    [],
  );

  // Map creation. Runs once; the instance outlives every data update.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    ensureWorkerUrl();

    // Captured once: the array identity is stable (it is mutated in place), so
    // the cleanup below acts on the same list the effect populated.
    const clusterMarkers = clusterMarkersRef.current;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: buildMapStyle("dark"),
        center: [initialCenter[0], initialCenter[1]],
        zoom: initialZoom,
        attributionControl: { compact: true },
        interactive,
        // The console is dense; a tilted map would only cost legibility.
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch {
      // WebGL unavailable (headless, blocked, software rendering disabled).
      // A one-shot transition into a terminal error state, not an ongoing
      // synchronisation — there is no cascade for the lint rule to prevent.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }

    mapRef.current = map;

    if (interactive) {
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
    }

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 52,
        // Severity is aggregated as clusters are built, so a cluster knows
        // what it contains without the main thread inspecting its children.
        clusterProperties: {
          criticalCount: ["+", ["get", "isCritical"]],
          warningCount: ["+", ["get", "isWarning"]],
          offlineCount: ["+", ["get", "isOffline"]],
        },
      });

      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": CLUSTER_COLOR_EXPRESSION as unknown as string,
          "circle-radius": CLUSTER_RADIUS_EXPRESSION as unknown as number,
          "circle-opacity": 0.22,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": CLUSTER_COLOR_EXPRESSION as unknown as string,
          "circle-stroke-opacity": 0.9,
        },
      });

      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": STATUS_COLOR_EXPRESSION as unknown as string,
          // Markers grow with zoom so they stay visible when zoomed out but
          // do not swamp the basemap when zoomed in.
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            2.5,
            6,
            4,
            12,
            6,
            16,
            8,
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#14171d",
          "circle-opacity": 0.95,
        },
      });

      setReady(true);
      setStalled(false);
    });

    // Watchdog. If `load` never fires the map is a blank box with no
    // explanation — and the usual cause is the web worker failing to start,
    // since MapLibre parses the style and every tile off the main thread.
    const loadWatchdog = setTimeout(() => {
      if (!map.isStyleLoaded()) setStalled(true);
    }, 10_000);
    map.once("load", () => clearTimeout(loadWatchdog));

    // Tile failures must not take the whole map down — markers are local.
    // Tile fetch failures are expected and already degrade gracefully — the
    // basemap is context, not content. Anything else means the map is broken
    // in a way the operator needs to be told about, rather than being left
    // looking at an empty box with the explanation hidden in the console.
    map.on("error", (event) => {
      const message = String(event.error?.message ?? "unknown map error");
      if (message.includes("tile") || message.includes("Failed to fetch")) return;
      console.warn("[nexora:map]", event.error);
      setMapError(message);
    });

    const onClusterClick = (event: MapMouseEvent): void => {
      const features = map.queryRenderedFeatures(event.point, { layers: [CLUSTER_LAYER] });
      const cluster = features[0];
      if (!cluster) return;
      const clusterId = cluster.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geometry = cluster.geometry as GeoJSON.Point;
        map.easeTo({
          center: [geometry.coordinates[0]!, geometry.coordinates[1]!],
          zoom,
          duration: 450,
        });
      });
    };

    const onPointClick = (event: MapMouseEvent): void => {
      const features = map.queryRenderedFeatures(event.point, { layers: [POINT_LAYER] });
      const feature = features[0];
      if (feature) handleFeatureClick(feature);
    };

    map.on("click", CLUSTER_LAYER, onClusterClick);
    map.on("click", POINT_LAYER, onPointClick);

    for (const layer of [CLUSTER_LAYER, POINT_LAYER]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    return () => {
      clearTimeout(loadWatchdog);
      for (const marker of clusterMarkers) marker.remove();
      clusterMarkers.length = 0;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The camera props are initial-only by design. Depending on them would tear
    // down and rebuild the whole map — losing the operator's pan and zoom —
    // whenever they changed; the page remounts this component when it genuinely
    // wants a new camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleFeatureClick, interactive]);

  // Data updates: imperative, throttled, and entirely outside React's render.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(devices));
    syncClusterLabels(map, clusterMarkersRef.current);
  }, [devices, ready, refreshTick]);

  /**
   * Keeps the cluster count labels in step with the rendered clusters.
   *
   * Driven by map events rather than React state: MapLibre repositions its own
   * markers during a pan, so the labels only need rebuilding when the *set* of
   * clusters changes — on settle, zoom, or new data.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const markers = clusterMarkersRef.current;
    const update = (): void => syncClusterLabels(map, markers);

    map.on("moveend", update);
    map.on("zoomend", update);
    map.on("idle", update);
    update();

    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
      map.off("idle", update);
    };
  }, [ready]);

  if (failed) {
    return (
      <div
        className={cn(
          "ops-grid grid place-items-center rounded-lg border border-border bg-muted/20 p-6 text-center",
          className,
        )}
      >
        <div className="max-w-xs space-y-1">
          <p className="text-sm font-medium">Map unavailable</p>
          <p className="text-xs text-muted-foreground">
            WebGL could not be initialised in this browser. Device locations are still
            available in the devices table.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/*
        Sized with `h-full w-full`, deliberately *not* `absolute inset-0`.
        MapLibre's stylesheet sets `.maplibregl-map { position: relative }` on
        whatever element it attaches to, and that selector has the same
        specificity as Tailwind's `.absolute` while loading from a later chunk
        — so it wins, `inset-0` stops stretching anything, and the container
        collapses to the height of its content, which is zero because the
        canvas inside is absolutely positioned. The result is an invisible map
        in a correctly sized parent.

        Filling the parent by width/height instead sidesteps the conflict
        entirely: MapLibre is welcome to own `position` here.
      */}
      <div
        ref={containerRef}
        className="ops-grid h-full w-full"
        role="application"
        aria-label={`Device map showing ${devices.length} devices`}
      />

      {selected ? (
        <DeviceMapPopup
          device={selected}
          onClose={() => setSelected(null)}
          onOpen={() => onSelectDevice?.(selected.id)}
        />
      ) : null}

      {/* Rendered as an overlay rather than instead of the map: a tile or
          style problem often still leaves usable markers underneath, and
          replacing the whole view would throw that away. */}
      {mapError || stalled ? (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded-md border border-status-critical/40 bg-popover/95 px-3 py-2 backdrop-blur-sm"
        >
          <p className="text-xs font-medium text-status-critical">
            {stalled ? "Map failed to finish loading" : "Map error"}
          </p>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted-foreground">
            {mapError ??
              "The style did not load within 10 seconds. The usual cause is the MapLibre web worker failing to start — try `npm run copy:map-worker`. Device locations are still available in the devices table."}
          </p>
        </div>
      ) : null}

      {/* Legend doubles as the non-colour key for marker severity. Sits above
          the attribution control, which MapLibre pins to the bottom-right and
          which would otherwise overlap it. */}
      <div className="pointer-events-none absolute bottom-9 right-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-border bg-popover/85 px-2.5 py-1.5 text-[0.65rem] backdrop-blur-sm">
        {(
          [
            ["online", "Online"],
            ["warning", "Warning"],
            ["critical", "Critical"],
            ["offline", "Offline"],
          ] as const
        ).map(([status, label]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                status === "online" && "bg-status-online",
                status === "warning" && "bg-status-warning",
                status === "critical" && "bg-status-critical",
                status === "offline" && "bg-status-offline",
              )}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface DeviceMapPopupProps {
  readonly device: SelectedDevice;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}

/**
 * Device summary card.
 *
 * Rendered as React rather than a MapLibre `Popup` so it can reuse the app's
 * components and stay keyboard accessible — a MapLibre popup is raw HTML with
 * no focus management.
 */
function DeviceMapPopup({ device, onClose, onOpen }: DeviceMapPopupProps) {
  return (
    <div className="absolute left-2 top-2 w-56 rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="ops-mono truncate font-medium">{device.id}</p>
          <p className="truncate text-xs text-muted-foreground">{device.site}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground"
          aria-label="Close device summary"
        >
          ×
        </button>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="ops-label">Status</dt>
          <dd className="capitalize">{device.status}</dd>
        </div>
        <div>
          <dt className="ops-label">Health</dt>
          <dd className="tabular">{device.health}</dd>
        </div>
        <div>
          <dt className="ops-label">Battery</dt>
          <dd className="tabular">{device.battery}%</dd>
        </div>
        <div>
          <dt className="ops-label">Reading</dt>
          <dd className="tabular truncate">{device.primaryValue}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onOpen}
        className="mt-3 w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        View device
      </button>
    </div>
  );
}
