# Lossless Telemetry Delivery Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Android Room-committed telemetry sequence explicitly acknowledged or durably retained, report mathematically correct trip completeness, and safely close incomplete trips without admitting them to training.

**Architecture:** Keep the deployed HTTPS `/api/v2` batch contract and atomic backend persistence. Repair Android to consume exact accepted/duplicate outcomes, add non-destructive Room v2 diagnostics and legacy recovery, add backend reconciliation plus an idempotent 24-hour incomplete finalizer, and render the authoritative fields in the admin dashboard.

**Tech Stack:** Kotlin 2.1, Android Room 2.8.4, WorkManager 2.9.1, OkHttp 4.12, Gson 2.11, JUnit 4, MockWebServer, FastAPI, SQLAlchemy, PostgreSQL/SQLite tests, pytest, Next.js 14, React 18, TypeScript, Node test runner, Terraform, Cloud Run, Cloud Scheduler, Google Play Android App Bundle.

**Spec:** `docs/superpowers/specs/2026-09-01-lossless-telemetry-delivery-repair-design.md`

## Global Constraints

- Preserve package `com.trickee.gpsdriverapp`, target SDK 36, and deployed `/api/v2` telemetry endpoint.
- Release Android `1.0.5` with `versionCode 6`; never overwrite an existing Play artifact.
- Room migration is explicit from version 1 to 2; never use destructive migration fallback.
- Delivery is at least once with idempotent server writes; only ACKED rows may be purged.
- Preserve request payloads for pending, in-flight, and dead-letter rows.
- Never log or persist tokens, authorization headers, raw response bodies, email addresses, or precise coordinates as diagnostics.
- Incomplete telemetry never produces calculated energy targets or a training-eligible label.
- Backend response changes are additive for one compatible release.
- Implementation uses red-green-refactor: production code follows a failing test.
- Preserve unrelated dirty-worktree changes and stage only files belonging to the current task.
- Add only reviewer-helpful comments that explain compatibility, data-integrity, or safety constraints.

---

## File Structure

### Android

- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAck.kt`: typed ACK model, range validation, and exact outcome expansion.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/UploadFailurePolicy.kt`: pure request-level status classification and bounded retry decisions.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryUploader.kt`: HTTP orchestration only.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryEntities.kt`: Room v2 diagnostic fields and exact acknowledgement decision types.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDao.kt`: transactional exact ACK, retry, failure, dead-letter, and legacy recovery queries.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepository.kt`: uploader-facing durable queue operations.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDatabase.kt`: Room v1-to-v2 migration registration.
- `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/storage/OutboxAckPolicyTest.kt` and `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAckTest.kt`: pure ACK tests.
- `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/UploadPolicyTest.kt` and `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/TelemetryUploaderTest.kt`: pure failure and HTTP orchestration tests.
- `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/telemetry/storage/TelemetryMigrationTest.kt` and `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepositoryTest.kt`: migration and transactional repository tests.

### Backend

- `backend/app/services/pilot_monitoring.py`: authoritative reconciliation measures.
- `backend/app/services/incomplete_trip_reconciler.py`: idempotent timeout closure and late-recovery support helpers.
- `backend/app/config.py`: validated timeout setting.
- `backend/app/cli.py`: one-shot `finalization-reconciler` role.
- `backend/app/telemetry/persistence.py`: reopen incomplete trips when late telemetry completes the cursor.
- `backend/tests/test_pilot_monitoring.py`: exact stored/missing/GPS calculations.
- `backend/tests/test_incomplete_trip_reconciler.py`: timeout, label, idempotency, and late recovery.
- `backend/tests/test_telemetry_ingestion.py`: backwards-compatible ingestion and late completion event.
- `infra/gcp/main.tf`, `infra/gcp/variables.tf`, `infra/gcp/README.md`: Cloud Run Job and scheduler configuration without applying unrelated Terraform drift.

### Admin frontend

- `.deploy/trickee-evify-production/production/trickee-frontend/types/gps-pilot.ts`: additive typed reconciliation contract.
- `.deploy/trickee-evify-production/production/trickee-frontend/app/(dashboard)/gps-pilot/page.tsx`: precise labels and responsive details.
- `.deploy/trickee-evify-production/production/trickee-frontend/tests/gps-pilot-contract.test.mjs`: static contract and misleading-label regression tests.
- `.deploy/trickee-evify-production/production/trickee-frontend/tests/fixtures/gps-pilot-rhythm.json`: Rhythm reconciliation fixture.

### Release and closeout

- `scripts/test-lossless-telemetry-pipeline.ps1`: deterministic backend/mobile contract verification entrypoint.
- `backend/tests/test_lossless_pipeline.py`: deterministic 1-20 gap, recovery, duplicate replay, and finalization scenario.
- `analysis/built_implementation_and_remaining_work.md` and `analysis/daily_logger.md`: GPS Driver implementation and evidence closeout.
- `../trickee-evify-production-main-voice/Trickee/analysis/built_implementation_and_remaining_work.md` and `../trickee-evify-production-main-voice/Trickee/analysis/daily_logger.md`: shared Trickee frontend/backend closeout copy.

---

### Task 1: Exact Android Acknowledgement Contract

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAck.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryEntities.kt`
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/storage/OutboxAckPolicyTest.kt`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAckTest.kt`

