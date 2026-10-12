"use client";

import { FilePlus2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  PILOT_SIZE,
  RolloutDialog,
  type RolloutMode,
} from "@/components/firmware/RolloutDialog";
import { UploadFirmwareDialog } from "@/components/firmware/UploadFirmwareDialog";
import { SelectField } from "@/components/shared/fields";
import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { KpiGroup, KpiTile } from "@/components/shared/KpiTile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNow } from "@/hooks/useClock";
import {
  useFirmwareActions,
  useFirmwareCatalogue,
  useFirmwareOverview,
  useRollouts,
} from "@/hooks/useFirmware";
import { injectFailure } from "@/services/platform/platform";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { useFirmwareStore, selectRolloutProgress } from "@/stores/firmwareStore";
import { FIRMWARE_STAGE_LABELS } from "@/types/firmware";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatDate,
  formatPercent,
  formatRelativeTime,
} from "@/utils/formatting";

/**
 * Firmware management.
 *
 * Rollouts are windowed rather than parallel, and this screen is built to make
 * that visible: a queue drains at a fixed concurrency, each device passes
 * through download → install → reboot, and failures are reported per device
 * rather than as a single rollout-level status. That is what an operator needs
 * to decide whether to let a rollout continue or stop it.
 */
export default function FirmwarePage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <FirmwareContent />
    </FleetReadyGate>
  );
}

