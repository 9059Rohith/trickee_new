# Plan My Day and Trip History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an Android planner with calendar/map-editable stops, grounded assistant location context, and clickable evidence-backed trip-day route summaries.

**Architecture:** Extend existing deterministic backend tools and React Native screens without new native libraries. Keep route-history shaping in a pure backend service, extend the reusable OSM bridge for center selection and polylines, and preserve measured-versus-estimated provenance throughout.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest, React Native 0.80, TypeScript, Jest, Leaflet in WebView, Android Gradle.

**Spec:** `docs/superpowers/specs/2026-09-10-plan-my-day-and-trip-history-design.md`

## Global Constraints

- Use 1–10 daily-plan stops; label length 1–160; arrival format `HH:MM`; coordinates bounded to valid latitude/longitude.
- Never invent or road-snap recorded routes, provider locations, live traffic, chargers, SOC, energy, or numeric estimates.
- Route traces contain at most 800 ordered points per trip and preserve endpoints.
- Actual energy comes only from `TripEnergyLabel`; estimated energy remains separately identified.
- No new native calendar/map dependency; FCM is outside this release.
- Release version is `1.0.14` and version code is `15`.

---

### Task 1: Freeze specification and pure trip-history contract

**Files:**
- Create: `backend/app/services/trip_history.py`
- Create: `backend/tests/test_trip_history.py`

**Interfaces:**
- Produces: `valid_route_points(windows)`, `downsample_route_points(points, limit=800)`, and `telemetry_quality(stored_windows, final_sequence_no)`.

- [ ] Write tests proving invalid GPS points are excluded, first/last points survive deterministic downsampling, and `stored/final/actual_missing/completeness` arithmetic is honest.
- [ ] Run `python -m pytest tests/test_trip_history.py -q` and confirm failures are due to the missing service.
- [ ] Implement the three pure functions with finite/bounds checks and an evenly spaced integer index selection.
- [ ] Re-run the focused tests and commit the green task.

### Task 2: Add trip-day evidence API

**Files:**
- Modify: `backend/app/routers/experience.py`
- Modify: `backend/tests/test_experience_live_services.py`

**Interfaces:**
- Consumes: Task 1 trip-history helpers and existing SQLAlchemy entities.
- Produces: `GET /drivers/{driver_id}/trip-days/{service_date}?timezone=<IANA>`.

- [ ] Write API tests for own-driver access, other-driver denial, local-day boundaries, ordered/bounded route points, actual versus predicted energy, event counts, finalization evidence, and a no-trace response.
- [ ] Run the focused tests and confirm the endpoint is missing.
- [ ] Add validated timezone/date handling, eager bounded queries per selected day, evidence serialization, and the response contract from the spec.
- [ ] Re-run focused tests, then `python -m pytest -q`, and commit.

### Task 3: Enrich and override daily-plan stops

**Files:**
- Modify: `backend/app/routers/daily_plans.py`
- Modify: `backend/app/services/daily_plan_conversation.py`
- Modify: `backend/tests/test_daily_plans_api.py`
- Modify: `backend/tests/test_daily_plan_conversation.py`

**Interfaces:**
- Produces: enriched draft stops and optional `ConfirmRequest.stops` validated by Pydantic.

- [ ] Write tests proving draft locations carry Google Places evidence, client map coordinates take precedence, invalid/more-than-10 stops are rejected, and client route/energy facts are forbidden.
- [ ] Run focused tests and confirm contract failures.
- [ ] Resolve each parsed label once during draft creation, render the safe conversation reply from enriched facts, validate overrides, persist the accepted draft, and feed only label/time/coordinates/provider evidence to orchestration.
- [ ] Re-run focused and full backend suites and commit.

### Task 4: Ground AI Intelligence in current location

**Files:**
- Modify: `backend/app/routers/experience.py`
- Modify: `backend/app/services/vehicle_assistant.py`
- Modify: `backend/tests/test_experience_live_services.py`
- Modify: `backend/tests/test_vehicle_assistant.py`
- Modify: `mobile/src/screens/detail/AIAssistantScreen.tsx`

**Interfaces:**
- Consumes: existing `currentPlannerLocation()` and Google Places charger adapter.
- Produces: validated `location_context`, optional bounded nearby chargers, and evidence labels.