**Interfaces:**
- Consumes: existing backend `TelemetryBatchAckV1` JSON fields.
- Produces: `TelemetryBatchAck.validateFor(batchId: String, tripId: String, leasedSequences: Set<Long>): ValidatedBatchAck` and `OutboxAckPolicy.classify(sequences, highestContiguousSequence, acceptedSequences, duplicateSequences, permanentRejections): AckDecision` for Tasks 2 and 3.

- [ ] **Step 1: Write the Rhythm-gap failing policy test**

```kotlin
@Test
fun acceptedRowsAreAcknowledgedWhenContiguousCursorIsBlocked() {
    val decision = OutboxAckPolicy.classify(
        sequences = (1L..20L).toList(),
        highestContiguousSequence = 0,
        acceptedSequences = setOf(7L, 8L, 9L, 20L),
        duplicateSequences = emptySet(),
        permanentRejections = emptySet(),
    )

    assertEquals(setOf(7L, 8L, 9L, 20L), decision.acknowledged)
    assertTrue((1L..6L).all { it in decision.pending })
}
```

- [ ] **Step 2: Run the test and verify RED**

Run from `mobile/android`:

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests "*OutboxAckPolicyTest.acceptedRowsAreAcknowledgedWhenContiguousCursorIsBlocked"
```

Expected: compilation failure because `acceptedSequences` and `duplicateSequences` do not exist.

- [ ] **Step 3: Extend the pure acknowledgement decision**

```kotlin
data class AckDecision(
    val acknowledged: Set<Long>,
    val permanentlyRejected: Set<Long>,
    val pending: Set<Long>,
)

fun classify(
    sequences: Collection<Long>,
    highestContiguousSequence: Long,
    acceptedSequences: Set<Long>,
    duplicateSequences: Set<Long>,
    permanentRejections: Set<Long>,
): AckDecision {
    val leased = sequences.toSet()
    val rejected = leased.intersect(permanentRejections)
    val acknowledged = leased.filterTo(mutableSetOf()) {
        it !in rejected && (
            it <= highestContiguousSequence ||
                it in acceptedSequences ||
                it in duplicateSequences
        )
    }
    return AckDecision(acknowledged, rejected, leased - acknowledged - rejected)
}
```

- [ ] **Step 4: Add duplicate, rejection-overlap, and pending-row tests**

Use explicit assertions that duplicates ACK despite cursor zero, explicit rejection wins over ACK, and unmentioned rows stay pending.

- [ ] **Step 5: Run policy tests and verify GREEN**

Run:

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests "*OutboxAckPolicyTest"
```

