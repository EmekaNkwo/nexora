import type { Rule } from "@/types/rules";

const CREATED = Date.UTC(2026, 0, 14, 9, 0, 0);

/**
 * Rules the platform ships with.
 *
 * These exist so a reviewer sees automation firing within seconds of starting
 * the simulation rather than having to author a rule first. The cold-chain
 * rule is the one the guided demo drives: it both raises a critical alert and
 * switches the fan on, which then actually cools the device and resolves the
 * alert — the full closed loop.
 */
export const DEFAULT_RULES: readonly Rule[] = [
  {
    id: "rule-cold-storage-critical",
    name: "Cold Storage Critical",
    description:
      "Cold chain excursion above 8°C. Raises a critical alert and engages active cooling.",
    enabled: true,
    logic: "all",
    scope: { kind: "type", deviceType: "cold-storage-sensor" },
    conditions: [
      {
        id: "cond-cold-temp",
        kind: "metric",
        metric: "temperature",
        operator: ">",
        value: 8,
        forSeconds: 0,
      },
    ],
    actions: [
      {
        id: "act-cold-alert",
        type: "send_alert",
        severity: "critical",
        message: "Cold chain excursion — product integrity at risk",
      },
      { id: "act-cold-fan", type: "send_command", command: "fan.on" },
    ],
    cooldownSeconds: 180,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
  {
    id: "rule-gateway-thermal",
    name: "Gateway Thermal Protection",
    description:
      "Gateway enclosure above 70°C for a sustained minute. Cools and switches the device to safe mode.",
    enabled: true,
    logic: "all",
    scope: { kind: "type", deviceType: "industrial-gateway" },
    conditions: [
      {
        id: "cond-gw-temp",
        kind: "metric",
        metric: "temperature",
        operator: ">",
        value: 70,
        forSeconds: 60,
      },
    ],
    actions: [
      {
        id: "act-gw-alert",
        type: "send_alert",
        severity: "critical",
        message: "Gateway enclosure overheating",
      },
      { id: "act-gw-fan", type: "send_command", command: "fan.on" },
      { id: "act-gw-mode", type: "set_device_mode", mode: "safe" },
    ],
    cooldownSeconds: 300,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
  {
    id: "rule-battery-critical",
    name: "Battery Depletion",
    description:
      "Battery below 10% anywhere in the fleet. Raises a warning and opens a field-service incident.",
    enabled: true,
    logic: "all",
    scope: { kind: "all" },
    conditions: [
      {
        id: "cond-batt",
        kind: "metric",
        metric: "battery",
        operator: "<",
        value: 10,
        forSeconds: 0,
      },
    ],
    actions: [
      {
        id: "act-batt-alert",
        type: "send_alert",
        severity: "warning",
        message: "Battery critically low — schedule replacement",
      },
      {
        id: "act-batt-incident",
        type: "create_incident",
        title: "Battery replacement required",
        assignee: "Field Service",
      },
    ],
    cooldownSeconds: 3600,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
  {
    id: "rule-silent-device",
    name: "Silent Device Detection",
    description:
      "No telemetry for five minutes. Catches devices that stop reporting without a clean disconnect.",
    enabled: true,
    logic: "all",
    scope: { kind: "all" },
    conditions: [{ id: "cond-silence", kind: "silence", forSeconds: 300 }],
    actions: [
      {
        id: "act-silent-alert",
        type: "send_alert",
        severity: "warning",
        message: "Device has stopped reporting telemetry",
      },
    ],
    cooldownSeconds: 1800,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
  {
    id: "rule-air-quality",
    name: "Air Quality Escalation",
    description:
      "AQI above 200 sustained for half a minute. Requests fresh telemetry to confirm before escalating.",
    enabled: true,
    logic: "all",
    scope: { kind: "type", deviceType: "air-quality-sensor" },
    conditions: [
      {
        id: "cond-aqi",
        kind: "metric",
        metric: "airQuality",
        operator: ">",
        value: 200,
        forSeconds: 30,
      },
    ],
    actions: [
      {
        id: "act-aqi-alert",
        type: "send_alert",
        severity: "critical",
        message: "Air quality unhealthy — ventilation required",
      },
      {
        id: "act-aqi-telemetry",
        type: "send_command",
        command: "telemetry.request",
      },
    ],
    cooldownSeconds: 600,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
  {
    id: "rule-signal-degraded",
    name: "Signal Degradation",
    description:
      "Signal below −105 dBm for two minutes. Marks the device for a connectivity review.",
    enabled: false,
    logic: "all",
    scope: { kind: "all" },
    conditions: [
      {
        id: "cond-signal",
        kind: "metric",
        metric: "signalStrength",
        operator: "<",
        value: -105,
        forSeconds: 120,
      },
    ],
    actions: [
      {
        id: "act-signal-alert",
        type: "send_alert",
        severity: "info",
        message: "Persistent poor signal — check antenna and siting",
      },
    ],
    cooldownSeconds: 3600,
    createdAt: CREATED,
    updatedAt: CREATED,
    triggerCount: 0,
  },
];
