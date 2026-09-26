import {
  completionOutcomeForTrip,
  createTripStartSubmissionGuard,
  executeTripStart,
  plannedDestinationFromNextLeg,
  type TripStartDraft,
} from "../tripStart";
import type { NextDailyPlanLeg } from "../types";

const draft: TripStartDraft = {
  tripId: "trip-1",
  vehicleId: "vehicle-1",
  startingSoc: 88,
  idempotencyKey: "attempt-1",
  destination: {
    mode: "manual",
    text: "Pinned customer",
    lat: 21.17,
    lng: 72.83,
    source: "map_pin",
  },
};

const nextLeg: NextDailyPlanLeg = {
  plan_id: "plan-1",
  leg_index: 2,
  status: "pending",
  destination_text: "Warehouse",
  destination_lat: 21.2,
  destination_lng: 72.9,
  planned_departure_at: null,
  planned_arrival_at: null,
  service_date: "2026-09-26",
  timezone: "Asia/Kolkata",
};

describe("destination-aware start flow", () => {
  it("starts native capture only after collector preparation and backend trip creation", async () => {
    const events: string[] = [];
    await executeTripStart(draft, {
      prepareCollector: async () => { events.push("prepared"); },
      createTrip: async payload => { events.push(`backend:${payload.trip_id}`); return { id: "server-trip" }; },
      startNative: async (tripId, vehicleId) => { events.push(`native:${tripId}:${vehicleId}`); },
    });
    expect(events).toEqual(["prepared", "backend:trip-1", "native:server-trip:vehicle-1"]);
  });

  it("does not start native capture when the backend rejects or route guidance is unavailable", async () => {
    const startNative = jest.fn();
    await expect(executeTripStart(draft, {
      prepareCollector: async () => undefined,
      createTrip: async () => { throw new Error("route provider unavailable"); },
      startNative,
    })).rejects.toThrow("route provider unavailable");
    expect(startNative).not.toHaveBeenCalled();
  });

  it("locks a double submit onto one in-flight operation", async () => {
    let release!: () => void;
    const pending = new Promise<string>(resolve => { release = () => resolve("done"); });
    const operation = jest.fn(() => pending);
    const guard = createTripStartSubmissionGuard();
    const first = guard.run(operation);
    const second = guard.run(operation);
    expect(first).toBe(second);
    expect(operation).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toBe("done");
  });

  it("uses only the server-confirmed requested plan leg and safely falls back otherwise", () => {
    expect(plannedDestinationFromNextLeg(nextLeg, { planId: "plan-1", legIndex: 2 })).toMatchObject({
      mode: "planned",
      planId: "plan-1",
      legIndex: 2,
      text: "Warehouse",
    });
    expect(plannedDestinationFromNextLeg(nextLeg, { planId: "foreign", legIndex: 2 })).toBeNull();
  });

  it("requires an explicit completion outcome only for a planned trip", () => {
    expect(completionOutcomeForTrip({ planned_trip_id: "plan-1" }, "arrived")).toBe("arrived");
    expect(() => completionOutcomeForTrip({ planned_trip_id: "plan-1" }, null)).toThrow(
      "Choose whether you arrived, skipped the stop, or ended elsewhere."
    );
    expect(completionOutcomeForTrip({}, null)).toBeUndefined();
  });
});
