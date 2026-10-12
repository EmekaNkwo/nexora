"use client";

import { ChevronsLeft, Radio } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAlertCounts } from "@/hooks/useAlerts";
import { useInFlightCommands } from "@/hooks/useCommands";
import { useStatusCounts } from "@/hooks/useDevices";
import { useRollouts } from "@/hooks/useFirmware";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_SECTIONS, type BadgeSource, type NavItem } from "@/components/shell/navigation";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/utils/formatting";

/**
 * Primary navigation.
 *
 * The badge counts are the reason this is a client component: they are live,
 * and an operator needs to see "6 critical" from any screen without going to
 * the alerts page. Each badge subscribes to its own store slice, so an
 * incoming alert re-renders the alerts badge and nothing else in the shell.
 */

/** Resolves a nav item's live badge. Returns null when there is nothing to show. */
function useBadgeValue(source: BadgeSource): {
  value: number;
  tone: "critical" | "warning" | "info";
} | null {
  const alerts = useAlertCounts();
  const statusCounts = useStatusCounts();
  const inFlight = useInFlightCommands();
  const rollouts = useRollouts();

  if (source === null) return null;

  if (source === "alerts") {
    // Critical count takes precedence; fall back to total open.
    if (alerts.critical > 0) return { value: alerts.critical, tone: "critical" };
    const open = alerts.active + alerts.acknowledged;
    return open > 0 ? { value: open, tone: "warning" } : null;
  }

  if (source === "offline") {
    const degraded = statusCounts.offline + statusCounts.critical;
    return degraded > 0 ? { value: degraded, tone: "critical" } : null;
  }

  if (source === "commands") {
    return inFlight.length > 0 ? { value: inFlight.length, tone: "info" } : null;
  }

  const active = rollouts.filter((rollout) => !rollout.finishedAt).length;
  return active > 0 ? { value: active, tone: "info" } : null;
}

interface NavLinkProps {
  readonly item: NavItem;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
}

function NavLink({ item, active, collapsed, onNavigate }: NavLinkProps) {
  const badge = useBadgeValue(item.badge);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      {/* Active state is marked by a rail as well as a background, so it does
          not rely on a subtle colour difference alone. */}
      <span
        className={cn(
          "absolute left-0 h-5 w-0.5 rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
          collapsed && "hidden",
        )}
        aria-hidden="true"
      />
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {badge && !collapsed ? (
        <span
          className={cn(
            "tabular shrink-0 rounded px-1.5 py-0.5 text-[0.68rem] font-semibold",
            badge.tone === "critical" && "bg-status-critical/15 text-status-critical",
            badge.tone === "warning" && "bg-status-warning/15 text-status-warning",
            badge.tone === "info" && "bg-status-updating/15 text-status-updating",
          )}
        >
          {formatCompact(badge.value)}
        </span>
      ) : null}
      {badge && collapsed ? (
        <span
          className={cn(
            "absolute right-2 top-1.5 size-1.5 rounded-full",
            badge.tone === "critical" && "bg-status-critical",
            badge.tone === "warning" && "bg-status-warning",
            badge.tone === "info" && "bg-status-updating",
          )}
          aria-hidden="true"
        />
      ) : null}
    </Link>
  );

  return (
    <li className="relative">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right">
            <p className="font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.description}</p>
            {badge ? (
              <p className="mt-0.5 text-xs">{badge.value} needing attention</p>
            ) : null}
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

export interface SidebarProps {
  /** Called after a navigation, so the mobile drawer can close itself. */
  readonly onNavigate?: () => void;
  /** Forces the expanded layout inside the mobile drawer. */
  readonly forceExpanded?: boolean;
}

export function Sidebar({ onNavigate, forceExpanded }: SidebarProps) {
  const pathname = usePathname();
  const collapsedPreference = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const collapsed = forceExpanded ? false : collapsedPreference;

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar">
      <div
        className={cn(
          "flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5",
          collapsed && "justify-center px-2",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
          <Radio className="size-4" aria-hidden="true" />
        </span>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">NEXORA</p>
            <p className="truncate text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
              IoT Cloud
            </p>
          </div>
        )}
      </div>

      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2"
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-3 last:mb-0">
            {collapsed ? (
              <div className="mx-2 mb-1.5 border-t border-sidebar-border" aria-hidden="true" />
            ) : (
              <p className="ops-label px-2.5 pb-1.5 pt-1">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)
                  }
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {forceExpanded ? null : (
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className={cn("w-full justify-start gap-2 text-muted-foreground", collapsed && "justify-center")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronsLeft
              className={cn("size-4 transition-transform", collapsed && "rotate-180")}
              aria-hidden="true"
            />
            {collapsed ? null : <span className="text-xs">Collapse</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
