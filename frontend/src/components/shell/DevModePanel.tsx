"use client";

import { Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { eventBus } from "@/services/events/eventBus";
import { platformDiagnostics, type PlatformDiagnostics } from "@/services/platform/platform";
import { useActivityStore } from "@/stores/activityStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSimulationStore } from "@/stores/simulationStore";
import { useUiStore } from "@/stores/uiStore";
import { SHORTCUTS } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";
import type { NexoraEnvelope } from "@/types/events";
import { formatBytes, formatCompact, formatNumber, formatTime } from "@/utils/formatting";

/**
 * Developer diagnostics (⌘⇧D).
 *
 * Reads straight from the services rather than through the stores, because the
 * point is to inspect the machinery — including the parts React never sees:
 * the ring-buffer memory footprint, the rule engine's evaluation count, how
 * many frames the transport dropped.
 *
 * Two things it does carefully:
 *
 * - **Polls on an interval and only while open.** Subscribing to every counter
 *   reactively would make the diagnostics panel itself a performance problem.
 * - **Measures FPS from `requestAnimationFrame`.** That is the number that
 *   actually tells you whether the console is keeping up at 5,000 devices.
 */

const EVENT_LOG_LIMIT = 40;
const POLL_INTERVAL_MS = 500;

/** Rolling FPS estimate, sampled over one-second windows. */
function useFpsMeter(active: boolean): number {
  const [fps, setFps] = useState(60);
  const setStoreFps = useActivityStore((state) => state.setFps);

  useEffect(() => {
    if (!active) return;
    let frames = 0;
    let windowStart = performance.now();
    let handle = 0;

    const tick = (): void => {
      frames += 1;
      const now = performance.now();
      if (now - windowStart >= 1000) {
        const value = Math.round((frames * 1000) / (now - windowStart));
        setFps(value);
        setStoreFps(value);
        frames = 0;
        windowStart = now;
      }
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [active, setStoreFps]);

  return fps;
}

/** Captures the most recent events off the bus's wildcard channel. */
function useRecentEvents(active: boolean): readonly NexoraEnvelope[] {
  const [events, setEvents] = useState<readonly NexoraEnvelope[]>([]);
  const buffer = useRef<NexoraEnvelope[]>([]);

  useEffect(() => {
    if (!active) return;

    // Buffer and flush on an interval: telemetry batches alone would push
    // several state updates a second otherwise.
    const unsubscribe = eventBus.onAny((envelope) => {
      buffer.current.unshift(envelope);
      if (buffer.current.length > EVENT_LOG_LIMIT) {
        buffer.current.length = EVENT_LOG_LIMIT;
      }
    });

    const timer = setInterval(() => setEvents([...buffer.current]), POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [active]);

  return events;
}

function useDiagnostics(active: boolean): PlatformDiagnostics | null {
  const [diagnostics, setDiagnostics] = useState<PlatformDiagnostics | null>(null);

  useEffect(() => {
    if (!active) return;
    const sample = (): void => setDiagnostics(platformDiagnostics());
    sample();
    const timer = setInterval(sample, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return diagnostics;
}

interface MetricRowProps {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: "normal" | "warning" | "critical" | "good";
}

function MetricRow({ label, value, tone = "normal" }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="truncate text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular shrink-0 text-xs font-medium",
          tone === "good" && "text-status-online",
          tone === "warning" && "text-status-warning",
          tone === "critical" && "text-status-critical",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function DevModePanel() {
  const open = useUiStore((state) => state.devModeOpen);
  const setOpen = useUiStore((state) => state.setDevModeOpen);

  const fps = useFpsMeter(open);
  const events = useRecentEvents(open);
  const diagnostics = useDiagnostics(open);

  const deviceCount = useDeviceStore((state) => state.devices.size);
  const metrics = useActivityStore((state) => state.metrics);
  const stats = useSimulationStore((state) => state.stats);
  const socketState = useSimulationStore((state) => state.socketState);

  if (!open) return null;

  // Not a modal: the panel is for watching the app while using it, so it must
  // not trap focus or block the surface behind it.
  return (
    <aside
      aria-label="Developer diagnostics"
      className="fixed bottom-3 right-3 z-40 flex max-h-[min(78vh,42rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover/95 shadow-xl backdrop-blur-sm"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Terminal className="size-3.5 text-primary" aria-hidden="true" />
        <p className="flex-1 text-xs font-semibold tracking-[0.08em]">NEXORA DEV MODE</p>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setOpen(false)}
          aria-label="Close developer diagnostics"
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section>
            <p className="ops-label mb-1.5">Runtime</p>
            <dl className="space-y-1">
              <MetricRow label="Devices" value={formatNumber(deviceCount)} />
              <MetricRow
                label="Events/sec"
                value={formatCompact(metrics.messagesPerSecond)}
              />
              <MetricRow
                label="WebSocket"
                value={socketState.toUpperCase()}
                tone={socketState === "connected" ? "good" : "warning"}
              />
              <MetricRow
                label="FPS"
                value={fps}
                tone={fps >= 50 ? "good" : fps >= 30 ? "warning" : "critical"}
              />
              <MetricRow
                label="Tick cost"
                value={`${stats.lastTickDurationMs.toFixed(2)}ms`}
                tone={stats.lastTickDurationMs > 16 ? "warning" : "good"}
              />
              <MetricRow label="Frames/tick" value={stats.lastTickFrameCount} />
              <MetricRow label="Render mode" value={stats.running ? "Live" : "Paused"} />
            </dl>
          </section>

          {diagnostics ? (
            <>
              <section>
                <p className="ops-label mb-1.5">Telemetry store</p>
                <dl className="space-y-1">
                  <MetricRow
                    label="Samples ingested"
                    value={formatCompact(diagnostics.telemetry.samplesIngested)}
                  />
                  <MetricRow
                    label="Ring buffers"
                    value={formatNumber(diagnostics.telemetry.ringCount)}
                  />
                  <MetricRow
                    label="Hot devices"
                    value={`${diagnostics.telemetry.hotDeviceCount} / ${formatNumber(diagnostics.telemetry.deviceCount)}`}
                  />
                  <MetricRow
                    label="Buffer memory"
                    value={formatBytes(diagnostics.telemetry.approximateBytes)}
                  />
                  <MetricRow
                    label="Dropped frames"
                    value={formatNumber(metrics.droppedFrames)}
                    tone={metrics.droppedFrames > 0 ? "warning" : "good"}
                  />
                </dl>
              </section>

              <section>
                <p className="ops-label mb-1.5">Engines</p>
                <dl className="space-y-1">
                  <MetricRow label="Active rules" value={diagnostics.rules.active} />
                  <MetricRow
                    label="Rule evaluations"
                    value={formatCompact(diagnostics.rules.evaluations)}
                  />
                  <MetricRow label="Rule triggers" value={diagnostics.rules.triggers} />
                  <MetricRow label="Indexed metrics" value={diagnostics.rules.indexedMetrics} />
                  <MetricRow label="Open alerts" value={diagnostics.alerts.open} />
                  <MetricRow
                    label="Alerts created"
                    value={formatCompact(diagnostics.alerts.created)}
                  />
                  <MetricRow label="Alerts resolved" value={diagnostics.alerts.resolved} />
                  <MetricRow label="Commands in flight" value={diagnostics.commands.inFlight} />
                  <MetricRow
                    label="Commands failed"
                    value={diagnostics.commands.failed}
                    tone={diagnostics.commands.failed > 0 ? "warning" : "normal"}
                  />
                  <MetricRow
                    label="Frames processed"
                    value={formatCompact(diagnostics.ingestion.frames)}
                  />
                  <MetricRow
                    label="Status changes"
                    value={formatCompact(diagnostics.ingestion.statusChanges)}
                  />
                  <MetricRow
                    label="Stale frames dropped"
                    value={formatCompact(diagnostics.ingestion.staleFramesDropped)}
                  />
                </dl>
              </section>

              <section>
                <p className="ops-label mb-1.5">Event bus</p>
                <dl className="space-y-1">
                  <MetricRow
                    label="Events emitted"
                    value={formatCompact(diagnostics.bus.eventsEmitted)}
                  />
                  <MetricRow label="Active listeners" value={diagnostics.bus.listeners} />
                </dl>
              </section>
            </>
          ) : null}

          <section>
            <p className="ops-label mb-1.5">Recent events</p>
            <ul className="space-y-0.5">
              {events.length === 0 ? (
                <li className="text-[0.7rem] text-muted-foreground">
                  Waiting for events…
                </li>
              ) : (
                events.map((envelope) => (
                  <li
                    key={envelope.seq}
                    className="flex items-baseline gap-2 font-mono text-[0.68rem] leading-snug"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {formatTime(envelope.at)}
                    </span>
                    <span className="truncate">{envelope.name}</span>
                    {envelope.name === "device.telemetry.batch" ? (
                      <span className="shrink-0 text-muted-foreground">
                        ×
                        {
                          (envelope.payload as { frames: readonly unknown[] }).frames
                            .length
                        }
                      </span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section>
            <p className="ops-label mb-1.5">Shortcuts</p>
            <dl className="space-y-1">
              {SHORTCUTS.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="text-[0.7rem] text-muted-foreground">{shortcut.label}</dt>
                  <dd>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.65rem]">
                      {shortcut.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
