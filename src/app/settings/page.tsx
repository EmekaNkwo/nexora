"use client";

import { SlidersHorizontal } from "lucide-react";

import { FleetReadyGate, ListSkeleton } from "@/components/shared/FleetReadyGate";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/shared/Panel";
import { InlineHint } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import type { MetricKey } from "@/types/telemetry";
import { useThresholdStore } from "@/stores/thresholdStore";
import type { ThresholdProfile } from "@/services/telemetry/thresholds";
import { cn } from "@/lib/utils";

/**
 * Threshold configuration.
 *
 * Edits apply to the next ingested telemetry frame — the ingestion pipeline
 * resolves thresholds per snapshot rather than caching them, so lowering a
 * critical limit here immediately changes which devices read as critical on
 * the dashboard. That immediacy is the whole point: a settings screen whose
 * changes only take effect after a reload is a form, not a control.
 *
 * Profiles are layered (default → device type → group) and only the metrics a
 * profile overrides are shown, which keeps the hierarchy visible rather than
 * flattening it into one long list of duplicated numbers.
 */
export default function SettingsPage() {
  return (
    <FleetReadyGate fallback={<ListSkeleton />}>
      <SettingsContent />
    </FleetReadyGate>
  );
}

function scopeDescription(profile: ThresholdProfile): string {
  switch (profile.scope.kind) {
    case "default":
      return "Applies to every device unless a more specific profile overrides it";
    case "type":
      return `Overrides the fleet default for ${DEVICE_TYPE_DESCRIPTORS[profile.scope.deviceType].label}s`;
    case "group":
      return `Overrides for devices in ${profile.scope.groupId.replace("grp-", "")}`;
  }
}

function SettingsContent() {
  const profiles = useThresholdStore((state) => state.profiles);
  const updateThreshold = useThresholdStore((state) => state.updateThreshold);
  const setProfileEnabled = useThresholdStore((state) => state.setProfileEnabled);
  const resetToDefaults = useThresholdStore((state) => state.resetToDefaults);

  return (
    <div className="mx-auto max-w-[80rem] space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Alert thresholds</h2>
          <p className="text-xs text-muted-foreground">
            Changes take effect on the next telemetry frame — within a second, with no
            reload — and are kept in this browser across sessions.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={resetToDefaults} className="text-xs">
          Reset to defaults
        </Button>
      </div>

      <InlineHint tone="info">
        <strong className="font-medium">Recovery</strong> implements hysteresis: an open
        alert stays open until the reading crosses back past the recovery level, not
        merely back under the firing level. Without it, a value hovering at the threshold
        would open and close an alert every few seconds.
      </InlineHint>

      {profiles.map((profile) => {
        const metrics = Object.keys(profile.thresholds) as MetricKey[];

        return (
          <Panel key={profile.id} flush>
            <PanelHeader
              title={profile.name}
              description={scopeDescription(profile)}
              icon={<SlidersHorizontal className="size-4" />}
              headingLevel={3}
              actions={
                <Badge variant="outline" className="text-[0.62rem]">
                  {profile.scope.kind === "default"
                    ? "fleet default"
                    : `${profile.scope.kind} override`}
                </Badge>
              }
            />
            <PanelBody flush>
              <div className="divide-y divide-border">
                {metrics.map((metric) => {
                  const threshold = profile.thresholds[metric];
                  if (!threshold) return null;
                  const descriptor = METRIC_DESCRIPTORS[metric];

                  return (
                    <div
                      key={metric}
                      className="grid gap-3 px-4 py-3 sm:grid-cols-[12rem_1fr]"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-sm"
                            style={{ background: descriptor.chartColor }}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-medium">{descriptor.label}</span>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={threshold.enabled}
                            onCheckedChange={(checked) =>
                              setProfileEnabled(profile.id, metric, checked)
                            }
                            aria-label={`${threshold.enabled ? "Disable" : "Enable"} ${descriptor.label} thresholds`}
                          />
                          {threshold.enabled ? "Enabled" : "Disabled"}
                        </label>
                        <p className="text-[0.68rem] text-muted-foreground">
                          Fires when the reading goes{" "}
                          <strong className="font-medium">{threshold.direction}</strong> the
                          limit
                        </p>
                      </div>

                      <div
                        className={cn(
                          "grid gap-3 sm:grid-cols-3",
                          !threshold.enabled && "opacity-50",
                        )}
                      >
                        <ThresholdField
                          id={`${profile.id}-${metric}-warning`}
                          label="Warning"
                          tone="warning"
                          unit={descriptor.unit}
                          value={threshold.warning}
                          disabled={!threshold.enabled}
                          onChange={(value) =>
                            updateThreshold(profile.id, metric, { warning: value })
                          }
                        />
                        <ThresholdField
                          id={`${profile.id}-${metric}-critical`}
                          label="Critical"
                          tone="critical"
                          unit={descriptor.unit}
                          value={threshold.critical}
                          disabled={!threshold.enabled}
                          onChange={(value) =>
                            updateThreshold(profile.id, metric, { critical: value })
                          }
                        />
                        <ThresholdField
                          id={`${profile.id}-${metric}-recovery`}
                          label="Recovery"
                          tone="online"
                          unit={descriptor.unit}
                          value={threshold.recovery}
                          disabled={!threshold.enabled}
                          onChange={(value) =>
                            updateThreshold(profile.id, metric, { recovery: value })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </PanelBody>
            <PanelFooter>
              <span>
                {metrics.length} metric{metrics.length === 1 ? "" : "s"} configured in this
                profile
              </span>
            </PanelFooter>
          </Panel>
        );
      })}
    </div>
  );
}

interface ThresholdFieldProps {
  readonly id: string;
  readonly label: string;
  readonly tone: "warning" | "critical" | "online";
  readonly unit: string;
  readonly value: number | null;
  readonly disabled: boolean;
  readonly onChange: (value: number | null) => void;
}

function ThresholdField({
  id,
  label,
  tone,
  unit,
  value,
  disabled,
  onChange,
}: ThresholdFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className={cn(
          "ops-label",
          tone === "warning" && "text-status-warning",
          tone === "critical" && "text-status-critical",
          tone === "online" && "text-status-online",
        )}
      >
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          value={value ?? ""}
          disabled={disabled}
          placeholder="none"
          onChange={(event) => {
            const raw = event.target.value;
            // An empty field means "no limit at this level", not zero.
            onChange(raw === "" ? null : Number(raw));
          }}
          className="tabular h-8 text-xs"
        />
        <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
