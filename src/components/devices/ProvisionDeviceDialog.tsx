"use client";

import { Check, CircleAlert, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField, TextField } from "@/components/shared/fields";
import { useFirmwareCatalogue } from "@/hooks/useFirmware";
import { useLogicalGroups } from "@/hooks/useGroups";
import { PROVISION_STAGE_LABELS } from "@/services/provisioning/provisioningService";
import { SITES } from "@/services/simulator/locations";
import { provisionDevice, validateProvisionRequest } from "@/services/platform/platform";
import { useDeviceStore } from "@/stores/deviceStore";
import { DEVICE_TYPES, DEVICE_TYPE_DESCRIPTORS, PROVISION_STAGES } from "@/types/device";
import type { DeviceType, ProvisionRequest } from "@/types/device";
import { cn } from "@/lib/utils";

/**
 * Device provisioning.
 *
 * Validation runs before the flow starts, not during it: a duplicate device id
 * or a bad format is a form error, and only a plausible request should be
 * allowed to become a provisioning job that can then fail for a *realistic*
 * reason (a rejected certificate).
 *
 * The staged progress is live — each stage arrives as its own event from the
 * provisioning service, so the dialog is reporting a real handshake rather
 * than animating a predetermined sequence.
 */

interface FormState {
  readonly id: string;
  readonly name: string;
  readonly type: DeviceType;
  readonly model: string;
  readonly groupId: string;
  readonly firmwareVersion: string;
  readonly siteId: string;
}

export function ProvisionDeviceDialog() {
  const groups = useLogicalGroups();
  const catalogue = useFirmwareCatalogue();
  const provisionJobs = useDeviceStore((state) => state.provisionJobs);

  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(() => ({
    id: "",
    name: "",
    type: "temperature-sensor",
    model: DEVICE_TYPE_DESCRIPTORS["temperature-sensor"].models[0]!,
    groupId: "grp-cold-storage",
    firmwareVersion: catalogue[catalogue.length - 1]?.version ?? "v2.4.0",
    siteId: SITES[0]!.id,
  }));

  const models = DEVICE_TYPE_DESCRIPTORS[form.type].models;

  const activeJob = useMemo(
    () => provisionJobs.find((job) => job.request.id === submittedId),
    [provisionJobs, submittedId],
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // Changing the type invalidates the model — reset it rather than leaving
      // a model that does not exist for the new type.
      if (key === "type") {
        next.model = DEVICE_TYPE_DESCRIPTORS[value as DeviceType].models[0]!;
      }
      return next;
    });
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const buildRequest = (): ProvisionRequest => {
    const site = SITES.find((candidate) => candidate.id === form.siteId) ?? SITES[0]!;
    return {
      id: form.id.trim().toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      model: form.model,
      groupId: form.groupId,
      firmwareVersion: form.firmwareVersion,
      location: {
        lat: site.lat,
        lng: site.lng,
        site: site.name,
        city: site.city,
        region: site.region,
      },
    };
  };

  const submit = (): void => {
    const request = buildRequest();
    const result = validateProvisionRequest(request);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmittedId(request.id);
    provisionDevice(request);
  };

  const reset = (): void => {
    setSubmittedId(null);
    setErrors({});
    setForm((current) => ({ ...current, id: "", name: "" }));
  };

  const closeAndReset = (next: boolean): void => {
    setOpen(next);
    if (!next) reset();
  };

  const stageIndex = activeJob
    ? PROVISION_STAGES.indexOf(activeJob.stage === "failed" ? "authenticating" : activeJob.stage)
    : -1;

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden="true" />
        Add device
      </Button>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Provision device</DialogTitle>
          <DialogDescription className="text-xs">
            Registers a new device with the platform and brings it online. The device
            begins reporting telemetry from its type profile as soon as it connects.
          </DialogDescription>
        </DialogHeader>

        {submittedId && activeJob ? (
          <div className="space-y-3 py-1">
            <p className="ops-mono text-xs">{submittedId}</p>
            <ol className="space-y-2">
              {PROVISION_STAGES.map((stage, index) => {
                const reached = stageIndex >= index;
                const current = activeJob.stage === stage;
                const failed = activeJob.stage === "failed" && index === 1;
                return (
                  <li key={stage} className="flex items-center gap-2.5 text-xs">
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        failed && "border-status-critical text-status-critical",
                        !failed && reached && !current && "border-status-online bg-status-online/15 text-status-online",
                        !failed && current && "border-primary text-primary",
                        !reached && "border-border text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {failed ? (
                        <CircleAlert className="size-2.5" />
                      ) : current ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : reached ? (
                        <Check className="size-2.5" />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        current && "font-medium",
                        !reached && "text-muted-foreground/60",
                      )}
                    >
                      {PROVISION_STAGE_LABELS[stage]}
                    </span>
                  </li>
                );
              })}
            </ol>

            {activeJob.stage === "failed" ? (
              <p className="rounded-md border border-status-critical/40 bg-status-critical/10 px-2.5 py-2 text-xs text-status-critical">
                {activeJob.error}
              </p>
            ) : null}

            <DialogFooter>
              {activeJob.stage === "online" ? (
                <Button size="sm" onClick={() => closeAndReset(false)}>
                  Done
                </Button>
              ) : activeJob.stage === "failed" ? (
                <Button size="sm" variant="outline" onClick={reset}>
                  Try again
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <TextField
              label="Device ID"
              error={errors.id}
              value={form.id}
              onChange={(value) => update("id", value)}
              placeholder="LAG-3092"
              inputClassName="ops-mono uppercase"
            />

            <TextField
              label="Name"
              error={errors.name}
              value={form.name}
              onChange={(value) => update("name", value)}
              placeholder="Cold Chain 3092"
            />

            <SelectField
              label="Device type"
              error={errors.type}
              value={form.type}
              onChange={(value: DeviceType) => update("type", value)}
              options={DEVICE_TYPES.map((type) => ({
                value: type,
                label: DEVICE_TYPE_DESCRIPTORS[type].label,
              }))}
            />

            <SelectField
              label="Model"
              error={errors.model}
              value={form.model}
              onChange={(value) => update("model", value)}
              options={models.map((model) => ({ value: model, label: model }))}
            />

            <SelectField
              label="Site"
              error={errors.location}
              value={form.siteId}
              onChange={(value) => update("siteId", value)}
              options={SITES.map((site) => ({ value: site.id, label: site.name }))}
            />

            <SelectField
              label="Group"
              error={errors.groupId}
              value={form.groupId}
              onChange={(value) => update("groupId", value)}
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
            />

            <SelectField
              label="Firmware"
              error={errors.firmwareVersion}
              className="sm:col-span-2"
              value={form.firmwareVersion}
              onChange={(value) => update("firmwareVersion", value)}
              options={[...catalogue].reverse().map((version) => ({
                value: version.version,
                label: version.version,
                meta: version.channel,
              }))}
            />

            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => closeAndReset(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Provision device
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

