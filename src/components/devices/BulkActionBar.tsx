"use client";

import { AlertTriangle, Boxes, RotateCcw, UploadCloud, Wind, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/shared/fields";
import { useBatchProgress, useCommandActions } from "@/hooks/useCommands";
import { useFirmwareActions, useFirmwareCatalogue } from "@/hooks/useFirmware";
import { useDeviceViewStore } from "@/stores/deviceViewStore";
import { useDeviceQuery, useSelectedDeviceIds } from "@/hooks/useDevices";
import { COMMAND_DESCRIPTORS, type CommandType } from "@/types/commands";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/utils/formatting";

/**
 * Bulk action bar.
 *
 * Appears only when something is selected, and insists on confirmation for
 * anything destructive. The confirmation dialog states the exact device count,
 * because "Restart" with 1,247 devices selected is a materially different
 * action from "Restart" with one — and the whole point of a bulk control is
 * that it is easy to do something large by accident.
 *
 * Progress is tracked by batch id, so the operator can watch a 500-device
 * restart drain rather than being told "done" the instant the commands were
 * queued.
 */

type PendingAction =
  | { readonly kind: "command"; readonly type: CommandType }
  | { readonly kind: "firmware" }
  | null;

export function BulkActionBar() {
  const selectedIds = useSelectedDeviceIds();
  const { matchingIds, filteredCount } = useDeviceQuery();
  const clearSelection = useDeviceViewStore((state) => state.clearSelection);
  const selectOnly = useDeviceViewStore((state) => state.selectOnly);
  const commands = useCommandActions();
  const firmware = useFirmwareActions();
  const catalogue = useFirmwareCatalogue();

  const [pending, setPending] = useState<PendingAction>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [targetVersion, setTargetVersion] = useState(
    catalogue[catalogue.length - 1]?.version ?? "v2.4.0",
  );

  const progress = useBatchProgress(batchId);
  const count = selectedIds.length;

  if (count === 0) return null;

  const run = (): void => {
    if (!pending) return;
    if (pending.kind === "command") {
      setBatchId(commands.sendBulk(selectedIds, pending.type));
    } else {
      firmware.startRollout(selectedIds, targetVersion, 8);
      setBatchId(null);
    }
    setPending(null);
    clearSelection();
  };

  const quickAction = (type: CommandType): void => {
    const descriptor = COMMAND_DESCRIPTORS[type];
    if (descriptor.destructive) {
      setPending({ kind: "command", type });
      return;
    }
    setBatchId(commands.sendBulk(selectedIds, type));
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
        role="region"
        aria-label="Bulk actions"
      >
        <span className="text-xs font-medium">
          {formatNumber(count)} device{count === 1 ? "" : "s"} selected
        </span>

        {/* Only offered when it would actually widen the selection — i.e. the
            operator has paged rows and more match than are selected. */}
        {count < filteredCount ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-[0.7rem]"
            onClick={() => selectOnly(matchingIds)}
          >
            Select all {formatNumber(filteredCount)} matching
          </Button>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => setPending({ kind: "command", type: "device.restart" })}
            className="gap-1.5"
          >
            <RotateCcw className="size-3" aria-hidden="true" /> Restart
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => quickAction("fan.on")}
            className="gap-1.5"
          >
            <Wind className="size-3" aria-hidden="true" /> Fan on
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => quickAction("device.calibrate")}
            className="gap-1.5"
          >
            Calibrate
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setPending({ kind: "firmware" })}
            className="gap-1.5"
          >
            <UploadCloud className="size-3" aria-hidden="true" /> Update firmware
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => quickAction("telemetry.request")}
            className="gap-1.5"
          >
            <Boxes className="size-3" aria-hidden="true" /> Request telemetry
          </Button>
        </div>

        {progress && progress.total > 0 ? (
          <span className="tabular ml-auto text-xs text-muted-foreground">
            {progress.settled}/{progress.total} settled ·{" "}
            {formatPercent(progress.progress * 100)}
            {progress.failed > 0 ? (
              <span className="ml-1.5 text-status-critical">{progress.failed} failed</span>
            ) : null}
          </span>
        ) : null}

        <Button
          size="icon-xs"
          variant="ghost"
          onClick={clearSelection}
          aria-label="Clear selection"
          className={cn(progress && progress.total > 0 ? "" : "ml-auto")}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-status-warning" aria-hidden="true" />
              {pending?.kind === "firmware"
                ? "Update firmware"
                : pending
                  ? COMMAND_DESCRIPTORS[pending.type].label
                  : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {pending?.kind === "firmware" ? (
                <>
                  This will start a staged rollout to {formatNumber(count)} device
                  {count === 1 ? "" : "s"}. Devices enter the updating state and stop
                  reporting telemetry while they install and reboot.
                </>
              ) : pending ? (
                <>
                  {COMMAND_DESCRIPTORS[pending.type].description} This will be sent to{" "}
                  {formatNumber(count)} device{count === 1 ? "" : "s"}.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {pending?.kind === "firmware" ? (
            <SelectField
              label="Target version"
              value={targetVersion}
              onChange={setTargetVersion}
              options={[...catalogue].reverse().map((version) => ({
                value: version.version,
                label: version.version,
                meta: version.channel,
              }))}
            />
          ) : null}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={
                pending?.kind === "command" && COMMAND_DESCRIPTORS[pending.type].destructive
                  ? "destructive"
                  : "default"
              }
              onClick={run}
            >
              {pending?.kind === "firmware"
                ? `Update ${formatNumber(count)} devices`
                : `Confirm for ${formatNumber(count)} devices`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
