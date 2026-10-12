"use client";

import { useEffect } from "react";

import { useCatalogueStore } from "@/stores/catalogueStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useThresholdStore } from "@/stores/thresholdStore";
import { useUiStore } from "@/stores/uiStore";
import { clearPersistedState, rehydrateStores } from "@/utils/persistence";

/**
 * Loads persisted operator state, once, after mount.
 *
 * Deliberately after mount rather than at module load: every persisted store
 * is created with `skipHydration`, so the first client render matches the
 * server-rendered HTML and React's hydration check passes. The stored values
 * land a tick later.
 *
 * Restoring thresholds and rules has a second step beyond loading them. Both
 * stores carry a `version` counter that downstream consumers watch — the
 * ingestion pipeline re-resolves threshold profiles when it changes, and the
 * rule engine rebuilds its metric index. Without bumping it, restored state
 * would sit in the store and never be applied to an incoming frame.
 */
export function usePersistedState(): void {
  useEffect(() => {
    rehydrateStores([useUiStore, useRuleStore, useThresholdStore, useCatalogueStore]);

    // Immutable bump, so subscribers are notified the way any other edit would
    // notify them.
    useRuleStore.setState((state) => ({ version: state.version + 1 }));
    useThresholdStore.setState((state) => ({ version: state.version + 1 }));
  }, []);
}

/** Clears stored state and returns the stores to their built-in defaults. */
export function resetPersistedState(): void {
  clearPersistedState();
  useRuleStore.getState().resetToDefaults();
  useThresholdStore.getState().resetToDefaults();
  useCatalogueStore.getState().resetToDefaults();
  useUiStore.getState().setTheme("system");
}
