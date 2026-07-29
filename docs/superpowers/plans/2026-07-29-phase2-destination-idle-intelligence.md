# Phase 2 Destination and Idle Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-check driver destination purpose and prompt once after five stationary minutes unless the vehicle is within 100 metres of a confirmed restaurant/order-collection destination.

**Architecture:** Implement a pure TypeScript idle state machine for immediate on-device behavior and persist resulting events through an idempotent backend API. Add a backend place-classification boundary with cached Nominatim responses and driver-final confirmation.

**Tech Stack:** React Native, TypeScript, Jest, FastAPI, SQLAlchemy, Alembic, pytest, OpenStreetMap Nominatim.

## Global Constraints

- The driver is the final authority and can edit destination purpose during the trip.
- Never auto-end a trip.
- Idle detection consumes only GPS points with accuracy at most 50 metres.
- Foreground-only GPS remains the policy.
- Provider failure retains the driver classification and marks app classification unavailable.

---

### Task 1: Destination and idle persistence

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/alembic/versions/0003_destination_idle.py`
- Create: `backend/tests/test_idle_intelligence.py`

**Interfaces:**
- Adds destination-purpose/provenance fields to `MobileTripSession`.
- Produces `TripIdleEvent` with duration, displacement, destination distance/purpose, classification, prompt, response, source, confidence, and idempotency key.

- [ ] Write failing persistence tests for destination context and idempotent idle events.
- [ ] Run the targeted pytest file and confirm missing fields/tables fail.
- [ ] Implement models and migration `0003_destination_idle` with `0002_vehicle_spec_evidence` as its parent.
- [ ] Re-run tests and a clean migration upgrade.
- [ ] Commit `feat: persist destination and idle intelligence`.

### Task 2: Place classification boundary

**Files:**
- Create: `backend/app/services/place_classifier.py`
- Modify: `backend/app/config.py`
- Create: `backend/tests/test_idle_intelligence.py`

**Interfaces:**
- Produces `classify_place(lat, lng) -> PlaceClassification` with purpose, raw types, provider, confidence, checked time, and availability.
- Maps Nominatim types to `delivery`, `restaurant`, `order_collection`, `charging`, `personal`, or `other`.

- [ ] Write failing tests using injected HTTP transport for restaurant mapping, unknown types, timeout, cache reuse, User-Agent, and rate-limit behavior.
- [ ] Run targeted tests and confirm missing service failure.
- [ ] Implement the provider with `httpx`, an in-process TTL cache, configured User-Agent, and fail-closed unavailable responses.
- [ ] Re-run targeted tests.
- [ ] Commit `feat: classify trip destinations with provider evidence`.

### Task 3: Destination API contracts

**Files:**
- Modify: `backend/app/routers/mobile.py`
- Modify: `backend/tests/test_idle_intelligence.py`

**Interfaces:**
- Extends trip start with coordinates, driver purpose, and confirmation.
- Produces `PATCH /api/v1/mobile/trips/{trip_id}/destination` for edits and reclassification.

- [ ] Write failing API tests for confirmed start, mismatch preservation, driver-final edit, provider outage, inactive trip, and cross-driver access.
- [ ] Run tests and confirm schema/route failures.
- [ ] Implement start serialization and the destination patch endpoint.
- [ ] Re-run tests.
- [ ] Commit `feat: add driver-final destination classification`.

### Task 4: Pure idle state machine

**Files:**
- Create: `mobile/src/services/idleDetection.ts`
- Create: `mobile/src/services/__tests__/idleDetection.test.ts`

**Interfaces:**
- Produces `IdleDetector.update(point, destinationContext) -> IdleDecision` and `respond(action)`.
- States: moving, candidate_idle, expected_wait, prompted, continued.

- [ ] Write failing Jest tests for five-minute threshold, 30 m stationary radius, 50 m accuracy gate, 100 m destination boundary, expected wait suppression, one prompt per episode, continue suppression, and 30-second movement reset.
- [ ] Run targeted Jest and confirm missing module failure.
- [ ] Implement the deterministic state machine with injected timestamps and Haversine distance.
- [ ] Re-run targeted Jest.
- [ ] Commit `feat: detect destination-aware idle episodes`.

### Task 5: Idle event API and offline queue

**Files:**
- Modify: `backend/app/routers/mobile.py`
- Modify: `mobile/src/services/api.ts`
- Create: `mobile/src/services/idleEventQueue.ts`
- Modify: `backend/tests/test_idle_intelligence.py`
- Create: `mobile/src/services/__tests__/idleEventQueue.test.ts`

**Interfaces:**
- Produces `POST /api/v1/mobile/trips/{trip_id}/idle-events` keyed by client event ID.
- Produces durable `enqueueIdleEvent` and `flushIdleEvents` mobile functions.

- [ ] Write failing backend and mobile tests for idempotency, authorization, offline enqueue, successful removal, and failed-upload retention.
- [ ] Run both targeted suites and confirm failures.
- [ ] Implement endpoint, API client, and AsyncStorage queue.
- [ ] Re-run both suites.
- [ ] Commit `feat: sync idle decisions idempotently`.

### Task 6: Destination and idle user experience

**Files:**
- Modify: `mobile/src/components/DriverActionSheet.tsx`
- Modify: `mobile/src/services/gpsTracking.ts`
- Create: `mobile/src/components/IdleTripPrompt.tsx`
- Modify: `mobile/src/context/LiveDataContext.tsx`
- Create: `mobile/src/components/__tests__/IdleTripPrompt.test.tsx`

**Interfaces:**
- Adds destination text/coordinates/purpose to trip start.
- Feeds accepted GPS points to `IdleDetector`.
- Presents Continue trip, End trip, Edit destination; expected waits show quiet status only.

- [ ] Write failing component tests for all actions, expected-wait suppression, destination edit, and never-auto-end behavior.
- [ ] Run targeted Jest and confirm failures.
- [ ] Implement the UI and integrate state machine/event queue without changing final GPS flush ordering.
- [ ] Run Jest, TypeScript, and ESLint.
- [ ] Commit `feat: prompt drivers for unplanned idle trips`.

### Task 7: Phase 2 verification

- [ ] Run all backend and mobile tests.
- [ ] Run TypeScript, ESLint, and Android `assembleDebug`.
- [ ] Execute emulator tests for a five-minute off-destination idle and an expected destination wait.
- [ ] Verify the Phase 2 acceptance criteria line by line.
