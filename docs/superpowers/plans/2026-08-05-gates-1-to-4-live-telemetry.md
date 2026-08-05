# Gates 1-4 Live Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every repository-owned component and executable certification harness for the approved Android live GPS/IMU architecture, while recording physical-trip, company-GCP, disaster-recovery, and multi-day rollout evidence only when those runs actually occur.

**Architecture:** A native Kotlin foreground service owns GPS/IMU collection and commits one-second windows into a Room WAL outbox before one serialized HTTPS uploader runs. FastAPI commits canonical PostgreSQL state and a server outbox; separate Redis-backed roles relay, project, finalize, archive, and publish recoverable versioned live state. Terraform and deterministic load/rollout tools make the external gates executable without embedding company credentials.

**Tech Stack:** Kotlin 1.9, Android foreground services, Fused Location Provider, SensorManager, Room, WorkManager, Android Keystore, React Native bridge, FastAPI, SQLAlchemy/Alembic, PostgreSQL, Redis Streams, WebSockets, Prometheus, Terraform, pytest, JUnit.

## Global Constraints

- Work only in `gpsdriver` on `feature/gpsdriver-gate0`; never edit `trickee_new`.
- Request GPS at approximately 1 Hz and accelerometer/gyroscope at 50 Hz; report actual cadence and completeness.
- Persist each elapsed-second window before upload and never synthesize missing GPS.
- Use separate revocable device credentials stored behind Android Keystore; Google tokens authenticate humans only.
- Physical delivery is at least once and logical persistence is exactly once through immutable identifiers and ACK cursors.
- PostgreSQL is canonical; Redis is recoverable processing/cache infrastructure and may fail without blocking ingestion.
- Manual dashboard SOC is not BMS telemetry; all derived values preserve source, confidence, estimated status, uncertainty, and provenance.
- Never commit secrets, `.env`, databases, logs, generated APKs, Terraform state, or service-account keys.

---

### Task 1: Native one-second telemetry domain

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/model/TelemetryModels.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/collector/ImuWindowAccumulator.kt`
- Create: `mobile/android/app/src/test/java/com/trickeeandroid/telemetry/collector/ImuWindowAccumulatorTest.kt`
- Modify: `mobile/android/app/build.gradle`

**Interfaces:**
- Produces: `ImuWindowAccumulator.addAccelerometer`, `addGyroscope`, and `closeWindow(expectedSamples)` returning immutable, schema-v1 unit-labelled summaries.
- Produces: `TelemetryWindowPayload` with explicit nullable GPS and health state.

- [ ] Write deterministic JUnit tests whose literal expectations prove mean/min/max/stddev/RMS, jerk, sample completeness, reset behavior, and missing-GPS serialization.
- [ ] Run `mobile/android/gradlew.bat app:testDebugUnitTest --tests *ImuWindowAccumulatorTest` and verify failures because the production types do not exist.
- [ ] Implement numerically stable accumulation and schema-v1 models without Android framework dependencies.
- [ ] Re-run the focused test and commit `feat(android): add one-second telemetry window builder`.

### Task 2: Room WAL outbox and acknowledgement state machine

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/storage/TelemetryEntities.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/storage/TelemetryDao.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/storage/TelemetryDatabase.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/storage/TelemetryRepository.kt`
- Create: `mobile/android/app/src/androidTest/java/com/trickeeandroid/telemetry/storage/TelemetryRepositoryTest.kt`
- Modify: `mobile/android/app/build.gradle`

**Interfaces:**
- Produces: atomic `createTrip`, `commitWindowAndAdvanceCursor`, `leasePending`, `applyAcknowledgement`, `recordEnd`, `recoverExpiredLeases`, and `purgeAckedBefore` operations.
- States: `PENDING`, `IN_FLIGHT`, `ACKED`, `PERMANENTLY_REJECTED`; no operation deletes pending data to enforce a size cap.

- [ ] Write in-memory Room instrumentation tests proving payload/cursor atomicity, ordered sequence assignment, lease recovery, gap-safe ACK, permanent rejection, and 24-hour ACK cleanup.
- [ ] Compile the Android tests and verify production symbols are missing.
- [ ] Implement entities, unique constraints, DAO transactions, WAL configuration, repository invariants, and storage-pressure status.
- [ ] Compile focused unit/instrumentation suites and commit `feat(android): add durable telemetry room outbox`.

