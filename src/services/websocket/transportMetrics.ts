import type { InfrastructureMetrics } from "@/types/activity";

/**
 * Rolling counter over a sliding time window.
 *
 * Used for messages/sec and bytes/sec. Samples are stored as (timestamp,
 * value) pairs in a plain array and expired from the front, which is O(1)
 * amortised and avoids recomputing a full history every read.
 */
class SlidingWindow {
  private readonly stamps: number[] = [];
  private readonly values: number[] = [];
  private sum = 0;

  constructor(private readonly windowMs: number) {}

  add(value: number, now: number): void {
    this.stamps.push(now);
    this.values.push(value);
    this.sum += value;
    this.expire(now);
  }

  /** Per-second rate across the window. */
  rate(now: number): number {
    this.expire(now);
    if (this.stamps.length === 0) return 0;
    const span = Math.max(this.windowMs, 1);
    return (this.sum * 1000) / span;
  }

  mean(now: number): number {
    this.expire(now);
    if (this.values.length === 0) return 0;
    return this.sum / this.values.length;
  }

  get size(): number {
    return this.values.length;
  }

  reset(): void {
    this.stamps.length = 0;
    this.values.length = 0;
    this.sum = 0;
  }

  private expire(now: number): void {
    const cutoff = now - this.windowMs;
    let removed = 0;
    while (removed < this.stamps.length && this.stamps[removed]! < cutoff) {
      this.sum -= this.values[removed]!;
      removed += 1;
    }
    if (removed > 0) {
      this.stamps.splice(0, removed);
      this.values.splice(0, removed);
    }
  }
}

/** Approximate wire size of a telemetry frame, used for the ingestion KPI. */
export const BYTES_PER_FRAME = 148;

export class TransportMetrics {
  private readonly messages = new SlidingWindow(5000);
  private readonly bytes = new SlidingWindow(5000);
  private readonly latencies = new SlidingWindow(10_000);
  private totalTelemetryEvents = 0;
  private eventsProcessed = 0;
  private dropped = 0;
  private connected = false;

  recordFrames(count: number, now: number): void {
    this.messages.add(count, now);
    this.bytes.add(count * BYTES_PER_FRAME, now);
    this.totalTelemetryEvents += count;
  }

  recordEvent(now: number): void {
    this.eventsProcessed += 1;
    this.messages.add(1, now);
    this.bytes.add(BYTES_PER_FRAME, now);
  }

  recordLatency(latencyMs: number, now: number): void {
    this.latencies.add(latencyMs, now);
  }

  recordDrop(count = 1): void {
    this.dropped += count;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  snapshot(now: number): InfrastructureMetrics {
    return {
      messagesPerSecond: Math.round(this.messages.rate(now)),
      averageLatencyMs: Math.round(this.latencies.mean(now)),
      totalTelemetryEvents: this.totalTelemetryEvents,
      ingestionBytesPerSecond: Math.round(this.bytes.rate(now)),
      eventsProcessed: this.eventsProcessed,
      socketConnected: this.connected,
      droppedFrames: this.dropped,
    };
  }

  reset(): void {
    this.messages.reset();
    this.bytes.reset();
    this.latencies.reset();
    this.totalTelemetryEvents = 0;
    this.eventsProcessed = 0;
    this.dropped = 0;
  }
}
