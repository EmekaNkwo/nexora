"use client";

import { Menu, Monitor, Moon, Pause, Play, Search, Sun, Zap } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/shell/Sidebar";
import { findActiveNavItem } from "@/components/shell/navigation";
import { useDashboardKpis } from "@/hooks/useActivity";
import { useSimulatorControls, useSimulatorState } from "@/hooks/useSimulator";
import { useThemeControls } from "@/hooks/useTheme";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { formatBytesPerSecond, formatCompact } from "@/utils/formatting";

/**
 * The console's top bar.
 *
 * Carries the three things an operator needs visible at all times regardless
 * of which screen they are on: whether the system is live, how much data is
 * flowing, and how many alerts are open. Everything else is navigation.
 */

function LiveIndicator() {
  const { socketState, running } = useSimulatorState();
  const connected = socketState === "connected";

  const label = !running
    ? "Paused"
    : connected
      ? "System live"
      : socketState === "connecting"
        ? "Connecting"
        : "Disconnected";

  return (
    <span
      className="flex items-center gap-2 text-xs font-medium"
      // Announced on change so a dropped connection is not a silent failure.
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          "size-2 rounded-full",
          connected && running && "bg-status-online animate-ops-pulse",
          connected && !running && "bg-status-warning",
          !connected && "bg-status-offline",
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          "uppercase tracking-[0.1em]",
          connected && running ? "text-status-online" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}

function ThroughputReadout() {
  const { infrastructure } = useDashboardKpis();

  return (
    <dl className="hidden items-center gap-5 lg:flex">
      <div className="flex items-baseline gap-1.5">
        <dt className="ops-label">msg/s</dt>
        <dd className="tabular text-xs font-medium">
          {formatCompact(infrastructure.messagesPerSecond)}
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5">
        <dt className="ops-label">latency</dt>
        <dd className="tabular text-xs font-medium">
          {infrastructure.averageLatencyMs}ms
        </dd>
      </div>
      <div className="hidden items-baseline gap-1.5 xl:flex">
        <dt className="ops-label">ingest</dt>
        <dd className="tabular text-xs font-medium">
          {formatBytesPerSecond(infrastructure.ingestionBytesPerSecond)}
        </dd>
      </div>
    </dl>
  );
}

const THEME_LABELS = {
  system: "Match system",
  dark: "Dark",
  light: "Light",
} as const;

function ThemeToggle() {
  const { theme, resolved, cycle } = useThemeControls();

  // The icon shows the *preference*, not the resolved theme: on "system" the
  // monitor icon is the honest answer, where a sun or moon would imply the
  // operator had chosen one.
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={cycle}
            // The label carries the current state because the icon alone is
            // ambiguous to a screen reader — "button, theme" says nothing.
            aria-label={`Theme: ${THEME_LABELS[theme]}${
              theme === "system" ? ` (currently ${resolved})` : ""
            }. Change theme`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent>
        Theme: {THEME_LABELS[theme]}
        {theme === "system" ? (
          <span className="ml-1 text-muted-foreground">({resolved})</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const activeItem = findActiveNavItem(pathname);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setSimulatorPanelOpen = useUiStore((state) => state.setSimulatorPanelOpen);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { running } = useSimulatorState();
  const controls = useSimulatorControls();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur-sm sm:px-4">
      {/* Mobile: the sidebar becomes a drawer. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-4" aria-hidden="true" />
        </Button>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Primary navigation for the Nexora operations console.
          </SheetDescription>
          <Sidebar forceExpanded onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight">
          {activeItem?.label ?? "Nexora IoT Cloud"}
        </h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {activeItem?.description ?? "Operations console"}
        </p>
      </div>

      <ThroughputReadout />

      <div className="flex items-center gap-1.5">
        <LiveIndicator />

        {/* A full-width search affordance on desktop, an icon on mobile. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden min-w-[13rem] justify-start gap-2 text-muted-foreground md:flex"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="flex-1 text-left text-xs">Search…</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium">
            ⌘K
          </kbd>
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
        >
          <Search className="size-4" aria-hidden="true" />
        </Button>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={controls.toggle}
                aria-label={running ? "Pause simulation" : "Start simulation"}
              >
                {running ? (
                  <Pause className="size-4 text-status-warning" aria-hidden="true" />
                ) : (
                  <Play className="size-4 text-status-online" aria-hidden="true" />
                )}
              </Button>
            }
          />
          <TooltipContent>{running ? "Pause simulation" : "Start simulation"}</TooltipContent>
        </Tooltip>

        <ThemeToggle />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSimulatorPanelOpen(true)}
                aria-label="Open simulator panel"
              >
                <Zap className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>
            Simulator &amp; failure injection
            <span className="ml-2 text-muted-foreground">⌘⇧S</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
