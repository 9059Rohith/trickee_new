# Actionable Live Trip Nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute natively/inline; the user explicitly requested no more questions.

**Goal:** Turn existing active-trip SOC, route, and charger pushes into evidence-backed, actionable one-tap recommendations.

**Architecture:** Extend the existing Google Routes adapter to return bounded alternatives, enhance the deterministic evaluator to compare SOC and road reachability, and update the Android Route Updates card to act on a suggestion. Keep the durable outbox and FCM path, no new streaming transport.

**Tech Stack:** Python/FastAPI, SQLAlchemy, pytest, Google Routes/Places, React Native/TypeScript/Jest, Android signed AAB, Cloud Run.

**Spec:** `docs/superpowers/specs/2026-09-25-actionable-live-trip-nudges-design.md`

## Global Constraints

- Pilot vehicle: Ola S1; only explicitly named Ola Hypercharger listings are push-eligible.
- GPS age <= 90 seconds; SOC and route values are estimated/evidence-labeled, never described as BMS measurements or guaranteed slots.
- External calls remain outside telemetry ingestion; worker cadence <= one evaluation per trip per two minutes, with existing cooldown/idempotency.
- Existing FCM outbox/inbox contracts remain backward-compatible and production URLs unchanged.

## Review Focus

- A generic car charger near an Ola scooter must not be pushed as compatible; test name filtering.
- A straight-line-near but road-unreachable charger must not be pushed; test provider road distance and SOC reserve.
- An alternate route slower than Google's default must not claim time savings; test route ranking and wording.
- An app unable to open Google Maps must not record the route as accepted; test action ordering.
- A stale/finished trip during a slow provider call must not emit a new notification; preserve existing race test.

---

### Task 1: Route facts and alternatives

**Files:** Modify `backend/app/services/daily_plan_tools.py`; test `backend/tests/test_daily_plan_tools.py`.

**Interfaces:** Produce `plan_route_options(origin, destination, departure_at) -> list[dict]`, each carrying `route_id`, `distance_m`, `duration_s`, `traffic_delay_s`, and optional `encoded_polyline`; preserve `plan_route_leg`.

- [x] Add a failing test with a fake Google response containing two alternatives; assert both are parsed with their independent traffic/distance facts.
- [x] Run `python -m pytest tests/test_daily_plan_tools.py -q` from `backend`; confirm the new test fails for the missing method.
- [x] Add the minimal adapter with `computeAlternativeRoutes: true`, explicit field mask, finite duration/distance checks, timeout degradation, and at most four routes.
- [x] Rerun the targeted test and preserve all prior adapter tests.

### Task 2: Deterministic trip advice

**Files:** Modify `backend/app/services/live_trip_nudges.py`; test `backend/tests/test_live_trip_nudges.py`.

**Interfaces:** Consume `plan_route_options` for destination guidance while preserving `plan_route_leg` for charger reachability and other planner flows; enqueue `NotificationOutbox` rows with `current_soc_pct`, `arrival_soc_pct`, `traffic_delay_s`, `route_duration_s`, `route_distance_m`, and a bounded suggested-route identity. Charger rows additionally contain `charger_distance_km`, `soc_at_charger_pct`, and `availability_confirmed: false`.

- [x] Write failing tests for conservative SOC at charger from road distance, non-Ola exclusion, <5% arrival reserve, alternative ETA/SOC comparison, missing evidence, cooldown, and completed-trip race.
- [x] Run `python -m pytest tests/test_live_trip_nudges.py -q` and confirm the intended failures.
- [x] Implement two-minute checkpoint, evidence-backed route wording, conservative charger selection using at most three bounded road-route calls, and no numeric saving claim without a valid comparison.
- [x] Rerun targeted tests, then the full backend suite from `backend` with `python -m pytest -q`.

### Task 3: One-tap mobile actions

**Files:** Modify `mobile/src/components/RouteNudgeCard.tsx`, `mobile/src/screens/detail/RouteNudgesScreen.tsx`, `mobile/src/services/mapNavigation.ts`, `mobile/src/services/types.ts`, `mobile/src/services/presentation.ts`; test `mobile/src/services/__tests__/mapNavigation.test.ts` and `mobile/src/services/__tests__/nudgeInbox.test.ts`.

**Interfaces:** `buildDirectionsUrl` accepts optional route-shaping waypoint; live route/charger primary actions open Maps before recording `accepted`, and the card shows evidence-labeled SOC/ETA facts.

- [x] Write failing Jest tests for bounded waypoint URL generation, invalid coordinates, action ordering, and live action wording.
- [x] Run targeted Jest with `npm test -- --runInBand mapNavigation nudgeInbox` from `mobile`; confirm failures.
- [x] Extend types/parser/card and action ordering. Keep the existing map fallback disabled when coordinates are unavailable; on map failure preserve the active nudge.
- [x] Run Jest, `npx tsc --noEmit`, and `npm run lint` from `mobile`.

### Task 4: Build and canary

**Files:** Update `PROJECT_MEMORY.md`, `analysis/daily_logger.md`, Android version config only after checking latest Play version code.

**Interfaces:** Signed Android bundle and immutable Cloud Run worker revision; no new database migration.

- [ ] Run all backend/mobile checks and compare the worktree diff with the spec; inspect exact deployment identity and latest Play version before a version increment.
- [ ] Build a signed release AAB, verify package/signature/version/FCM metadata, and retain the previous AAB for rollback.
- [ ] Build and deploy an immutable worker image only after the targeted and full tests pass; verify readiness and aggregate logs without claiming a handset canary until seen.
- [ ] With the next genuine pilot trip, verify trip-linked outbox evidence, FCM receipt, and handset Route Updates action; record any unverified physical gate honestly.
