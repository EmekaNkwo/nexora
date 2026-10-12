import type {
  EventListener,
  NexoraEnvelope,
  NexoraEventMap,
  NexoraEventName,
  Unsubscribe,
  WildcardListener,
} from "@/types/events";

/**
 * Typed in-process event bus.
 *
 * This is the single seam between the simulation layer and everything that
 * consumes it. Stores, the rule engine, the alert engine and the activity log
 * are all plain subscribers — none of them know the simulator exists, and the
 * simulator knows nothing about React.
 *
 * Design notes:
 * - Listener sets are snapshotted before dispatch so a listener that
 *   subscribes or unsubscribes during dispatch can't corrupt the iteration.
 * - A listener that throws is isolated: the error is reported and the
 *   remaining listeners still run. One broken panel must not stall ingestion.
 * - Wildcard listeners exist for cross-cutting consumers (activity feed, dev
 *   tools). They are intentionally second-class: they see an envelope rather
 *   than a typed payload.
 */
export class EventBus {
  private readonly listeners = new Map<NexoraEventName, Set<EventListener<never>>>();
  private readonly wildcardListeners = new Set<WildcardListener>();
  private sequence = 0;
  private emitted = 0;
  private readonly errorHandler: (error: unknown, name: NexoraEventName) => void;

  constructor(options?: {
    onListenerError?: (error: unknown, name: NexoraEventName) => void;
  }) {
    this.errorHandler =
      options?.onListenerError ??
      ((error, name) => {
        console.error(`[nexora:eventBus] listener for "${name}" threw`, error);
      });
  }

  on<K extends NexoraEventName>(name: K, listener: EventListener<K>): Unsubscribe {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const erased = listener as unknown as EventListener<never>;
    set.add(erased);
    return () => {
      set?.delete(erased);
      if (set && set.size === 0) this.listeners.delete(name);
    };
  }

  /** Subscribes to several events with one listener-per-event map. */
  onMany(
    handlers: Partial<{ [K in NexoraEventName]: EventListener<K> }>,
  ): Unsubscribe {
    const unsubscribers = (Object.keys(handlers) as NexoraEventName[]).map((name) => {
      const handler = handlers[name];
      if (!handler) return () => {};
      return this.on(name, handler as EventListener<typeof name>);
    });
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  once<K extends NexoraEventName>(name: K, listener: EventListener<K>): Unsubscribe {
    const unsubscribe = this.on(name, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  onAny(listener: WildcardListener): Unsubscribe {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  emit<K extends NexoraEventName>(name: K, payload: NexoraEventMap[K]): void {
    this.sequence += 1;
    this.emitted += 1;

    const set = this.listeners.get(name);
    if (set && set.size > 0) {
      for (const listener of [...set]) {
        try {
          (listener as unknown as EventListener<K>)(payload);
        } catch (error) {
          this.errorHandler(error, name);
        }
      }
    }

    if (this.wildcardListeners.size > 0) {
      const envelope: NexoraEnvelope<K> = {
        name,
        payload,
        at: payload && typeof payload === "object" && "at" in payload
          ? (payload as { at: number }).at
          : Date.now(),
        seq: this.sequence,
      };
      for (const listener of [...this.wildcardListeners]) {
        try {
          listener(envelope as NexoraEnvelope);
        } catch (error) {
          this.errorHandler(error, name);
        }
      }
    }
  }

  listenerCount(name?: NexoraEventName): number {
    if (name) return this.listeners.get(name)?.size ?? 0;
    let total = this.wildcardListeners.size;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Total events dispatched since construction — surfaced in dev mode. */
  get eventsEmitted(): number {
    return this.emitted;
  }

  /** Drops every listener. Used by tests and by a full simulation reset. */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }
}

/**
 * The application-wide bus. A module singleton rather than React context:
 * services need to reach it outside the component tree, and there is exactly
 * one event stream per browser tab.
 */
export const eventBus = new EventBus();
