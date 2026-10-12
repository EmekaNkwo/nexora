import { MetricRing } from "@/services/telemetry/ringBuffer";
import type { MetricKey, MetricStats, TelemetryFrame } from "@/types/telemetry";
import { summarise } from "@/utils/calculations/stats";

/**
 * In-memory telemetry store.
 *
 * Deliberately **not** a React store. Telemetry is the highest-frequency data
 * in the application — thousands of writes per second — and routing it through
 * `useState` or even a Zustand `set` would mean a render per batch. Instead
 * this is a plain object graph with an explicit, throttled subscription, read
 * through `useSyncExternalStore`. React learns that data changed at most a few
 * times per second; the data itself is always current when read.
 *
 * ### Hot / cold tiering
 *
 * Keeping a full live window for every device would cost tens of megabytes at
 * fleet scale, nearly all of it never looked at. So every device gets a small
 * cold buffer (enough for a sparkline and recent statistics), and devices the
 * UI is actually watching are *promoted* to a large hot buffer via `observe`.
 * Promotion preserves existing samples, and the hot set is LRU-capped so a
 * user who opens fifty device pages does not leak fifty large buffers.
 */

export interface TelemetryRepositoryOptions {
  /** Samples retained per metric for every device. */
  readonly coldCapacity?: number;
  /** Samples retained per metric for observed devices. */
  readonly hotCapacity?: number;
  /** Maximum simultaneously promoted devices. */
  readonly maxHotDevices?: number;
  /** Minimum gap between subscriber notifications, in ms. */
  readonly notifyIntervalMs?: number;
}

interface DeviceBuffers {
  readonly rings: Map<MetricKey, MetricRing>;
  capacity: number;
  lastTimestamp: number;
  /** Monotonic write counter, used for cheap change detection. */
  revision: number;
}

export class TelemetryRepository {
  private readonly devices = new Map<string, DeviceBuffers>();
  private readonly listeners = new Set<() => void>();
  /** Reference counts per observed device, so nested observers compose. */
  private readonly observers = new Map<string, number>();
  /** Insertion-ordered hot set; Map iteration order gives us LRU for free. */
  private readonly hotOrder = new Map<string, number>();

  private readonly coldCapacity: number;
  private readonly hotCapacity: number;
  private readonly maxHotDevices: number;
  private readonly notifyIntervalMs: number;

  private revision = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotifyAt = 0;
  private pendingNotify = false;
  private totalSamples = 0;

  constructor(options: TelemetryRepositoryOptions = {}) {
    this.coldCapacity = options.coldCapacity ?? 40;
    this.hotCapacity = options.hotCapacity ?? 900;
    this.maxHotDevices = options.maxHotDevices ?? 24;
    this.notifyIntervalMs = options.notifyIntervalMs ?? 250;
  }

  /** Global revision counter — the `getSnapshot` value for React. */
  getRevision = (): number => this.revision;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Ingests one simulator batch. The hot path — keep it allocation-light. */
  ingestBatch(frames: readonly TelemetryFrame[]): void {
    for (let index = 0; index < frames.length; index += 1) {
      this.ingestFrame(frames[index]!);
    }
    this.scheduleNotify();
  }

  ingestFrame(frame: TelemetryFrame): void {
    let buffers = this.devices.get(frame.deviceId);
    if (!buffers) {
      buffers = {
        rings: new Map(),
        capacity: this.capacityFor(frame.deviceId),
        lastTimestamp: 0,
        revision: 0,
      };
      this.devices.set(frame.deviceId, buffers);
    }

    for (const metricKey in frame.values) {
      const metric = metricKey as MetricKey;
      const value = frame.values[metric];
      if (value === undefined) continue;
      let ring = buffers.rings.get(metric);
      if (!ring) {
        ring = new MetricRing(buffers.capacity);
        buffers.rings.set(metric, ring);
      }
      ring.push(frame.timestamp, value);
      this.totalSamples += 1;
    }

    buffers.lastTimestamp = frame.timestamp;
    buffers.revision += 1;
  }

