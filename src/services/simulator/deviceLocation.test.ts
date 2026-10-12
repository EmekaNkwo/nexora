import { describe, expect, it } from "vitest";

import { createProvisionedDevice, generateFleet, haversineKm } from "./deviceFactory";
import { SITES } from "./locations";
import type { ProvisionRequest } from "@/types/device";

const NOW = 1_760_000_000_000;

/**
 * Where devices sit on the map is load-bearing: the whole premise is a fleet
 * deployed across real places, and a device plotted in the sea or stacked on
 * top of its neighbours reads as a bug in the data, not a quirk of the demo.
 * None of it is covered by type checking — coordinates are just two numbers —
 * so it is asserted here.
 */
describe("device placement", () => {
  const site = SITES.find((candidate) => candidate.name === "Lagos Cold Storage")!;

  function request(id: string): ProvisionRequest {
    return {
      id,
      name: `Probe ${id}`,
      type: "temperature-sensor",
      model: "NX-T100",
      groupId: "grp-cold-storage",
      firmwareVersion: "2.4.1",
      // What the provisioning form actually sends: the chosen site's centre.
      location: {
        lat: site.lat,
        lng: site.lng,
        site: site.name,
        city: site.city,
        region: site.region,
      },
    };
  }

  it("places every generated device near the site it reports", () => {
    const { devices } = generateFleet(1000, 1337, NOW);
    expect(devices).toHaveLength(1000);

    for (const device of devices) {
      const home = SITES.find((candidate) => candidate.name === device.location.site);
      expect(home, `device ${device.id} reports unknown site`).toBeDefined();

      const km = haversineKm(device.location.lat, device.location.lng, home!.lat, home!.lng);
      // Scatter is gaussian with sigma = spread/2, so it is unbounded in
      // principle. 3x the nominal radius is 6 sigma — a real misplacement
      // (wrong site, swapped lat/lng, degrees-vs-radians) overshoots by
      // hundreds or thousands of km, far outside this bound.
      expect(km, `device ${device.id} is ${km.toFixed(1)}km from ${home!.name}`).toBeLessThan(
        home!.spreadKm * 3,
      );
    }
  });

  it("keeps coordinates in valid geographic range", () => {
    const { devices } = generateFleet(1000, 4242, NOW);
    for (const device of devices) {
      expect(Number.isFinite(device.location.lat)).toBe(true);
      expect(Number.isFinite(device.location.lng)).toBe(true);
      expect(Math.abs(device.location.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(device.location.lng)).toBeLessThanOrEqual(180);
    }
  });

  it("scatters provisioned devices instead of stacking them on the site centre", () => {
    const first = createProvisionedDevice(request("LAG-9001"), NOW, NOW).device;
    const second = createProvisionedDevice(request("LAG-9002"), NOW, NOW).device;

    // Distinct positions — the regression is both landing on the exact centre.
    expect(first.location.lat).not.toBe(second.location.lat);
    expect(first.location.lng).not.toBe(second.location.lng);

    for (const device of [first, second]) {
      const km = haversineKm(device.location.lat, device.location.lng, site.lat, site.lng);
      expect(km).toBeGreaterThan(0);
      expect(km).toBeLessThan(site.spreadKm * 3);
    }
  });

  it("honours an explicit coordinate rather than scattering it", () => {
    const explicit: ProvisionRequest = {
      ...request("LAG-9003"),
      location: { ...request("LAG-9003").location, lat: 6.47, lng: 3.41 },
    };

    const { device } = createProvisionedDevice(explicit, NOW, NOW);
    expect(device.location.lat).toBe(6.47);
    expect(device.location.lng).toBe(3.41);
  });

  it("gives the simulator and the device record the same position", () => {
    const { device, state } = createProvisionedDevice(request("LAG-9004"), NOW, NOW);
    expect(state.lat).toBe(device.location.lat);
    expect(state.lng).toBe(device.location.lng);
  });
});
