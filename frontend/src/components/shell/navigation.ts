import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BellRing,
  Boxes,
  CircuitBoard,
  GitBranch,
  LayoutDashboard,
  Map,
  SlidersHorizontal,
  Terminal,
  UploadCloud,
} from "lucide-react";

/**
 * Navigation model.
 *
 * Declared as data rather than markup so the sidebar, the mobile drawer and
 * the command palette all render the same list from one source. Adding a
 * screen means adding one entry, not editing three components.
 */

export type BadgeSource = "alerts" | "commands" | "offline" | "rollouts" | null;

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
  /** Which live counter, if any, shows as a badge on this item. */
  readonly badge: BadgeSource;
  /** Keywords the command palette matches against beyond the label. */
  readonly keywords: readonly string[];
}

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Monitor",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        description: "Fleet overview, live telemetry and activity",
        badge: null,
        keywords: ["home", "overview", "kpi", "ops"],
      },
      {
        href: "/devices",
        label: "Devices",
        icon: CircuitBoard,
        description: "Search, filter and act on the whole fleet",
        badge: "offline",
        keywords: ["fleet", "table", "sensors", "inventory"],
      },
      {
        href: "/map",
        label: "Device Map",
        icon: Map,
        description: "Geospatial view with clustering",
        badge: null,
        keywords: ["geo", "location", "sites", "cluster"],
      },
      {
        href: "/telemetry",
        label: "Telemetry",
        icon: Activity,
        description: "Historical charts and device comparison",
        badge: null,
        keywords: ["charts", "history", "compare", "metrics"],
      },
    ],
  },
  {
    label: "Respond",
    items: [
      {
        href: "/alerts",
        label: "Alerts",
        icon: BellRing,
        description: "Triage, acknowledge and resolve",
        badge: "alerts",
        keywords: ["incidents", "warnings", "critical", "triage"],
      },
      {
        href: "/rules",
        label: "Rules",
        icon: GitBranch,
        description: "Visual automation builder",
        badge: null,
        keywords: ["automation", "if then", "triggers", "actions"],
      },
      {
        href: "/commands",
        label: "Commands",
        icon: Terminal,
        description: "Issue and track device commands",
        badge: "commands",
        keywords: ["restart", "fan", "calibrate", "console"],
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        href: "/groups",
        label: "Groups",
        icon: Boxes,
        description: "Sites and logical device groups",
        badge: null,
        keywords: ["sites", "fleet", "cohorts", "tags"],
      },
      {
        href: "/firmware",
        label: "Firmware",
        icon: UploadCloud,
        description: "Versions and staged rollouts",
        badge: "rollouts",
        keywords: ["ota", "update", "version", "rollout"],
      },
      {
        href: "/settings",
        label: "Thresholds",
        icon: SlidersHorizontal,
        description: "Alert thresholds and simulation settings",
        badge: null,
        keywords: ["settings", "limits", "warning", "critical", "config"],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

/**
 * Resolves the active nav item for a pathname.
 *
 * Longest-prefix match, so `/devices/LAG-2048` highlights "Devices" — but the
 * root route only matches exactly, otherwise it would match everything.
 */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (item.href === "/") {
      if (pathname === "/") best = item;
      continue;
    }
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}
