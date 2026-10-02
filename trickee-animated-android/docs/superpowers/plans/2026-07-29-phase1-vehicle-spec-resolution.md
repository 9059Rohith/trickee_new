# Phase 1 Vehicle Specification Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an assigned driver search sourced vehicle specifications, review/edit them, and explicitly confirm them while enforcing fleet authorization and preserving evidence.

**Architecture:** Add an append-only evidence model and a provider-independent catalog service behind fleet-scoped FastAPI endpoints. Extend the existing React Native vehicle form with search, candidate review, confirmation, and permanent manual editing.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest, React Native 0.73, TypeScript, Jest.

## Global Constraints

- Never fabricate BMS or vehicle specifications.
- Official manufacturer sources are preferred and every sourced field retains provenance.
- A candidate cannot update a vehicle until the driver explicitly confirms it.
- Drivers can update only their assigned active vehicle; cross-fleet identifiers return 404.
- Manual edits remain available and are labelled `driver_edited`.

---

### Task 1: Fleet-scoped vehicle authorization

**Files:**
- Modify: `backend/app/routers/vehicles.py`
- Modify: `backend/tests/test_gps_prediction.py`

**Interfaces:**
- Produces: `_authorized_vehicle(db, user, vehicle_id, write=False) -> Vehicle`.
- Consumes: `User.fleet_id`, `User.driver_id`, `MobileTripSession.vehicle_id` for current assignment compatibility.

- [ ] **Step 1: Write failing API tests** proving a fleet admin sees only their fleet, a driver can patch the vehicle returned by `/mobile/me`, and cross-fleet reads/patches return 404.
- [ ] **Step 2: Run** `backend/venv/Scripts/python.exe -m pytest backend/tests/test_gps_prediction.py -q` and confirm the cross-fleet assertions fail.
- [ ] **Step 3: Implement `_authorized_vehicle`** and apply fleet filters to list/get/create/update; driver writes require the vehicle selected by the existing active-vehicle assignment logic.
- [ ] **Step 4: Re-run the targeted test** and confirm it passes.
- [ ] **Step 5: Commit** `fix: scope vehicle access to fleet assignments`.

### Task 2: Evidence model and migration

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/alembic/versions/0002_vehicle_spec_evidence.py`
- Create: `backend/tests/test_vehicle_specs.py`

**Interfaces:**
- Produces: `VehicleSpecEvidence` with provider, query, normalized candidate payload, source URLs, retrieval/confidence, confirmation user/time, and driver edits.

- [ ] **Step 1: Write a failing model test** that persists evidence and reloads its JSON payload, URLs, confirmer, and edits.
- [ ] **Step 2: Run** `backend/venv/Scripts/python.exe -m pytest backend/tests/test_vehicle_specs.py -q` and confirm import/table failure.
- [ ] **Step 3: Add the SQLAlchemy model and Alembic upgrade/downgrade** in revision `0002_vehicle_spec_evidence` with indexed `vehicle_id` and `confirmed_at` fields.
- [ ] **Step 4: Run the targeted test and** `backend/venv/Scripts/alembic.exe upgrade head` against a temporary SQLite database.
- [ ] **Step 5: Commit** `feat: persist vehicle specification evidence`.

### Task 3: Curated specification provider

**Files:**
- Create: `backend/app/services/vehicle_spec_provider.py`
- Create: `backend/app/data/vehicle_specs.json`
- Create: `backend/tests/test_vehicle_specs.py`

**Interfaces:**
- Produces: `VehicleSpecCandidate` Pydantic model and `search_vehicle_specs(query: str) -> list[VehicleSpecCandidate]`.
- Candidate fields: `candidate_id`, make/model/variant/category, normalized physics specs, `source_urls`, `retrieved_at`, `confidence`, and field notes.

- [ ] **Step 1: Write failing tests** for exact normalized search, ambiguous search, three-character minimum, and preservation of source URLs/units.
- [ ] **Step 2: Run the targeted tests** and confirm the provider import fails.
- [ ] **Step 3: Implement deterministic normalized matching** over a small official-source catalog containing only entries backed by source URLs; return no candidate for unsupported text.
- [ ] **Step 4: Re-run tests** and confirm all provider cases pass.
- [ ] **Step 5: Commit** `feat: add sourced vehicle specification catalog`.

### Task 4: Suggestion and confirmation APIs

**Files:**
- Modify: `backend/app/routers/vehicles.py`
- Modify: `backend/app/schemas/api.py`
- Modify: `backend/tests/test_vehicle_specs.py`

**Interfaces:**
- Produces: `GET /api/v1/vehicles/spec-suggestions?q=` and `POST /api/v1/vehicles/{id}/spec-confirmations`.
- Confirmation request: `candidate_id`, `confirmed: true`, and `edits: dict[str, scalar]` restricted to vehicle spec fields.

- [ ] **Step 1: Write failing endpoint tests** for candidate retrieval, required confirmation, rejected unknown candidate/field, evidence creation, driver edits, and authorization.
- [ ] **Step 2: Run the targeted tests** and confirm 404/405 failures for missing routes.
- [ ] **Step 3: Implement the endpoints** using the provider and `_authorized_vehicle`; update the vehicle and append evidence in one transaction.
- [ ] **Step 4: Re-run tests** and confirm all API cases pass.
- [ ] **Step 5: Commit** `feat: confirm sourced vehicle specifications`.

### Task 5: Mobile candidate confirmation and editing

**Files:**
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/types/index.ts`
- Modify: `mobile/src/screens/VehicleOnboardingScreen.tsx`
- Create: `mobile/src/screens/__tests__/VehicleOnboardingScreen.test.tsx`

**Interfaces:**
- Consumes: suggestion and confirmation API contracts from Task 4.
- Produces: debounced search, candidate cards with source URLs/confidence, review/edit form, and explicit `Confirm and save` action.

- [ ] **Step 1: Write failing Jest tests** for 400 ms debounce, candidate selection, edited-field submission, explicit confirmation, empty results, and manual-save fallback.
- [ ] **Step 2: Run** `npm test -- --runInBand VehicleOnboardingScreen` in `mobile` and confirm missing behavior failures.
- [ ] **Step 3: Add API/types and implement the UI** while preserving the existing edit screen and Back navigation.
- [ ] **Step 4: Run Jest,** `npx tsc --noEmit`, and `npx eslint . --quiet`.
- [ ] **Step 5: Commit** `feat: add driver-confirmed vehicle spec lookup`.

### Task 6: Phase 1 verification

- [ ] Run `backend/venv/Scripts/python.exe -m pytest backend/tests -q`.
- [ ] Run `npx tsc --noEmit`, `npx eslint . --quiet`, and mobile Jest tests.
- [ ] Run `mobile/android/gradlew.bat assembleDebug` from `mobile/android`.
- [ ] Verify the exact Phase 1 acceptance criteria against the design specification.
