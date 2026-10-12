import { EventBus, eventBus as defaultBus } from "@/services/events/eventBus";
import { createProvisionedDevice, type DeviceSimState } from "@/services/simulator/deviceFactory";
import type { Device, ProvisionJob, ProvisionRequest, ProvisionStage } from "@/types/device";
import { PROVISION_STAGES } from "@/types/device";
import { createRng, type Rng } from "@/utils/random";

export interface ProvisioningServiceOptions {
  readonly bus?: EventBus;
  readonly seed?: number;
  readonly now?: () => number;
  readonly onJobUpdate: (job: ProvisionJob) => void;
  /** Adds the finished device to the fleet and the simulator. */
  readonly onProvisioned: (device: Device, state: DeviceSimState) => void;
  /** Rejects duplicate device ids before the flow starts. */
  readonly deviceExists: (deviceId: string) => boolean;
  readonly failureChance?: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: Readonly<Record<string, string>>;
}

/** Device ids follow the `AAA-0000` convention the fleet already uses. */
const DEVICE_ID_PATTERN = /^[A-Z]{3}-\d{3,6}$/;

/**
 * Device provisioning.
 *
 * The staged handshake (register → authenticate → configure → connect) is not
 * decoration: each stage is a real step in onboarding a device, each can fail,
 * and showing them individually is what distinguishes a provisioning flow from
 * a form that appends a row to a list. Validation runs *before* the flow
 * starts, because a rejected device id should be a form error, not a failed
 * provisioning job.
 */
export class ProvisioningService {
  private readonly bus: EventBus;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly options: ProvisioningServiceOptions;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly failureChance: number;

  constructor(options: ProvisioningServiceOptions) {
    this.options = options;
    this.bus = options.bus ?? defaultBus;
    this.rng = createRng(options.seed ?? 0x9609);
    this.now = options.now ?? (() => Date.now());
    this.failureChance = options.failureChance ?? 0.05;
  }

  validate(request: Partial<ProvisionRequest>): ValidationResult {
    const errors: Record<string, string> = {};

    const id = request.id?.trim().toUpperCase() ?? "";
    if (id.length === 0) {
      errors.id = "Device ID is required";
    } else if (!DEVICE_ID_PATTERN.test(id)) {
      errors.id = "Use the format LAG-3092 (three letters, dash, digits)";
    } else if (this.options.deviceExists(id)) {
      errors.id = `${id} is already registered`;
    }

    if (!request.name || request.name.trim().length < 3) {
      errors.name = "Name must be at least 3 characters";
    }
    if (!request.type) errors.type = "Select a device type";
    if (!request.model) errors.model = "Select a model";
    if (!request.groupId) errors.groupId = "Select a group";
    if (!request.firmwareVersion) errors.firmwareVersion = "Select a firmware version";
    if (!request.location?.site) errors.location = "Select a deployment site";

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Runs the provisioning handshake. Returns the initial job so the UI can
   * follow it; subsequent stages arrive through `onJobUpdate`.
   */
  provision(request: ProvisionRequest): ProvisionJob {
    const job: ProvisionJob = {
      id: `prov_${request.id}`,
      request,
      stage: "registering",
      startedAt: this.now(),
    };

    this.publish(job);
    this.advance(job, 0);
    return job;
  }

  destroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private advance(job: ProvisionJob, stageIndex: number): void {
    const stage = PROVISION_STAGES[stageIndex];
    if (!stage) return;

    const delay = this.rng.range(500, 1200);

    const timer = setTimeout(() => {
      this.timers.delete(timer);

      // Authentication is the realistic place for onboarding to fail.
      if (stage === "authenticating" && this.rng.chance(this.failureChance)) {
        const failed: ProvisionJob = {
          ...job,
          stage: "failed",
          error: "Device certificate rejected by the identity service",
        };
        this.publish(failed);
        return;
      }

      const next: ProvisionJob = { ...job, stage };
      this.publish(next);

      if (stage === "online") {
        this.complete(next);
        return;
      }

      this.advance(next, stageIndex + 1);
    }, delay);

    this.timers.add(timer);
  }

  private complete(job: ProvisionJob): void {
    const now = this.now();
    const { device, state } = createProvisionedDevice(job.request, now, now);
    this.options.onProvisioned(device, state);
    this.bus.emit("device.provisioned", { device });
  }

  private publish(job: ProvisionJob): void {
    this.options.onJobUpdate(job);
    this.bus.emit("device.provisioning.progress", { job });
  }
}

/** Stage captions for the provisioning progress UI. */
export const PROVISION_STAGE_LABELS: Readonly<Record<ProvisionStage, string>> = {
  registering: "Registering device…",
  authenticating: "Authenticating certificate…",
  configuring: "Applying configuration…",
  connecting: "Establishing telemetry channel…",
  online: "Online",
  failed: "Provisioning failed",
};
