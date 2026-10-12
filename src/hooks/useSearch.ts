"use client";

import { useDeferredValue, useMemo } from "react";

import { useDeviceSummaries } from "@/hooks/useDevices";
import { useGroups } from "@/hooks/useGroups";
import { useOpenAlerts } from "@/hooks/useAlerts";
import { useRules } from "@/hooks/useRules";
import { useCommands } from "@/hooks/useCommands";
import { SITES } from "@/services/simulator/locations";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import { COMMAND_DESCRIPTORS } from "@/types/commands";

export type SearchResultKind =
  | "device"
  | "group"
  | "site"
  | "alert"
  | "rule"
  | "command";

export interface SearchResult {
  readonly kind: SearchResultKind;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  /** Lower is better. Prefix matches outrank substring matches. */
  readonly score: number;
}

/** Per-kind caps, so one category cannot crowd out the others. */
const LIMITS: Readonly<Record<SearchResultKind, number>> = {
  device: 8,
  group: 4,
  site: 4,
  alert: 5,
  rule: 4,
  command: 3,
};

/**
 * Scores a match. An exact id match wins outright, then prefix matches, then
 * substring position — so typing "LAG" surfaces `LAG-1000` before a device
 * merely located in Lagos.
 */
function score(haystack: string, needle: string): number | null {
  const lower = haystack.toLowerCase();
  if (lower === needle) return 0;
  const index = lower.indexOf(needle);
  if (index < 0) return null;
  return index === 0 ? 1 : 2 + index;
}

/** Best score across several candidate fields. */
function bestScore(needle: string, ...fields: (string | undefined)[]): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (!field) continue;
    const result = score(field, needle);
    if (result === null) continue;
    if (best === null || result < best) best = result;
  }
  return best;
}

/**
 * Global search across every entity type.
 *
 * Search runs over in-memory collections, so it is synchronous — but it also
 * touches every device, which at 5,000 devices is enough work to drop a frame
 * if it ran on every keystroke. `useDeferredValue` lets React keep the input
 * responsive and compute results at a lower priority.
 */
export function useGlobalSearch(query: string): readonly SearchResult[] {
  const deferredQuery = useDeferredValue(query);
  const devices = useDeviceSummaries();
  const groups = useGroups();
  const alerts = useOpenAlerts();
  const rules = useRules();
  const commands = useCommands(60);

  return useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (needle.length === 0) return [];

    const results: SearchResult[] = [];
    const counts: Record<SearchResultKind, number> = {
      device: 0,
      group: 0,
      site: 0,
      alert: 0,
      rule: 0,
      command: 0,
    };

    const push = (result: SearchResult): void => {
      if (counts[result.kind] >= LIMITS[result.kind]) return;
      counts[result.kind] += 1;
      results.push(result);
    };

    for (const device of devices) {
      if (counts.device >= LIMITS.device) break;
      const matched = bestScore(
        needle,
        device.id,
        device.name,
        device.site,
        DEVICE_TYPE_DESCRIPTORS[device.type].label,
      );
      if (matched === null) continue;
      push({
        kind: "device",
        id: device.id,
        title: device.id,
        subtitle: `${DEVICE_TYPE_DESCRIPTORS[device.type].label} · ${device.site} · ${device.status}`,
        href: `/devices/${device.id}`,
        score: matched,
      });
    }

    for (const group of groups) {
      const matched = bestScore(needle, group.name, group.description);
      if (matched === null) continue;
      push({
        kind: "group",
        id: group.id,
        title: group.name,
        subtitle: `Group · ${group.description}`,
        href: `/groups/${group.id}`,
        score: matched,
      });
    }

    for (const site of SITES) {
      const matched = bestScore(needle, site.name, site.city, site.region);
      if (matched === null) continue;
      push({
        kind: "site",
        id: site.id,
        title: site.name,
        subtitle: `Site · ${site.city}, ${site.region}`,
        href: `/map?site=${encodeURIComponent(site.name)}`,
        score: matched,
      });
    }

    for (const alert of alerts) {
      const matched = bestScore(needle, alert.title, alert.deviceId, alert.message);
      if (matched === null) continue;
      push({
        kind: "alert",
        id: alert.id,
        title: alert.title,
        subtitle: `${alert.severity} alert · ${alert.deviceId}`,
        href: `/alerts?alert=${alert.id}`,
        score: matched,
      });
    }

    for (const rule of rules) {
      const matched = bestScore(needle, rule.name, rule.description);
      if (matched === null) continue;
      push({
        kind: "rule",
        id: rule.id,
        title: rule.name,
        subtitle: `Rule · ${rule.enabled ? "enabled" : "disabled"}`,
        href: `/rules/${rule.id}`,
        score: matched,
      });
    }

    for (const command of commands) {
      const label = COMMAND_DESCRIPTORS[command.type].label;
      const matched = bestScore(needle, label, command.deviceId);
      if (matched === null) continue;
      push({
        kind: "command",
        id: command.id,
        title: label,
        subtitle: `Command · ${command.deviceId} · ${command.status}`,
        href: `/commands?command=${command.id}`,
        score: matched,
      });
    }

    return results.sort((a, b) => a.score - b.score);
  }, [deferredQuery, devices, groups, alerts, rules, commands]);
}

export const SEARCH_KIND_LABELS: Readonly<Record<SearchResultKind, string>> = {
  device: "Devices",
  group: "Groups",
  site: "Locations",
  alert: "Alerts",
  rule: "Rules",
  command: "Commands",
};

/** Groups results by kind, preserving relevance order within each group. */
export function groupSearchResults(
  results: readonly SearchResult[],
): readonly { kind: SearchResultKind; items: readonly SearchResult[] }[] {
  const order: SearchResultKind[] = ["device", "alert", "rule", "group", "site", "command"];
  return order
    .map((kind) => ({ kind, items: results.filter((result) => result.kind === kind) }))
    .filter((entry) => entry.items.length > 0);
}
