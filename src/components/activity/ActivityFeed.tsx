"use client";

import {
  Activity,
  BellRing,
  GitBranch,
  PlugZap,
  Radio,
  Server,
  Terminal,
  UploadCloud,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/states";
import { useNow } from "@/hooks/useClock";
import { useActivityFeed } from "@/hooks/useActivity";
import { cn } from "@/lib/utils";
import type { ActivityEntry, ActivityKind, ActivitySeverity } from "@/types/activity";
import { formatRelativeTime, formatTime } from "@/utils/formatting";

/**
 * The live activity feed.
 *
 * Three decisions worth noting:
 *
 * - **It is not a log of everything.** The ingestion pipeline deliberately
 *   keeps routine telemetry out; only state changes, alerts, rule firings,
 *   commands and system events reach here. A feed that scrolls at 2,000
 *   entries a second is noise, not information.
 * - **New rows animate in, once.** Keying on the entry id means React only
 *   animates genuinely new entries, not every row on every re-render. The
 *   animation is also disabled under `prefers-reduced-motion`.
 * - **It is announced politely.** `aria-live="polite"` on the list means a
 *   screen reader hears new events without being interrupted mid-sentence.
 */

const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  telemetry: Activity,
  connectivity: Wifi,
  status: Radio,
  alert: BellRing,
  rule: GitBranch,
  command: Terminal,
  firmware: UploadCloud,
  provisioning: PlugZap,
  simulation: Server,
  system: Server,
};

const SEVERITY_CLASSES: Record<ActivitySeverity, string> = {
  info: "text-muted-foreground",
  success: "text-status-online",
  warning: "text-status-warning",
  critical: "text-status-critical",
};

const SEVERITY_RAIL: Record<ActivitySeverity, string> = {
  info: "bg-border",
  success: "bg-status-online",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
};

interface ActivityRowProps {
  readonly entry: ActivityEntry;
  readonly now: number;
  readonly showDevice: boolean;
}

function ActivityRow({ entry, now, showDevice }: ActivityRowProps) {
  const Icon = KIND_ICONS[entry.kind];

  return (
    <li className="animate-ops-slide-in flex gap-3 px-4 py-2.5">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <Icon
          className={cn("size-3.5 shrink-0", SEVERITY_CLASSES[entry.severity])}
          aria-hidden="true"
        />
        {/* A severity rail, so the row's importance is readable without colour
            vision and without reading the text. */}
        <span
          className={cn("w-0.5 flex-1 rounded-full", SEVERITY_RAIL[entry.severity])}
          aria-hidden="true"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          {showDevice && entry.deviceId ? (
            <Link
              href={`/devices/${entry.deviceId}`}
              className="ops-mono truncate font-medium hover:underline"
            >
              {entry.subject}
            </Link>
          ) : (
            <span className="truncate text-xs font-medium">{entry.subject}</span>
          )}
          <time
            dateTime={new Date(entry.at).toISOString()}
            title={formatTime(entry.at)}
            className="tabular shrink-0 text-[0.7rem] text-muted-foreground"
          >
            {now === 0 ? formatTime(entry.at) : formatRelativeTime(entry.at, now)}
          </time>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{entry.message}</p>
      </div>
    </li>
  );
}

export interface ActivityFeedProps {
  readonly limit?: number;
  readonly className?: string;
  /** Hides device links when the feed is already scoped to one device. */
  readonly showDevice?: boolean;
}

export function ActivityFeed({
  limit = 40,
  className,
  showDevice = true,
}: ActivityFeedProps) {
  const entries = useActivityFeed(limit);
  const now = useNow();

  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No activity yet"
        description="Device events, alerts, rule firings and commands appear here as they happen."
        className={className}
      />
    );
  }

  return (
    <ul
      className={cn("divide-y divide-border", className)}
      aria-live="polite"
      aria-label="Live activity feed"
    >
      {entries.map((entry) => (
        <ActivityRow
          key={entry.id}
          entry={entry}
          now={now}
          showDevice={showDevice}
        />
      ))}
    </ul>
  );
}

/** Compact variant for a device page, scoped to that device. */
export function DeviceActivityList({
  entries,
  className,
}: {
  readonly entries: readonly ActivityEntry[];
  readonly className?: string;
}) {
  const now = useNow();

  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No activity recorded"
        description="This device has not produced any notable events in the current session."
      />
    );
  }

  return (
    <ul className={cn("divide-y divide-border", className)}>
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} now={now} showDevice={false} />
      ))}
    </ul>
  );
}