Expected: all acknowledgement policy tests pass.

- [ ] **Step 6: Write failing typed-ACK validation tests**

```kotlin
@Test
fun validatesAndExpandsAcceptedRanges() {
    val ack = TelemetryBatchAck(
        batchId = "batch-1",
        tripId = "trip-1",
        committed = true,
        highestContiguousSequence = 0,
        acceptedSequences = listOf(7L to 9L),
        duplicateSequences = listOf(10L),
        rejections = emptyList(),
        missingRanges = listOf(1L to 6L),
    )

    val result = ack.validateFor("batch-1", "trip-1", (7L..10L).toSet())
    assertEquals(setOf(7L, 8L, 9L), result.accepted)
    assertEquals(setOf(10L), result.duplicates)
}

@Test(expected = IllegalArgumentException::class)
fun rejectsOverlappingAckAndRejection() {
    ack(accepted = listOf(7L to 7L), rejected = setOf(7L))
        .validateFor("batch-1", "trip-1", setOf(7L))
}
```

- [ ] **Step 7: Run the ACK tests and verify RED**

Run:

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests "*TelemetryBatchAckTest"
```

Expected: compilation failure because the typed ACK file does not exist.

- [ ] **Step 8: Implement the typed ACK contract**

Define Gson-serializable fields using current server names, validate identity and `committed`, bound every expanded range to leased sequences, reject invalid ranges and overlaps, and return immutable accepted/duplicate/rejection sets.

- [ ] **Step 9: Run Task 1 tests and commit**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests "*OutboxAckPolicyTest" --tests "*TelemetryBatchAckTest"
git add -- mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAck.kt mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryEntities.kt mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/storage/OutboxAckPolicyTest.kt mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/TelemetryBatchAckTest.kt
git commit -m "fix(android): acknowledge exact telemetry outcomes"
```

Expected: tests pass and only Task 1 files are committed.

---

### Task 2: Room v2 Migration and Transactional Queue Outcomes

**Files:**
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryEntities.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDao.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepository.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDatabase.kt`
- Modify: `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepositoryTest.kt`
- Create: `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/telemetry/storage/TelemetryMigrationTest.kt`
- Create: `mobile/android/app/schemas/com.trickee.gpsdriver.telemetry.storage.TelemetryDatabase/2.json`

**Interfaces:**
- Consumes: `ValidatedBatchAck` and `AckDecision` from Task 1.
- Produces: `TelemetryRepository.applyAcknowledgement(tripId, leasedRows, ack, committedAt)` plus `recordRetry`, `recordDeadLetter`, and exact DAO state transitions for Task 3.

- [ ] **Step 1: Write the failing transactional acknowledgement test**

Seed sequences 1-10, lease them, apply an ACK with accepted 7-10 and cursor zero, then assert 7-10 are ACKED and 1-6 are PENDING in the same database transaction.

- [ ] **Step 2: Run the repository test and verify RED**

Run on an emulator or connected test device:

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.trickee.gpsdriver.telemetry.storage.TelemetryRepositoryTest
```

Expected: failure because repository acknowledgement cannot accept exact rows.

- [ ] **Step 3: Add exact DAO mutations**

Add bounded queries equivalent to:

