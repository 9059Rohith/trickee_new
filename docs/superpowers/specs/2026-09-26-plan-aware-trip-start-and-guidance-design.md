# Plan-Aware Trip Start and Driver Guidance Design

**Date:** 2026-09-26
**Status:** Approved design awaiting written-spec review
**Scope:** GPS Driver Android app and GPS Driver backend, including the broken Plan My Day and Assistant voice-entry path

## Purpose

Connect `Plan My Day` to real trip capture so a driver can start a trip with a confirmed destination, receive route- and SOC-aware guidance, advance through a daily schedule, and still record an unscheduled trip when no destination is available.

Success means:

- every planned trip can carry an exact destination from reminder to trip start and throughout active capture;
- the driver explicitly starts telemetry and can deliberately record without a destination;
- route, arrival-SOC, and charging guidance use the selected destination rather than a fallback distance;
- one-off and recurring schedules produce auditable dated plans and deduplicated reminders;
- voice entry starts reliably on supported Android devices and fails visibly with a usable typed fallback;
- provider failures never prevent GPS recording and uncertain information is labelled;
- the change passes mobile, native Android, backend, migration, and release-build verification before any tester release.

## Product Decisions

### Destination at trip start

Starting a trip opens a dedicated form with:

1. the next eligible stop from today's confirmed plan, preselected when available;
2. manual destination search and map-pin confirmation;
3. current dashboard SOC;
4. an explicit `Record without destination` action.

A destination is strongly encouraged but not mandatory. This preserves capture for unscheduled work, outages, or ambiguous addresses. The app never silently selects an unresolved location.

The app does not auto-start telemetry from a schedule or notification. A driver confirmation remains the safety and consent boundary.

### Plan-aware trip progression

A started planned trip records the daily-plan ID and leg index together with the destination snapshot. Ending it records one of:

- `arrived`: advance to the next planned leg;
- `skipped`: leave the leg in plan history with a reason;
- `ended_elsewhere`: preserve actual endpoint and leave the planned leg unresolved.

The next stop shown on Home is derived from persisted leg state, not from array position alone.

### Recurring schedules

Recurring schedules are templates, not infinitely pre-created trips. A template contains timezone, active weekdays, stops, arrival times, and optional effective dates. The backend materializes an idempotent dated `DailyPlan` for the next service day. Drivers can edit a single day without changing the template.

Initial recurrence supports weekly weekday selection only. Calendar exceptions, holidays, and fleet-wide bulk scheduling are outside this release.

### Guidance and charging

While a destination-aware trip is active, route guidance is recalculated from the latest accepted location subject to bounded refresh rules. Guidance includes:

- distance and estimated arrival time;
- predicted arrival SOC and reserve;
- route/provider source, confidence, and staleness;
- charging recommendations when predicted arrival SOC violates the configured reserve.

Charging candidates must be near a route corridor or reachable detour, not merely near the destination. A station listing may be described as verified only when the place provider confirms it. Live connector availability, occupancy, price, and booking are never claimed without a provider that supplies those fields.

Nearby-charger browsing is available outside an active trip, but it must use a fresh one-shot phone location. If the one-shot request fails, the UI may show results from the last accepted telemetry location only when it labels them `last known`, displays the observation time, and does not describe them as current. Destination-dependent range advice is omitted outside a destination-aware trip rather than calculated from a synthetic distance.

Route/provider failure degrades guidance to unavailable or stale. It never blocks starting, collecting, uploading, or ending a GPS trip.

## User Flows

### Planned trip

1. Driver confirms a dated daily plan or a recurring template produces one.
2. Fifteen minutes before calculated departure, a notification identifies the next destination and expected arrival SOC.
3. Tapping the notification opens the start form with the plan leg and destination prefilled.
4. Driver confirms the destination and SOC, then starts the trip.
5. Native foreground telemetry begins only after the backend creates the trip.
6. The active-trip UI shows destination, route status, ETA, predicted arrival SOC, and charging advice.
7. Driver ends the trip and records ending SOC and arrival outcome.
8. The daily plan advances to the next eligible leg.

### Manual trip

1. Driver taps `Start Trip`.
2. Driver searches for a destination or selects a map pin.
3. Driver confirms SOC and starts capture.
4. The trip receives the same live guidance as a planned trip but has no plan-leg relationship.