### Task 3: Foreground collector, uploader, recovery, and React Native bridge

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/collector/TripCollectorService.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/network/TelemetryUploader.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/network/BackfillWorker.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/security/DeviceCredentialStore.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/bridge/TelemetryModule.kt`
- Create: `mobile/android/app/src/main/java/com/trickeeandroid/telemetry/bridge/TelemetryPackage.kt`
- Create: `mobile/android/app/src/test/java/com/trickeeandroid/telemetry/network/UploadPolicyTest.kt`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `mobile/android/app/src/main/java/com/trickeeandroid/MainApplication.kt`
- Modify: `mobile/src/services/telemetryNative.ts`
- Modify: `mobile/src/context/LiveDataContext.tsx`

**Interfaces:**
- Native bridge: `startTrip(config)`, `stopTrip(ending)`, `status()`, `registerDevice(session)`, and status events.
- Uploader: two-second/20-window online flush, 100-window backfill, 15-second timeout, full-jitter retry for 408/425/429/5xx, and contiguous ACK application.

- [ ] Write policy tests proving retry classification, bounded exponential jitter, ACK deletion boundary, and a single active uploader lease.
- [ ] Verify focused tests fail before production implementation.
- [ ] Implement the location foreground service, 50 Hz sensor listeners, monotonic one-second boundaries, ongoing notification, START_STICKY recovery, Keystore AES-GCM credential storage, gzip uploader, and unique WorkManager backfill.
- [ ] Register the service/permissions/package and replace JavaScript `gpsTracking` ownership with the narrow native bridge.
- [ ] Run Kotlin unit tests, TypeScript, ESLint, and `assembleDebug`; commit `feat(android): ship durable foreground telemetry collector`.

### Task 4: Idempotent trip lifecycle and projection schema

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/app/telemetry/trip_routes.py`
- Create: `backend/app/processors/models.py`
- Create: `backend/alembic/versions/0003_realtime_processing.py`
- Create: `backend/tests/test_telemetry_trip_lifecycle.py`

**Interfaces:**
- Produces client-ID idempotent trip start and final-sequence completion commands.
- Produces `ProcessorIdempotency`, `VehicleLiveStateSnapshot`, `TelemetryEvent`, `TripFinalization`, and archive-manifest tables.

- [ ] Write route tests proving offline-first start replay, end replay, finalization waiting on gaps, and device/vehicle isolation.
- [ ] Run focused tests and observe missing-route failures.
- [ ] Implement forward-only migration, models, and v2 lifecycle routes; finalization becomes eligible only at the declared contiguous cursor.
- [ ] Run focused/full backend suites and commit `feat: add durable telemetry trip lifecycle`.

### Task 5: PostgreSQL outbox relay and Redis recovery backbone

**Files:**
- Create: `backend/app/streams/redis_client.py`
- Create: `backend/app/streams/outbox_relay.py`
- Create: `backend/app/streams/consumer.py`
- Create: `backend/app/processors/live_state.py`
- Create: `backend/app/processors/imu_rules.py`
- Create: `backend/app/processors/trip_finalizer.py`
- Create: `backend/app/worker.py`
- Create: `backend/tests/test_stream_processing.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Relay uses `FOR UPDATE SKIP LOCKED`, stable outbox IDs, Redis `XADD`, and marks rows dispatched only after successful append.
- Consumers claim PostgreSQL idempotency keys, reclaim stale pending entries, retry up to five times, and copy poison events to `telemetry:dead-letter`.

- [ ] Write fake-adapter integration tests for relay crash boundaries, repeated delivery, independent processor idempotency, pending reclaim, poison dead-lettering, and Redis outage backlog preservation.
- [ ] Verify tests fail because stream/processors do not exist.
- [ ] Implement protocol-based Redis adapters, relay/consumer loops, live-state freshness, IMU quality/event rules, and deterministic finalization from committed windows.
- [ ] Run focused/full tests and commit `feat: add recoverable telemetry processors`.

### Task 6: Reconnect-safe live API, metrics, and archive manifests

**Files:**
- Create: `backend/app/realtime/websocket_gateway.py`
- Create: `backend/app/observability/metrics.py`
- Create: `backend/app/archive/manifest.py`
- Create: `backend/tests/test_realtime_and_archive.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces `GET /api/v2/vehicles/{vehicle_id}/live-state`, `WS /ws/v2/vehicles/{vehicle_id}`, and `GET /metrics`.
- Archive manifest verifies row count, sequence bounds, SHA-256, object generation, and restore status before hot-data retirement can be authorized.

