jest.mock("../api", () => ({
  api: { getTelemetryTripStatus: jest.fn() },
}));

import { waitForTripFinalization } from "../tripFinalization";


describe("trip finalization polling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("polls waiting trips and maps a completed summary without mixing measured and predicted values", async () => {
    const fetchStatus = jest
      .fn()
      .mockResolvedValueOnce({ finalization_state: "waiting_for_telemetry", summary: null })
      .mockResolvedValueOnce({
        finalization_state: "completed",
        summary: {
          calculation_status: "complete",
          distance_km: 20,
          gps_window_count: 72,
          energy: {
            wh_per_km: 18.5,
            route_energy_wh: 370,
            confidence: "medium",
            source: "physics_baseline",
          },
          energy_label: {
            actual_wh_per_km: 14.9,
            actual_energy_consumed_wh: 298,
            label_source: "manual_dashboard",
            label_confidence: 0.6,
            is_training_eligible: true,
            eligibility_reason: "eligible_manual_dashboard",
          },
          soc: { measured_delta_pct: 10, estimated_consumed_pct: 8 },
          range: { estimated_remaining_km: 100 },
        },
      });

    const pending = waitForTripFinalization("token", "trip-1", {
      fetchStatus,
      intervalMs: 1000,
      timeoutMs: 30000,
    });
    await jest.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.state).toBe("completed");
    if (result.state === "completed") {
      expect(result.overlayResult.prediction.wh_per_km).toBe(18.5);
      expect(result.overlayResult.calculation.measured_wh_per_km).toBe(14.9);
      expect(result.overlayResult.calculation.measured_energy_wh).toBe(298);
    }
  });

  it("returns an honest saved-and-processing result at the deadline", async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      finalization_state: "waiting_for_telemetry",
      summary: null,
    });
    const pending = waitForTripFinalization("token", "trip-2", {
      fetchStatus,
      intervalMs: 1000,
      timeoutMs: 2000,
    });

    await jest.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual({
      state: "processing",
      message: "Trip saved; processing continues",
    });
  });

  it("rejects a permanent finalizer failure", async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      finalization_state: "failed",
      summary: { failure_reason: "invalid telemetry" },
    });

    await expect(
      waitForTripFinalization("token", "trip-3", { fetchStatus })
    ).rejects.toThrow("invalid telemetry");
  });
});
