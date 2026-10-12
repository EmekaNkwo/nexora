"use client";

import { useEffect } from "react";

import { useUiStore } from "@/stores/uiStore";

/**
 * Global keyboard shortcuts.
 *
 * Registered once at the shell. Two details matter for not fighting the user:
 *
 * - Shortcuts are ignored while focus is in a text field, unless they use a
 *   modifier. Otherwise typing "d" in the search box would open dev mode.
 * - `event.key` is checked case-insensitively, because Shift+D reports "D".
 */

/** True when the event originated inside an editable control. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useKeyboardShortcuts(): void {
  const toggleCommandPalette = useUiStore((state) => state.toggleCommandPalette);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const toggleDevMode = useUiStore((state) => state.toggleDevMode);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setSimulatorPanelOpen = useUiStore((state) => state.setSimulatorPanelOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl+K — global search.
      if (modifier && key === "k") {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd/Ctrl+Shift+D — developer diagnostics.
      if (modifier && event.shiftKey && key === "d") {
        event.preventDefault();
        toggleDevMode();
        return;
      }

      // Cmd/Ctrl+Shift+S — simulator panel.
      if (modifier && event.shiftKey && key === "s") {
        event.preventDefault();
        setSimulatorPanelOpen(true);
        return;
      }

      // Cmd/Ctrl+B — collapse the sidebar.
      if (modifier && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (isEditableTarget(event.target)) return;

      // Unmodified keys only outside text fields.
      if (key === "/") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (key === "escape") {
        setCommandPaletteOpen(false);
        setSimulatorPanelOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    toggleCommandPalette,
    setCommandPaletteOpen,
    toggleDevMode,
    toggleSidebar,
    setSimulatorPanelOpen,
  ]);
}

/**
 * Mirrors the OS `prefers-reduced-motion` setting into the UI store, so
 * animated components can opt out without each one querying the media list.
 */
export function useReducedMotionSync(): void {
  const setReducedMotion = useUiStore((state) => state.setReducedMotion);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent): void =>
      setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setReducedMotion]);
}

export function useReducedMotion(): boolean {
  return useUiStore((state) => state.reducedMotion);
}

/** Shortcut hints shown in the command palette footer and dev panel. */
export const SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: "⌘K", label: "Global search" },
  { keys: "⌘⇧D", label: "Developer mode" },
  { keys: "⌘⇧S", label: "Simulator panel" },
  { keys: "⌘B", label: "Toggle sidebar" },
  { keys: "Esc", label: "Close overlays" },
];
