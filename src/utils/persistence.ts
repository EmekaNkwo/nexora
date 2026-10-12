import { createJSONStorage, type PersistOptions } from "zustand/middleware";

/**
 * Persistence for operator-authored state.
 *
 * Only state the operator *wrote* is persisted — rules, thresholds, theme.
 * Simulated state is deliberately not: the fleet is deterministic in its seed,
 * so it reconstructs identically on reload, and storing thousands of telemetry
 * readings in `localStorage` would be both slow and pointless. The rule is
 * "persist what the user would be annoyed to lose", not "persist everything".
 */

/** Namespaced so the console never collides with anything else on the origin. */
export const STORAGE_PREFIX = "nexora:";

export const STORAGE_KEYS = {
  ui: `${STORAGE_PREFIX}ui`,
  rules: `${STORAGE_PREFIX}rules`,
  thresholds: `${STORAGE_PREFIX}thresholds`,
  catalogue: `${STORAGE_PREFIX}catalogue`,
} as const;

/**
 * `localStorage` that cannot throw.
 *
 * Three real failure modes, all of which must degrade to "this session just
 * isn't persisted" rather than taking the console down: there is no
 * `localStorage` during server rendering; Safari's private mode and some
 * enterprise policies throw `SecurityError` on access; and a full quota throws
 * on write. None of those are worth an error boundary — persistence is a
 * convenience here, not a correctness requirement.
 */
function readStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const { localStorage } = window;
    // Touch it: merely having the property does not mean access is permitted.
    const probe = `${STORAGE_PREFIX}probe`;
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

let cachedStorage: Storage | null | undefined;

function storage(): Storage | null {
  if (cachedStorage === undefined) cachedStorage = readStorage();
  return cachedStorage;
}

/** True when this browser will actually retain anything we write. */
export function isPersistenceAvailable(): boolean {
  return storage() !== null;
}

export const safeJsonStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    try {
      return storage()?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      storage()?.setItem(name, value);
    } catch {
      // Quota exceeded, or storage revoked mid-session. Dropping the write is
      // correct: the in-memory store stays authoritative either way.
    }
  },
  removeItem: (name: string): void => {
    try {
      storage()?.removeItem(name);
    } catch {
      // See above.
    }
  },
}));

/**
 * Shared persist configuration.
 *
 * `skipHydration` is the important part. Zustand rehydrates synchronously for
 * `localStorage`, which would make the client's first render disagree with the
 * server-rendered HTML and trip React's hydration check. Instead every store
 * starts at its defaults — matching the server — and `rehydratePersistedStores`
 * applies the stored values once, after mount.
 */
export function persistConfig<T, P>(
  name: string,
  version: number,
  partialize: (state: T) => P,
): Pick<
  PersistOptions<T, P>,
  "name" | "version" | "partialize" | "storage" | "skipHydration"
> {
  return {
    name,
    version,
    partialize,
    storage: safeJsonStorage as PersistOptions<T, P>["storage"],
    skipHydration: true,
  };
}

/** A store exposing zustand's persist API. */
interface RehydratableStore {
  readonly persist: {
    rehydrate: () => Promise<void> | void;
  };
}

/**
 * Applies persisted state to every store, after mount.
 *
 * Failures are swallowed per store: one corrupt key — hand-edited, or written
 * by an older build — must not stop the others from loading.
 */
export function rehydrateStores(stores: readonly RehydratableStore[]): void {
  for (const store of stores) {
    try {
      void store.persist.rehydrate();
    } catch {
      // Corrupt or incompatible payload; that store keeps its defaults.
    }
  }
}

/** Clears everything the console has persisted. Used by the settings reset. */
export function clearPersistedState(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      storage()?.removeItem(key);
    } catch {
      // Nothing useful to do; the caller is already resetting in-memory state.
    }
  }
}
