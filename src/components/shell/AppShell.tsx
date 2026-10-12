"use client";

import { Suspense, useEffect, type ReactNode } from "react";

import { CommandPalette } from "@/components/shell/CommandPalette";
import { DevModePanel } from "@/components/shell/DevModePanel";
import { SimulatorPanel } from "@/components/simulator/SimulatorPanel";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useKeyboardShortcuts,
  useReducedMotionSync,
} from "@/hooks/useKeyboardShortcuts";
import { usePersistedState } from "@/hooks/usePersistedState";
import { usePlatformBootstrap } from "@/hooks/useSimulator";
import { useThemeSync } from "@/hooks/useTheme";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { registerWebComponents } from "@/web-components/registry";

/**
 * The application shell.
 *
 * This is the single client boundary for the whole console, and it owns four
 * things that have to happen exactly once per session:
 *
 * 1. **Custom element registration** — `customElements` is browser-only, so it
 *    cannot happen at import time in a server-rendered tree.
 * 2. **Platform bootstrap** — seeding the fleet, subscribing the ingestion
 *    pipeline to the bus, starting the simulator.
 * 3. **Global keyboard shortcuts** and the reduced-motion sync.
 * 4. **Overlays** — the command palette, simulator panel and dev diagnostics
 *    live here rather than per-page, so they survive navigation.
 *
 * Deliberately *not* torn down on unmount. The shell lives for the session;
 * stopping the simulator on a route change would reset the fleet every time
 * the operator clicked a link.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);

  // Registration first: the bridges assign element properties in effects, and
  // an unregistered element would silently swallow them.
  useEffect(() => {
    registerWebComponents();
  }, []);

  // Before the bootstrap, so restored thresholds and rules are in place by the
  // time the first telemetry frame is ingested.
  usePersistedState();

  usePlatformBootstrap();
  useKeyboardShortcuts();
  useReducedMotionSync();
  useThemeSync();

  return (
    <TooltipProvider delay={350}>
      {/* Skip link — the device table can be hundreds of rows, so tabbing past
          the whole sidebar on every page load is not acceptable. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <div className="flex h-dvh overflow-hidden">
        <aside
          className={cn(
            "hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:block",
            sidebarCollapsed ? "w-14" : "w-56",
          )}
        >
          {/* The sidebar and top bar both read the pathname to show the active
              route. Under `cacheComponents`, URL data in a client component has
              to sit behind a Suspense boundary so the shell around it can still
              be prerendered. */}
          <Suspense fallback={<div className="h-full bg-sidebar" />}>
            <Sidebar />
          </Suspense>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="h-14 shrink-0 border-b border-border bg-background" />
            }
          >
            <TopBar />
          </Suspense>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus:outline-none"
          >
            {children}
          </main>
        </div>
      </div>

      <CommandPalette />
      <SimulatorPanel />
      <DevModePanel />
    </TooltipProvider>
  );
}