function FirmwareContent() {
  const catalogue = useFirmwareCatalogue();
  const [targetVersion, setTargetVersion] = useState(
    catalogue[catalogue.length - 1]?.version ?? "v2.4.0",
  );
  const overview = useFirmwareOverview(targetVersion);
  const rollouts = useRollouts();
  const actions = useFirmwareActions();
  const jobs = useFirmwareStore((state) => state.jobs);
  const firmwareState = useFirmwareStore((state) => state);
  const now = useNow();

  const selectedVersion = useMemo(
    () => catalogue.find((entry) => entry.version === targetVersion),
    [catalogue, targetVersion],
  );

  const [rolloutMode, setRolloutMode] = useState<RolloutMode | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const addVersion = useCatalogueStore((state) => state.addVersion);

  /** Confirmed from the dialog, with whatever subset the operator kept. */
  const startRollout = (deviceIds: readonly string[]): void => {
    if (deviceIds.length === 0) return;
    actions.startRollout(deviceIds, targetVersion, 8);
  };

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Firmware</h2>
          <p className="text-xs text-muted-foreground">
            Fleet adoption and staged over-the-air rollouts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            label="Target version"
            hideLabel
            className="w-44"
            value={targetVersion}
            onChange={setTargetVersion}
            options={[...catalogue].reverse().map((version) => ({
              value: version.version,
              label: version.version,
              meta: version.channel,
            }))}
          />

          <Button
            size="sm"
            variant="outline"
            onClick={() => setUploadOpen(true)}
            className="gap-1.5"
          >
            <FilePlus2 className="size-3.5" aria-hidden="true" />
            Upload new firmware
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRolloutMode("pilot")}
            disabled={overview.outdatedDeviceIds.length === 0}
          >
            Pilot {PILOT_SIZE} devices
          </Button>
          <Button
            size="sm"
            onClick={() => setRolloutMode("full")}
            disabled={overview.outdatedDeviceIds.length === 0}
            className="gap-1.5"
          >
            <UploadCloud className="size-3.5" aria-hidden="true" />
            Update {formatCompact(overview.outdatedDeviceIds.length)} devices
          </Button>
        </div>
      </div>

      <KpiGroup minTileWidth={150}>
        <KpiTile
          label="Target version"
          value={targetVersion}
          hint={selectedVersion ? `Released ${formatDate(selectedVersion.releasedAt)}` : ""}
        />
        <KpiTile
          label="Up to date"
          value={overview.upToDateCount}
          tone="online"
          hint={`${formatPercent(
            overview.upToDateCount + overview.outdatedDeviceIds.length === 0
              ? 0
              : (overview.upToDateCount /
                  (overview.upToDateCount + overview.outdatedDeviceIds.length)) *
                  100,
          )} of fleet`}
        />
        <KpiTile
          label="Outdated"
          value={overview.outdatedDeviceIds.length}
          tone={overview.outdatedDeviceIds.length > 0 ? "warning" : "neutral"}
          hint="Eligible for rollout"
        />
        <KpiTile
          label="Active rollouts"
          value={rollouts.filter((rollout) => !rollout.finishedAt).length}
          tone="info"
        />
      </KpiGroup>

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Panel flush>
            <PanelHeader
              title="Rollouts"
              description="Devices update in windows of 8; the queue drains as each finishes"
              icon={<UploadCloud className="size-4" />}
            />
            <PanelBody flush className="max-h-[32rem] overflow-y-auto">
              {rollouts.length === 0 ? (
                <EmptyState
                  icon={UploadCloud}
                  title="No rollouts yet"
                  description="Start a rollout above, or from a bulk action on the devices page."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {rollouts.map((rollout) => {
                    const progress = selectRolloutProgress(firmwareState, rollout);
                    const rolloutJobs = jobs.filter(
                      (job) => job.rolloutId === rollout.id,
                    );
                    const inFlight = rolloutJobs.filter(
                      (job) => job.stage !== "completed" && job.stage !== "failed",
                    );

                    return (
                      <li key={rollout.id} className="space-y-2.5 px-4 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              → {rollout.toVersion}
                            </span>
                            <Badge variant="outline" className="text-[0.62rem]">
                              {formatCompact(rollout.deviceIds.length)} devices
                            </Badge>
                            {rollout.cancelled ? (
                              <Badge variant="outline" className="text-[0.62rem]">
                                cancelled
                              </Badge>
                            ) : null}
                            {rollout.finishedAt ? (
                              <Badge
                                variant="secondary"
                                className="bg-status-online/15 text-[0.62rem] text-status-online"
                              >
                                finished
                              </Badge>
                            ) : null}
                          </div>
                          <span className="tabular text-[0.7rem] text-muted-foreground">
                            {now === 0
                              ? ""
                              : formatRelativeTime(rollout.createdAt, now)}
                          </span>
                        </div>

                        <Progress
                          value={progress.progress * 100}
                          aria-label={`Rollout progress ${Math.round(progress.progress * 100)} percent`}
                        />

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
                          <span className="text-status-online">
                            {progress.completed} completed
                          </span>
                          {progress.failed > 0 ? (
                            <span className="text-status-critical">
                              {progress.failed} failed
                            </span>
                          ) : null}
                          <span>{progress.inFlight} in flight</span>
                          <span>{progress.pending} pending</span>
                          {!rollout.finishedAt && !rollout.cancelled ? (
                            <>
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-5 px-1.5 text-[0.65rem]"
                                onClick={() => actions.cancelRollout(rollout.id)}
                              >
                                Cancel queue
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-5 px-1.5 text-[0.65rem] text-status-critical"
                                onClick={() => injectFailure("firmware-failure")}
                              >
                                Inject failure
                              </Button>
                            </>
                          ) : null}
                        </div>

                        {inFlight.length > 0 ? (
                          <ul className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2.5">
                            {inFlight.slice(0, 8).map((job) => (
                              <li key={job.id} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-2 text-[0.7rem]">
                                  <Link
                                    href={`/devices/${job.deviceId}`}
                                    className="ops-mono hover:underline"
                                  >
                                    {job.deviceId}
                                  </Link>
                                  <span className="text-muted-foreground">
                                    {FIRMWARE_STAGE_LABELS[job.stage]}
                                  </span>
                                </div>
                                <span className="block h-1 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className="block h-full rounded-full bg-status-updating transition-[width] duration-200"
                                    style={{ width: `${job.progress * 100}%` }}
                                  />
                                </span>
                              </li>
                            ))}
                            {inFlight.length > 8 ? (
                              <li className="text-[0.68rem] text-muted-foreground">
                                +{inFlight.length - 8} more in flight
                              </li>
                            ) : null}
                          </ul>
                        ) : null}

                        {rolloutJobs.some((job) => job.stage === "failed") ? (
                          <ul className="space-y-1">
                            {rolloutJobs
                              .filter((job) => job.stage === "failed")
                              .slice(0, 5)
                              .map((job) => (
                                <li
                                  key={job.id}
                                  className="text-[0.7rem] text-status-critical"
                                >
                                  <Link
                                    href={`/devices/${job.deviceId}`}
                                    className="ops-mono hover:underline"
                                  >
                                    {job.deviceId}
                                  </Link>{" "}
                                  — {job.error}
                                </li>
                              ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </PanelBody>
            <PanelFooter>
              <span>
                Devices enter the updating state and stop reporting telemetry while they
                install and reboot — a failed update leaves the device on its old version.
              </span>
            </PanelFooter>
          </Panel>
        </div>

        <div className="space-y-5 xl:sticky xl:top-4 xl:self-start">
          <Panel flush>
            <PanelHeader title="Fleet adoption" headingLevel={3} />
            <PanelBody className="space-y-2.5">
              {overview.adoption.map((entry) => (
                <div key={entry.version} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      {entry.version}
                      {entry.outdated ? (
                        <span className="text-[0.62rem] text-status-warning">outdated</span>
                      ) : null}
                    </span>
                    <span className="tabular text-muted-foreground">
                      {formatCompact(entry.deviceCount)} · {formatPercent(entry.share * 100)}
                    </span>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        entry.outdated ? "bg-status-warning" : "bg-status-online",
                      )}
                      style={{ width: `${Math.max(1, entry.share * 100)}%` }}
                    />
                  </span>
                </div>
              ))}
            </PanelBody>
          </Panel>

          <Panel flush>
            <PanelHeader title="Release notes" headingLevel={3} />
            <PanelBody className="space-y-3">
              {selectedVersion ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{selectedVersion.version}</span>
                    <Badge variant="outline" className="text-[0.62rem]">
                      {selectedVersion.channel}
                    </Badge>
                  </div>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {formatDate(selectedVersion.releasedAt)} · {selectedVersion.sizeMb} MB
                  </p>
                  <ul className="space-y-1.5">
                    {selectedVersion.notes.map((note) => (
                      <li key={note} className="flex gap-2 text-xs">
                        <span className="text-muted-foreground" aria-hidden="true">
                          •
                        </span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <RolloutDialog
        key={rolloutMode ?? "closed"}
        mode={rolloutMode}
        onOpenChange={(open) => !open && setRolloutMode(null)}
        targetVersion={targetVersion}
        outdatedDeviceIds={overview.outdatedDeviceIds}
        onConfirm={startRollout}
      />

      <UploadFirmwareDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        existingVersions={catalogue.map((entry) => entry.version)}
        onSubmit={(entry) => {
          addVersion(entry);
          // Jump straight to what was just registered — the reason to add a
          // build is to roll it out, and re-selecting it by hand is friction.
          setTargetVersion(entry.version);
        }}
      />
    </div>
  );
}
