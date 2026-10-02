# Phase 3 Route and Performance Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict route energy and arrival SOC and return honest end-trip moving, waiting, baseline, money, and charging comparisons.

**Architecture:** Add isolated route-provider, efficiency-selection, performance-baseline, and charging-calculation services. Extend end-trip responses and the result overlay without changing the existing GPS final-flush contract.

**Tech Stack:** FastAPI, SQLAlchemy, pytest, HTTPX, OSRM-compatible routing, React Native, TypeScript, Jest.

## Global Constraints

- Route values remain estimated with confidence/source/provenance.
- No straight-line distance may be labelled routed distance.
- Arrival SOC and range require recent SOC and usable battery capacity.
- Savings require at least five comparable trips and a configured electricity rate.
- "Using Trickee" requires an accepted intervention record.

---

### Task 1: Route provider and prediction formulas

**Files:**
- Create: `backend/app/services/route_prediction.py`
- Modify: `backend/app/config.py`
- Create: `backend/tests/test_route_performance.py`

**Interfaces:**
- Produces `RouteProvider.route(origin, destination) -> RouteResult`.
- Produces `predict_route_energy(route, vehicle, recent_soc, trip_predictions) -> RoutePredictionResult`.

- [ ] Write failing tests for OSRM parsing, timeout/unavailable behavior, latest-20 median selection with five-trip minimum, physics fallback, energy, arrival SOC, insufficient-range warning, and missing SOC.
- [ ] Run targeted pytest and confirm missing service failure.
- [ ] Implement the provider boundary and pure prediction functions.
- [ ] Re-run targeted tests.
- [ ] Commit `feat: add sourced route energy predictions`.

### Task 2: Route prediction API

**Files:**
- Modify: `backend/app/routers/experience.py`
- Modify: `backend/tests/test_route_performance.py`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/types/index.ts`

**Interfaces:**
- Produces `POST /api/v1/routes/predict` with origin, destination, vehicle ID.
- Returns route distance/duration, energy, arrival SOC, range, source, confidence, assumptions, and timestamp.

- [ ] Write failing API tests for valid prediction, cross-fleet vehicle, missing recent SOC, provider failure, and incomplete specs.
- [ ] Run targeted tests and confirm missing route failure.
- [ ] Implement endpoint and mobile types/client.
- [ ] Re-run targeted pytest and TypeScript.
- [ ] Commit `feat: expose route and arrival SOC prediction`.

### Task 3: Performance calculation service

**Files:**
- Create: `backend/app/services/trip_performance.py`
- Modify: `backend/tests/test_route_performance.py`

**Interfaces:**
- Produces `build_trip_performance(db, trip, feature, prediction) -> TripPerformanceResult`.
- Calculates moving/planned/unplanned time, comparable trips, medians, energy/duration delta, money delta, and charge-time comparison.

- [ ] Write failing tests for speed-based moving time, expected-wait allocation, 250 m endpoints, 20% distance match, five-trip minimum, median baseline, positive/negative labels, intervention attribution, currency/rate provenance, and missing charge inputs.
- [ ] Run targeted tests and confirm missing service failure.
- [ ] Implement pure formulas plus scoped database selection.
- [ ] Re-run targeted tests.
- [ ] Commit `feat: calculate defensible trip performance baselines`.

### Task 4: Configuration and intervention persistence

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/alembic/versions/0004_performance_evidence.py`
- Modify: `backend/tests/test_route_performance.py`

**Interfaces:**
- Produces fleet electricity-rate configuration and `TripIntervention` evidence with recommendation/acceptance timestamps.

- [ ] Write failing persistence and authorization tests.
- [ ] Run targeted tests and confirm missing models fail.
- [ ] Add models, migration `0004_performance_evidence` with `0003_destination_idle` as its parent, and fleet-scoped access helpers.
- [ ] Re-run tests and clean migration upgrade.
- [ ] Commit `feat: persist savings and intervention evidence`.

### Task 5: End-trip response integration

**Files:**
- Modify: `backend/app/routers/mobile.py`
- Modify: `backend/app/routers/experience.py`
- Modify: `backend/tests/test_route_performance.py`

**Interfaces:**
- Adds `performance` to successful end-trip response while preserving existing `calculation` and `prediction` fields.

- [ ] Write failing lifecycle tests proving performance appears after prediction, insufficient GPS remains honest, missing baseline yields availability reasons, and final calculation still occurs after uploaded points.
- [ ] Run targeted tests and confirm missing performance failure.
- [ ] Integrate `build_trip_performance` and configuration endpoints.
- [ ] Re-run targeted and existing GPS lifecycle tests.
- [ ] Commit `feat: return end-trip performance intelligence`.

### Task 6: Mobile route and performance UI

**Files:**
- Modify: `mobile/src/screens/detail/RouteIntelScreen.tsx`
- Modify: `mobile/src/components/CalculationOverlay.tsx`
- Modify: `mobile/src/types/index.ts`
- Create: `mobile/src/components/__tests__/CalculationOverlay.test.tsx`

**Interfaces:**
- Displays route distance/duration, energy, arrival SOC, confidence, and source.
- Displays moving/planned/unplanned time, baseline deltas, money/charge values or explicit unavailable reasons.

- [ ] Write failing component tests for value labels, negative deltas, unavailable reasons, no false "using Trickee" attribution, and insufficient GPS.
- [ ] Run targeted Jest and confirm failures.
- [ ] Implement cards and copy with accessible labels.
- [ ] Run Jest, TypeScript, and ESLint.
- [ ] Commit `feat: show route and trip performance results`.

### Task 7: Phase 3 verification

- [ ] Run all backend/mobile tests, TypeScript, ESLint, and Android debug build.
- [ ] Run an emulator trip and inspect route-provider unavailable and configured-provider paths.
- [ ] Verify savings never appear without five comparable trips and price evidence.
- [ ] Verify the Phase 3 acceptance criteria line by line.
