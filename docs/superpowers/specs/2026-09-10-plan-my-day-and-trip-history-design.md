# Plan My Day and Trip History Design

## Goal

Ship one Android release that makes daily planning form-driven and location-aware, gives the AI assistant verified current-location context, and turns Past Trips into an evidence-backed route and trip-summary viewer.

## User experience

### Plan My Day

- The service date is selected from an in-app calendar modal and stored as an ISO `YYYY-MM-DD` value. Dates before the device-local current date are disabled for new plans.
- The free-form conversation remains available. The deterministic schedule parser remains authoritative; the LLM may phrase the response but cannot invent locations, routes, traffic, chargers, SOC, or numeric estimates.
- Parsed stops become editable cards. A driver can add, remove, and move up/down between 1 and 10 stops. Each stop requires a non-empty label and a valid local arrival time before confirmation.
- Each stop offers `Select on map`. The picker opens a full-screen OpenStreetMap view centered on the current phone location, with Surat as an explicit fallback when no fix is available. A fixed center pin represents the selected coordinate; moving the map updates the coordinate readout. Confirming writes the latitude and longitude into that stop.
- Map selection does not depend on public reverse geocoding. The user-entered label remains the display label and coordinates are the routing authority.
- Chat-entered text locations are resolved once through Google Places when the draft is created. The draft shows the verified name/address and source when available, or a clear unresolved state when not.
- Confirming sends the edited stop list to the backend. Explicit map coordinates override text geocoding. Text-only stops are routed from their Google Places resolution. The backend validates the complete override and persists it before route/SOC calculation.

### AI Intelligence location context

- The mobile client requests the latest permitted foreground location before sending an assistant message and includes it when available.
- The backend validates the coordinates, adds them to the deterministic tool context, and may fetch nearby verified charger listings when the question is location-sensitive.
- The assistant answer and evidence label state whether current location and Google Places charger context were used. No location fix remains a supported degraded state; the assistant must not imply that it knows the location.

### Past Trips

- Every trip card is pressable and includes a chevron and `View route & summary` affordance.
- Pressing a card opens an in-app Trip Details screen for the trip's local calendar day. The screen offers `All day` plus one selector per trip when the day contains multiple trips.
- The map draws the selected trip polyline, or all trip polylines for the day, with start and end markers. It never fabricates, road-snaps, or substitutes a planned route for recorded GPS.
- The summary shows recorded start/end times, duration, distance, starting/ending/SOC used, actual energy and Wh/km when an authoritative label exists, estimated energy separately, average/max speed, stops/dwell, GPS stored/final/missing/completeness, finalization state, training eligibility/reason, and telemetry event counts/warnings.
- If raw telemetry has expired or is archived outside the online database, summary data still renders and the map states `Route trace is no longer available`.

## API contracts

### Enriched daily-plan stop

```json
{
  "label": "Adani International School",
  "requested_arrival_local": "07:45",
  "status": "resolved",
  "coordinates": {"lat": 23.0123, "lng": 72.5012},
  "resolved_location": {
    "place_id": "places/abc",
    "name": "Adani International School",
    "formatted_address": "Ahmedabad, Gujarat",
    "coordinates": {"lat": 23.0123, "lng": 72.5012},
    "source": "google_places",
    "confidence": 0.85,
    "degraded_reason": null
  }
}
```

`POST /daily-plans/{plan_id}/confirm` accepts an optional `stops` array containing 1 to 10 validated stops. Each stop has a 1–160 character label, `HH:MM` arrival, optional bounded coordinates, and optional provider evidence copied from the owned draft. Unknown fields are rejected. The server uses only the submitted coordinates or its own provider resolution, never client-supplied route distance, energy, SOC, traffic, or charger facts.

### Trip-day detail

`GET /drivers/{driver_id}/trip-days/{service_date}?timezone=Asia/Kolkata` is authorized with the same own-driver/admin/fleet-admin policy as the existing trip list. The timezone must be a valid IANA zone. The response includes the requested local date and an ordered `trips` array. Each trip contains:

- identifiers, status, start/end timestamps, origin/destination labels;
- `route_points`: ordered `{latitude, longitude, event_time, sequence_no}` points;
- `route_trace_available` and an explicit unavailable reason;
- feature, finalization, energy-label, prediction, telemetry-quality, and event-summary objects.

Route points come from `TelemetryWindow` rows where `gps_available` is true and coordinates are finite and within bounds. They are ordered by sequence, preserve first and last valid points, and are deterministically downsampled to at most 800 points per trip. `stored_windows` is the count of all telemetry windows. `final_windows` is `MobileTripSession.final_sequence_no`. `actual_missing_windows` is `max(final_windows - stored_windows, 0)` and completeness is `stored_windows / final_windows * 100` only when the final count is known.

Actual energy comes only from `TripEnergyLabel`; estimated energy remains separately sourced from the latest `TripPrediction`. Telemetry event summaries are counts by severity/type and a bounded latest-event list. No raw IMU payload is returned.

## Components and boundaries

- `CalendarPickerModal` owns month navigation, disabled past dates, and ISO date output without adding a native dependency.
- `DailyPlanStopEditor` owns stop labels/times, add/remove/reorder actions, and location evidence display.
- `LocationPickerModal` owns the center-pin map interaction and emits only coordinates.
- `OpenStreetMap` and its HTML builder gain optional polylines and map-center messages while preserving existing markers.
- `TripDetailsScreen` owns selector, route map, evidence summary, loading, retry, empty, and expired-trace states.
- Backend route serialization/downsampling is kept in a focused `trip_history.py` service so database querying and pure transformation are independently testable.

## Failure and safety behavior

- Calendar and stop edits remain local until draft creation or confirmation succeeds.
- Provider failures preserve labels and show degraded evidence; they do not create coordinates.
- A stop without coordinates can be confirmed only if server-side Google Places resolution succeeds; otherwise its leg is explicitly unavailable, consistent with current degraded routing behavior.
- Location permission denial does not crash planning or chat. The map uses the labeled Surat fallback and the assistant reports that live location was unavailable.
- Trip ownership is checked before any route points or summaries are returned.
- Route payloads are bounded to protect mobile memory and response time.

## Verification and release

- Backend tests cover stop enrichment, override validation/ownership, map-coordinate precedence, trip-day authorization, date boundaries, downsampling, missing-window arithmetic, evidence separation, and expired traces.
- Mobile Jest tests cover calendar math, stop editing/validation, HTML polylines and center messages, and trip-summary presentation helpers.
- Run the full backend suite, mobile Jest suite, TypeScript compiler, ESLint, Android JVM tests, and signed release checks.
- Use version `1.0.14` with version code `15` to avoid confusion with the signed but unpublished `1.0.13 (14)` artifact.
- Backend deployment and Play upload remain separately verified operations. FCM remains outside this feature; local high-priority reminders continue to work, and no remote-push readiness claim is made.

## What breaks first

The highest-risk dependency is provider resolution/routing availability, followed by very large route traces. The design contains both: explicit degraded states with no invented coordinates, and bounded deterministic downsampling. Physical-device checks remain required for WebView map gestures, location permission behavior, and notification delivery timing.
