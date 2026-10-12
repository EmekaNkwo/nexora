"use client";

import { Suspense } from "react";

import { CircuitBoard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { DeviceGaugeGrid } from "@/components/devices/detail/DeviceGaugeGrid";
import { DeviceHeader } from "@/components/devices/detail/DeviceHeader";
import { DeviceHistoryPanel } from "@/components/devices/detail/DeviceHistoryPanel";
import {
  DeviceActivityPanel,
  DeviceAlertsPanel,
  DeviceCommandPanel,
  DeviceHealthPanel,
  DeviceMetadataPanel,
  DeviceRulesPanel,
} from "@/components/devices/detail/DeviceSidePanels";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/hooks/useDevices";
import { useObservedDevice } from "@/hooks/useTelemetry";

/**
 * Device detail.
 *
 * Mounting this page *promotes* the device in the telemetry repository: its
 * ring buffers are widened from the fleet-wide 40-sample default to the full
 * live window, so the history chart has real resolution to draw. The promotion
 * is released on unmount, which is what keeps the memory cost bounded no
 * matter how many device pages an operator opens over a shift.
 */
export default function DevicePage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      {/* `useParams` is URL data, so it has to be read inside the boundary —
          reading it in the outer component would make the whole page
          unprerenderable under `cacheComponents`. */}
      <Suspense fallback={<ListSkeleton />}>
        <DeviceDetail />
      </Suspense>
    </FleetReadyGate>
  );
}

function DeviceDetail() {
  const params = useParams<{ deviceId: string }>();
  const deviceId = params.deviceId;
  const device = useDevice(deviceId);

  // Promote before the charts read, so the first paint already has a wide
  // buffer rather than filling in a second later.
  useObservedDevice(deviceId);

  if (!device) {
    return (
      <div className="p-4 sm:p-5">
        <EmptyState
          icon={CircuitBoard}
          title={`No device with id ${deviceId}`}
          description="It may have been removed by a simulation reset, or the id may be mistyped."
          action={
            <Button size="sm" variant="outline" render={<Link href="/devices" />}>
              Back to devices
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem] space-y-5 p-4 sm:p-5">
      <DeviceHeader device={device} />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <DeviceGaugeGrid device={device} />
          <DeviceHistoryPanel device={device} />
          <DeviceActivityPanel device={device} />
        </div>

        <div className="space-y-5">
          <DeviceAlertsPanel device={device} />
          <DeviceCommandPanel device={device} />
          <DeviceHealthPanel device={device} />
          <DeviceRulesPanel device={device} />
          <DeviceMetadataPanel device={device} />
        </div>
      </div>
    </div>
  );
}
