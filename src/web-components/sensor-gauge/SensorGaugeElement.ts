/**
 * `<nexora-sensor-gauge>` — a radial gauge for a single live metric.
 *
 * ## Why this is a Web Component and not a React component
 *
 * Three reasons, in order of weight:
 *
 * 1. **It repaints far more often than React should re-render.** A device page
 *    shows four to six of these, each tracking a metric that updates several
 *    times a second. As React components, every update would mean a render, a
 *    reconciliation pass and a commit — for a widget whose entire output is one
 *    `arc()` call. Here, a new value is a property assignment that schedules a
 *    single `requestAnimationFrame` and paints to a canvas. React never learns
 *    the value changed, because it does not need to.
 *
 * 2. **Its animation is stateful and imperative.** The needle eases toward its
 *    target rather than snapping, which means per-frame interpolation state.
 *    That is naturally held in instance fields, not in React state where every
 *    frame would be a re-render.
 *
 * 3. **It is genuinely reusable outside this app.** An operations wall display
 *    or an embedded status page can use `<nexora-sensor-gauge value="28.4">`
 *    with no framework at all, and shadow-DOM style encapsulation means the
 *    host page's CSS cannot break it.
 *
 * Accessibility is handled explicitly rather than inherited: the element
 * exposes `role="img"` with a composed `aria-label`, so a screen reader gets
 * "Temperature, 28.4 degrees Celsius, warning" instead of an opaque canvas.
 */

import { CustomElementBase } from "@/web-components/ssrSafeBase";

export type GaugeStatus = "normal" | "warning" | "critical" | "unknown";

const TEMPLATE = `
  <style>
    :host {
      display: block;
      position: relative;
      container-type: inline-size;
      /* Consumers override these; defaults keep the element usable bare. */
      --gauge-track: rgba(148, 163, 184, 0.18);
      --gauge-fill: #38bdf8;
      --gauge-text: #e2e8f0;
      --gauge-muted: rgba(148, 163, 184, 0.9);
      --gauge-size: 100%;
    }
    :host([hidden]) { display: none; }
    .wrap {
      position: relative;
      width: var(--gauge-size);
      aspect-ratio: 1 / 1;
    }
    canvas { display: block; width: 100%; height: 100%; }
    .readout {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.1em;
      pointer-events: none;
      font-family: inherit;
    }
    .value {
      font-size: 1.45rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--gauge-text);
      line-height: 1;
    }
    .unit { font-size: 0.7rem; color: var(--gauge-muted); }
    .label {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--gauge-muted);
    }
    @container (max-width: 110px) {
      .value { font-size: 1.05rem; }
      .label { display: none; }
    }
  </style>
  <div class="wrap">
    <canvas part="canvas"></canvas>
    <div class="readout">
      <span class="value"></span>
      <span class="unit"></span>
      <span class="label"></span>
    </div>
  </div>
`;

/** Arc spans 240°, starting at 150° — a standard open-bottom gauge. */
const START_ANGLE = (150 * Math.PI) / 180;
const SWEEP = (240 * Math.PI) / 180;

const STATUS_COLORS: Record<GaugeStatus, string> = {
  normal: "#34d399",
  warning: "#fbbf24",
  critical: "#f87171",
  unknown: "#64748b",
};

export class SensorGaugeElement extends CustomElementBase {
  static get observedAttributes(): string[] {
    return ["value", "min", "max", "unit", "label", "status", "decimals", "reduced-motion"];
  }

  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private valueNode: HTMLElement | null = null;
  private unitNode: HTMLElement | null = null;
  private labelNode: HTMLElement | null = null;

