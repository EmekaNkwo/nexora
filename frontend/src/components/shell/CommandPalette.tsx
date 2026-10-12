"use client";

import {
  CornerDownLeft,
  Play,
  RotateCcw,
  Square,
  Wand2,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ALL_NAV_ITEMS } from "@/components/shell/navigation";
import { useDemoScenario } from "@/hooks/useDemo";
import { useSimulatorControls, useSimulatorState } from "@/hooks/useSimulator";
import {
  SEARCH_KIND_LABELS,
  groupSearchResults,
  useGlobalSearch,
} from "@/hooks/useSearch";
import { FAILURE_DESCRIPTORS } from "@/types/simulation";
import { useUiStore } from "@/stores/uiStore";

/**
 * Global search and command palette (⌘K).
 *
 * It is both a search box and an action launcher, which is the point: in an
 * operations console the fastest path to "restart the device that is
 * alarming" should not be three clicks through a table. Entity results and
 * platform actions share one ranked list.
 *
 * The query is kept in local state rather than the UI store. It is ephemeral,
 * nothing else reads it, and putting it in a store would make every keystroke
 * a global state update.
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The body is mounted only while the palette is open, so the query and
          the search it drives are discarded on close. Resetting them from an
          effect instead would cost a render on every open/close and keep a
          stale result set alive in between. */}
      {open ? <PaletteBody onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function PaletteBody({ onClose }: { readonly onClose: () => void }) {
  const setSimulatorPanelOpen = useUiStore((state) => state.setSimulatorPanelOpen);
  const toggleDevMode = useUiStore((state) => state.toggleDevMode);

  const [query, setQuery] = useState("");
  const router = useRouter();
  const results = useGlobalSearch(query);
  const grouped = groupSearchResults(results);

  const { running } = useSimulatorState();
  const controls = useSimulatorControls();
  const demo = useDemoScenario();

  const run = (action: () => void): void => {
    action();
    onClose();
  };

  const navigate = (href: string): void => run(() => router.push(href));

  return (
    <>
      <DialogContent
        className="top-[12vh] max-w-2xl translate-y-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Search devices, groups, alerts, rules and commands, or run a platform action.
        </DialogDescription>

        {/* `shouldFilter={false}` — ranking is done by useGlobalSearch, which
            knows about ids, sites and device types. cmdk's fuzzy matcher would
            fight it. */}
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:ops-label">
          <CommandInput
            placeholder="Search devices, alerts, rules… or type a command"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>
              <div className="py-6 text-center">
                <p className="text-sm">No matches for “{query}”</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a device id like LAG-1000, a site, or a rule name.
                </p>
              </div>
            </CommandEmpty>

            {grouped.map((group) => (
              <CommandGroup key={group.kind} heading={SEARCH_KIND_LABELS[group.kind]}>
                {group.items.map((result) => (
                  <CommandItem
                    key={`${result.kind}:${result.id}`}
                    value={`${result.kind}:${result.id}`}
                    onSelect={() => navigate(result.href)}
                    className="gap-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{result.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {result.subtitle}
                      </span>
                    </span>
                    <CornerDownLeft
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {results.length > 0 ? <CommandSeparator /> : null}

            <CommandGroup heading="Navigate">
              {ALL_NAV_ITEMS.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`nav:${item.label} ${item.keywords.join(" ")}`}
                  onSelect={() => navigate(item.href)}
                  className="gap-2.5"
                >
                  <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Simulation">
              <CommandItem
                value="sim:toggle start stop simulation"
                onSelect={() => run(controls.toggle)}
                className="gap-2.5"
              >
                {running ? (
                  <Square className="size-4 text-status-warning" aria-hidden="true" />
                ) : (
                  <Play className="size-4 text-status-online" aria-hidden="true" />
                )}
                <span className="flex-1">{running ? "Stop simulation" : "Start simulation"}</span>
              </CommandItem>

              <CommandItem
                value="sim:demo guided walkthrough scenario"
                onSelect={() => run(demo.start)}
                className="gap-2.5"
              >
                <Wand2 className="size-4 text-primary" aria-hidden="true" />
                <span className="flex-1">Run guided walkthrough</span>
                <span className="text-xs text-muted-foreground">
                  Telemetry → rule → command → resolution
                </span>
              </CommandItem>

              <CommandItem
                value="sim:panel simulator controls"
                onSelect={() => run(() => setSimulatorPanelOpen(true))}
                className="gap-2.5"
              >
                <Zap className="size-4 text-status-warning" aria-hidden="true" />
                <span className="flex-1">Open simulator panel</span>
                <CommandShortcut>⌘⇧S</CommandShortcut>
              </CommandItem>

              <CommandItem
                value="sim:reset regenerate fleet"
                onSelect={() => run(controls.reset)}
                className="gap-2.5"
              >
                <RotateCcw className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">Reset simulation</span>
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Inject failure">
              {Object.values(FAILURE_DESCRIPTORS).map((descriptor) => (
                <CommandItem
                  key={descriptor.kind}
                  value={`fail:${descriptor.kind} ${descriptor.label}`}
                  onSelect={() => run(() => controls.inject(descriptor.kind))}
                  className="gap-2.5"
                >
                  <Zap className="size-4 text-status-critical" aria-hidden="true" />
                  <span className="flex-1 truncate">{descriptor.label}</span>
                  <span className="hidden truncate text-xs text-muted-foreground sm:block">
                    {descriptor.target === "fleet" ? "Fleet-wide" : "Single device"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Developer">
              <CommandItem
                value="dev:diagnostics panel"
                onSelect={() => run(toggleDevMode)}
                className="gap-2.5"
              >
                <Zap className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">Toggle developer diagnostics</span>
                <CommandShortcut>⌘⇧D</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </>
  );
}
