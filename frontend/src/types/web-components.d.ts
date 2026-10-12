import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * JSX typings for the platform's custom elements.
 *
 * Only *attributes* are declared here. Rich data (series arrays, numeric
 * values on the hot path) is assigned to element properties through refs
 * instead, so it never has to be serialised into the DOM — see the wrapper
 * components in `components/shared/web-component-bridges.tsx`.
 */

type CustomElementProps<T extends HTMLElement> = DetailedHTMLProps<
  HTMLAttributes<T>,
  T
>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "nexora-sensor-gauge": CustomElementProps<HTMLElement> & {
        value?: number | string;
        min?: number | string;
        max?: number | string;
        unit?: string;
        label?: string;
        status?: string;
        decimals?: number | string;
        "reduced-motion"?: string;
      };
      "nexora-telemetry-chart": CustomElementProps<HTMLElement> & {
        tone?: string;
        label?: string;
        fill?: string;
        baseline?: number | string;
        min?: number | string;
        max?: number | string;
      };
      "nexora-device-status": CustomElementProps<HTMLElement> & {
        status?: string;
        compact?: string;
        uppercase?: string;
        pulse?: string;
      };
    }
  }
}
