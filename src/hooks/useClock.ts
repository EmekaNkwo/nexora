"use client";

import { useSyncExternalStore } from "react";

/**
 * A single shared clock tick.
 *
 * Relative timestamps ("42s ago") need to re-render periodically, but giving
 * every row its own interval means hundreds of timers and hundreds of
 * independent re-renders. One subscribable clock at module scope means one
 * timer for the whole application, and every "x ago" label in a table updates
 * on the same frame — which also stops rows from visibly disagreeing about
 * what time it is.
 *
 * Exposed through `useSyncExternalStore` rather than `useState` + an effect.
 * That is the correct primitive for this shape of data: the clock is an
 * external source React does not own, and reading it through a snapshot avoids
 * both the extra render an effect-based sync would cost and the
 * `Date.now()`-during-render impurity that reading it inline would introduce.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * The published time. Starts at 0 so the server and the first client render
 * agree; formatters treat 0 as "not yet known" and render a placeholder.
 */
let currentNow = 0;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  if (timer === null) {
    // Publish a real time as soon as anything subscribes, so the first commit
    // after hydration already has one rather than waiting a full second.
    currentNow = Date.now();
    timer = setInterval(() => {
      currentNow = Date.now();
      notify();
    }, 1000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => currentNow;
/** No clock exists during server rendering. */
const getServerSnapshot = (): number => 0;

/**
 * Current time, updated once a second.
 *
 * Returns 0 until the first subscription is established — callers should treat
 * that as "unknown" and render a placeholder rather than a relative time.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * A coarser tick for expensive consumers.
 *
 * `everyMs` is quantised against the shared clock, so a 5-second consumer
 * still shares the one timer rather than adding another, and its value is
 * referentially stable between buckets — which is what makes it usable as a
 * `useMemo` dependency.
 */
export function useCoarseNow(everyMs = 5000): number {
  const now = useNow();
  if (now === 0) return 0;
  const bucket = Math.max(1000, everyMs);
  return Math.floor(now / bucket) * bucket;
}
