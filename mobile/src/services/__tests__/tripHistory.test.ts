import {
  localServiceDate,
  selectedTripPolylines,
  socUsedLabel,
  tripDurationLabel,
} from "../tripHistory";

const trip = (id: string, routeTraceAvailable = true) => ({
  id,
  vehicle_id: "vehicle-1",
  driver_id: "driver-1",
  status: "completed",
  started_at: "2026-09-10T03:00:00Z",
  ended_at: "2026-09-10T03:20:00Z",
  origin: { lat: 21.17, lng: 72.83 },
  destination: { label: "Office", lat: 21.18, lng: 72.84 },
  route_points: routeTraceAvailable ? [
    { latitude: 21.17, longitude: 72.83, event_time: "2026-09-10T03:00:01Z", sequence_no: 1 },
    { latitude: 21.18, longitude: 72.84, event_time: "2026-09-10T03:20:00Z", sequence_no: 1200 },
  ] : [],
  route_trace_available: routeTraceAvailable,
  route_trace_unavailable_reason: routeTraceAvailable ? null : "recorded_gps_unavailable_or_expired",
  features: null,
  telemetry_quality: { stored_windows: 1200, final_windows: 1200, actual_missing_windows: 0, completeness_pct: 100 },
  finalization: null,
  energy_label: { starting_soc_pct: 80, ending_soc_pct: 72, soc_delta_pct: 8, actual_energy_consumed_wh: 240, actual_wh_per_km: 28.24, usable_kwh_snapshot: 3, source: "dashboard_soc", confidence: 0.9, is_training_eligible: true, eligibility_reason: "eligible" },
  prediction: null,
  events: { by_severity: {}, by_type: {}, latest: [] },
});

describe("trip history presentation", () => {
  it("groups a UTC timestamp by the requested local calendar day", () => {
    expect(localServiceDate("2026-09-09T20:00:00Z", "Asia/Kolkata")).toBe("2026-09-10");
  });

  it("formats recorded duration and SOC without inventing missing values", () => {
    expect(tripDurationLabel("2026-09-10T03:00:00Z", "2026-09-10T04:05:00Z")).toBe("1h 5m");
    expect(socUsedLabel(80, 72)).toBe("8.0%");
    expect(socUsedLabel(80, null)).toBe("Unavailable");
    expect(socUsedLabel(90, 80, "charging_observed")).toBe("Not comparable after charging");
  });

  it("returns all recorded lines or one selected trip and omits unavailable traces", () => {
    const trips = [trip("trip-a"), trip("trip-b", false), trip("trip-c")];
    expect(selectedTripPolylines(trips, null).map(line => line.id)).toEqual(["trip-a", "trip-c"]);
    expect(selectedTripPolylines(trips, "trip-c").map(line => line.id)).toEqual(["trip-c"]);
    expect(selectedTripPolylines(trips, "trip-b")).toEqual([]);
  });
});
