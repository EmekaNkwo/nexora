"use client";

import { useMemo } from "react";

import { Panel, PanelBody, PanelHeader } from "@/components/shared/Panel";
import { SensorGauge, TelemetrySparkline } from "@/components/shared/web-component-bridges";
import { InlineHint } from "@/components/shared/states";
import { useSparkline } from "@/hooks/useTelemetry";
import { resolveThresholds } from "@/services/telemetry/thresholds";
import { useThresholdStore } from "@/stores/thresholdStore";
import { evaluateMetric } from "@/services/telemetry/thresholds";
import type { BreachLevel } from "@/types/alerts";
import type { Device } from "@/types/device";
import { DEVICE_TYPE_DESCRIPTORS } from "@/types/device";
import type { MetricKey } from "@/types/telemetry";
import { METRIC_DESCRIPTORS } from "@/types/telemetry";
import type { GaugeStatus } from "@/web-components/sensor-gauge/SensorGaugeElement";
import type { ChartTone } from "@/web-components/telemetry-chart/TelemetryChartElement";

/**
 * Current readings as gauges.
 *
 * Every tile here is driven by the two canvas Web Components. At four to six
 * tiles per device, each updating several times a second, this is exactly the
 * case the custom elements exist for: a value change is a property assignment
 * and a canvas repaint, with no React render in the path.
 *
 * Gauge colour is derived from the device's *resolved* thresholds, so a
 * cold-chain sensor at 7°C reads as warning while a gateway at 7°C reads as
 * perfectly normal.
 */

function toGaugeStatus(level: BreachLevel): GaugeStatus {
  if (level === "critical") return "critical";
  if (level === "warning") return "warning";
  return "normal";
}

function toChartTone(level: BreachLevel): ChartTone {
  if (level === "critical") return "critical";
  if (level === "warning") return "warning";
  return "neutral";
}

interface GaugeTileProps {
  readonly deviceId: string;
  readonly metric: MetricKey;
  readonly value: number | undefined;
  readonly level: BreachLevel;
}

function GaugeTile({ deviceId, metric, value, level }: GaugeTileProps) {
  const sparkline = useSparkline(deviceId, metric, 40);
  const descriptor = METRIC_DESCRIPTORS[metric];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="mx-auto w-full max-w-[9rem]">
        <SensorGauge metric={metric} value={value} status={toGaugeStatus(level)} />
      </div>
      <div className="h-9">
        <TelemetrySparkline
          points={sparkline}
          metric={metric}
          tone={toChartTone(level)}
          label={`${descriptor.label} recent trend`}
        />
      </div>
    </div>
  );
}

export function DeviceGaugeGrid({ device }: { readonly device: Device }) {
  const profiles = useThresholdStore((state) => state.profiles);
  const descriptor = DEVICE_TYPE_DESCRIPTORS[device.type];

  const thresholds = useMemo(
    () => resolveThresholds(device, profiles),
    [device, profiles],
  );

  const metrics = useMemo(
    () =>
      descriptor.metrics.filter(
        (metric) => device.telemetry.values[metric] !== undefined,
      ),
    [descriptor.metrics, device.telemetry.values],
  );

  return (
    <Panel flush>
      <PanelHeader
        title="Current telemetry"
        description="Gauges and sparklines render on canvas via Web Components — no React render per reading"
        headingLevel={3}
      />
      <PanelBody>
        {metrics.length === 0 ? (
          <InlineHint>
            This device is not currently reporting. Its last known readings are shown in
            the history chart below.
          </InlineHint>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(min(10rem, 100%), 1fr))",
            }}
          >
            {metrics.map((metric) => {
              const value = device.telemetry.values[metric];
              const level =
                value === undefined ? null : evaluateMetric(value, thresholds[metric]);
              return (
                <GaugeTile
                  key={metric}
                  deviceId={device.id}
                  metric={metric}
                  value={value}
                  level={level}
                />
              );
            })}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
