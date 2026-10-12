/**
 * Fixed-capacity circular buffer for a single metric's time series.
 *
 * Backed by typed arrays rather than an array of `{ timestamp, value }`
 * objects. At 5,000 devices this is the difference between a few megabytes of
 * contiguous memory and over a million short-lived heap objects for the GC to
 * trace — and the read path for charting wants a flat array anyway.
 *
 * Timestamps are `Float64Array` (epoch millis exceed `Float32` precision);
 * values are `Float32Array`, which is ample for sensor readings.
 */
export class MetricRing {
  private timestamps: Float64Array;
  private values: Float32Array;
  private head = 0;
  private count = 0;

  constructor(private capacityValue: number) {
    this.timestamps = new Float64Array(capacityValue);
    this.values = new Float32Array(capacityValue);
  }

  get capacity(): number {
    return this.capacityValue;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  push(timestamp: number, value: number): void {
    this.timestamps[this.head] = timestamp;
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacityValue;
    if (this.count < this.capacityValue) this.count += 1;
  }

  /** Most recent value, or undefined when empty. */
  get last(): number | undefined {
    if (this.count === 0) return undefined;
    return this.values[(this.head - 1 + this.capacityValue) % this.capacityValue];
  }

  get lastTimestamp(): number | undefined {
    if (this.count === 0) return undefined;
    return this.timestamps[(this.head - 1 + this.capacityValue) % this.capacityValue];
  }

  get firstTimestamp(): number | undefined {
    if (this.count === 0) return undefined;
    return this.timestamps[this.startIndex()];
  }

  /**
   * Walks entries oldest → newest, optionally skipping anything older than
   * `since`. Callback form avoids materialising an array on the hot path.
   */
  forEach(
    visit: (timestamp: number, value: number) => void,
    since = Number.NEGATIVE_INFINITY,
  ): void {
    const start = this.startIndex();
    for (let offset = 0; offset < this.count; offset += 1) {
      const index = (start + offset) % this.capacityValue;
      const timestamp = this.timestamps[index]!;
      if (timestamp < since) continue;
      visit(timestamp, this.values[index]!);
    }
  }

  /** Copies the window into fresh arrays, oldest → newest. */
  toArrays(since = Number.NEGATIVE_INFINITY): {
    timestamps: number[];
    values: number[];
  } {
    const outTimestamps: number[] = [];
    const outValues: number[] = [];
    this.forEach((timestamp, value) => {
      outTimestamps.push(timestamp);
      outValues.push(value);
    }, since);
    return { timestamps: outTimestamps, values: outValues };
  }

  /** Values only — used by the statistics helpers. */
  valuesSince(since = Number.NEGATIVE_INFINITY): number[] {
    const out: number[] = [];
    this.forEach((_, value) => out.push(value), since);
    return out;
  }

  /**
   * Grows or shrinks capacity, preserving the most recent entries.
   *
   * This is what makes device "promotion" cheap: a device being watched on its
   * detail page keeps its accumulated history when its buffer is widened from
   * the fleet-wide default to the full live window.
   */
  resize(capacity: number): void {
    if (capacity === this.capacityValue) return;
    const keep = Math.min(this.count, capacity);
    const nextTimestamps = new Float64Array(capacity);
    const nextValues = new Float32Array(capacity);

    // Copy the newest `keep` entries in chronological order.
    const skip = this.count - keep;
    const start = (this.startIndex() + skip) % this.capacityValue;
    for (let offset = 0; offset < keep; offset += 1) {
      const index = (start + offset) % this.capacityValue;
      nextTimestamps[offset] = this.timestamps[index]!;
      nextValues[offset] = this.values[index]!;
    }

    this.timestamps = nextTimestamps;
    this.values = nextValues;
    this.capacityValue = capacity;
    this.count = keep;
    this.head = keep % capacity;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Approximate heap cost in bytes — reported in the dev-mode panel. */
  get byteLength(): number {
    return this.timestamps.byteLength + this.values.byteLength;
  }

  private startIndex(): number {
    return this.count < this.capacityValue
      ? 0
      : (this.head + this.capacityValue - this.count) % this.capacityValue;
  }
}
