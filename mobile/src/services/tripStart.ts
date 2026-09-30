import type { NextDailyPlanLeg, TripSession } from "./types";

export type TripDestination =
  | {
      mode: "planned";
      planId: string;
      legIndex: number;
      text: string;
      lat: number;
      lng: number;
      source: "planned_stop";
    }
  | {
      mode: "manual";
      text: string;
      lat: number | null;
      lng: number | null;
      source: "search_result" | "map_pin";
    }
  | {
      mode: "destinationless";
      source: "destinationless";
      warningAcknowledged: boolean;
    };

export type TripStartDraft = {
  tripId: string;
  vehicleId: string;
  startingSoc: number;
  idempotencyKey: string;
  origin?: { lat: number; lng: number };
  destination: TripDestination;
};

export type TripStartPayload = {
  trip_id: string;
  vehicle_id: string;
  starting_soc: number;
  idempotency_key: string;
  origin?: { lat: number; lng: number };
  destination_text?: string;
  destination_lat?: number;
  destination_lng?: number;
  planned_trip_id?: string;
  planned_leg_index?: number;
  destination_source: "planned_stop" | "search_result" | "map_pin" | "destinationless";
  record_without_destination?: boolean;
};

export type TripStartValidation = { valid: true; reason: null } | { valid: false; reason: string };

export type DestinationSearchResult = {
  query: string;
  place_id?: string | null;
  name?: string | null;
  formatted_address?: string | null;
  coordinates: { lat: number; lng: number };
  source: string;
  confidence?: number | null;
};

const validCoordinate = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

export function destinationFromSearchResult(
  result: DestinationSearchResult
): Extract<TripDestination, { mode: "manual" }> {
  const text = (result.formatted_address || result.name || result.query).trim();
  if (
    !text ||
    !validCoordinate(result.coordinates.lat, -90, 90) ||
    !validCoordinate(result.coordinates.lng, -180, 180)
  ) {
    throw new Error("Destination search returned an invalid map location.");
  }
  return {
    mode: "manual",
    text,
    lat: result.coordinates.lat,
    lng: result.coordinates.lng,
    source: "search_result",
  };
}

export function manualDestinationTextChanged(
  destination: Extract<TripDestination, { mode: "manual" }>,
  text: string
): Extract<TripDestination, { mode: "manual" }> {
  if (text === destination.text) return destination;
  return { mode: "manual", text, lat: null, lng: null, source: "search_result" };
}

export function adjustManualDestinationPin(
  destination: Extract<TripDestination, { mode: "manual" }>,
  coordinates: { lat: number; lng: number }
): Extract<TripDestination, { mode: "manual" }> {
  return {
    mode: "manual",
    text: destination.text.trim() || "Pinned destination",
    lat: coordinates.lat,
    lng: coordinates.lng,
    source: "map_pin",
  };
}

export function validateTripStart(draft: TripStartDraft): TripStartValidation {
  if (!draft.tripId.trim() || !draft.vehicleId.trim() || !draft.idempotencyKey.trim()) {
    return { valid: false, reason: "Trip identity is unavailable. Refresh and try again." };
  }
  if (!Number.isFinite(draft.startingSoc) || draft.startingSoc < 0 || draft.startingSoc > 100) {
    return { valid: false, reason: "Enter a battery SOC from 0 to 100%." };
  }
  if (draft.origin && (
    !validCoordinate(draft.origin.lat, -90, 90) ||
    !validCoordinate(draft.origin.lng, -180, 180)
  )) {
    return { valid: false, reason: "Current location is invalid. Refresh location and try again." };
  }
  if (draft.destination.mode === "destinationless") {
    return draft.destination.warningAcknowledged
      ? { valid: true, reason: null }
      : { valid: false, reason: "Confirm that route and charging guidance will be limited." };
  }
  if (!draft.destination.text.trim()) {
    return { valid: false, reason: "Choose a destination before starting." };
  }
  if (
    !validCoordinate(draft.destination.lat ?? Number.NaN, -90, 90) ||
    !validCoordinate(draft.destination.lng ?? Number.NaN, -180, 180)
  ) {
    return { valid: false, reason: "Choose a resolved search result or map pin." };
  }
  if (draft.destination.mode === "planned" && (
    !draft.destination.planId.trim() ||
    !Number.isInteger(draft.destination.legIndex) ||
    draft.destination.legIndex < 0
  )) {
    return { valid: false, reason: "This planned stop is no longer available. Choose another destination." };
  }
  return { valid: true, reason: null };
}