```kotlin
@Query("UPDATE telemetry_outbox SET state = 'ACKED', lease_until_utc_ms = NULL, server_committed_at_utc_ms = :committedAt, last_error_code = NULL, last_error_detail = NULL WHERE trip_id = :tripId AND sequence_no IN (:sequences) AND state != 'PERMANENTLY_REJECTED'")
abstract suspend fun acknowledgeSequences(tripId: String, sequences: List<Long>, committedAt: Long): Int

@Query("UPDATE telemetry_outbox SET state = 'PENDING', lease_until_utc_ms = NULL, next_attempt_at_utc_ms = :nextAttemptAt, last_http_status = :httpStatus, last_error_code = :code, last_error_detail = :detail, last_failure_at_utc_ms = :failedAt WHERE sample_id IN (:sampleIds) AND state = 'IN_FLIGHT'")
abstract suspend fun releaseWithFailure(sampleIds: List<String>, nextAttemptAt: Long, httpStatus: Int?, code: String, detail: String?, failedAt: Long): Int
```

Keep the transaction method responsible for explicit rejections, exact ACK,
and release of all unmentioned leased rows.

- [ ] **Step 4: Implement repository transaction and verify GREEN**

Run the repository instrumentation test again and confirm exact state counts.

- [ ] **Step 5: Write the failing Room v1-to-v2 migration tests**

Create a v1 database with one normal pending row, one legacy
`PERMANENTLY_REJECTED/HTTP_403` row, and one explicit
`PERMANENTLY_REJECTED/PAYLOAD_CONFLICT` row. Migrate and assert:

```kotlin
assertEquals(OutboxState.PENDING, legacyHttp.state)
assertEquals("LEGACY_HTTP_403_REQUEUED", legacyHttp.lastErrorCode)
assertEquals(OutboxState.PERMANENTLY_REJECTED, explicitConflict.state)
assertEquals(payloadBefore, legacyHttp.payloadJson)
```

- [ ] **Step 6: Run migration test and verify RED**

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.trickee.gpsdriver.telemetry.storage.TelemetryMigrationTest
```

Expected: Room cannot find migration 1 to 2.

- [ ] **Step 7: Implement and register `MIGRATION_1_2`**

Use `ALTER TABLE` for the five nullable columns, then a single guarded update:

```sql
UPDATE telemetry_outbox
SET state = 'PENDING',
    next_attempt_at_utc_ms = 0,
    lease_until_utc_ms = NULL,
    last_http_status = CAST(SUBSTR(rejection_code, 6) AS INTEGER),
    last_error_code = 'LEGACY_' || rejection_code || '_REQUEUED',
    last_failure_at_utc_ms = 0,
    rejection_code = NULL
WHERE state = 'PERMANENTLY_REJECTED'
  AND rejection_code GLOB 'HTTP_[0-9]*';
```

Register the migration with `.addMigrations(MIGRATION_1_2)` and export schema 2.

- [ ] **Step 8: Verify migration, repository, and schema**

Run both instrumentation classes. Confirm no destructive fallback and inspect
schema 2 for all diagnostic columns.

- [ ] **Step 9: Commit Task 2**

Stage only Task 2 files and commit:

```powershell
git commit -m "fix(android): preserve and recover telemetry outbox rows"
```

---

### Task 3: Safe HTTP Retry, Isolation, and WorkManager Recovery

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/UploadFailurePolicy.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/UploadPolicy.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryUploader.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/BackfillWorker.kt`
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/UploadPolicyTest.kt`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/TelemetryUploaderTest.kt`
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/network/BackfillWorkerTest.kt`

**Interfaces:**
- Consumes: transactional repository methods from Task 2.
- Produces: `UploadFailurePolicy.decide(status, rowCount, retryAfter): UploadFailureDecision` and an uploader that never discards a request-level batch.

- [ ] **Step 1: Write failing status-classification tests**

```kotlin
@Test
fun authorizationAndDeploymentFailuresRemainRetryable() {
    listOf(401, 403, 404).forEach { status ->
        assertTrue(UploadFailurePolicy.decide(status, 10, null) is Retry)
    }
}

@Test
fun payloadTooLargeRequestsBatchReduction() {
    assertEquals(ReduceBatch, UploadFailurePolicy.decide(413, 20, null))
}