### Destinationless trip

1. Driver taps `Record without destination` and confirms the warning that route/charging predictions will be limited.
2. GPS capture and lossless upload work normally.
3. Current-location charger listings remain available, but destination-dependent range claims are omitted.

## Mobile Architecture

### Start form

Replace the start-only use of `SOCEntryModal` with `StartTripModal`. End-trip SOC remains in `SOCEntryModal`.

`StartTripModal` owns presentation only. Pure services provide:

- next-leg selection;
- destination validation and normalized payload construction;
- offline-safe draft persistence;
- planned-leg status transitions.

The form displays destination provenance: `planned stop`, `search result`, or `map pin`. Unresolved text cannot be submitted as coordinates.

### Voice input repair

The current voice path has two confirmed design defects:

- the React Native component catches native-module subscription failure and displays no error, so missing native wiring looks like an inert button;
- Android selects the on-device recognizer whenever any on-device recognizer exists, without proving that the requested `en-IN` language model is installed, and it has no fallback to the platform recognizer after a locale failure.

The repaired path must:

1. expose `checking`, `ready`, `starting`, `listening`, `processing`, `completed`, and `failed` states;
2. check native-module and recognition-service availability and show a specific visible result;
3. prevent repeated starts while the recognizer is starting or active;
4. use the platform recognizer for the requested locale unless on-device support for that recognition request is verified;
5. fall back once from an unsupported on-device locale to the platform recognizer without discarding existing typed text;
6. preserve partial text, append the final transcript exactly once, and never submit a plan automatically;
7. time out a start that never reaches `onReadyForSpeech` and fully release the recognizer;
8. surface stable diagnostic codes for permission, missing service, unsupported locale, busy recognizer, audio failure, network failure, silence, and timeout;
9. keep raw audio out of Trickee storage and logs and avoid logging transcript content.

Voice remains optional. A phone without a microphone or compatible recognition service must still install and use all non-voice features.

### Local plan state

The app persists the latest confirmed plans and recurring-template summaries. Cached data may prefill the UI offline, but backend confirmation is required before attaching a plan leg to a new trip. If validation cannot complete, the driver may start the same trip as manual or destinationless.

### Navigation and notifications

Every scheduled occurrence has one stable occurrence ID. Local WorkManager and Firebase delivery use that ID so the Android notification is replaced rather than duplicated.

Notification actions deep-link to bounded app routes and identifiers only. They never accept arbitrary URLs. Initial notification types are:

- `daily_departure`;
- `departure_changed`;
- `low_arrival_soc`;
- `charger_recommendation`;
- `next_stop_ready`.

Traffic changes use hysteresis: create a new alert only when the recommended departure changes by at least ten minutes or a previously safe reserve becomes unsafe. This prevents noisy updates.

## Backend Architecture

### Trip start contract

Extend the existing trip-start request with:

- `origin`;
- `destination_text`, `destination_lat`, `destination_lng`;
- `planned_trip_id` and `planned_leg_index`;
- `destination_source`;
- existing `starting_soc` and idempotency key.

When a plan reference is supplied, the backend verifies ownership, driver, vehicle, confirmed status, service date, leg index, and destination coordinates. It snapshots the verified destination into the trip so later plan edits cannot rewrite trip history.

Manual and destinationless trips omit the plan reference. Invalid or foreign plan references return a bounded 4xx error and do not start telemetry.

### Persistence

Add explicit nullable plan-link fields to the trip model and structured context fields for destination provenance. Do not overload the existing completion location as the planned destination. Persist actual ending coordinates separately so planned destination and actual endpoint remain distinguishable.

Add:

- recurring schedule template and stop tables;
- daily-plan leg status and linked-trip fields;
- route-guidance snapshot records with source, confidence, observed time, and expiry;
- notification idempotency keys and outcomes using the existing durable outbox.

Migrations are additive and preserve all existing trips. Existing trips have no plan link and retain their current endpoint semantics.

### Schedule materialization

A backend worker materializes the next dated plan for each active recurring template. The uniqueness boundary is template ID plus service date. Retrying the worker cannot duplicate a daily plan or its notifications.

### Live guidance worker

