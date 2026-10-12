"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import type { DeviceSummary } from "@/types/device";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/utils/formatting";

/**
 * Checkbox list for choosing devices.
 *
 * Virtualised because the candidate set is the *outdated* fleet, which can be
 * most of several thousand devices — a plain list would mount thousands of rows
 * inside a modal.
 *
 * Selection is held by the caller rather than here: the dialogs that use this
 * need to seed it (a pilot starts with the first 24 pre-ticked) and read it
 * back on confirm, and a component that owned it privately would have to
 * expose both anyway.
 */
const ROW_HEIGHT = 44;

export interface DevicePickerProps {
  readonly devices: readonly DeviceSummary[];
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** Cap on how many can be ticked; the rest disable once reached. */
  readonly max?: number;
  readonly emptyMessage?: string;
}

export function DevicePicker({
  devices,
  selected,
  onChange,
  max,
  emptyMessage = "No devices match.",
}: DevicePickerProps) {
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return devices;
    return devices.filter(
      (device) =>
        device.id.toLowerCase().includes(needle) ||
        device.name.toLowerCase().includes(needle) ||
        device.site.toLowerCase().includes(needle),
    );
  }, [devices, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const atLimit = max !== undefined && selected.size >= max;

  const toggle = (deviceId: string): void => {
    const next = new Set(selected);
    if (next.has(deviceId)) next.delete(deviceId);
    else {
      if (atLimit) return;
      next.add(deviceId);
    }
    onChange(next);
  };

  /** Acts on the filtered set, so it means "everything you can currently see". */
  const selectFiltered = (): void => {
    const next = new Set(selected);
    for (const device of filtered) {
      if (max !== undefined && next.size >= max) break;
      next.add(device.id);
    }
    onChange(next);
  };

  const clearFiltered = (): void => {
    const next = new Set(selected);
    for (const device of filtered) next.delete(device.id);
    onChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search id, name or site…"
            aria-label="Search devices"
            className="h-8 w-full pl-8 text-xs"
          />
        </div>

        <Button size="xs" variant="outline" onClick={selectFiltered} disabled={atLimit}>
          Select {search.trim() ? "matching" : "all"}
        </Button>
        <Button size="xs" variant="ghost" onClick={clearFiltered}>
          Clear
        </Button>
      </div>

      <p className="text-[0.7rem] text-muted-foreground" role="status" aria-live="polite">
        {formatNumber(selected.size)} selected
        {max === undefined ? "" : ` of ${formatNumber(max)} max`} ·{" "}
        {formatNumber(filtered.length)} shown
      </p>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border"
        role="group"
        aria-label="Devices to include"
      >
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const device = filtered[row.index];
              if (!device) return null;
              const isSelected = selected.has(device.id);
              return (
                <label
                  key={device.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${row.start}px)`,
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-b border-border px-3 text-xs",
                    isSelected && "bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggle(device.id)}
                    disabled={!isSelected && atLimit}
                    aria-label={`Include ${device.id}`}
                  />
                  <StatusIndicator status={device.status} />
                  <span className="ops-mono shrink-0 font-medium">{device.id}</span>
                  <span className="truncate text-muted-foreground">{device.site}</span>
                  <span className="tabular ml-auto shrink-0 text-muted-foreground">
                    {device.firmwareVersion}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
