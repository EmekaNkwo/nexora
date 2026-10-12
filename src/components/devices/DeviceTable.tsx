"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { EmptyState, TableSkeleton } from "@/components/shared/states";
import {
  BatteryCell,
  HealthBar,
  MetricValue,
  SignalCell,
} from "@/components/shared/MetricDisplay";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/useClock";
import { useDeviceQuery } from "@/hooks/useDevices";
import { useCommandActions } from "@/hooks/useCommands";
import { setDeviceMaintenance } from "@/services/platform/platform";
import {
  DEVICE_COLUMNS,
  useDeviceViewStore,
  type DeviceColumnKey,
} from "@/stores/deviceViewStore";
import type { DeviceSortKey, DeviceSummary } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/utils/formatting";

/**
 * The device table.
 *
 * ### Why it is virtualised, and why it is not a `<table>`
 *
 * A filter can leave 5,000 rows in the result set. Rendering them all is ~60k
 * DOM nodes and several seconds of layout, so only the visible window is
 * mounted — `@tanstack/react-virtual` over a scroll container.
 *
 * Virtualising a real `<table>` means absolutely positioning `<tr>` elements,
 * which browsers handle inconsistently. So the rows are a CSS grid instead,
 * and the table semantics are supplied explicitly via `role="table"`,
 * `role="row"` and `role="gridcell"` — plus `aria-rowcount` so a screen reader
 * is told the *true* total rather than the dozen currently in the DOM.
 *
 * ### Why cells are cheap
 *
 * Every row re-renders when its device's telemetry changes, which at the
 * fleet's reporting rate is often. So each cell is a small, allocation-light
 * component, timestamps share one clock tick via `useNow`, and the row's
 * sparkline (where enabled) is a canvas Web Component React never diffs.
 */

const ROW_HEIGHT = 48;
/** Rows rendered beyond the viewport, to cover fast scrolling. */
const OVERSCAN = 12;

/** Grid template per column, in the order declared by DEVICE_COLUMNS. */
const COLUMN_WIDTHS: Record<DeviceColumnKey, string> = {
  device: "minmax(11rem, 1.6fr)",
  type: "minmax(8rem, 1fr)",
  location: "minmax(9rem, 1.2fr)",
  status: "minmax(7rem, 0.9fr)",
  primary: "minmax(6.5rem, 0.8fr)",
  battery: "minmax(8rem, 0.9fr)",
  signal: "minmax(7rem, 0.8fr)",
  lastSeen: "minmax(6rem, 0.7fr)",
  health: "minmax(6.5rem, 0.8fr)",
  actions: "3rem",
};

const SORT_KEY_BY_COLUMN: Partial<Record<DeviceColumnKey, DeviceSortKey>> = {
  device: "name",
  type: "type",
  location: "site",
  status: "status",
  primary: "primaryMetric",
  battery: "battery",
  signal: "signalStrength",
  lastSeen: "lastSeen",
  health: "healthScore",
};

function useVisibleColumns(): readonly DeviceColumnKey[] {
  const visibleColumns = useDeviceViewStore((state) => state.visibleColumns);
  return useMemo(
    () => DEVICE_COLUMNS.filter((column) => visibleColumns.includes(column.key)).map((c) => c.key),
    [visibleColumns],
  );
}

interface HeaderProps {
  readonly columns: readonly DeviceColumnKey[];
  readonly gridTemplate: string;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly onToggleAll: () => void;
}