export function buildTripStartPayload(draft: TripStartDraft): TripStartPayload {
  const validation = validateTripStart(draft);
  if (!validation.valid) throw new Error(validation.reason);
  const base: TripStartPayload = {
    trip_id: draft.tripId,
    vehicle_id: draft.vehicleId,
    starting_soc: draft.startingSoc,
    idempotency_key: draft.idempotencyKey,
    destination_source: draft.destination.source,
    ...(draft.origin ? { origin: draft.origin } : {}),
  };
  if (draft.destination.mode === "planned") {
    return {
      ...base,
      planned_trip_id: draft.destination.planId,
      planned_leg_index: draft.destination.legIndex,
    };
  }
  if (draft.destination.mode === "manual") {
    return {
      ...base,
      destination_text: draft.destination.text.trim(),
      destination_lat: draft.destination.lat!,
      destination_lng: draft.destination.lng!,
    };
  }
  return { ...base, record_without_destination: true };
}

export function createTripStartAttemptId(now = Date.now(), random = Math.random()): string {
  const suffix = Math.floor(Math.max(0, Math.min(random, 0.999999)) * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `trip-start-${now}-${suffix}`;
}

export function plannedDestinationFromNextLeg(
  leg: NextDailyPlanLeg | null,
  requested?: { planId: string; legIndex: number }
): Extract<TripDestination, { mode: "planned" }> | null {
  if (!leg) return null;
  if (requested && (leg.plan_id !== requested.planId || leg.leg_index !== requested.legIndex)) {
    return null;
  }
  if (
    !leg.destination_text.trim() ||
    !validCoordinate(leg.destination_lat, -90, 90) ||
    !validCoordinate(leg.destination_lng, -180, 180)
  ) return null;
  return {
    mode: "planned",
    planId: leg.plan_id,
    legIndex: leg.leg_index,
    text: leg.destination_text,
    lat: leg.destination_lat,
    lng: leg.destination_lng,
    source: "planned_stop",
  };
}

export type ArrivalOutcome = "arrived" | "skipped" | "ended_elsewhere";

export function completionOutcomeForTrip(
  trip: Pick<TripSession, "planned_trip_id">,
  selected: ArrivalOutcome | null
): ArrivalOutcome | undefined {
  if (!trip.planned_trip_id) return undefined;
  if (!selected) {
    throw new Error("Choose whether you arrived, skipped the stop, or ended elsewhere.");
  }
  return selected;
}

export async function executeTripStart(
  draft: TripStartDraft,
  dependencies: {
    prepareCollector: () => Promise<unknown>;
    createTrip: (payload: TripStartPayload) => Promise<{ id: string }>;
    startNative: (tripId: string, vehicleId: string) => Promise<unknown>;
  }
): Promise<{ id: string }> {
  const payload = buildTripStartPayload(draft);
  await dependencies.prepareCollector();
  const trip = await dependencies.createTrip(payload);
  await dependencies.startNative(trip.id, draft.vehicleId);
  return trip;
}

export function createTripStartSubmissionGuard() {
  let inFlight: Promise<unknown> | null = null;
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (inFlight) return inFlight as Promise<T>;
      const pending = operation();
      inFlight = pending;
      const clear = () => {
        if (inFlight === pending) inFlight = null;
      };
      pending.then(clear, clear);
      return pending;
    },
  };
}