- [ ] Write tests for fleet isolation, LIVE/DELAYED/OFFLINE/GPS_LOST/SYNCING/DEGRADED labels, WebSocket snapshot/version-gap recovery, coordinate-safe metrics, and manifest mismatch refusal.
- [ ] Verify focused failures, implement the routes/services, then run focused/full tests.
- [ ] Commit `feat: add realtime recovery and archive verification`.

### Task 7: Google Cloud infrastructure and process-role packaging

**Files:**
- Create: `infra/gcp/versions.tf`, `variables.tf`, `main.tf`, `iam.tf`, `outputs.tf`, `README.md`
- Create: `backend/app/cli.py`
- Modify: `backend/Dockerfile`, `docker-compose.yml`, `backend/.env.example`

**Interfaces:**
- Terraform provisions APIs, VPC connector/networking, Cloud SQL HA configuration, Memorystore HA, private archive bucket, Secret Manager secrets, Artifact Registry, dedicated least-privilege service accounts, Cloud Run API/WebSocket/worker/jobs, monitoring alerts, and lifecycle rules.
- One immutable image selects `api`, `websocket`, `worker`, `migrate`, `archive`, or `retention` role by command.

- [ ] Add executable configuration checks that reject public buckets, shared service accounts, unbounded Cloud Run database connections, missing backup/PITR, and API-replica migrations.
- [ ] Run checks against absent infrastructure and observe failure.
- [ ] Implement parameterized Terraform without credentials/state and process-role CLI commands.
- [ ] Run `terraform fmt -check`, `terraform validate` when Terraform is installed, Compose validation, and commit `infra: add gcloud live telemetry topology`.

### Task 8: Capacity, recovery, and controlled-rollout certification tools

**Files:**
- Create: `backend/scripts/telemetry_load.py`
- Create: `backend/scripts/rollout_gate.py`
- Create: `backend/tests/test_capacity_tools.py`
- Create: `docs/runbooks/telemetry-operations.md`
- Create: `docs/evidence/gates-1-to-4-status.md`

**Interfaces:**
- Load tool supports 2/150 live identities, 300-window/s bursts, 30-device 60-minute backfill, live-priority scheduling, deterministic payloads, and JSON latency/loss/duplication evidence.
- Rollout evaluator requires three consecutive operating days within configured completeness, backlog, battery, rejection, latency, and incident thresholds for cohorts 10/25/50/100/150.

- [ ] Write deterministic tests for rate schedules, unique sequences, live-priority fairness, SLO percentile evaluation, 50% headroom rule, and three-day cohort holds.
- [ ] Verify focused failures, implement both tools and operator recovery/dead-letter/archive/rollback procedures, then run focused/full tests.
- [ ] Run a short local two-identity smoke load without claiming physical or Cloud SQL certification.
- [ ] Record verified repository evidence and explicitly mark company-GCP, two-real-device, 60-minute capacity, restore-drill, and three-day cohort evidence as pending until executed.
- [ ] Commit `test: add telemetry certification and rollout gates`.

### Task 9: Complete verification and handoff

**Files:**
- Modify: `README.md`
- Modify: `DEVELOPER_HANDOFF.md`
- Modify: this plan

**Interfaces:**
- Produces a clean branch, exact commands, evidence locations, and no unsupported production-readiness claims.

- [ ] Run backend full tests, Alembic clean upgrade/current, Android unit tests, TypeScript, ESLint, debug build, Compose validation, Terraform checks when installed, and repository hygiene checks.
- [ ] Audit all 18 master acceptance criteria against evidence; distinguish implemented, locally verified, and externally pending.
- [ ] Update documentation and checklist states from actual output only.
- [ ] Commit `docs: complete live telemetry implementation gates` and preserve the branch for user-directed integration.