@Test
fun contractFailureBisectsBeforeDeadLetter() {
    assertEquals(BisectBatch, UploadFailurePolicy.decide(422, 4, null))
    assertEquals(DeadLetterSingle, UploadFailurePolicy.decide(422, 1, null))
}
```

- [ ] **Step 2: Run policy tests and verify RED**

Expected: `UploadFailurePolicy` is unresolved.

- [ ] **Step 3: Implement pure failure decisions**

Define sealed outcomes `Retry`, `RefreshThenRetry`, `ReduceBatch`,
`BisectBatch`, and `DeadLetterSingle`. Treat network exceptions separately as
retry. Cap parsed `Retry-After` at the existing five-minute maximum.

- [ ] **Step 4: Run policy tests and verify GREEN**

Run `*UploadPolicyTest` and require all status cases to pass.

- [ ] **Step 5: Write MockWebServer uploader tests**

Cover these real HTTP flows with a fake durable store:

- successful ACK accepts 7-10 with cursor zero;
- duplicate list ACKs rows;
- failed refresh after 401 retains all rows;
- 503 releases all rows with retry diagnostics;
- malformed 200 ACK releases all rows with `ACK_CONTRACT_INVALID`;
- 422 multi-row request splits work without dead-lettering the whole batch;
- 422 single-row request preserves that row as dead letter;
- response text is sanitized and bounded before persistence.

- [ ] **Step 6: Run uploader tests and verify RED**

Expected: current uploader permanently rejects request-level non-retryable batches
and ignores accepted/duplicate fields.

- [ ] **Step 7: Refactor uploader around typed decisions**

Read and close the response body once, validate the ACK before Room mutation,
refresh credentials once per run, and delegate every queue mutation to the
transactional repository. Do not swallow exceptions; map them to stable codes
such as `NETWORK_IO`, `AUTH_REFRESH_FAILED`, `HTTP_503_RETRY`, and
`ACK_CONTRACT_INVALID`.

For bisection, release rows with a reduced batch limit marker so subsequent
leases isolate the oldest half. A single contract-invalid row enters preserved
dead letter; its payload remains unchanged.

- [ ] **Step 8: Verify uploader tests and WorkManager behavior**

Require WorkManager to return retry while retry-eligible rows remain, success
when only ACKED/dead-letter rows remain, and connected-network constraints on
every request.

- [ ] **Step 9: Run all Android JVM tests and commit**

```powershell
.\gradlew.bat :app:testDebugUnitTest
git commit -m "fix(android): retry telemetry without batch loss"
```

---

### Task 4: Authoritative Backend Reconciliation

**Files:**
- Modify: `backend/app/services/pilot_monitoring.py`
- Modify: `backend/tests/test_pilot_monitoring.py`

**Interfaces:**
- Consumes: stored telemetry, upload cursors, trip final sequence, latest health payload, finalization and label rows.
- Produces: additive recent-trip fields consumed by Task 6 frontend.

- [ ] **Step 1: Add the failing Rhythm reconciliation test**

Seed a sealed trip with final sequence 1,098, distinct stored sequences matching
the audit's 675 received rows, cursor contiguous zero/highest received 894, and
last phone backlog 359. Assert:

```python
assert row["stored_windows"] == 675
assert row["actual_missing_sequences"] == 423
assert row["upload_completeness_pct"] == 61.48
assert row["highest_contiguous_sequence"] == 0
assert row["highest_received_sequence"] == 894
assert row["gps_availability_pct"] == 100.0
assert row["end_to_end_gps_pct"] == 61.48
assert row["phone_backlog"] == 359
```

- [ ] **Step 2: Run the targeted pytest and verify RED**

```powershell
python -m pytest tests/test_pilot_monitoring.py -q
```

Expected: additive reconciliation fields are missing and legacy missing is 1,098.

- [ ] **Step 3: Implement bounded aggregate queries**

Count stored sequences only within `1..final_sequence_no`, fetch both cursor
columns, derive actual missing and both percentages server-side, and obtain the
latest health backlog with its observation time. Return null final measures for
unsealed active trips.

Return exact missing ranges in bounded inclusive form. Keep deprecated
`uploaded_through`, `processed_through`, and `missing_sequences` for one release,
but define `missing_sequences` as actual missing rather than `final-contiguous`.

- [ ] **Step 4: Add beginning/interior/trailing gap and active-trip tests**

Assert ranges include `[1,6]`, interior holes, and `[895,1098]`; assert unsealed
trip completeness is null.

- [ ] **Step 5: Run monitoring and authorization tests and verify GREEN**

```powershell
python -m pytest tests/test_pilot_monitoring.py tests/test_pilot_monitoring_identity.py -q
```

- [ ] **Step 6: Commit Task 4**

```powershell
git commit -m "fix(backend): report actual telemetry completeness"
```

---

### Task 5: Controlled Incomplete Finalization and Late Recovery

**Files:**
- Create: `backend/app/services/incomplete_trip_reconciler.py`
- Create: `backend/tests/test_incomplete_trip_reconciler.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/cli.py`
- Modify: `backend/app/telemetry/persistence.py`
- Modify: `backend/tests/test_telemetry_ingestion.py`
- Modify: `backend/tests/test_trip_finalizer.py`
- Modify: `backend/.env.example`
- Modify: `infra/gcp/main.tf`
- Modify: `infra/gcp/variables.tf`
- Modify: `infra/gcp/README.md`

**Interfaces:**
- Consumes: `MobileTripSession`, `TripFinalization`, `TelemetryWindow`, `TripEnergyLabel`, upload cursor, configured 24-hour threshold.
- Produces: `reconcile_incomplete_trips(db, now, timeout_hours): ReconciliationResult` and CLI role `finalization-reconciler`.

- [ ] **Step 1: Write failing timeout tests with an injected clock**

Create one 25-hour waiting trip and one 23-hour waiting trip. Assert only the
expired trip becomes incomplete, its summary contains exact counts/ranges, and
its label has null calculated targets and `is_training_eligible is False`.

- [ ] **Step 2: Run the reconciler tests and verify RED**

```powershell
python -m pytest tests/test_incomplete_trip_reconciler.py -q
```

Expected: module is missing.

- [ ] **Step 3: Implement the idempotent reconciler**

Define:

```python
@dataclass(frozen=True)
class ReconciliationResult:
    examined: int
    marked_incomplete: int

