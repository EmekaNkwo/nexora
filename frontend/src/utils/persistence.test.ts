// Runs under jsdom — see the `dom` project in `vitest.config.mts`. This is the
// only file in the suite that needs a DOM: persistence and the pre-paint theme
// script are defined entirely in terms of `localStorage` and
// `document.documentElement`, and stubbing those by hand would be testing the
// stubs. Everything else stays on `node`, which is faster and keeps the domain
// tests honest about having no DOM dependency.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { themeScript } from "@/components/shell/themeScript";
import { useRuleStore } from "@/stores/ruleStore";
import { useThresholdStore } from "@/stores/thresholdStore";
import { useUiStore } from "@/stores/uiStore";
import { STORAGE_KEYS } from "@/utils/persistence";

/**
 * Persistence is easy to write and easy to get silently wrong: a store that
 * saves but never restores, or restores into a shape nothing reads, behaves
 * exactly like one that works until you reload. These drive the real stores.
 */

function readStored(key: string): { state: Record<string, unknown> } | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }) : null;
}

beforeEach(() => {
  localStorage.clear();
  useRuleStore.getState().resetToDefaults();
  useThresholdStore.getState().resetToDefaults();
  useUiStore.getState().setTheme("system");
});

describe("persisted stores", () => {
  it("writes operator-authored rules to storage", () => {
    // Derived from a real rule rather than hand-built, so the fixture cannot
    // drift away from the shape the engine actually consumes.
    const template = useRuleStore.getState().rules[0]!;
    useRuleStore.getState().createRule({ ...template, id: "", name: "Audit rule" });

    const stored = readStored(STORAGE_KEYS.rules);
    const rules = stored?.state.rules as readonly { name: string }[] | undefined;
    expect(rules?.some((rule) => rule.name === "Audit rule")).toBe(true);
  });

  it("does not persist firing history", () => {
    useRuleStore.getState().recordTrigger({
      id: "trig-1",
      ruleId: useRuleStore.getState().rules[0]!.id,
      ruleName: "Audit rule",
      deviceId: "LAG-1000",
      deviceName: "Cold store 1000",
      triggeredAt: 1_760_000_000_000,
      conditions: [],
      actions: [],
    });

    const stored = readStored(STORAGE_KEYS.rules);
    // A log of what a previous session's fleet did would be fiction after a
    // reload, so only the definitions are kept.
    expect(stored?.state.triggers).toBeUndefined();
    expect(stored?.state.triggerCounts).toBeUndefined();
  });

  it("restores threshold edits across a reload", async () => {
    const profileId = useThresholdStore.getState().profiles[0]!.id;
    const critical = (): number | null | undefined =>
      useThresholdStore.getState().profiles.find((profile) => profile.id === profileId)
        ?.thresholds.temperature?.critical;

    useThresholdStore.getState().updateThreshold(profileId, "temperature", { critical: 41 });
    expect(critical()).toBe(41);

    // Snapshot what was written. Every `setState` persists, so clearing the
    // in-memory state below also overwrites storage — the saved payload has to
    // be captured first and put back, or "reload" would restore the wipe.
    const saved = localStorage.getItem(STORAGE_KEYS.thresholds)!;

    useThresholdStore.setState({ profiles: [] });
    expect(critical()).toBeUndefined();

    // A fresh page: storage as it was, in-memory state empty, then the
    // rehydrate `usePersistedState` performs on mount.
    localStorage.setItem(STORAGE_KEYS.thresholds, saved);
    await useThresholdStore.persist.rehydrate();
    expect(critical()).toBe(41);
  });

  it("persists the theme preference but not transient UI state", () => {
    useUiStore.getState().setTheme("light");
    useUiStore.getState().setCommandPaletteOpen(true);

    const stored = readStored(STORAGE_KEYS.ui);
    expect(stored?.state.theme).toBe("light");
    expect(stored?.state.commandPaletteOpen).toBeUndefined();
  });

  it("survives a corrupt payload instead of throwing", () => {
    localStorage.setItem(STORAGE_KEYS.rules, "{not json");
    expect(() => useRuleStore.persist.rehydrate()).not.toThrow();
    expect(useRuleStore.getState().rules.length).toBeGreaterThan(0);
  });
});

describe("themeScript", () => {
  /** Runs the pre-paint script against a given stored payload. */
  function run(): string | null {
    document.documentElement.className = "";
    // Executed as real source, exactly as the browser receives it in the
    // blocking <script>. A hand-reimplementation here would test nothing.
    new Function(themeScript)();
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  }

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  it("reads the key and envelope the ui store actually writes", () => {
    // The whole point: not a hand-built fixture, but whatever `uiStore` wrote.
    useUiStore.getState().setTheme("light");
    expect(run()).toBe("light");

    useUiStore.getState().setTheme("dark");
    expect(run()).toBe("dark");
  });

  it("falls back to dark when nothing is stored", () => {
    localStorage.clear();
    expect(run()).toBe("dark");
  });

  it("does not throw on a corrupt payload", () => {
    localStorage.setItem(STORAGE_KEYS.ui, "{not json");
    expect(() => run()).not.toThrow();
  });
});
