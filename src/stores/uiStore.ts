import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MetricKey, TimeRangeKey } from "@/types/telemetry";
import { persistConfig, STORAGE_KEYS } from "@/utils/persistence";

/** Devices that can be compared on one chart at once. */
export const MAX_COMPARISON_DEVICES = 5;

/**
 * Theme preference.
 *
 * Dark is the design target — this is a NOC surface, usually on a wall display
 * in a dim room. Light exists as a daytime fallback, and `system` is the
 * default because the correct answer genuinely depends on where the screen is.
 */
export type ThemePreference = "dark" | "light" | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "dark", "light"];

export interface UiStoreState {
  readonly theme: ThemePreference;
  readonly sidebarCollapsed: boolean;
  readonly mobileNavOpen: boolean;
  readonly commandPaletteOpen: boolean;
  readonly devModeOpen: boolean;
  readonly simulatorPanelOpen: boolean;
  /** Device ids selected for telemetry comparison. */
  readonly comparisonDeviceIds: readonly string[];
  readonly comparisonMetric: MetricKey;
  readonly comparisonRange: TimeRangeKey;
  /** Device currently previewed on the map. */
  readonly mapFocusDeviceId: string | null;
  readonly reducedMotion: boolean;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setDevModeOpen: (open: boolean) => void;
  toggleDevMode: () => void;
  setSimulatorPanelOpen: (open: boolean) => void;
  toggleComparisonDevice: (deviceId: string) => void;
  setComparisonDevices: (deviceIds: readonly string[]) => void;
  clearComparison: () => void;
  setComparisonMetric: (metric: MetricKey) => void;
  setComparisonRange: (range: TimeRangeKey) => void;
  setMapFocusDevice: (deviceId: string | null) => void;
  setReducedMotion: (reduced: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  cycleTheme: () => void;
}

/** What is worth surviving a reload: a deliberate choice, not a session state. */
interface PersistedUiState {
  readonly theme: ThemePreference;
  readonly sidebarCollapsed: boolean;
}

export const useUiStore = create<UiStoreState>()(
  persist(
    (set, get) => ({
  theme: "system",
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandPaletteOpen: false,
  devModeOpen: false,
  simulatorPanelOpen: false,
  comparisonDeviceIds: [],
  comparisonMetric: "temperature",
  comparisonRange: "1H",
  mapFocusDeviceId: null,
  reducedMotion: false,

  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setDevModeOpen: (devModeOpen) => set({ devModeOpen }),
  toggleDevMode: () => set((state) => ({ devModeOpen: !state.devModeOpen })),
  setSimulatorPanelOpen: (simulatorPanelOpen) => set({ simulatorPanelOpen }),

  /**
   * Adds or removes a device from the comparison set, capped so the chart
   * stays legible and the colour scale stays distinguishable.
   */
  toggleComparisonDevice: (deviceId) => {
    const { comparisonDeviceIds } = get();
    if (comparisonDeviceIds.includes(deviceId)) {
      set({
        comparisonDeviceIds: comparisonDeviceIds.filter((id) => id !== deviceId),
      });
      return;
    }
    if (comparisonDeviceIds.length >= MAX_COMPARISON_DEVICES) return;
    set({ comparisonDeviceIds: [...comparisonDeviceIds, deviceId] });
  },

  setComparisonDevices: (deviceIds) =>
    set({ comparisonDeviceIds: deviceIds.slice(0, MAX_COMPARISON_DEVICES) }),

  clearComparison: () => set({ comparisonDeviceIds: [] }),
  setComparisonMetric: (comparisonMetric) => set({ comparisonMetric }),
  setComparisonRange: (comparisonRange) => set({ comparisonRange }),
  setMapFocusDevice: (mapFocusDeviceId) => set({ mapFocusDeviceId }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),

  setTheme: (theme) => set({ theme }),

  /** Cycles system → dark → light, so one control covers all three. */
  cycleTheme: () => {
    const current = THEME_PREFERENCES.indexOf(get().theme);
    const next = THEME_PREFERENCES[(current + 1) % THEME_PREFERENCES.length];
    if (next) set({ theme: next });
  },
    }),
    persistConfig<UiStoreState, PersistedUiState>(STORAGE_KEYS.ui, 1, (state) => ({
      theme: state.theme,
      sidebarCollapsed: state.sidebarCollapsed,
    })),
  ),
);
