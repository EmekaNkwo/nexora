"use client";

import { useMemo, useState } from "react";

import { SelectField, TextAreaField, TextField } from "@/components/shared/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FirmwareChannel, FirmwareVersion } from "@/types/firmware";

/**
 * Registering a new firmware build.
 *
 * There is no file to upload — there is no server, and a fake file input that
 * discarded its bytes would be a lie. What the console actually needs from a
 * build is its *metadata*: the version it will report, the channel it belongs
 * to, how large it is (which drives the simulated download time) and what
 * changed. So that is what this collects, and the wording says "register"
 * rather than pretending a binary moved.
 */
export interface UploadFirmwareDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly existingVersions: readonly string[];
  readonly onSubmit: (version: FirmwareVersion) => void;
}

const CHANNEL_OPTIONS = [
  { value: "stable" as const, label: "Stable", meta: "fleet-wide" },
  { value: "beta" as const, label: "Beta", meta: "pilot only" },
];

/** `v` followed by three dot-separated numbers — the convention in use. */
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

export function UploadFirmwareDialog({
  open,
  onOpenChange,
  existingVersions,
  onSubmit,
}: UploadFirmwareDialogProps) {
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState<FirmwareChannel>("beta");
  const [sizeMb, setSizeMb] = useState("8.0");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const versionError = useMemo(() => {
    const trimmed = version.trim();
    if (trimmed.length === 0) return "Version is required";
    if (!VERSION_PATTERN.test(trimmed)) return "Use the format v2.5.0";
    if (existingVersions.includes(trimmed)) return `${trimmed} is already registered`;
    return null;
  }, [version, existingVersions]);

  const sizeError = useMemo(() => {
    const parsed = Number(sizeMb);
    if (!Number.isFinite(parsed) || parsed <= 0) return "Size must be a positive number";
    if (parsed > 512) return "That is implausibly large for a device image";
    return null;
  }, [sizeMb]);

  const valid = !versionError && !sizeError;

  const reset = (): void => {
    setVersion("");
    setChannel("beta");
    setSizeMb("8.0");
    setNotes("");
    setSubmitted(false);
  };

  const close = (next: boolean): void => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = (): void => {
    setSubmitted(true);
    if (!valid) return;

    onSubmit({
      version: version.trim(),
      channel,
      sizeMb: Number(sizeMb),
      // Released now: this build did not exist until the operator added it.
      releasedAt: Date.now(),
      notes: notes
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    });
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight">
            Register firmware build
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Adds a version to the catalogue so it can be rolled out. Metadata only — no
            image is transferred in this simulation.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <TextField
            label="Version"
            value={version}
            onChange={setVersion}
            placeholder="v2.5.0"
            inputClassName="ops-mono"
            error={submitted ? versionError : null}
            hint="The version devices will report once installed."
          />

          <SelectField
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
            hint={
              channel === "beta"
                ? "Beta builds are offered for pilots but excluded from “latest stable”."
                : "Stable builds become the fleet-wide target."
            }
          />

          <TextField
            label="Image size (MB)"
            type="number"
            min={0.1}
            step={0.1}
            value={sizeMb}
            onChange={setSizeMb}
            error={submitted ? sizeError : null}
            hint="Drives how long the simulated download stage takes."
          />

          <TextAreaField
            label="Release notes"
            value={notes}
            onChange={setNotes}
            rows={4}
            placeholder={"One change per line\nMQTT keep-alive fixes"}
            hint="One per line. Shown on the catalogue entry."
          />
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitted && !valid}>
            Register build
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
