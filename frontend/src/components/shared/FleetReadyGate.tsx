"use client";

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useFleetReady } from "@/hooks/useDevices";

/**
 * Holds a page until the fleet has been seeded.
 *
 * The entire data set is generated in the browser during the shell's bootstrap
 * effect, which means the first client render genuinely has no devices. Rather
 * than let every panel render its own "no data" state for one frame — a visible
 * flash of emptiness on every page load — pages wrap in this gate and show a
 * layout-shaped skeleton instead.
 */
export function FleetReadyGate({
  children,
  fallback,
}: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const ready = useFleetReady();
  if (ready) return <>{children}</>;
  return <>{fallback ?? <DashboardSkeleton />}</>;
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto max-w-[120rem] space-y-5 p-4 sm:p-5"
      aria-busy="true"
      aria-label="Loading fleet"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-lg xl:col-span-2" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-lg xl:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

/** Narrower skeleton for list-shaped pages. */
export function ListSkeleton() {
  return (
    <div className="space-y-3 p-4 sm:p-5" aria-busy="true">
      <Skeleton className="h-9 w-full max-w-md rounded-md" />
      <Skeleton className="h-[32rem] w-full rounded-lg" />
    </div>
  );
}
