import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  BUILT_IN_THRESHOLD_PROFILES,
  type ThresholdProfile,
} from "@/services/telemetry/thresholds";
import type { MetricThreshold } from "@/types/alerts";
import type { MetricKey } from "@/types/telemetry";
import { persistConfig, STORAGE_KEYS } from "@/utils/persistence";

/**
 * Threshold configuration.
 *
 * Edits here take effect on the next ingested telemetry frame — the ingestion
 * pipeline reads the profiles on every snapshot rather than caching a resolved
 * set, so lowering a critical threshold immediately changes which devices read
 * as critical. That immediacy is the point: a threshold screen whose changes
 * only apply after a reload is not a control, it is a form.
 */
export interface ThresholdStoreState {
  readonly profiles: readonly ThresholdProfile[];
  readonly version: number;

  updateThreshold: (
    profileId: string,
    metric: MetricKey,
    patch: Partial<MetricThreshold>,
  ) => void;
  setProfileEnabled: (profileId: string, metric: MetricKey, enabled: boolean) => void;
  addProfile: (profile: ThresholdProfile) => void;
  removeProfile: (profileId: string) => void;
  resetToDefaults: () => void;
}

export const useThresholdStore = create<ThresholdStoreState>()(
  persist(
    (set) => ({
  profiles: BUILT_IN_THRESHOLD_PROFILES,
  version: 0,

  updateThreshold: (profileId, metric, patch) => {
    set((state) => ({
      profiles: state.profiles.map((profile) => {
        if (profile.id !== profileId) return profile;
        const existing = profile.thresholds[metric];
        if (!existing) return profile;
        return {
          ...profile,
          thresholds: { ...profile.thresholds, [metric]: { ...existing, ...patch } },
        };
      }),
      version: state.version + 1,
    }));
  },

  setProfileEnabled: (profileId, metric, enabled) => {
    set((state) => ({
      profiles: state.profiles.map((profile) => {
        if (profile.id !== profileId) return profile;
        const existing = profile.thresholds[metric];
        if (!existing) return profile;
        return {
          ...profile,
          thresholds: { ...profile.thresholds, [metric]: { ...existing, enabled } },
        };
      }),
      version: state.version + 1,
    }));
  },

  addProfile: (profile) =>
    set((state) => ({
      profiles: [...state.profiles, profile],
      version: state.version + 1,
    })),

  removeProfile: (profileId) =>
    set((state) => ({
      // The fleet default is load-bearing: removing it would leave devices
      // with no thresholds at all.
      profiles: state.profiles.filter(
        (profile) => profile.id !== profileId || profile.scope.kind === "default",
      ),
      version: state.version + 1,
    })),

  resetToDefaults: () =>
    set((state) => ({
      profiles: BUILT_IN_THRESHOLD_PROFILES,
      version: state.version + 1,
    })),
    }),
    persistConfig<ThresholdStoreState, { readonly profiles: readonly ThresholdProfile[] }>(
      STORAGE_KEYS.thresholds,
      1,
      (state) => ({ profiles: state.profiles }),
    ),
  ),
);

/** Non-reactive read for the ingestion pipeline. */
export function getThresholdProfiles(): readonly ThresholdProfile[] {
  return useThresholdStore.getState().profiles;
}
