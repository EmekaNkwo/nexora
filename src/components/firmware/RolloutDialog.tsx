"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import { DevicePicker } from "@/components/shared/DevicePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeviceSummaries } from "@/hooks/useDevices";
import type { DeviceSummary } from "@/types/device";
import { formatNumber } from "@/utils/formatting";

/**
 * Device picker for a firmware rollout.
 *
 * "Update 792 devices" used to start on the whole outdated set the instant it
 * was clicked — several hundred devices going quiet with no chance to look at
 * the list first, and no undo. The rollout is now proposed rather than
 * executed: the devices are pre-ticked to match the button that opened it, and
 * the operator can narrow the set before committing.
 */
export type RolloutMode = "pilot" | "full";

/** A pilot is a sample, so the cap is what makes it one. */
export const PILOT_SIZE = 24;

export interface RolloutDialogProps {
  readonly mode: RolloutMode | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetVersion: string;
  /** Ids not already on the target version. */
  readonly outdatedDeviceIds: readonly string[];
  readonly onConfirm: (deviceIds: readonly string[]) => void;
}

export function RolloutDialog({
  mode,
  onOpenChange,
  targetVersion,
  outdatedDeviceIds,
  onConfirm,
}: RolloutDialogProps) {
  const allDevices = useDeviceSummaries();

  // Seeded once, from the button that opened the dialog: a pilot starts with
  // the first PILOT_SIZE ticked, a full rollout with everything. The parent
  // keys this component on `mode`, so a fresh open re-runs this initialiser —
  // which is why it is lazy state rather than an effect that writes state on
  // mount and triggers a second render.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        mode === "pilot" ? outdatedDeviceIds.slice(0, PILOT_SIZE) : outdatedDeviceIds,
      ),
  );

  const candidates = useMemo<readonly DeviceSummary[]>(() => {
    const outdated = new Set(outdatedDeviceIds);
    return allDevices.filter((device) => outdated.has(device.id));
  }, [allDevices, outdatedDeviceIds]);

  const count = selected.size;
  const isPilot = mode === "pilot";

  const confirm = (): void => {
    if (count === 0) return;
    onConfirm([...selected]);
    onOpenChange(false);
  };

  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight">
            {isPilot ? "Pilot rollout" : "Fleet rollout"} — {targetVersion}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isPilot
              ? `A sample of up to ${PILOT_SIZE} devices, to prove the build before committing the fleet.`
              : "Every device not already on this version. Narrow the list if you want a smaller wave."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <DevicePicker
            devices={candidates}
            selected={selected}
            onChange={setSelected}
            max={isPilot ? PILOT_SIZE : undefined}
            emptyMessage="Every device is already on this version."
          />
        </div>

        <DialogFooter className="shrink-0 flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 text-status-warning" aria-hidden="true" />
            Devices stop reporting telemetry while they install and reboot.
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={count === 0}>
              Start rollout · {formatNumber(count)} device{count === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
