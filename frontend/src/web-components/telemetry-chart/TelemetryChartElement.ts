/**
 * `<nexora-telemetry-chart>` — a canvas line chart for a telemetry series.
 *
 * ## Why this is a Web Component and not a React chart
 *
 * The device table renders one of these per visible row, and the dashboard
 * renders several more. Each tracks a series that grows a few times a second.
 * Expressed as React + SVG (Recharts), every update would allocate a VDOM tree
 * of hundreds of path nodes per chart, diff it, and commit DOM mutations — for
 * output that is a single `stroke()`.
 *
 * So the split in this codebase is deliberate: **Recharts is used for the big
 * interactive charts** where tooltips, brushes, legends and axes carry real
 * value and there is exactly one on screen; **this element is used for the
 * dense, high-frequency, non-interactive sparklines** where there may be fifty
 * at once and the only requirement is that the line be correct and cheap.
 *
 * The data crosses the boundary as a typed array set through a property, never
 * as an attribute — serialising 900 floats to a DOM string attribute on every
 * tick would defeat the entire purpose.
 */

import { CustomElementBase } from "@/web-components/ssrSafeBase";

export type ChartTone = "neutral" | "normal" | "warning" | "critical";

const TONE_COLORS: Record<ChartTone, string> = {
  neutral: "#64748b",
  normal: "#34d399",
  warning: "#fbbf24",
  critical: "#f87171",
};

const TEMPLATE = `
  <style>
    :host {
      display: block;
      position: relative;
      --chart-line: #38bdf8;
      --chart-fill: rgba(56, 189, 248, 0.14);
      --chart-grid: rgba(148, 163, 184, 0.14);
    }
    :host([hidden]) { display: none; }
    canvas { display: block; width: 100%; height: 100%; }
    .empty {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      color: rgba(148, 163, 184, 0.75);
      font-family: inherit;
    }
    :host([data-empty="true"]) .empty { display: flex; }
  </style>
  <canvas part="canvas"></canvas>
  <div class="empty">No data</div>
`;

export class TelemetryChartElement extends CustomElementBase {
  static get observedAttributes(): string[] {
    return ["tone", "label", "fill", "baseline", "min", "max"];
  }

  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame: number | null = null;

  /** Series data, held as typed arrays to avoid per-point objects. */
  private xs: Float64Array = new Float64Array(0);
  private ys: Float32Array = new Float32Array(0);
  private toneValue: ChartTone = "neutral";
  private showFill = true;
  private baselineValue: number | null = null;
  private explicitMin: number | null = null;
  private explicitMax: number | null = null;
  private labelText = "";

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    const root = this.shadowRoot;
    if (!root) return;
    if (!this.canvas) {
      root.innerHTML = TEMPLATE;
      this.canvas = root.querySelector("canvas");
      this.context = this.canvas?.getContext("2d") ?? null;
    }