The worker reads only accepted cloud telemetry. It evaluates active destination-aware trips at bounded intervals and creates a new guidance snapshot when location, route, SOC reserve, or provider freshness crosses a refresh threshold.

It may enqueue a notification only from a committed guidance snapshot. Notification creation and its idempotency key occur in the same transaction.

## Personalization Boundary

This release uses deterministic contextual personalization:

- authenticated driver and assigned vehicle;
- confirmed schedule and destination;
- current and predicted SOC;
- vehicle usable energy and energy-rate evidence;
- current accepted location;
- route duration, traffic source, and provider freshness;
- prior notification outcome for deduplication and suppression.

It does not claim learned personal preferences. Notification outcomes are stored for future evaluation but do not train or change policy in this release.

## Error Handling and Safety

- Destination search failure offers map pin, retry, or destinationless capture.
- Route and charger errors never block trip lifecycle APIs.
- Notification permission denial is visible and does not invalidate the plan.
- Missing Firebase token leaves the server notification pending until expiry; local reminders remain independent.
- Stale location, SOC, route, or charger data is marked stale or unavailable.
- Outside an active trip, charger lookup uses a fresh one-shot location or visibly time-stamped last-known coordinates; it never silently treats previous-trip telemetry as current.
- A provider response without source evidence cannot be displayed as live traffic or live charger availability.
- No trip starts automatically, and no navigation app opens without a driver action.
- Existing one-second Room capture, explicit acknowledgements, retry logic, and finalization behavior remain unchanged.

## Testing Strategy

Implementation follows test-driven development.

### Mobile unit and component tests

- next confirmed leg is selected and prefilled;
- manual search and map-pin destinations normalize correctly;
- unresolved destinations cannot be submitted;
- destinationless confirmation creates an explicit payload;
- a reminder deep-link opens the correct prefilled start form;
- one occurrence ID deduplicates local and Firebase presentation;
- planned arrival, skipped, and ended-elsewhere states advance correctly;
- recurring-template editing does not mutate an already materialized day;
- provider and permission failures degrade without blocking trip start.
- charger browsing outside a trip uses a fresh one-shot location and labels any allowed last-known fallback with its age;
- voice module absence and recognizer unavailability are visible rather than silently ignored;
- unsupported `en-IN` on-device recognition falls back once to the platform recognizer;
- repeated taps cannot create concurrent recognition sessions;
- partial and final transcripts are merged once without erasing typed schedule text;
- microphone denial, silence, network failure, and start timeout return actionable messages.

### Backend tests

- plan ownership and leg validation;
- idempotent trip start and plan-leg linkage;
- planned destination and actual endpoint remain separate;
- recurring materialization is idempotent across retries;
- route refresh thresholds and stale-data handling;
- reserve breach creates one charger nudge;
- notification retry, expiry, deduplication, and outcome recording;
- existing destinationless trip clients remain compatible.

### Integration and release gates

- migrate a copy of the current schema forward and back where supported;
- run complete backend and mobile test suites;
- run Android JVM/native tests and release lint;
- build signed APK and AAB with incremented version code/name;
- inspect manifest permissions and signing certificate identity;
- install the APK on a physical Android device;
- verify voice entry on the tester's device with `en-IN`, permission denial/retry, silence, stop-and-transcribe, and unavailable-service scenarios;
- verify planned, manual, destinationless, offline, reboot, notification, and low-SOC scenarios;
- reconcile one test trip from device outbox through Cloud SQL before release;
- upload to the existing Play internal-testing track only after all preceding gates pass.

## Deployment and Rollback

Deploy additive backend migrations and backward-compatible APIs before distributing the Android build. Old clients continue to start destinationless trips.

Release order:

1. database migration;
2. backend API and workers;
3. backend smoke tests and notification-outbox health check;
4. signed Android artifact;
5. internal-testing upload;
6. one controlled tester canary;
7. broader internal-test availability.

Rollback disables recurring materialization and guidance workers first, then rolls back the mobile release through Play. Additive schema fields remain in place until no released client depends on them.

## Explicit Non-Goals

- automatic trip start;
- in-app turn-by-turn navigation;
- charger booking, payment, or unverified live availability;
- learned notification preferences;
- fleet-wide dispatch optimization;
- calendar/holiday recurrence rules;
- silently replacing missing provider data with invented values.
