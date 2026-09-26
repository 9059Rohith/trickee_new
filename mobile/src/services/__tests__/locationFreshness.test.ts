import {
  chargerDestinationDistanceKm,
  resolveChargerLocation,
} from "../locationFreshness";

describe("charger location freshness", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const oneShot = { lat: 21.17, lng: 72.83, capturedAtMs: now - 10_000 };
  const telemetry = { lat: 21.16, lng: 72.82, capturedAtMs: now - 30_000 };

  it("uses a fresh one-shot phone location before any trip", () => {
    expect(resolveChargerLocation({ activeTrip: false, oneShot, lastTelemetry: telemetry, nowMs: now })).toMatchObject({
      kind: "fresh",
      source: "one_shot",
      lat: 21.17,
      lng: 72.83,
    });
  });

  it("labels data older than five minutes as last-known with its observation time", () => {
    const stale = { ...oneShot, capturedAtMs: now - 5 * 60_000 - 1 };
    expect(resolveChargerLocation({ activeTrip: false, oneShot: stale, lastTelemetry: null, nowMs: now })).toEqual({
      kind: "last_known",
      source: "one_shot",
      lat: 21.17,
      lng: 72.83,
      observedAtMs: stale.capturedAtMs,
    });
  });

  it("prefers active-trip telemetry and never substitutes a destination distance", () => {
    expect(resolveChargerLocation({ activeTrip: true, oneShot, lastTelemetry: telemetry, nowMs: now })).toMatchObject({
      kind: "fresh",
      source: "active_trip",
      lat: telemetry.lat,
      lng: telemetry.lng,
    });
    expect(chargerDestinationDistanceKm(oneShot, null)).toBeNull();
    expect(chargerDestinationDistanceKm(oneShot, { lat: 21.2, lng: 72.9 })).toBeGreaterThan(0);
  });

  it("reports unavailable when neither source has valid timestamped coordinates", () => {
    expect(resolveChargerLocation({ activeTrip: false, oneShot: null, lastTelemetry: null, nowMs: now })).toEqual({
      kind: "unavailable",
      reason: "No timestamped phone location is available.",
    });
  });
});
