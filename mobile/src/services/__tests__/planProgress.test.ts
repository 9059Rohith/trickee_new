import { nextLegPresentation, selectNextPlanLeg } from "../planProgress";
import type { DailyPlan } from "../types";

const plan = (overrides: Partial<DailyPlan> = {}): DailyPlan => ({
  id: "plan-1",
  driver_id: "driver-1",
  vehicle_id: "vehicle-1",
  service_date: "2026-09-26",
  timezone: "Asia/Kolkata",
  starting_soc_pct: 90,
  status: "confirmed",
  draft: { service_date: "2026-09-26", timezone: "Asia/Kolkata", stops: [], parser_source: "test", warnings: [] },
  result: {
    complete: true,
    final_soc_pct: 72,
    legs: [
      {
        index: 1,
        status: "pending",
        destination: { name: "Second stop", coordinates: { lat: 21.2, lng: 72.9 }, source: "google_routes" },
        requested_arrival_local: "12:00",
        planned_departure_at: "2026-09-26T05:30:00Z",
        estimated_arrival_at: "2026-09-26T06:00:00Z",
        distance_m: 10000,
        duration_s: 1800,
        traffic_delay_s: 120,
        starting_soc_pct: 80,
        energy_wh: 900,
        arrival_soc_pct: 75,
        route_source: "google_routes",
        energy_source: "vehicle_spec",
        confidence: 0.8,
        degraded_reason: null,
        chargers: [],
      },
      {
        index: 0,
        status: "arrived",
        destination: { name: "Completed stop", coordinates: { lat: 21.1, lng: 72.8 }, source: "google_routes" },
        requested_arrival_local: "10:00",
        planned_departure_at: "2026-09-26T03:30:00Z",
        estimated_arrival_at: "2026-09-26T04:00:00Z",
        distance_m: 8000,
        duration_s: 1800,
        traffic_delay_s: 0,
        starting_soc_pct: 90,
        energy_wh: 700,
        arrival_soc_pct: 84,
        route_source: "google_routes",
        energy_source: "vehicle_spec",
        confidence: 0.8,
        degraded_reason: null,
        chargers: [],
      },
    ],
  },
  ...overrides,
});

describe("daily-plan progression", () => {
  const now = new Date("2026-09-26T04:30:00Z");

  it("selects the next unresolved stop from a current confirmed plan", () => {
    expect(selectNextPlanLeg([plan()], now)).toMatchObject({
      planId: "plan-1",
      legIndex: 1,
      destination: { text: "Second stop", lat: 21.2, lng: 72.9 },
      selectionSource: "next_available",
    });
  });

  it("uses a valid bounded deep-link leg and falls back from stale or foreign references", () => {
    expect(selectNextPlanLeg([plan()], now, { planId: "plan-1", legIndex: 1 })).toMatchObject({
      planId: "plan-1",
      legIndex: 1,
      selectionSource: "requested",
      fallbackReason: null,
    });
    expect(selectNextPlanLeg([plan()], now, { planId: "foreign", legIndex: 9 })).toMatchObject({
      planId: "plan-1",
      legIndex: 1,
      selectionSource: "next_available",
      fallbackReason: "requested_leg_unavailable",
    });
    expect(selectNextPlanLeg([plan({ service_date: "2026-09-25" })], now, { planId: "plan-1", legIndex: 1 })).toBeNull();
  });

  it("builds a truthful next-stop presentation", () => {
    expect(nextLegPresentation(plan(), now)).toEqual({
      title: "Next: Second stop",
      subtitle: "Planned arrival 12:00 · Estimated 75% SOC",
      planId: "plan-1",
      legIndex: 1,
      destination: { text: "Second stop", lat: 21.2, lng: 72.9 },
    });
  });
});
