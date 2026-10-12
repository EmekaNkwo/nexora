"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useUiStore, type ThemePreference } from "@/stores/uiStore";

/**
 * Theme application.
 *
 * The preference lives in `uiStore`; this is the half that touches the DOM.
 * `.light` is a class on `<html>` rather than a React-rendered attribute,
 * because the class has to be correct *before* first paint — see
 * `themeInitScript` — and a value React controls cannot be.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Key and shape must match what `uiStore` persists; see `themeInitScript`. */
function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Server snapshot is `true` — dark is the default, so the server-rendered
 * markup and the pre-paint script already agree on it.
 */
function getServerPrefersDark(): boolean {
  return true;
}

export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPrefersDark,
    getServerPrefersDark,
  );
}

/** The theme actually in effect, with `system` resolved against the OS. */
export function useResolvedTheme(): "dark" | "light" {
  const theme = useUiStore((state) => state.theme);
  const systemPrefersDark = useSystemPrefersDark();
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/**
 * Keeps `<html>` in sync with the resolved theme.
 *
 * Also updates `color-scheme`, without which the browser renders scrollbars,
 * date pickers and autofill backgrounds for the wrong theme — the detail that
 * makes an otherwise-complete light mode look broken.
 */
export function useThemeSync(): void {
  const resolved = useResolvedTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", resolved === "light");
    root.style.colorScheme = resolved;
  }, [resolved]);
}

export interface ThemeControls {
  readonly theme: ThemePreference;
  readonly resolved: "dark" | "light";
  readonly cycle: () => void;
  readonly set: (theme: ThemePreference) => void;
}

export function useThemeControls(): ThemeControls {
  const theme = useUiStore((state) => state.theme);
  const resolved = useResolvedTheme();
  const cycleTheme = useUiStore((state) => state.cycleTheme);
  const setTheme = useUiStore((state) => state.setTheme);

  const cycle = useCallback(() => cycleTheme(), [cycleTheme]);
  const set = useCallback((next: ThemePreference) => setTheme(next), [setTheme]);

  return { theme, resolved, cycle, set };
}
