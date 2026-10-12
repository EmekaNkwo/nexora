/**
 * `<nexora-device-status>` — the fleet's canonical status indicator.
 *
 * ## Why this is a Web Component and not a React component
 *
 * This one is not about performance. It is about there being exactly **one**
 * definition of what each device status looks like, enforced by the platform
 * rather than by convention.
 *
 * A status pill appears in the device table, the map popup, the alert list, the
 * device header, the command console and the activity feed. As a React
 * component it would be one implementation among several — easy for a later
 * surface to hand-roll a `<span className="text-red-500">` and drift. As a
 * custom element with shadow-DOM styling, the appearance is sealed: a consumer
 * can position it, but cannot restyle its internals, and nothing in the host
 * page's cascade can leak in and change it.
 *
 * That encapsulation also makes it safely embeddable — a status page or a
 * third-party ops display can use this element directly and get pixel-identical
 * semantics with no stylesheet to import.
 *
 * ### Non-colour encoding
 *
 * Status is never communicated by colour alone. Each state has a distinct
 * glyph (filled dot, hollow ring, triangle, square, chevron), a text label,
 * and `aria-label`, so the indicator survives greyscale, colour blindness and
 * screen readers.
 */

import { CustomElementBase } from "@/web-components/ssrSafeBase";

export type DeviceStatusValue =
  | "online"
  | "offline"
  | "warning"
  | "critical"
  | "maintenance"
  | "updating";

interface StatusPresentation {
  readonly label: string;
  readonly colour: string;
  /** Shape cue, so the state is legible without colour. */
  readonly glyph: string;
  readonly description: string;
}

const PRESENTATION: Record<DeviceStatusValue, StatusPresentation> = {
  online: {
    label: "Online",
    colour: "#34d399",
    glyph: "●",
    description: "Device is connected and reporting normally",
  },
  offline: {
    label: "Offline",
    colour: "#64748b",
    glyph: "○",
    description: "Device is not reachable",
  },
  warning: {
    label: "Warning",
    colour: "#fbbf24",
    glyph: "▲",
    description: "Device has crossed a warning threshold",
  },
  critical: {
    label: "Critical",
    colour: "#f87171",
    glyph: "■",
    description: "Device has crossed a critical threshold",
  },
  maintenance: {
    label: "Maintenance",
    colour: "#a78bfa",
    glyph: "◆",
    description: "Device is under maintenance",
  },
  updating: {
    label: "Updating",
    colour: "#38bdf8",
    glyph: "⟳",
    description: "Device is installing firmware",
  },
};

const TEMPLATE = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      font-family: inherit;
      font-size: 0.75rem;
      line-height: 1;
      white-space: nowrap;
      vertical-align: middle;
    }
    :host([hidden]) { display: none; }
    .glyph {
      font-size: 0.7em;
      color: var(--status-colour);
      /* Keeps glyphs of differing widths from shifting the label. */
      display: inline-flex;
      justify-content: center;
      min-width: 1em;
    }
    .label {
      color: var(--status-colour);
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    /* Pulse marks live states; suppressed for reduced motion and for states
       that are not actively changing. */
    :host([pulse]) .glyph { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([pulse]) .glyph { animation: none; }
    }
    :host([compact]) .label { display: none; }
    :host([uppercase]) .label {
      text-transform: uppercase;
      font-size: 0.68rem;
      letter-spacing: 0.07em;
    }
  </style>
  <span class="glyph" aria-hidden="true"></span>
  <span class="label"></span>
`;

export class DeviceStatusElement extends CustomElementBase {
  static get observedAttributes(): string[] {
    return ["status"];
  }

  private glyphNode: HTMLElement | null = null;
  private labelNode: HTMLElement | null = null;
  private statusValue: DeviceStatusValue = "offline";

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    const root = this.shadowRoot;
    if (!root) return;
    if (!this.glyphNode) {
      root.innerHTML = TEMPLATE;
      this.glyphNode = root.querySelector(".glyph");
      this.labelNode = root.querySelector(".label");
    }
    this.render();
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (name !== "status") return;
    this.statusValue = isStatus(next) ? next : "offline";
    this.render();
  }

  set status(next: DeviceStatusValue) {
    if (next === this.statusValue) return;
    this.statusValue = next;
    this.setAttribute("status", next);
    this.render();
  }

  get status(): DeviceStatusValue {
    return this.statusValue;
  }

  private render(): void {
    const presentation = PRESENTATION[this.statusValue];
    this.style.setProperty("--status-colour", presentation.colour);
    if (this.glyphNode) this.glyphNode.textContent = presentation.glyph;
    if (this.labelNode) this.labelNode.textContent = presentation.label;

    // `role="status"` would announce on every change — far too chatty for a
    // table of 1,000 rows. `img` with a label is read on focus instead.
    if (!this.hasAttribute("role")) this.setAttribute("role", "img");
    this.setAttribute("aria-label", `${presentation.label}: ${presentation.description}`);
    this.setAttribute("title", presentation.description);
  }
}

function isStatus(value: string | null): value is DeviceStatusValue {
  return value !== null && value in PRESENTATION;
}

/** Exported so React surfaces can reuse the same colours for non-pill UI. */
export const STATUS_PRESENTATION: Readonly<Record<DeviceStatusValue, StatusPresentation>> =
  PRESENTATION;
