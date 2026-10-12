"use client";

import { ArrowUpRight, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Panel, PanelHeader } from "@/components/shared/Panel";
import { useDeviceCount } from "@/hooks/useDevices";
import { formatCompact } from "@/utils/formatting";

/**
 * Map panel for the dashboard.
 *
 * MapLibre is loaded dynamically with SSR disabled — it is ~200 kB of
 * browser-only code that touches `window` at import time, so bundling it into
 * the initial payload would slow the first paint of every page in the console,
 * not just this one.
 */
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

export interface MapPanelProps {
  /**
   * Floor for the map area. The panel otherwise fills its grid cell, so the
   * minimum only applies when it is stacked single-column and has no sibling
   * to match.
   */
  readonly minHeight?: number;
}

export function MapPanel({ minHeight = 340 }: MapPanelProps) {
  const router = useRouter();
  const deviceCount = useDeviceCount();

  return (
    // `h-full` makes the panel fill its grid cell, which the browser has
    // already stretched to the height of the tallest item in the row — the
    // alerts panel beside it. Pairing that with a flexed map area keeps the
    // two matched automatically, rather than pinning the map to a fixed
    // height that drifts out of step whenever the alert list changes length.
    <Panel flush className="h-full">
      <PanelHeader
        title="Device map"
        description={`${formatCompact(deviceCount)} devices across 8 sites · clusters coloured by worst contained status`}
        icon={<MapPin className="size-4" />}
        actions={
          <Link
            href="/map"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Full map <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        }
      />
      <div className="flex-1" style={{ minHeight }}>
        <DeviceMap
          className="h-full w-full"
          onSelectDevice={(deviceId) => router.push(`/devices/${deviceId}`)}
        />
      </div>
    </Panel>
  );
}