  private targetValue = Number.NaN;
  /** Animated position, eased toward `targetValue`. */
  private displayValue = Number.NaN;
  private minValue = 0;
  private maxValue = 100;
  private decimalPlaces = 1;
  private unitText = "";
  private labelText = "";
  private statusValue: GaugeStatus = "unknown";
  private prefersReducedMotion = false;

  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

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
      this.valueNode = root.querySelector(".value");
      this.unitNode = root.querySelector(".unit");
      this.labelNode = root.querySelector(".label");
    }

    if (!this.hasAttribute("role")) this.setAttribute("role", "img");

    // Repaint on resize: a canvas has no intrinsic responsiveness, and the
    // backing store must track devicePixelRatio to stay sharp.
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this);

    this.resizeCanvas();
    this.syncText();
    this.scheduleFrame();
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
      case "value":
        this.value = next === null ? Number.NaN : Number.parseFloat(next);
        break;
      case "min":
        this.minValue = next === null ? 0 : Number.parseFloat(next);
        this.scheduleFrame();
        break;
      case "max":
        this.maxValue = next === null ? 100 : Number.parseFloat(next);
        this.scheduleFrame();
        break;
      case "unit":
        this.unitText = next ?? "";
        this.syncText();
        break;
      case "label":
        this.labelText = next ?? "";
        this.syncText();
        break;
      case "status":
        this.statusValue = (next as GaugeStatus | null) ?? "unknown";
        this.syncText();
        this.scheduleFrame();
        break;
      case "decimals":
        this.decimalPlaces = next === null ? 1 : Number.parseInt(next, 10);
        this.syncText();
        break;
      case "reduced-motion":
        this.prefersReducedMotion = next !== null && next !== "false";
        break;
    }
  }

  /**
   * Property setter is the fast path. React sets this via a ref rather than
   * re-rendering an attribute, so a value update costs one assignment.
   */
  set value(next: number) {
    if (Number.isNaN(next)) {
      this.targetValue = Number.NaN;
      this.displayValue = Number.NaN;
      this.syncText();
      this.scheduleFrame();
      return;
    }
    if (next === this.targetValue) return;
    this.targetValue = next;
    if (Number.isNaN(this.displayValue) || this.prefersReducedMotion) {
      this.displayValue = next;
    }
    this.syncText();
    this.scheduleFrame();
  }

  get value(): number {
    return this.targetValue;
  }

  set status(next: GaugeStatus) {
    if (next === this.statusValue) return;
    this.statusValue = next;
    this.syncText();
    this.scheduleFrame();
  }

  get status(): GaugeStatus {
    return this.statusValue;
  }

  /** Sets range, unit and label in one call to avoid four separate repaints. */
  configure(options: {
    min: number;
    max: number;
    unit: string;
    label: string;
    decimals: number;
  }): void {
    this.minValue = options.min;
    this.maxValue = options.max;
    this.unitText = options.unit;
    this.labelText = options.label;
    this.decimalPlaces = options.decimals;
    this.syncText();
    this.scheduleFrame();
  }

  private syncText(): void {
    const hasValue = !Number.isNaN(this.targetValue);
    const text = hasValue ? this.targetValue.toFixed(this.decimalPlaces) : "—";
    if (this.valueNode) this.valueNode.textContent = text;
    if (this.unitNode) this.unitNode.textContent = hasValue ? this.unitText : "";
    if (this.labelNode) this.labelNode.textContent = this.labelText;

    this.setAttribute(
      "aria-label",
      hasValue
        ? `${this.labelText || "Sensor"}: ${text}${this.unitText}, ${this.statusValue}`
        : `${this.labelText || "Sensor"}: no reading`,
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

    const centerX = width / 2;
    const centerY = height / 2;
    const thickness = Math.max(4, Math.min(width, height) * 0.09);
    const radius = Math.min(width, height) / 2 - thickness / 2 - 2;
    if (radius <= 0) return;

    const styles = getComputedStyle(this);
    const track = styles.getPropertyValue("--gauge-track").trim() || "rgba(148,163,184,0.18)";

    context.lineCap = "round";

    context.beginPath();
    context.strokeStyle = track;
    context.lineWidth = thickness;
    context.arc(centerX, centerY, radius, START_ANGLE, START_ANGLE + SWEEP);
    context.stroke();

    if (Number.isNaN(this.displayValue)) return;

    const span = this.maxValue - this.minValue;
    const ratio = span === 0 ? 0 : (this.displayValue - this.minValue) / span;
    const clamped = Math.max(0, Math.min(1, ratio));

    context.beginPath();
    context.strokeStyle = STATUS_COLORS[this.statusValue];
    context.lineWidth = thickness;
    context.arc(centerX, centerY, radius, START_ANGLE, START_ANGLE + SWEEP * clamped);
    context.stroke();

    // Ease toward the target and keep animating until close enough. Reduced
    // motion skips the interpolation entirely.
    if (!this.prefersReducedMotion && this.displayValue !== this.targetValue) {
      const delta = this.targetValue - this.displayValue;
      if (Math.abs(delta) < Math.max(Math.abs(span) * 0.0005, 0.001)) {
        this.displayValue = this.targetValue;
      } else {
        this.displayValue += delta * 0.18;
        this.scheduleFrame();
      }
    }
  }
}