    if (!this.hasAttribute("role")) this.setAttribute("role", "img");
    this.syncLabel();

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this);
    this.resizeCanvas();
  }

  disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    switch (name) {
      case "tone":
        this.toneValue = (next as ChartTone | null) ?? "neutral";
        break;
      case "fill":
        this.showFill = next !== "false";
        break;
      case "baseline":
        this.baselineValue = next === null ? null : Number.parseFloat(next);
        break;
      case "min":
        this.explicitMin = next === null ? null : Number.parseFloat(next);
        break;
      case "max":
        this.explicitMax = next === null ? null : Number.parseFloat(next);
        break;
      case "label":
        this.labelText = next ?? "";
        this.syncLabel();
        break;
    }
    this.scheduleFrame();
  }

  /**
   * Replaces the series. The hot path: called from React via a ref, and copies
   * into pre-sized typed arrays rather than retaining caller-owned arrays.
   */
  setSeries(timestamps: readonly number[], values: readonly number[]): void {
    const length = Math.min(timestamps.length, values.length);
    if (this.xs.length !== length) {
      this.xs = new Float64Array(length);
      this.ys = new Float32Array(length);
    }
    for (let index = 0; index < length; index += 1) {
      this.xs[index] = timestamps[index]!;
      this.ys[index] = values[index]!;
    }
    this.dataset.empty = length === 0 ? "true" : "false";
    this.syncLabel();
    this.scheduleFrame();
  }

  set tone(next: ChartTone) {
    if (next === this.toneValue) return;
    this.toneValue = next;
    this.scheduleFrame();
  }

  get tone(): ChartTone {
    return this.toneValue;
  }

  private syncLabel(): void {
    if (this.ys.length === 0) {
      this.setAttribute("aria-label", `${this.labelText || "Telemetry"}: no data`);
      return;
    }
    let min = this.ys[0]!;
    let max = this.ys[0]!;
    for (let index = 1; index < this.ys.length; index += 1) {
      const value = this.ys[index]!;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const last = this.ys[this.ys.length - 1]!;
    // A canvas is opaque to assistive tech, so the shape is described in words.
    this.setAttribute(
      "aria-label",
      `${this.labelText || "Telemetry"} trend: ${this.ys.length} samples, latest ${last.toFixed(1)}, range ${min.toFixed(1)} to ${max.toFixed(1)}`,
    );
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  private paint(): void {
    const context = this.context;
    const canvas = this.canvas;
    if (!context || !canvas) return;

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (this.ys.length < 2) return;

    const ratio = window.devicePixelRatio || 1;
    const padding = 2 * ratio;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;
    if (plotWidth <= 0 || plotHeight <= 0) return;

    let min = this.explicitMin ?? Number.POSITIVE_INFINITY;
    let max = this.explicitMax ?? Number.NEGATIVE_INFINITY;
    if (this.explicitMin === null || this.explicitMax === null) {
      for (let index = 0; index < this.ys.length; index += 1) {
        const value = this.ys[index]!;
        if (this.explicitMin === null && value < min) min = value;
        if (this.explicitMax === null && value > max) max = value;
      }
    }

    // A perfectly flat series would divide by zero; give it a nominal band so
    // the line renders through the middle instead of vanishing.
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
      const centre = Number.isFinite(min) ? min : 0;
      min = centre - 1;
      max = centre + 1;
    }

    const firstX = this.xs[0]!;
    const lastX = this.xs[this.xs.length - 1]!;
    const xSpan = lastX - firstX || 1;
    const ySpan = max - min;

    const toX = (value: number): number => padding + ((value - firstX) / xSpan) * plotWidth;
    const toY = (value: number): number =>
      padding + plotHeight - ((value - min) / ySpan) * plotHeight;

    const colour =
      this.toneValue === "neutral"
        ? getComputedStyle(this).getPropertyValue("--chart-line").trim() || TONE_COLORS.neutral
        : TONE_COLORS[this.toneValue];

    if (this.baselineValue !== null && this.baselineValue >= min && this.baselineValue <= max) {
      const gridColour =
        getComputedStyle(this).getPropertyValue("--chart-grid").trim() ||
        "rgba(148,163,184,0.14)";
      context.beginPath();
      context.strokeStyle = gridColour;
      context.lineWidth = Math.max(1, ratio);
      context.setLineDash([3 * ratio, 3 * ratio]);
      context.moveTo(padding, toY(this.baselineValue));
      context.lineTo(width - padding, toY(this.baselineValue));
      context.stroke();
      context.setLineDash([]);
    }

    context.beginPath();
    context.moveTo(toX(this.xs[0]!), toY(this.ys[0]!));
    for (let index = 1; index < this.ys.length; index += 1) {
      context.lineTo(toX(this.xs[index]!), toY(this.ys[index]!));
    }

    if (this.showFill) {
      // Close the path down to the baseline and fill before stroking, so the
      // stroke sits on top of its own gradient.
      context.save();
      context.lineTo(toX(lastX), padding + plotHeight);
      context.lineTo(toX(firstX), padding + plotHeight);
      context.closePath();
      const gradient = context.createLinearGradient(0, padding, 0, padding + plotHeight);
      gradient.addColorStop(0, withAlpha(colour, 0.28));
      gradient.addColorStop(1, withAlpha(colour, 0));
      context.fillStyle = gradient;
      context.fill();
      context.restore();

      context.beginPath();
      context.moveTo(toX(this.xs[0]!), toY(this.ys[0]!));
      for (let index = 1; index < this.ys.length; index += 1) {
        context.lineTo(toX(this.xs[index]!), toY(this.ys[index]!));
      }
    }

    context.strokeStyle = colour;
    context.lineWidth = Math.max(1.25, 1.5 * ratio);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    // Mark the latest sample — it is the number the operator cares about.
    context.beginPath();
    context.fillStyle = colour;
    context.arc(
      toX(lastX),
      toY(this.ys[this.ys.length - 1]!),
      Math.max(1.5, 2 * ratio),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

/** Applies an alpha channel to a hex or rgb colour string. */
function withAlpha(colour: string, alpha: number): string {
  const trimmed = colour.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((character) => character + character)
            .join("")
        : hex;
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  if (trimmed.startsWith("rgb(")) {
    return trimmed.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  if (trimmed.startsWith("rgba(")) return trimmed;
  return `rgba(100, 116, 139, ${alpha})`;
}
