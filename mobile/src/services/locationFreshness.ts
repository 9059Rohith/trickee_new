export type TimestampedLocation = {
  lat: number;
  lng: number;
  capturedAtMs: number;
};

export type ChargerLocation =
  | ({ lat: number; lng: number } & {
      kind: "fresh" | "last_known";
      source: "active_trip" | "one_shot" | "telemetry_fallback";
      observedAtMs: number;
    })
  | { kind: "unavailable"; reason: string };

const FRESH_FOR_MS = 5 * 60_000;

const valid = (value: TimestampedLocation | null | undefined): value is TimestampedLocation => Boolean(
  value &&
  Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90 &&
  Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180 &&
  Number.isFinite(value.capturedAtMs) && value.capturedAtMs > 0
);

export function resolveChargerLocation(input: {
  activeTrip: boolean;
  oneShot: TimestampedLocation | null;
  lastTelemetry: TimestampedLocation | null;
  nowMs: number;
}): ChargerLocation {
  const telemetry = valid(input.lastTelemetry) ? input.lastTelemetry : null;
  const oneShot = valid(input.oneShot) ? input.oneShot : null;
  let selected: TimestampedLocation | null;
  let source: "active_trip" | "one_shot" | "telemetry_fallback";
  if (input.activeTrip && telemetry) {
    selected = telemetry;
    source = "active_trip";
  } else if (oneShot && input.nowMs - oneShot.capturedAtMs <= FRESH_FOR_MS && input.nowMs >= oneShot.capturedAtMs) {
    selected = oneShot;
    source = "one_shot";
  } else {
    const available = [
      ...(oneShot ? [{ value: oneShot, source: "one_shot" as const }] : []),
      ...(telemetry ? [{ value: telemetry, source: "telemetry_fallback" as const }] : []),
    ].sort((left, right) => right.value.capturedAtMs - left.value.capturedAtMs);
    selected = available[0]?.value || null;
    source = available[0]?.source || "telemetry_fallback";
  }
  if (!selected) return { kind: "unavailable", reason: "No timestamped phone location is available." };
  const age = input.nowMs - selected.capturedAtMs;
  return {
    kind: age >= 0 && age <= FRESH_FOR_MS ? "fresh" : "last_known",
    source,
    lat: selected.lat,
    lng: selected.lng,
    observedAtMs: selected.capturedAtMs,
  };
}

export function chargerLocationLabel(location: ChargerLocation): string {
  if (location.kind === "unavailable") return location.reason;
  const time = new Date(location.observedAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (location.kind === "last_known") return `Last known phone location · ${time}`;
  return `${location.source === "active_trip" ? "Live trip GPS" : "Current phone location"} · ${time}`;
}

export function chargerDestinationDistanceKm(
  origin: Pick<TimestampedLocation, "lat" | "lng">,
  destination: { lat: number; lng: number } | null
): number | null {
  if (!destination) return null;
  const radiusKm = 6371;
  const dLat = (destination.lat - origin.lat) * Math.PI / 180;
  const dLng = (destination.lng - origin.lng) * Math.PI / 180;
  const left = origin.lat * Math.PI / 180;
  const right = destination.lat * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(left) * Math.cos(right) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
