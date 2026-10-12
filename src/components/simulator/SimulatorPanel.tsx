"use client";

import { Play, RotateCcw, Square, Wand2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SectionHeading } from "@/components/shared/Panel";
import { DemoWalkthrough } from "@/components/simulator/DemoWalkthrough";
import { useSimulatorControls, useSimulatorState } from "@/hooks/useSimulator";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import {
  EVENT_RATE_PROFILES,
  FAILURE_DESCRIPTORS,
  SIMULATION_SCALES,
  type EventRate,
  type SimulationFeatures,
} from "@/types/simulation";
import { formatCompact, formatNumber } from "@/utils/formatting";

/**
 * Simulator control panel.
 *
 * Every control here is wired to the real engine, not to a display value.
 * Changing the scale regenerates the fleet; changing the rate re-times the
 * tick loop; unticking "Battery" genuinely stops battery drain. That is the
 * difference between a control panel and a settings mock-up, and it is worth
 * saying explicitly because the easy version of this screen does nothing.
 */

const FEATURE_LABELS: readonly {
  key: keyof SimulationFeatures;
  label: string;
  description: string;
}[] = [
  {
    key: "telemetry",
    label: "Telemetry",
    description: "Advance sensor signals each tick",
  },
  {
    key: "connectivity",
    label: "Connectivity",
    description: "Allow devices to drop off and reconnect",
  },
  {
    key: "battery",
    label: "Battery",
    description: "Drain batteries over time",
  },
  {
    key: "alerts",
    label: "Alerts",
    description: "Evaluate thresholds and raise alerts",
  },
  {
    key: "failures",
    label: "Failures",
    description: "Let faulty devices degrade spontaneously",
  },
];

export function SimulatorPanel() {
  const open = useUiStore((state) => state.simulatorPanelOpen);
  const setOpen = useUiStore((state) => state.setSimulatorPanelOpen);
  const { config, stats, running, metrics } = useSimulatorState();
  const controls = useSimulatorControls();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Zap className="size-4 text-status-warning" aria-hidden="true" />
            Simulator
          </SheetTitle>
          <SheetDescription className="text-xs">
            Drive the fleet, change its scale and inject failures. Every control
            affects the running simulation immediately.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={controls.toggle}
                variant={running ? "secondary" : "default"}
                size="sm"
                className="flex-1 gap-1.5"
              >
                {running ? (
                  <>
                    <Square className="size-3.5" aria-hidden="true" /> Stop
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" aria-hidden="true" /> Start
                  </>
                )}
              </Button>
              <Button
                onClick={controls.reset}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" /> Reset
              </Button>
            </div>

            <dl className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-center">
              <div>
                <dt className="ops-label">Tick</dt>
                <dd className="tabular text-sm font-medium">{formatCompact(stats.tick)}</dd>
              </div>
              <div>
                <dt className="ops-label">Msg/s</dt>
                <dd className="tabular text-sm font-medium">
                  {formatCompact(metrics.messagesPerSecond)}
                </dd>
              </div>
              <div>
                <dt className="ops-label">Tick cost</dt>
                <dd className="tabular text-sm font-medium">
                  {stats.lastTickDurationMs.toFixed(1)}ms
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2.5">
            <SectionHeading>Event rate</SectionHeading>
            <RadioGroup
              value={config.rate}
              onValueChange={(value) => controls.setRate(value as EventRate)}
              className="gap-2"
            >
              {Object.values(EVENT_RATE_PROFILES).map((profile) => (
                <Label
                  key={profile.rate}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-2.5 text-sm transition-colors hover:bg-accent/40",
                    config.rate === profile.rate && "border-primary/50 bg-primary/5",
                  )}
                >
                  <RadioGroupItem value={profile.rate} />
                  <span className="flex-1">{profile.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {profile.tickMs}ms · {Math.round(profile.fleetFractionPerTick * 100)}% of
                    fleet
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </section>

          <section className="space-y-2.5">
            <SectionHeading>Simulation scale</SectionHeading>
            <div className="grid grid-cols-5 gap-1.5">
              {SIMULATION_SCALES.map((scale) => (
                <Button
                  key={scale}
                  size="sm"
                  variant={config.deviceCount === scale ? "default" : "outline"}
                  onClick={() => controls.setScale(scale)}
                  className="px-0 text-xs"
                >
                  {scale >= 1000 ? `${scale / 1000}k` : scale}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(config.deviceCount)} devices simulated. Scaling up preserves the
              existing fleet — devices are deterministic in their seed and index.
            </p>
          </section>

          <section className="space-y-2.5">
            <SectionHeading>Device events</SectionHeading>
            <div className="space-y-1.5">
              {FEATURE_LABELS.map((feature) => (
                <Label
                  key={feature.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 text-sm transition-colors hover:bg-accent/40"
                >
                  <Checkbox
                    checked={config.features[feature.key]}
                    onCheckedChange={(checked) =>
                      controls.setFeature(feature.key, checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block">{feature.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {feature.description}
                    </span>
                  </span>
                </Label>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <SectionHeading>Failure injection</SectionHeading>
            <div className="space-y-1.5">
              {Object.values(FAILURE_DESCRIPTORS).map((descriptor) => (
                <Button
                  key={descriptor.kind}
                  variant="outline"
                  size="sm"
                  onClick={() => controls.inject(descriptor.kind)}
                  className="h-auto w-full justify-start gap-2.5 py-2 text-left"
                >
                  <Zap className="size-3.5 shrink-0 text-status-critical" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{descriptor.label}</span>
                    <span className="block whitespace-normal text-[0.7rem] text-muted-foreground">
                      {descriptor.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <SectionHeading>
              <span className="inline-flex items-center gap-1.5">
                <Wand2 className="size-3" aria-hidden="true" /> Guided walkthrough
              </span>
            </SectionHeading>
            <DemoWalkthrough />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
