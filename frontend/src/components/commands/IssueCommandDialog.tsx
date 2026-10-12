"use client";

import { useMemo, useState } from "react";

import { SelectField, TextField } from "@/components/shared/fields";
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
import {
  COMMAND_DESCRIPTORS,
  COMMAND_TYPES,
  type CommandType,
} from "@/types/commands";
import { formatDuration } from "@/utils/formatting";

/**
 * Issuing a command.
 *
 * Previously a permanently-mounted sidebar panel, which gave a one-off action
 * a third of the screen on every visit — while the command *history*, the
 * reason to be on this page, was squeezed beside it. As a dialog the history
 * gets the full width and the form appears when it is wanted.
 *
 * The latency and failure-rate figures come along, because they are what makes
 * the choice informed: a command with a 4% failure rate and a 12-second round
 * trip behaves differently from an instant one, and the operator should see
 * that before sending, not after.
 */
export interface IssueCommandDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSend: (deviceId: string, type: CommandType) => void;
  /** Pre-fills the target, e.g. when opened from a device row. */
  readonly initialDeviceId?: string;
}

const COMMAND_OPTIONS = COMMAND_TYPES.filter((type) => type !== "firmware.update").map(
  (type) => ({ value: type, label: COMMAND_DESCRIPTORS[type].label }),
);

export function IssueCommandDialog({
  open,
  onOpenChange,
  onSend,
  initialDeviceId = "",
}: IssueCommandDialogProps) {
  const devices = useDeviceSummaries();
  const [targetId, setTargetId] = useState(initialDeviceId);
  const [commandType, setCommandType] = useState<CommandType>("telemetry.request");

  const resolvedTarget = useMemo(() => {
    const needle = targetId.trim().toUpperCase();
    if (needle.length === 0) return null;
    return devices.find((device) => device.id === needle) ?? null;
  }, [devices, targetId]);

  const descriptor = COMMAND_DESCRIPTORS[commandType];
  const unknownDevice = targetId.trim().length > 0 && !resolvedTarget;

  const send = (): void => {
    if (!resolvedTarget) return;
    onSend(resolvedTarget.id, commandType);
    onOpenChange(false);
    setTargetId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight">
            Issue command
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Sent over the simulated transport — it will pass through queued → sent →
            acknowledged → completed, and can fail or time out.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <TextField
            label="Device ID"
            value={targetId}
            onChange={setTargetId}
            placeholder="LAG-1000"
            inputClassName="ops-mono uppercase"
            error={unknownDevice ? "No device with that id." : null}
            hint={
              resolvedTarget
                ? `${resolvedTarget.site} · ${resolvedTarget.status}`
                : "Enter a device id, or use ⌘K to find one."
            }
          />

          <SelectField
            label="Command"
            value={commandType}
            onChange={setCommandType}
            options={COMMAND_OPTIONS}
            hint={descriptor.description}
          />

          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <dt className="ops-label">Typical latency</dt>
              <dd className="tabular text-xs">
                {formatDuration(descriptor.baseLatencyMs)}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="ops-label">Failure rate</dt>
              <dd className="tabular text-xs">
                {(descriptor.failureChance * 100).toFixed(1)}%
              </dd>
            </div>
          </dl>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={send}
            disabled={!resolvedTarget}
            variant={descriptor.destructive ? "destructive" : "default"}
          >
            Send command
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