- [ ] Write backend tests for validated location inclusion, charger lookup on location-sensitive prompts, and explicit no-location degradation.
- [ ] Run focused backend tests and confirm failures.
- [ ] Extend assistant grounding so location and charger rows are tool facts, never prompt claims; include `location_used` and `charger_context_used` in the response.
- [ ] Update the mobile send flow to attach a location when available and display the evidence state.
- [ ] Re-run backend tests plus TypeScript/Jest and commit.

### Task 5: Add mobile calendar and structured stop editor

**Files:**
- Create: `mobile/src/services/plannerForm.ts`
- Create: `mobile/src/services/__tests__/plannerForm.test.ts`
- Create: `mobile/src/components/CalendarPickerModal.tsx`
- Create: `mobile/src/components/DailyPlanStopEditor.tsx`
- Modify: `mobile/src/services/dailyPlans.ts`
- Modify: `mobile/src/services/types.ts`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`

**Interfaces:**
- Produces: pure calendar/month helpers, immutable stop add/remove/move/update helpers, and confirm payload stops.

- [ ] Write Jest tests for leap/month boundaries, past-date disabling, 1–10 stop limits, immutable reordering, coordinate retention, and complete validation.
- [ ] Run focused Jest tests and confirm the helper module is missing.
- [ ] Implement pure helpers, then calendar and stop components; wire the screen to edit the server draft and submit validated stops.
- [ ] Run focused Jest, all Jest, `npx tsc --noEmit`, and ESLint; commit.

### Task 6: Extend OpenStreetMap for center selection and route polylines

**Files:**
- Modify: `mobile/src/services/openStreetMapHtml.ts`
- Modify: `mobile/src/services/__tests__/openStreetMapHtml.test.ts`
- Modify: `mobile/src/components/OpenStreetMap.tsx`
- Create: `mobile/src/components/LocationPickerModal.tsx`

**Interfaces:**
- Produces: `polylines`, `onCenterChange`, fixed center-pin picker mode, and confirmed coordinates.

- [ ] Write Jest tests proving safe polyline serialization, fit bounds, endpoint rendering, and debounced `map-center` bridge messages.
- [ ] Run the test and confirm it fails on the absent options.
- [ ] Add typed polylines and picker mode to the HTML/component bridge and implement the full-screen modal with current-location and Surat fallback labels.
- [ ] Re-run Jest, TypeScript, and ESLint; commit.

### Task 7: Make Past Trips clickable with day route summaries

**Files:**
- Create: `mobile/src/services/tripHistory.ts`
- Create: `mobile/src/services/__tests__/tripHistory.test.ts`
- Create: `mobile/src/screens/detail/TripDetailsScreen.tsx`
- Modify: `mobile/src/screens/detail/PastTripsScreen.tsx`
- Modify: `mobile/src/navigation/AppNavigator.tsx`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/services/types.ts`

**Interfaces:**
- Consumes: Task 2 endpoint and Task 6 polylines.
- Produces: local-day grouping/labels and `TripDetails` navigation with `{driverId, serviceDate, selectedTripId}`.

- [ ] Write Jest tests for local-day grouping, duration/SOC formatting, evidence labels, all-day polyline selection, and unavailable traces.
- [ ] Run focused Jest and confirm the helper module is missing.
- [ ] Add typed API response, pressable cards, navigation route, selector chips, recorded-route map, and measured/estimated/quality/event summary sections.
- [ ] Re-run focused/all Jest, TypeScript, and ESLint; commit.

### Task 8: Release version, documentation, and verification

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Modify: `analysis/built_implementation_and_remaining_work.md`
- Modify: `analysis/daily_logger.md`
- Modify mirrored notes under `D:/projects/trickee-evify-production/Trickee/analysis/`

**Interfaces:**
- Produces: signed `1.0.14 (15)` AAB/APK and an evidence-based release handoff.

- [ ] Change `versionName` to `1.0.14` and `versionCode` to `15`; add tests/assertions where release checks expect exact identity.
- [ ] Run backend full pytest, mobile full Jest, TypeScript, ESLint, Android JVM tests, and the repository release-validation command discovered from existing scripts.
- [ ] Build signed release artifacts, verify package/version/target SDK/signature, calculate SHA-256, and copy them to `play-store-assets` with versioned names.
- [ ] Update both analysis logs with implemented behavior, test evidence, deployment/Play state, FCM boundary, and remaining physical-handset checks.
- [ ] Deploy the backend only after tests pass; verify immutable Cloud Run revision and `/health`. Upload to Play internal testing only if the configured authenticated session and final publish authority are available, then independently verify tester availability.
- [ ] Commit source/documentation changes without adding unrelated untracked artifacts.
