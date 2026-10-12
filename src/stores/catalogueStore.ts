import { create } from "zustand";
import { persist } from "zustand/middleware";

import { FIRMWARE_CATALOGUE } from "@/services/firmware/firmwareService";
import type { FirmwareVersion } from "@/types/firmware";
import { persistConfig, STORAGE_KEYS } from "@/utils/persistence";

/**
 * Firmware catalogue.
 *
 * The built-in versions are a module constant, but an operator can upload new
 * builds — so the catalogue has to be state rather than a frozen import. It is
 * persisted alongside rules and thresholds for the same reason: a build the
 * operator registered is authored state, and losing it on reload would be
 * surprising. Rollouts and jobs are *not* persisted; those are simulated.
 *
 * Ordering is "newest last", which `latestVersion` in the service relies on,
 * so inserts are sorted by release date rather than appended.
 */
export interface CatalogueStoreState {
  readonly versions: readonly FirmwareVersion[];

  addVersion: (version: FirmwareVersion) => void;
  removeVersion: (version: string) => void;
  resetToDefaults: () => void;
}

function sortByRelease(versions: readonly FirmwareVersion[]): readonly FirmwareVersion[] {
  return [...versions].sort((left, right) => left.releasedAt - right.releasedAt);
}

export const useCatalogueStore = create<CatalogueStoreState>()(
  persist(
    (set) => ({
      versions: FIRMWARE_CATALOGUE,

      addVersion: (version) =>
        set((state) => {
          // Re-registering a version replaces it rather than duplicating.
          const without = state.versions.filter(
            (entry) => entry.version !== version.version,
          );
          return { versions: sortByRelease([...without, version]) };
        }),

      removeVersion: (version) =>
        set((state) => ({
          versions: state.versions.filter((entry) => entry.version !== version),
        })),

      resetToDefaults: () => set({ versions: FIRMWARE_CATALOGUE }),
    }),
    persistConfig<CatalogueStoreState, { readonly versions: readonly FirmwareVersion[] }>(
      STORAGE_KEYS.catalogue,
      1,
      (state) => ({ versions: state.versions }),
    ),
  ),
);

/** Non-reactive read, for services outside the component tree. */
export function getCatalogue(): readonly FirmwareVersion[] {
  return useCatalogueStore.getState().versions;
}
