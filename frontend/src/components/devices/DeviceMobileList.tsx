"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { EmptyState } from "@/components/shared/states";
import { BatteryCell, HealthBar, MetricValue } from "@/components/shared/MetricDisplay";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { Checkbox } from "@/components/ui/checkbox";
import { useNow } from "@/hooks/useClock";
import { useDeviceQuery } from "@/hooks/useDevices";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/utils/formatting";

/**
 * Device list for small screens.
 *
 * The table becomes cards rather than a horizontally scrolling table, because
 * a nine-column table on a 390 px viewport is not a table — it is a scrolling
 * puzzle. Each card leads with the two things that matter on a phone (which
 * device, and is it alright), and selection still works so bulk actions are
 * available on mobile too.
 *
 * Still virtualised: the filtered set can be thousands of cards.
 */

const CARD_HEIGHT = 104;

export function DeviceMobileList() {
  const { rows, totalCount } = useDeviceQuery();
  const selectedIds = useDeviceViewStore((state) => state.selectedIds);
  const toggleSelected = useDeviceViewStore((state) => state.toggleSelected);
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 8,
  });

  if (totalCount > 0 && rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No devices match these filters"
        description="Try clearing a filter or widening the health range."
      />
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const device = rows[virtualRow.index];
          if (!device) return null;
          const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
          const selected = selectedIds.has(device.id);

          return (
            <div
              key={device.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                height: CARD_HEIGHT,
              }}
            >
              <article
                className={cn(
                  "mx-3 my-1.5 flex gap-3 rounded-lg border border-border bg-card p-3",
                  selected && "border-primary/40 bg-primary/5",
                )}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => toggleSelected(device.id)}
                  aria-label={`Select ${device.id}`}
                  className="mt-0.5"
                />

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/devices/${device.id}`}
                      className="ops-mono truncate font-medium"
                    >
                      {device.id}
                    </Link>
                    <StatusIndicator status={device.status} compact />
                  </div>

                  <p className="truncate text-xs text-muted-foreground">
                    {descriptor.label} · {device.site}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <MetricValue
                      metric={device.primaryMetric}
                      value={device.primaryValue}
                      showLabel
                    />
                    <BatteryCell
                      value={device.battery}
                      mainsPowered={descriptor.mainsPowered}
                    />
                    <HealthBar score={device.healthScore} width="2.5rem" />
                    <span className="tabular text-[0.7rem] text-muted-foreground">
                      {now === 0 ? "" : formatRelativeTime(device.lastSeen, now)}
                    </span>
                  </div>
                </div>

                <Link
                  href={`/devices/${device.id}`}
                  aria-label={`Open ${device.id}`}
                  className="grid shrink-0 place-items-center self-center rounded p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}
