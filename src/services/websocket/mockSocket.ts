import { EventBus, eventBus as defaultBus } from "@/services/events/eventBus";
import { TransportMetrics } from "@/services/websocket/transportMetrics";
import type { NexoraEventMap, NexoraEventName } from "@/types/events";
import { createRng, type Rng } from "@/utils/random";

export type SocketState = "disconnected" | "connecting" | "connected";

export interface MockSocketOptions {
  readonly bus?: EventBus;
  /** Base one-way latency in ms before jitter. */
  readonly baseLatencyMs?: number;
  readonly jitterMs?: number;
  /** Probability a published frame batch is dropped entirely. */
  readonly dropRate?: number;
  readonly seed?: number;
  readonly handshakeMs?: number;
}

/**
 * A WebSocket-shaped transport with no socket behind it.
 *
 * Why this layer exists at all: the simulator could write straight to the
 * stores, but then the app's data path would be nothing like a real
 * deployment's. Routing everything through a transport that has connection
 * state, latency, jitter and packet loss means the UI has to handle reconnects,
 * stale reads and out-of-order delivery — the things that actually make an
 * operations console hard. Swapping this class for a real `WebSocket` would
 * not require touching any store, hook or component.
 *
 * `publish` is server→client (telemetry, alerts, lifecycle). `send` is
 * client→server (commands) and resolves once the simulated backend replies.
 */
export class MockSocket {
  private state: SocketState = "disconnected";
  private readonly bus: EventBus;
  private readonly rng: Rng;
  private readonly baseLatencyMs: number;
  private readonly jitterMs: number;
  private readonly handshakeMs: number;
  private dropRate: number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly stateListeners = new Set<(state: SocketState) => void>();
  readonly metrics = new TransportMetrics();

  constructor(options: MockSocketOptions = {}) {
    this.bus = options.bus ?? defaultBus;
    this.rng = createRng(options.seed ?? 0x5eed);
    this.baseLatencyMs = options.baseLatencyMs ?? 55;
    this.jitterMs = options.jitterMs ?? 40;
    this.dropRate = options.dropRate ?? 0.001;
    this.handshakeMs = options.handshakeMs ?? 420;
  }

  get connectionState(): SocketState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  onStateChange(listener: (state: SocketState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  connect(): void {
    if (this.state !== "disconnected") return;
    this.setState("connecting");
    this.schedule(() => {
      this.setState("connected");
      this.metrics.setConnected(true);
      this.bus.emit("socket.connected", { at: Date.now() });
    }, this.handshakeMs);
  }

  disconnect(reason = "client closed"): void {
    if (this.state === "disconnected") return;
    this.clearTimers();
    this.setState("disconnected");
    this.metrics.setConnected(false);
    this.bus.emit("socket.disconnected", { at: Date.now(), reason });
  }

  /** Temporarily raise the loss rate — used by the network-outage injector. */
  setDropRate(rate: number): void {
    this.dropRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Server→client delivery. The payload reaches the bus after a jittered
   * latency, so consumers genuinely observe data that is slightly stale.
   */
  publish<K extends NexoraEventName>(name: K, payload: NexoraEventMap[K]): void {
    if (!this.connected) {
      this.metrics.recordDrop();
      return;
    }

    const isTelemetryBatch = name === "device.telemetry.batch";
    const frameCount = isTelemetryBatch
      ? (payload as NexoraEventMap["device.telemetry.batch"]).frames.length
      : 1;

    if (this.rng.chance(this.dropRate)) {
      this.metrics.recordDrop(frameCount);
      return;
    }

    const latency = this.nextLatency();
    const sentAt = Date.now();

    this.schedule(() => {
      // Re-check: the socket may have closed while this frame was in flight.
      if (!this.connected) {
        this.metrics.recordDrop(frameCount);
        return;
      }
      const arrivedAt = Date.now();
      this.metrics.recordLatency(arrivedAt - sentAt, arrivedAt);
      if (isTelemetryBatch) {
        this.metrics.recordFrames(frameCount, arrivedAt);
      } else {
        this.metrics.recordEvent(arrivedAt);
      }
      this.bus.emit(name, payload);
    }, latency);
  }

  /**
   * Client→server request. Resolves after a round trip, or rejects when the
   * link is down — which is what lets the command console show real failures.
   */
  send<T>(channel: string, request: T, latencyMs?: number): Promise<T> {
    if (!this.connected) {
      return Promise.reject(
        new Error(`socket is ${this.state}; cannot send on "${channel}"`),
      );
    }
    const delay = latencyMs ?? this.nextLatency() * 2;
    return new Promise((resolve, reject) => {
      this.schedule(() => {
        if (!this.connected) {
          reject(new Error(`socket closed while awaiting "${channel}"`));
          return;
        }
        this.metrics.recordEvent(Date.now());
        resolve(request);
      }, delay);
    });
  }

  /** Current one-way latency estimate, used to seed command timings. */
  nextLatency(): number {
    return Math.max(4, this.baseLatencyMs + this.rng.range(-this.jitterMs, this.jitterMs));
  }

  destroy(): void {
    this.clearTimers();
    this.stateListeners.clear();
    this.state = "disconnected";
    this.metrics.setConnected(false);
  }

  private setState(state: SocketState): void {
    this.state = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private schedule(fn: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

export const mockSocket = new MockSocket();