function TableHeader({
  columns,
  gridTemplate,
  allSelected,
  someSelected,
  onToggleAll,
}: HeaderProps) {
  const sortKey = useDeviceViewStore((state) => state.sortKey);
  const sortDirection = useDeviceViewStore((state) => state.sortDirection);
  const setSort = useDeviceViewStore((state) => state.setSort);

  return (
    <div
      role="row"
      className="sticky top-0 z-10 grid items-center gap-3 border-b border-border bg-card px-3 py-2"
      style={{ gridTemplateColumns: `2rem ${gridTemplate}` }}
    >
      <Checkbox
        checked={allSelected}
        // A partial selection is `indeterminate`, not `checked` — otherwise
        // the header box would claim the whole filtered set is selected.
        indeterminate={someSelected}
        onCheckedChange={onToggleAll}
        // "Visible", not "matching": this acts on the rows currently on screen.
        // In paged mode that is one page; in continuous scroll the page is the
        // whole filtered set, so the wording stays true in both. Widening to
        // every match is a separate labelled button in the bulk bar.
        aria-label={
          allSelected ? "Deselect all visible devices" : "Select all visible devices"
        }
      />

      {columns.map((key) => {
        const column = DEVICE_COLUMNS.find((entry) => entry.key === key)!;
        const columnSortKey = SORT_KEY_BY_COLUMN[key];
        const active = columnSortKey === sortKey;

        if (!columnSortKey) {
          return (
            <div key={key} role="columnheader" className="ops-label">
              {column.label}
            </div>
          );
        }

        return (
          <div key={key} role="columnheader" aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
            <button
              type="button"
              onClick={() => setSort(columnSortKey)}
              className={cn(
                "ops-label flex items-center gap-1 transition-colors hover:text-foreground",
                active && "text-foreground",
              )}
            >
              {column.label}
              {active ? (
                sortDirection === "asc" ? (
                  <ArrowUp className="size-3" aria-hidden="true" />
                ) : (
                  <ArrowDown className="size-3" aria-hidden="true" />
                )
              ) : (
                <ChevronsUpDown className="size-3 opacity-40" aria-hidden="true" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface RowProps {
  readonly device: DeviceSummary;
  readonly columns: readonly DeviceColumnKey[];
  readonly gridTemplate: string;
  readonly selected: boolean;
  readonly onToggle: (deviceId: string) => void;
  readonly now: number;
  readonly rowIndex: number;
}

function DeviceRow({
  device,
  columns,
  gridTemplate,
  selected,
  onToggle,
  now,
  rowIndex,
}: RowProps) {
  const router = useRouter();
  const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
  const commands = useCommandActions();

  const cell = (key: DeviceColumnKey) => {
    switch (key) {
      case "device":
        return (
          <div className="min-w-0">
            <Link
              href={`/devices/${device.id}`}
              className="ops-mono block truncate font-medium hover:underline"
            >
              {device.id}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              {device.name}
            </span>
          </div>
        );
      case "type":
        return (
          <span className="truncate text-xs text-muted-foreground">
            {descriptor.label}
          </span>
        );
      case "location":
        return (
          <span className="truncate text-xs text-muted-foreground">{device.site}</span>
        );
      case "status":
        return (
          <StatusIndicator
            status={device.status}
            pulse={device.status === "updating"}
          />
        );
      case "primary":
        return <MetricValue metric={device.primaryMetric} value={device.primaryValue} />;
      case "battery":
        return (
          <BatteryCell value={device.battery} mainsPowered={descriptor.mainsPowered} />
        );
      case "signal":
        return <SignalCell value={device.signalStrength} />;
      case "lastSeen":
        return (
          <span className="tabular truncate text-xs text-muted-foreground">
            {now === 0 ? "—" : formatRelativeTime(device.lastSeen, now)}
          </span>
        );
      case "health":
        return <HealthBar score={device.healthScore} />;
      case "actions":
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Actions for ${device.id}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => router.push(`/devices/${device.id}`)}>
                Open device
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => commands.send(device.id, "telemetry.request")}
              >
                Request telemetry
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => commands.send(device.id, "fan.on")}>
                Turn fan on
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => commands.send(device.id, "device.calibrate")}
              >
                Trigger calibration
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  setDeviceMaintenance(device.id, device.status !== "maintenance")
                }
              >
                {device.status === "maintenance"
                  ? "End maintenance"
                  : "Place in maintenance"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => commands.send(device.id, "device.restart")}
              >
                Restart device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
    }
  };

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-selected={selected}
      className={cn(
        "grid items-center gap-3 border-b border-border/60 px-3 transition-colors hover:bg-accent/30",
        selected && "bg-primary/5",
      )}
      style={{ gridTemplateColumns: `2rem ${gridTemplate}`, height: ROW_HEIGHT }}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(device.id)}
        aria-label={`Select ${device.id}`}
      />
      {columns.map((key) => (
        <div key={key} role="gridcell" className="min-w-0">
          {cell(key)}
        </div>
      ))}
    </div>
  );
}

export function DeviceTable() {
  const { rows, page, pageIds, filteredCount, totalCount } = useDeviceQuery();
  const columns = useVisibleColumns();
  const selectedIds = useDeviceViewStore((state) => state.selectedIds);
  const toggleSelected = useDeviceViewStore((state) => state.toggleSelected);
  const selectOnly = useDeviceViewStore((state) => state.selectOnly);
  const selectMany = useDeviceViewStore((state) => state.selectMany);
  const now = useNow();

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const gridTemplate = useMemo(
    () => columns.map((key) => COLUMN_WIDTHS[key]).join(" "),
    [columns],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Paging keeps the scroll container but replaces its contents, so without
  // this the operator lands halfway down page 2 at whatever offset they left
  // page 1 — and with a short last page, potentially past the end entirely.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page.page]);

  // Scoped to the visible page. When paginated, a header checkbox that
  // silently selects 1,200 devices while 50 are on screen is a trap — the
  // operator cannot see what they just selected. Widening to the whole
  // filtered set is a separate, explicitly labelled action in the bulk bar.
  // In continuous-scroll mode the page *is* the filtered set, so the two
  // meanings coincide and nothing is lost.
  const pageSelectedCount = pageIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = pageIds.length > 0 && pageSelectedCount === pageIds.length;
  const someSelected = pageSelectedCount > 0 && !allSelected;

  const onToggleAll = useCallback(() => {
    if (allSelected) {
      // Deselect just this page, leaving selections on other pages intact.
      const onPage = new Set(pageIds);
      selectOnly([...selectedIds].filter((id) => !onPage.has(id)));
      return;
    }
    selectMany(pageIds);
  }, [allSelected, selectMany, selectOnly, selectedIds, pageIds]);

  if (totalCount === 0) {
    return <TableSkeleton rows={10} columns={columns.length} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No devices match these filters"
        description="Try clearing a filter or widening the health range."
      />
    );
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      role="table"
      aria-label="Devices"
      aria-rowcount={filteredCount + 1}
      aria-colcount={columns.length + 1}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TableHeader
        columns={columns}
        gridTemplate={gridTemplate}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggleAll={onToggleAll}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Spacer div sized to the full list, with only the visible window
            absolutely positioned inside it. */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const device = rows[virtualRow.index];
            if (!device) return null;
            return (
              <div
                key={device.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <DeviceRow
                  device={device}
                  columns={columns}
                  gridTemplate={gridTemplate}
                  selected={selectedIds.has(device.id)}
                  onToggle={toggleSelected}
                  now={now}
                  // Absolute within the filtered set, not within the page.
                  // `aria-rowcount` below is the full filtered count, so a row
                  // on page 3 must announce as row 101, not row 1.
                  rowIndex={virtualRow.index + page.from - 1}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