def reconcile_incomplete_trips(
    db: Session,
    *,
    now: datetime,
    timeout_hours: int,
) -> ReconciliationResult:
    cutoff = now - timedelta(hours=timeout_hours)
    candidates = _lock_waiting_candidates(db, cutoff=cutoff, limit=100)
    marked = 0
    for trip, finalization in candidates:
        summary = _build_incomplete_summary(db, trip, finalization)
        _mark_incomplete(db, trip, finalization, summary, now)
        marked += 1
    db.commit()
    return ReconciliationResult(examined=len(candidates), marked_incomplete=marked)
```

Lock candidate rows, recheck state/deadline, calculate stored/missing/GPS
measures, write the incomplete summary and zero-confidence non-training label,
and commit once after all bounded candidates.

- [ ] **Step 4: Add idempotency and non-expired tests and verify GREEN**

Run the reconciler twice and assert one label, unchanged counts, and no duplicate
server-outbox events.

- [ ] **Step 5: Write the failing late-recovery ingestion test**

Seed an incomplete trip missing sequence 2, ingest sequence 2, then assert the
transaction sets trip/finalization state to eligible and creates exactly one
`trip.finalization_eligible` event.

- [ ] **Step 6: Run the late-recovery test and verify RED**

Expected: current persistence only promotes `waiting_for_telemetry`.

- [ ] **Step 7: Permit idempotent incomplete-to-eligible promotion**

Extend the guarded persistence condition to `waiting_for_telemetry` or
`incomplete` only when contiguous reaches final. Keep completed trips terminal.
The normal finalizer updates the one incomplete label in place.

- [ ] **Step 8: Add validated configuration and CLI role**

Add `trip_incomplete_finalize_after_hours: int = 24` with Pydantic bounds, and
CLI role `finalization-reconciler` that opens one session, calls the service,
prints low-cardinality JSON counts, and exits non-zero on failure.

- [ ] **Step 9: Add Terraform job and scheduler without applying**

Model the reconciler beside existing one-shot jobs, invoke every 15 minutes, use
the existing least-privilege backend identity and database/secret configuration,
and document a targeted plan/apply procedure. Run `terraform fmt -check` and
`terraform validate`; do not execute a full production apply while unrelated
destroy actions remain possible.

- [ ] **Step 10: Run backend lifecycle suite and commit**

```powershell
python -m pytest tests/test_incomplete_trip_reconciler.py tests/test_telemetry_ingestion.py tests/test_trip_finalizer.py tests/test_telemetry_trip_lifecycle.py -q
git commit -m "feat(backend): close and recover incomplete trips safely"
```

---

### Task 6: Correct GPS Pilot Dashboard Semantics

**Files:**
- Modify: `.deploy/trickee-evify-production/production/trickee-frontend/types/gps-pilot.ts`
- Modify: `.deploy/trickee-evify-production/production/trickee-frontend/app/(dashboard)/gps-pilot/page.tsx`
- Modify: `.deploy/trickee-evify-production/production/trickee-frontend/tests/gps-pilot-contract.test.mjs`
- Create: `.deploy/trickee-evify-production/production/trickee-frontend/tests/fixtures/gps-pilot-rhythm.json`

**Interfaces:**
- Consumes: additive monitoring response from Task 4.
- Produces: admin-only UI with no client-side missing arithmetic.

- [ ] **Step 1: Add failing contract and misleading-copy tests**

Extend the Node test to assert the type/page contain
`actual_missing_sequences`, `upload_completeness_pct`,
`highest_contiguous_sequence`, `highest_received_sequence`,
`end_to_end_gps_pct`, and `phone_backlog_observed_at`. Assert the trip table does
not match `/Uploaded \{|Processed \{/`.

- [ ] **Step 2: Run the Node test and verify RED**

```powershell
node --test tests/gps-pilot-contract.test.mjs
```

Expected: new contract fields and precise labels are absent.

- [ ] **Step 3: Extend TypeScript contract and Rhythm fixture**

Use nullable final-trip measures and include the exact Rhythm values 675, 423,
61.48, 0, 894, 100, 61.48, and 359.

- [ ] **Step 4: Replace table presentation**

Render `Stored`, `Upload completeness`, `Actual missing`, `Contiguous through`,
`Highest received`, `Final sequence`, `Phone backlog`, `Stored GPS`,
`End-to-end GPS`, `Finalizer`, and training-label reason. Keep desktop density
and add labelled stacked content at narrow widths. Show stale backlog age and
bounded missing-range detail.

- [ ] **Step 5: Verify contract, types, lint, and production build**

```powershell
node --test tests/gps-pilot-contract.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands pass without misleading trip labels.

- [ ] **Step 6: Commit the frontend repository**

From `.deploy/trickee-evify-production`, stage only the GPS Pilot type, page,
test, and fixture. Commit:

```powershell
git commit -m "fix(admin): show actual GPS trip completeness"
```

---

### Task 7: Cross-Layer Verification, Versioning, Build, and Closeout

**Files:**
- Create: `scripts/test-lossless-telemetry-pipeline.ps1`
- Create: `backend/tests/test_lossless_pipeline.py`
- Modify: `mobile/android/app/build.gradle`
- Modify: `analysis/built_implementation_and_remaining_work.md`
- Modify: `analysis/daily_logger.md`
- Modify: `../trickee-evify-production-main-voice/Trickee/analysis/built_implementation_and_remaining_work.md`
- Modify: `../trickee-evify-production-main-voice/Trickee/analysis/daily_logger.md`
- Update: `docs/superpowers/plans/2026-09-01-lossless-telemetry-delivery-repair.md` checkboxes as evidence completes.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: repeatable verification evidence, versioned signed AAB, deployment-ready artifacts, and honest remaining-work status.

- [ ] **Step 1: Write the failing cross-layer verification script contract**

The PowerShell script must stop on first failure and run:

```powershell
python -m pytest backend/tests -q
Push-Location mobile/android
.\gradlew.bat :app:testDebugUnitTest :app:lintRelease
Pop-Location
Push-Location mobile
npm test -- --runInBand
npm run lint
Pop-Location
```

It then runs the frontend Node contract, TypeScript, lint, and build checks from
the clean deployment clone. It prints one JSON-like summary with pass/fail per
layer and no secrets.

- [ ] **Step 2: Run the script and verify RED or expose remaining failures**

Expected: any unimplemented integration or existing conflicting failure is
reported with its exact command; the script never masks a failure.

- [ ] **Step 3: Add deterministic synthetic reconciliation coverage**

Create `backend/tests/test_lossless_pipeline.py` with the 1-20
gap/recovery/replay/finalization scenario from the spec. The test must prove 20
distinct server rows, zero actual missing, contiguous 20, one finalization, and
idempotent duplicate replay.

- [ ] **Step 4: Bump Android release identity**

Change only:

```gradle
versionCode 6
versionName "1.0.5"
```

Run `scripts/verify-android-identity.ps1` and confirm package, SDK, OAuth/API
configuration, and prohibited permissions.

- [ ] **Step 5: Run complete automated gates**

Run the cross-layer script, backend Alembic upgrade/downgrade test in an isolated
database, Room migration instrumentation test when a device/emulator is
available, Terraform fmt/validate, and public endpoint configuration checks.

- [ ] **Step 6: Build and verify the signed AAB**

Use the external signing properties already authorized for the Play upload key:

```powershell
.\gradlew.bat clean :app:bundleRelease -PTRICKEE_RELEASE_PROPERTIES_FILE=$env:TRICKEE_RELEASE_PROPERTIES_FILE
```

Do not copy signing material into the repository. Record artifact absolute path,
SHA-256, package, version, target SDK, signer fingerprint, and manifest
permissions. If signing inputs are unavailable, report the build as blocked
rather than producing an unsigned or differently signed artifact.

- [ ] **Step 7: Deploy in compatibility order**

Deploy backend first and verify health plus old-client ingestion. Apply only a
reviewed zero-destroy targeted Terraform plan for the reconciler job. Deploy the
frontend from its clean repository and verify the authenticated `/gps-pilot`
page. Upload AAB only to Play internal testing after all artifact checks pass.

- [ ] **Step 8: Record physical-device acceptance as pending or verified**

The tester must install from Play and execute screen-off capture, network loss,
reconnect, process restart, token refresh, stop, and backlog drain. Record phone
model, Android version, final sequence, stored count, actual missing, duplicate
count, finalizer result, battery impact, and GPS quality separately.

- [ ] **Step 9: Update all four Trickee closeout files**

Separate verified automated work, live deployment evidence, and physical-device
pending work. State explicitly that software cannot guarantee a satellite fix
every second or recover cleared/uninstalled Room data.

- [ ] **Step 10: Final review and commit**

Run `git diff --check`, inspect staged file lists in both repositories, rerun
the complete verification script, and commit only release/closeout files:

```powershell
git commit -m "release: prepare GPS Driver 1.0.5 lossless pilot"
```

Do not claim completion until the latest command outputs and artifact hashes are
captured. Mark physical-device proof separately if it remains outstanding.
