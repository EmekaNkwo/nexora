"use client";

import { Check, Loader2, Play, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useDemoScenario, isStepReached } from "@/hooks/useDemo";
import { DEMO_STEP_LABELS, DEMO_STEP_ORDER } from "@/stores/simulationStore";
import { cn } from "@/lib/utils";
import { formatTime } from "@/utils/formatting";

/** Step marker for the walkthrough rail. */
function StepCheck({ done }: { readonly done: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
        done
          ? "border-status-online bg-status-online/15 text-status-online"
          : "border-border text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {done ? <Check className="size-2.5" /> : null}
    </span>
  );
}

/**
 * The guided walkthrough.
 *
 * Shows the causal chain as a rail and ticks each step off as the platform
 * genuinely reaches it. Nothing here is on a timer — a step only lights up
 * because the corresponding event actually fired, so if the rule engine were
 * broken the rail would visibly stall rather than completing anyway.
 */
export function DemoWalkthrough() {
  const demo = useDemoScenario();
  const { state } = demo;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Injects one real sensor fault on a cold-storage device, then narrates the
        platform&apos;s response: threshold breach → alert → rule → command → device
        cooling → automatic resolution.
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={demo.start}
          disabled={demo.running}
          className="flex-1 gap-1.5"
        >
          {demo.running ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {demo.running ? "Running…" : demo.completed ? "Run again" : "Start walkthrough"}
        </Button>
        {state.step !== "idle" ? (
          <Button size="sm" variant="outline" onClick={demo.reset} aria-label="Reset walkthrough">
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {state.deviceId ? (
        <p className="text-xs text-muted-foreground">
          Target:{" "}
          <Link
            href={`/devices/${state.deviceId}`}
            className="ops-mono text-foreground underline underline-offset-2"
          >
            {state.deviceId}
          </Link>
        </p>
      ) : null}

      <ol className="space-y-1.5">
        {DEMO_STEP_ORDER.map((step) => {
          const reached = isStepReached(state.step, step);
          const current = state.step === step;
          return (
            <li key={step} className="flex items-start gap-2.5">
              <StepCheck done={reached && !current} />
              <span
                className={cn(
                  "text-xs leading-snug",
                  current && "font-medium text-foreground",
                  !current && reached && "text-muted-foreground",
                  !reached && "text-muted-foreground/55",
                )}
              >
                {DEMO_STEP_LABELS[step]}
                {current ? (
                  <Loader2
                    className="ml-1.5 inline size-3 animate-spin align-[-1px]"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {state.log.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
          <p className="ops-label">Event log</p>
          <ul className="space-y-1.5" aria-live="polite">
            {state.log.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-2 text-[0.7rem] leading-snug">
                <span className="tabular shrink-0 text-muted-foreground">
                  {formatTime(entry.at)}
                </span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
