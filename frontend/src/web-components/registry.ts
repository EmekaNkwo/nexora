import { DeviceStatusElement } from "@/web-components/device-status/DeviceStatusElement";
import { SensorGaugeElement } from "@/web-components/sensor-gauge/SensorGaugeElement";
import { TelemetryChartElement } from "@/web-components/telemetry-chart/TelemetryChartElement";

/**
 * Custom element registration.
 *
 * Deliberately *not* done at module import time. `customElements` does not
 * exist during server rendering, and these modules are reachable from server
 * components through the shared type graph. Registration is therefore an
 * explicit, idempotent call made from a client effect in the app shell.
 *
 * `customElements.define` throws on a duplicate name, which React Strict Mode's
 * double-invoked effects would trigger, so every definition is guarded.
 */

export const ELEMENT_NAMES = {
  gauge: "nexora-sensor-gauge",
  chart: "nexora-telemetry-chart",
  status: "nexora-device-status",
} as const;

let registered = false;

function define(name: string, constructor: CustomElementConstructor): void {
  if (customElements.get(name)) return;
  customElements.define(name, constructor);
}

export function registerWebComponents(): void {
  if (registered || typeof window === "undefined" || !("customElements" in window)) {
    return;
  }
  registered = true;
  define(ELEMENT_NAMES.gauge, SensorGaugeElement);
  define(ELEMENT_NAMES.chart, TelemetryChartElement);
  define(ELEMENT_NAMES.status, DeviceStatusElement);
}

export function areWebComponentsRegistered(): boolean {
  return registered;
}

export { DeviceStatusElement, SensorGaugeElement, TelemetryChartElement };
