"use client";

import { Columns3, Filter, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { useGroups } from "@/hooks/useGroups";
import {
  DEVICE_COLUMNS,
  countActiveFilters,
  hasActiveFilters,
  useDeviceViewStore,
} from "@/stores/deviceViewStore";
import { DEVICE_STATUSES, DEVICE_TYPES, DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/utils/formatting";

/**
 * Device filter bar.
 *
 * The search input is *locally* controlled and debounced into the store.
 * Writing every keystroke straight to the store would re-run the filter and
 * sort over the whole fleet on each character — the input would visibly lag at
 * 5,000 devices. Local state keeps typing instant; the expensive query runs
 * once the user pauses.
 */

const SEARCH_DEBOUNCE_MS = 200;

export interface DeviceFilterBarProps {
  readonly filteredCount: number;
  readonly totalCount: number;
}

export function DeviceFilterBar({ filteredCount, totalCount }: DeviceFilterBarProps) {
  const filters = useDeviceViewStore((state) => state.filters);
  const setSearch = useDeviceViewStore((state) => state.setSearch);
  const toggleStatus = useDeviceViewStore((state) => state.toggleStatus);
  const toggleType = useDeviceViewStore((state) => state.toggleType);
  const toggleGroup = useDeviceViewStore((state) => state.toggleGroup);
  const setHealthRange = useDeviceViewStore((state) => state.setHealthRange);
  const setOnlyWithAlerts = useDeviceViewStore((state) => state.setOnlyWithAlerts);
  const resetFilters = useDeviceViewStore((state) => state.resetFilters);
  const visibleColumns = useDeviceViewStore((state) => state.visibleColumns);
  const toggleColumn = useDeviceViewStore((state) => state.toggleColumn);
  const resetColumns = useDeviceViewStore((state) => state.resetColumns);

  const groups = useGroups();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  /** Last store value this component reconciled against. */
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  const activeFilterCount = countActiveFilters(filters);

  // The store search can change from outside this component — a KPI tile
  // drilling through clears it, for instance. Reconciling during render is
  // React's documented pattern for deriving state from changed input; doing it
  // in an effect would render once with the stale draft and then again with
  // the fresh one.
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search);
    setSearchDraft(filters.search);
  }

  // Debounce the draft into the store. Typing stays instant because the input
  // is locally controlled; the expensive filter+sort over the whole fleet only
  // runs once the operator pauses.
  useEffect(() => {
    if (searchDraft === filters.search) return;
    const timer = setTimeout(() => setSearch(searchDraft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, filters.search, setSearch]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search id, name, model, site…"
          aria-label="Search devices"
          className="h-8 pl-8 pr-8 text-xs"
        />
        {searchDraft.length > 0 ? (
          <button
            type="button"
            onClick={() => setSearchDraft("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Status is the most-used filter, so it gets inline chips rather than
          being buried in a dropdown. */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
        {DEVICE_STATUSES.map((status) => {
          const active = filters.statuses.includes(status);
          return (
            <Button
              key={status}
              size="xs"
              variant={active ? "secondary" : "ghost"}
              onClick={() => toggleStatus(status)}
              aria-pressed={active}
              className={cn("gap-1.5 px-1.5", active && "ring-1 ring-ring/40")}
            >
              <StatusIndicator status={status} compact />
              <span className="hidden text-[0.7rem] capitalize sm:inline">{status}</span>
            </Button>
          );
        })}
      </div>

      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Filter className="size-3.5" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 ? (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.65rem]">
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-72 space-y-4">
          <div className="space-y-2">
            <Label className="ops-label">Device type</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {DEVICE_TYPES.map((type) => (
                <Label
                  key={type}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/40"
                >
                  <Checkbox
                    checked={filters.types.includes(type)}
                    onCheckedChange={() => toggleType(type)}
                  />
                  <span className="truncate">{DEVICE_TYPE_DESCRIPTORS[type].label}</span>
                </Label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="ops-label">Group</Label>
            <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {groups
                .filter((group) => group.kind !== "site")
                .map((group) => (
                  <Label
                    key={group.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={filters.groupIds.includes(group.id)}
                      onCheckedChange={() => toggleGroup(group.id)}
                    />
                    <span className="truncate">{group.name}</span>
                  </Label>
                ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="ops-label">Health score</Label>
              <span className="tabular text-xs text-muted-foreground">
                {filters.healthRange[0]} – {filters.healthRange[1]}
              </span>
            </div>
            <Slider
              value={[filters.healthRange[0], filters.healthRange[1]]}
              min={0}
              max={100}
              step={5}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value : [value, value];
                setHealthRange([next[0] ?? 0, next[1] ?? 100]);
              }}
              aria-label="Health score range"
            />
          </div>

          <Label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={filters.onlyWithActiveAlerts}
              onCheckedChange={(checked) => setOnlyWithAlerts(checked === true)}
            />
            Only devices with open alerts
          </Label>

          {hasActiveFilters(filters) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="w-full text-xs"
            >
              Clear all filters
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Columns3 className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Columns</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          {/* The label is a `Menu.GroupLabel`, which Base UI requires to sit
              inside a `Menu.Group`. The group covers the toggles it names and
              stops before "Reset columns", which is an action rather than a
              member of the list. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="ops-label">Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DEVICE_COLUMNS.filter((column) => !column.locked && column.label).map(
              (column) => (
                <DropdownMenuItem
                  key={column.key}
                  // Keep the menu open so several columns can be toggled in
                  // one visit. `event.preventDefault()` was doing this job and
                  // silently failing — that is the Radix idiom; Base UI closes
                  // on click unless told otherwise by this prop.
                  closeOnClick={false}
                  onClick={() => toggleColumn(column.key)}
                  className="gap-2"
                >
                  <Checkbox
                    checked={visibleColumns.includes(column.key)}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  {column.label}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={resetColumns}>Reset columns</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <p className="ml-auto shrink-0 text-xs text-muted-foreground" aria-live="polite">
        {filteredCount === totalCount
          ? `${formatCompact(totalCount)} devices`
          : `${formatCompact(filteredCount)} of ${formatCompact(totalCount)}`}
      </p>
    </div>
  );
}
