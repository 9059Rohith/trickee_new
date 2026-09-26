import {
  buildTripStartPayload,
  createTripStartAttemptId,
  validateTripStart,
  type TripStartDraft,
} from "../tripStart";

const baseDraft = (overrides: Partial<TripStartDraft> = {}): TripStartDraft => ({
  tripId: "trip-1",
  vehicleId: "vehicle-1",
  startingSoc: 82,
  idempotencyKey: "attempt-1",
  destination: {
    mode: "planned",
    planId: "plan-1",
    legIndex: 2,
    text: "Customer depot",
    lat: 21.171,
    lng: 72.831,
    source: "planned_stop",
  },
  ...overrides,
});

describe("plan-aware trip start policy", () => {
  it("preserves the exact planned-stop reference and provenance", () => {
    const payload = buildTripStartPayload(baseDraft());
    expect(payload).toMatchObject({
      trip_id: "trip-1",
      vehicle_id: "vehicle-1",
      starting_soc: 82,
      planned_trip_id: "plan-1",
      planned_leg_index: 2,
      destination_source: "planned_stop",
      idempotency_key: "attempt-1",
    });
    expect(payload).not.toHaveProperty("destination_lat");
    expect(payload).not.toHaveProperty("destination_lng");
  });

  it("rejects unresolved destination text and accepts a resolved map pin", () => {
    const unresolved = baseDraft({
      destination: {
        mode: "manual",
        text: "Somewhere near the depot",
        lat: null,
        lng: null,
        source: "search_result",
      },
    });
    expect(validateTripStart(unresolved)).toEqual({
      valid: false,
      reason: "Choose a resolved search result or map pin.",
    });

    const pin = baseDraft({
      destination: {
        mode: "manual",
        text: "Pinned destination",
        lat: 21.2,
        lng: 72.9,
        source: "map_pin",
      },
    });
    expect(buildTripStartPayload(pin)).toMatchObject({
      destination_text: "Pinned destination",
      destination_lat: 21.2,
      destination_lng: 72.9,
      destination_source: "map_pin",
    });
  });

  it("requires an explicit destinationless warning acknowledgement", () => {
    const unconfirmed = baseDraft({
      destination: {
        mode: "destinationless",
        source: "destinationless",
        warningAcknowledged: false,
      },
    });
    expect(validateTripStart(unconfirmed).valid).toBe(false);

    const confirmed = baseDraft({
      destination: {
        mode: "destinationless",
        source: "destinationless",
        warningAcknowledged: true,
      },
    });
    expect(buildTripStartPayload(confirmed)).toMatchObject({
      record_without_destination: true,
      destination_source: "destinationless",
    });
  });

  it("keeps one idempotency key stable within a submit attempt", () => {
    const draft = baseDraft({ idempotencyKey: createTripStartAttemptId(1234, 0.25) });
    expect(buildTripStartPayload(draft).idempotency_key).toBe(buildTripStartPayload(draft).idempotency_key);
    expect(createTripStartAttemptId(1234, 0.25)).toBe("trip-start-1234-250000");
  });

  it("validates SOC before constructing a request", () => {
    expect(validateTripStart(baseDraft({ startingSoc: 101 }))).toEqual({
      valid: false,
      reason: "Enter a battery SOC from 0 to 100%.",
    });
    expect(() => buildTripStartPayload(baseDraft({ startingSoc: Number.NaN }))).toThrow(
      "Enter a battery SOC from 0 to 100%."
    );
  });
});
