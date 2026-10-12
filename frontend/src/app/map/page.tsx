"use client";

import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { FleetReadyGate } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { Button } from "@/components/ui/button";
import { useDeviceSummaries, useStatusCounts } from "@/hooks/useDevices";
import { SITES } from "@/services/simulator/locations";
import { TILE_ATTRIBUTION } from "@/components/maps/mapStyle";
import { formatCompact } from "@/utils/formatting";

const DeviceMap = dynamic(
  () => import("@/components/maps/DeviceMap").then((module) => module.DeviceMap),
  {
    ssr: false,
    loading: () => (
      <div className="ops-grid grid h-full w-full place-items-center bg-muted/20">
        <p className="text-xs text-muted-foreground">Loading map…</p>
      </div>
    ),
  },
);

/**
 * Full-page geospatial view.
 *
 * Site filtering works by narrowing the device set handed to the map rather
 * than by flying the camera, so clustering recomputes for the filtered fleet —
 * which is what makes "show me just the cold stores" useful rather than
 * decorative.
 */
export default function MapPage() {
  return (
    <FleetReadyGate>
      <Suspense fallback={<div className="p-5" />}>
        <MapContent />
      </Suspense>
    </FleetReadyGate>
  );
}

function MapContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const devices = useDeviceSummaries();
  const statusCounts = useStatusCounts();

  const [siteFilter, setSiteFilter] = useState<string | null>(
    searchParams.get("site"),
  );

  const siteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const device of devices) {
      counts.set(device.site, (counts.get(device.site) ?? 0) + 1);
    }
    return counts;
  }, [devices]);

  const visibleIds = useMemo(() => {
    if (!siteFilter) return undefined;
    return devices
      .filter((device) => device.site === siteFilter)
      .map((device) => device.id);
  }, [devices, siteFilter]);

  const focusSite = useMemo(
    () => SITES.find((site) => site.name === siteFilter),
    [siteFilter],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-5">
      <KpiGroup minTileWidth={140}>
        <KpiTile
          label="Plotted devices"
          value={visibleIds ? visibleIds.length : devices.length}
          hint={siteFilter ?? "All sites"}
        />
        <KpiTile label="Online" value={statusCounts.online} tone="online" compact />
        <KpiTile label="Warning" value={statusCounts.warning} tone="warning" compact />
        <KpiTile label="Critical" value={statusCounts.critical} tone="critical" compact />
        <KpiTile label="Offline" value={statusCounts.offline} tone="offline" compact />
      </KpiGroup>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by site">
        <Button
          size="xs"
          variant={siteFilter === null ? "secondary" : "ghost"}
          onClick={() => setSiteFilter(null)}
          aria-pressed={siteFilter === null}
          className="text-[0.7rem]"
        >
          All sites
        </Button>
        {SITES.map((site) => (
          <Button
            key={site.id}
            size="xs"
            variant={siteFilter === site.name ? "secondary" : "ghost"}
            onClick={() => setSiteFilter(site.name)}
            aria-pressed={siteFilter === site.name}
            className="gap-1.5 text-[0.7rem]"
          >
            {site.name}
            <span className="tabular text-muted-foreground">
              {formatCompact(siteCounts.get(site.name) ?? 0)}
            </span>
          </Button>
        ))}
      </div>

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader
          title="Device map"
          description="Clusters are coloured by the worst status they contain. Click a cluster to zoom, or a marker for a summary."
          icon={<MapPin className="size-4" />}
        />
        <div className="min-h-[24rem] flex-1">
          <DeviceMap
            className="h-full w-full"
            deviceIds={visibleIds}
            // Remounting on site change resets the camera to the new site,
            // which is what an operator expects when they pick one.
            key={siteFilter ?? "all"}
            initialCenter={focusSite ? [focusSite.lng, focusSite.lat] : [12, 22]}
            initialZoom={focusSite ? 10 : 1.4}
            onSelectDevice={(deviceId) => router.push(`/devices/${deviceId}`)}
          />
        </div>
        <PanelFooter>
          <span>
            Rendered as a single clustered GeoJSON source — the whole fleet costs three
            GPU draw calls regardless of size.
          </span>
          <span
            className="text-[0.65rem] text-muted-foreground"
            // Tile attribution is a licence requirement, not decoration.
            dangerouslySetInnerHTML={{ __html: TILE_ATTRIBUTION }}
          />
        </PanelFooter>
      </Panel>
    </div>
  );
}
