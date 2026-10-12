"use client";

import { CircuitBoard, MoveVertical, Rows3 } from "lucide-react";

import { BulkActionBar } from "@/components/devices/BulkActionBar";
import { DeviceFilterBar } from "@/components/devices/DeviceFilterBar";
import { DeviceMobileList } from "@/components/devices/DeviceMobileList";
import { DeviceTable } from "@/components/devices/DeviceTable";
import { ProvisionDeviceDialog } from "@/components/devices/ProvisionDeviceDialog";
import { ExportButton } from "@/components/shared/ExportButton";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { Pagination } from "@/components/shared/Pagination";
import { Panel, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { Button } from "@/components/ui/button";
import { useDeviceQuery } from "@/hooks/useDevices";
import { PAGE_SIZE_OPTIONS, useDeviceViewStore } from "@/stores/deviceViewStore";
import { DEVICE_EXPORT_COLUMNS } from "@/utils/export/datasets";
import { formatCompact } from "@/utils/formatting";

/**
 * The device fleet.
 *
 * The table and the mobile card list are two presentations of one query — both
 * read `useDeviceQuery`, so filtering, sorting and selection behave identically
 * regardless of viewport. Only the rendering differs, which is the right place
 * for the responsive split: a nine-column table is unusable on a phone, but
 * the underlying data question is the same.
 */
export default function DevicesPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <DevicesContent />
    </FleetReadyGate>
  );
}

function DevicesContent() {
  const { matching, page, filteredCount, totalCount, virtualised } = useDeviceQuery();
  const pageSize = useDeviceViewStore((state) => state.pageSize);
  const setPage = useDeviceViewStore((state) => state.setPage);
  const setPageSize = useDeviceViewStore((state) => state.setPageSize);
  const setVirtualised = useDeviceViewStore((state) => state.setVirtualised);

  const pager = virtualised ? null : (
    <Pagination
      page={page.page}
      pageCount={page.pageCount}
      total={page.total}
      from={page.from}
      to={page.to}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      itemLabel="devices"
      className="w-full"
    />
  );

  const modeToggle = (
    <div className="flex items-center gap-1" role="group" aria-label="Row display mode">
      <Button
        size="xs"
        variant={virtualised ? "ghost" : "secondary"}
        aria-pressed={!virtualised}
        onClick={() => setVirtualised(false)}
        className="gap-1.5 text-[0.7rem]"
      >
        <Rows3 className="size-3" aria-hidden="true" /> Pages
      </Button>
      <Button
        size="xs"
        variant={virtualised ? "secondary" : "ghost"}
        aria-pressed={virtualised}
        onClick={() => setVirtualised(true)}
        className="gap-1.5 text-[0.7rem]"
      >
        <MoveVertical className="size-3" aria-hidden="true" /> Scroll
      </Button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Device fleet</h2>
          <p className="text-xs text-muted-foreground">
            {formatCompact(totalCount)} devices across 8 sites. Select rows for bulk
            actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Exports the filtered set, not the page — the filter is the
              operator's query, and a CSV of 50 visible rows out of 1,200
              matches would be a surprising interpretation of "export". */}
          <ExportButton
            filePrefix="nexora-devices"
            rows={matching}
            columns={DEVICE_EXPORT_COLUMNS}
            noun="devices"
            size="sm"
          />
          <ProvisionDeviceDialog />
        </div>
      </div>

      <DeviceFilterBar filteredCount={filteredCount} totalCount={totalCount} />
      <BulkActionBar />

      {/* Desktop: a nine-column table, paged or continuously scrolled. */}
      <Panel flush className="hidden min-h-0 flex-1 lg:flex">
        <DeviceTable />
        <PanelFooter>
          {virtualised ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span>
                Showing all {formatCompact(filteredCount)} rows · virtualised, only the
                visible window is mounted
              </span>
              {modeToggle}
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-3">
              {modeToggle}
              <div className="min-w-0 flex-1">{pager}</div>
            </div>
          )}
        </PanelFooter>
      </Panel>

      {/* Mobile and tablet: the same query rendered as cards. */}
      <Panel flush className="min-h-0 flex-1 lg:hidden">
        <PanelHeader
          title="Devices"
          description={`${formatCompact(filteredCount)} matching`}
          icon={<CircuitBoard className="size-4" />}
          headingLevel={3}
        />
        <DeviceMobileList />
        {pager ? <PanelFooter>{pager}</PanelFooter> : null}
      </Panel>
    </div>
  );
}
