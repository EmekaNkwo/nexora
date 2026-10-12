"use client";

import { ArrowLeft, Fan, RotateCcw, Snowflake, Wrench } from "lucide-react";
import Link from "next/link";

import { StatBlock } from "@/components/shared/KpiTile";
import { HealthBar } from "@/components/shared/MetricDisplay";
import { StatusIndicator } from "@/components/shared/web-component-bridges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/useClock";
import { useDeviceCommandActions } from "@/hooks/useCommands";
import { useDeviceRuntime } from "@/hooks/useDeviceHealth";
import { setDeviceMaintenance } from "@/services/platform/platform";
import type { Device } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { formatDate, formatRelativeTime, formatTime } from "@/utils/formatting";

/**
 * Device page header.
 *
 * The runtime badges (fan running, calibrating, fault active) come straight
 * from the simulator rather than from the device record. They are physical
 * state, not domain data — and showing them is what makes the rule → command →
 * cooling loop legible: when a rule switches a fan on, the badge appears here
 * and the temperature chart below starts falling.
 */
export function DeviceHeader({ device }: { readonly device: Device }) {
  const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];
  const runtime = useDeviceRuntime(device.id);
  const commands = useDeviceCommandActions(device.id);
  const now = useNow();

  return (
    <header className="space-y-4">
      <Link
        href="/devices"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All devices
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="ops-mono text-lg font-semibold tracking-tight">
              {device.id}
            </h2>
            <StatusIndicator
              status={device.status}
              uppercase
              pulse={device.status === "updating"}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {descriptor.label} · {device.model} · {device.location.site}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {runtime?.fanOn ? (
              <Badge variant="secondary" className="gap-1 text-[0.65rem]">
                <Fan className="size-3 animate-spin" aria-hidden="true" /> Fan running
              </Badge>
            ) : null}
            {runtime?.calibrating ? (
              <Badge variant="secondary" className="gap-1 text-[0.65rem]">
                <Snowflake className="size-3" aria-hidden="true" /> Calibrating
              </Badge>
            ) : null}
            {runtime?.faultActive ? (
              <Badge
                variant="secondary"
                className="gap-1 bg-status-critical/15 text-[0.65rem] text-status-critical"
              >
                Sensor fault active
              </Badge>
            ) : null}
            {runtime?.muted ? (
              <Badge variant="secondary" className="text-[0.65rem]">
                Telemetry paused
              </Badge>
            ) : null}
            {device.faulty ? (
              <Badge variant="outline" className="text-[0.65rem]">
                Flagged for service
              </Badge>
            ) : null}
            {device.mode !== "normal" ? (
              <Badge variant="outline" className="text-[0.65rem] capitalize">
                {device.mode} mode
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => commands.send(runtime?.fanOn ? "fan.off" : "fan.on")}
                >
                  <Fan className="size-3.5" aria-hidden="true" />
                  {runtime?.fanOn ? "Fan off" : "Fan on"}
                </Button>
              }
            />
            <TooltipContent>
              Engages active cooling. Temperature genuinely falls while it runs.
            </TooltipContent>
          </Tooltip>

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => commands.send("telemetry.request")}
          >
            Request telemetry
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              setDeviceMaintenance(device.id, device.status !== "maintenance")
            }
          >
            <Wrench className="size-3.5" aria-hidden="true" />
            {device.status === "maintenance" ? "End maintenance" : "Maintenance"}
          </Button>

          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => commands.send("device.restart")}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Restart
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatBlock
          label="Health"
          value={<HealthBar score={device.healthScore} width="4rem" />}
        />
        <StatBlock label="Firmware" value={device.firmwareVersion} />
        <StatBlock label="Group" value={device.groupId.replace("grp-", "")} />
        <StatBlock
          label="Last seen"
          value={
            now === 0 ? formatTime(device.lastSeen) : formatRelativeTime(device.lastSeen, now)
          }
        />
        <StatBlock label="Provisioned" value={formatDate(device.createdAt)} />
      </div>
    </header>
  );
}
