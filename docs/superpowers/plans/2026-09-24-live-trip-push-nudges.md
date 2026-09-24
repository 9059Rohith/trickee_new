# Live Trip Push Nudges Implementation Plan

> **For agentic workers:** Execute inline in the isolated `feature/live-route-charger-soc-nudges` worktree. Follow test-driven development and verify each task before continuing.

**Goal:** Deliver evidence-backed live route, charger and SOC push nudges during active trips.

**Architecture:** The always-on notification worker scans recent active-trip projections, records a five-minute durable evaluation checkpoint, enqueues bounded nudges in the existing outbox, then uses FCM delivery. External mobility providers never run in the telemetry ingestion transaction.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest, Cloud Run, Google Routes/Places, FCM, Android existing receiver and React Native inbox.

**Spec:** `docs/superpowers/specs/2026-09-24-live-trip-push-nudges-design.md`

## Global constraints

- Use only an assigned active driver, active trip and GPS snapshot newer than 90 seconds.
- Do not claim measured SOC, live charger availability or alternative routes without evidence.
- Do not log FCM tokens, exact GPS coordinates or private user details.
- Keep provider calls outside the telemetry processor and bound them by five-minute checkpoints.
- Preserve the existing outbox, inbox and FCM message contract.

## Review focus

- A just-finished trip must not receive a late alert.
- A new SOC after charging must reset the estimate and threshold deduplication.
- A provider timeout must not stop SOC alerts or the worker loop.
- Two worker instances must not create duplicate rows or duplicate sends.
- An installed build without Firebase configuration must not be called push-ready.

### Task 1: Durable evaluation state and migration

**Files:** Create `backend/alembic/versions/0008_live_nudge_evaluations.py`; modify `backend/app/models/entities.py`; test `backend/tests/test_alembic_roundtrip.py`.

**Interface:** `LiveNudgeEvaluation(trip_id, last_evaluated_at, soc_anchor_at, soc_anchor_distance_km, soc_anchor_pct, updated_at)`.

- [ ] Add a failing migration roundtrip test asserting table and indexes appear after upgrade and disappear after downgrade.
- [ ] Run the targeted test and confirm the missing-table failure.
- [ ] Add the SQLAlchemy entity and Alembic migration, with trip ID primary key and indexed evaluation time.
- [ ] Run targeted and migration tests; inspect actual exit codes.

### Task 2: Deterministic evaluator

**Files:** Create `backend/app/services/live_trip_nudges.py`; test `backend/tests/test_live_trip_nudges.py`.

**Interface:** `evaluate_active_trip_nudges(db, *, tools, now, limit=100) -> dict[str, int]`. It enqueues `NotificationOutbox` rows and commits bounded checkpoints.

- [ ] Write failing tests for fresh/stale GPS, assigned user, explicit/planned destination, model/spec rate, charging reset, route/charger/SOC thresholds, missing evidence, reachability, cooldown and rerun idempotency.
- [ ] Run the targeted tests and verify failures are from the absent evaluator.
- [ ] Implement bounded active-trip selection, SOC anchor update, Google evidence calls, deterministic rules and unique outbox keys.
- [ ] Run targeted tests and the full backend suite; inspect actual exit codes.

### Task 3: Worker delivery and configuration

**Files:** Modify `backend/app/worker.py`, `backend/app/services/fcm_notifications.py`, `infra/gcp/main.tf`, `infra/gcp/iam.tf`; test `backend/tests/test_fcm_notifications.py`, `backend/tests/test_live_trip_nudges.py`.

**Interface:** The `notification-fcm` worker evaluates every minute and dispatches due rows continuously. `GoogleFcmSender` rejects malformed project IDs before serving traffic.

- [ ] Add failing tests for project-ID validation, retryable FCM transport failure and worker-safe evaluator failures.
- [ ] Run tests and confirm the intended failures.
- [ ] Wire the evaluator with bounded logging, retry handling and the Google Maps secret reference/least-privilege IAM.
- [ ] Run targeted/full backend tests plus Terraform validation; inspect exit codes.

### Task 4: Android presentation and release candidate

**Files:** Modify RouteNudgeCard, presentation helpers and inbox parser; bump public version to `1.0.20 (22)`.

- [ ] Distinguish route, charger and SOC evidence/actions without implying live charger availability or real-time SOC measurement.
- [ ] Parse title/body from data-only FCM, not only notification payloads.
- [ ] Run Jest, TypeScript, ESLint and signed release verification. Check Play version code before any upload.

### Task 5: Production proof and handoff

**Files:** Update `PROJECT_MEMORY.md` and `analysis/daily_logger.md` with exact deployment and canary state.

- [ ] Review the migration and Terraform plan for unrelated resource changes; confirm a recent successful production backup before migration.
- [ ] Build an immutable backend image, run migration, configure the worker's project ID and Maps secret, deploy the new worker revision, and confirm readiness and logs.
- [ ] Perform a bounded test trip with a future destination/SOC, inspect queued and sent outbox evidence, then confirm handset notification and deep link with the tester.
- [ ] Report any physical proof still outstanding separately from cloud success.