  /**
   * Promotes a device to the hot tier for as long as the returned function is
   * not called. Safe to call repeatedly for the same device.
   */
  observe(deviceId: string): () => void {
    const count = (this.observers.get(deviceId) ?? 0) + 1;
    this.observers.set(deviceId, count);
    if (count === 1) this.promote(deviceId);
    else this.hotOrder.set(deviceId, ++this.revision);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.observers.get(deviceId) ?? 1) - 1;
      if (remaining <= 0) {
        this.observers.delete(deviceId);
        this.demote(deviceId);
      } else {
        this.observers.set(deviceId, remaining);
      }
    };
  }

  isHot(deviceId: string): boolean {
    return this.hotOrder.has(deviceId);
  }

  getRing(deviceId: string, metric: MetricKey): MetricRing | undefined {
    return this.devices.get(deviceId)?.rings.get(metric);
  }

  getMetrics(deviceId: string): readonly MetricKey[] {
    const buffers = this.devices.get(deviceId);
    if (!buffers) return [];
    return [...buffers.rings.keys()];
  }

  getLatest(deviceId: string, metric: MetricKey): number | undefined {
    return this.getRing(deviceId, metric)?.last;
  }

  getLastTimestamp(deviceId: string): number | undefined {
    const value = this.devices.get(deviceId)?.lastTimestamp;
    return value === 0 ? undefined : value;
  }

  /** Oldest sample held for a device — tells the chart where live data begins. */
  getOldestTimestamp(deviceId: string, metric: MetricKey): number | undefined {
    return this.getRing(deviceId, metric)?.firstTimestamp;
  }

  getSeries(
    deviceId: string,
    metric: MetricKey,
    since = Number.NEGATIVE_INFINITY,
  ): { timestamps: number[]; values: number[] } {
    const ring = this.getRing(deviceId, metric);
    if (!ring) return { timestamps: [], values: [] };
    return ring.toArrays(since);
  }

  getStats(
    deviceId: string,
    metric: MetricKey,
    since = Number.NEGATIVE_INFINITY,
  ): MetricStats {
    const ring = this.getRing(deviceId, metric);
    if (!ring) return summarise([]);
    return summarise(ring.valuesSince(since));
  }

  /** Per-device write counter, for fine-grained memoisation. */
  getDeviceRevision(deviceId: string): number {
    return this.devices.get(deviceId)?.revision ?? 0;
  }

  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.hotOrder.delete(deviceId);
    this.observers.delete(deviceId);
  }

  clear(): void {
    this.devices.clear();
    this.hotOrder.clear();
    this.observers.clear();
    this.totalSamples = 0;
    this.revision += 1;
    this.flushNotify();
  }

  /** Diagnostics for the dev-mode panel. */
  get diagnostics(): {
    deviceCount: number;
    hotDeviceCount: number;
    ringCount: number;
    samplesIngested: number;
    approximateBytes: number;
  } {
    let ringCount = 0;
    let bytes = 0;
    for (const buffers of this.devices.values()) {
      for (const ring of buffers.rings.values()) {
        ringCount += 1;
        bytes += ring.byteLength;
      }
    }
    return {
      deviceCount: this.devices.size,
      hotDeviceCount: this.hotOrder.size,
      ringCount,
      samplesIngested: this.totalSamples,
      approximateBytes: bytes,
    };
  }

  private capacityFor(deviceId: string): number {
    return this.hotOrder.has(deviceId) ? this.hotCapacity : this.coldCapacity;
  }

  private promote(deviceId: string): void {
    this.hotOrder.set(deviceId, ++this.revision);
    this.applyCapacity(deviceId, this.hotCapacity);
    this.evictExcessHot();
  }

  private demote(deviceId: string): void {
    if (!this.hotOrder.delete(deviceId)) return;
    this.applyCapacity(deviceId, this.coldCapacity);
  }

  private evictExcessHot(): void {
    while (this.hotOrder.size > this.maxHotDevices) {
      // Oldest insertion that nothing is actively observing.
      let victim: string | null = null;
      for (const candidate of this.hotOrder.keys()) {
        if (!this.observers.has(candidate)) {
          victim = candidate;
          break;
        }
      }
      if (victim === null) return;
      this.hotOrder.delete(victim);
      this.applyCapacity(victim, this.coldCapacity);
    }
  }

  private applyCapacity(deviceId: string, capacity: number): void {
    const buffers = this.devices.get(deviceId);
    if (!buffers) return;
    buffers.capacity = capacity;
    for (const ring of buffers.rings.values()) ring.resize(capacity);
  }

  /**
   * Coalesces notifications. Without this, a 400 ms tick containing 1,100
   * frames would wake every subscriber 1,100 times.
   */
  private scheduleNotify(): void {
    this.revision += 1;
    if (this.pendingNotify) return;

    const now = Date.now();
    const elapsed = now - this.lastNotifyAt;
    if (elapsed >= this.notifyIntervalMs) {
      this.flushNotify();
      return;
    }

    this.pendingNotify = true;
    this.notifyTimer = setTimeout(
      () => this.flushNotify(),
      this.notifyIntervalMs - elapsed,
    );
  }

  private flushNotify(): void {
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.pendingNotify = false;
    this.lastNotifyAt = Date.now();
    for (const listener of [...this.listeners]) listener();
  }
}

export const telemetryRepository = new TelemetryRepository();
