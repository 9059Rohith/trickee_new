import { resolveCollectorSync } from "../collectorSyncPolicy";

describe("collector synchronization policy", () => {
  it("does not stop durable capture while identity or live data is unresolved", () => {
    expect(resolveCollectorSync(false, false, null, null)).toEqual({ action: "none" });
    expect(resolveCollectorSync(true, false, null, null)).toEqual({ action: "none" });
  });

  it("starts the assigned active trip and stops only after an authoritative idle response", () => {
    expect(resolveCollectorSync(true, true, "trip-1", "vehicle-1")).toEqual({
      action: "start",
      tripId: "trip-1",
      vehicleId: "vehicle-1",
    });
    expect(resolveCollectorSync(true, true, null, "vehicle-1")).toEqual({ action: "stop" });
  });
});
