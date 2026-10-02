# GPS Driver Live Pilot Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify GPS Driver Android `1.0.3 (4)` as a company-signed AAB for Play internal testing, with event-time one-second telemetry, atomic trip sealing, durable offline recovery, provenance-safe trip energy labels, and the provisioned OLA S1 pilot identity.

**Architecture:** A native Kotlin foreground service converts all Android GPS and IMU callbacks into monotonic one-second event-time windows, commits each window and sequence atomically to a Room outbox, and seals the final sequence before React Native completes the backend trip. FastAPI stores canonical telemetry in PostgreSQL, derives a separate provenance-qualified trip energy label after finalization, and exposes finalization status for the mobile result flow. WorkManager recovers pending uploads; the release script fails closed on package, endpoint, permission, version, and signing-certificate mismatches.

**Tech Stack:** Kotlin 1.9, Android foreground services, Fused Location Provider, SensorManager, Room 2.8.4, WorkManager 2.9.1, React Native 0.80.3, TypeScript, FastAPI, Pydantic 2, SQLAlchemy, Alembic, PostgreSQL 16, pytest, JUnit 4, PowerShell, Gradle 8.14.1, Google Play App Signing.

**Spec:** `docs/superpowers/specs/2026-08-30-gpsdriver-live-pilot-release-hardening-design.md`

## Global Constraints

- Preserve Android package `com.trickee.gpsdriverapp` and Kotlin namespace `com.trickee.gpsdriver`.
- Preserve the deployed API and WebSocket URLs.
- Release is `versionName 1.0.3`, `versionCode 4`, target SDK 36.
- Expected upload-certificate SHA-1 is `1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A`.
- The primary future supervised target is `actual_wh_per_km`; predictions must never become labels.
- Store no registration number, chassis number, engine number, owner name, address, signing password, OAuth token, or `.env` secret in Git or logs.
- Use only model-level OLA S1 data: 2023, 2.98 kWh, lithium-ion, 121 kg, 8.5 kW peak, 95 km/h, 141 km certified range, regenerative braking.
- Android requests a one-second desired location interval but never claims the OS guarantees a fresh fix each second.
- Missing GPS seconds are explicit null-GPS windows; coordinates are never interpolated.
- Keep schema-version 1 telemetry backward compatible for existing clients.
- Existing worktree changes predate this plan. Never revert them. Before staging implementation work, inspect `git diff`; stage only task-owned hunks. If an owned hunk cannot be separated safely, leave it uncommitted and record the verified checkpoint rather than absorbing unrelated user work.
- Every production change starts with a failing regression test and follows red-green-refactor.

---

## File Structure

### New focused units

- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/GpsWindowBuffer.kt` — pure event-time GPS window selection.
- `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/collector/GpsWindowBufferTest.kt` — batched, delayed, boundary, and accuracy regression tests.
- `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryStoragePolicy.kt` — pure storage pressure and cleanup decisions.
- `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/storage/TelemetryStoragePolicyTest.kt` — storage policy tests.
- `backend/alembic/versions/0005_trip_energy_labels.py` — additive label-table migration.
- `backend/app/services/trip_energy_labels.py` — deterministic label calculation and eligibility policy.
- `backend/tests/test_trip_energy_labels.py` — formula, provenance, eligibility, and anti-leakage tests.

### Existing files modified

- `TripCollectorService.kt` — event-time scheduling, all-location handling, final flush, storage checks, and recovery scheduling.
- `ImuWindowAccumulator.kt` and its test — timestamp-bounded extraction with future samples retained.
- `TelemetryDao.kt`, `TelemetryRepository.kt`, and `TelemetryRepositoryTest.kt` — idempotent atomic sealing and ACK-safe cleanup.
- `TelemetryModule.kt` — wait for the persisted sealed sequence instead of guessing it.
- `BackfillWorker.kt` — connected-network constraint and recurring pending-trip recovery.
- `entities.py`, `trip_finalizer.py`, and finalizer tests — persistent energy labels and final summary.
- `trip_routes.py` and lifecycle tests — authenticated finalization-status response.
- `api.ts`, `telemetryNative.ts`, `DriverActionSheet.tsx`, and new focused Jest tests — wait for the real final result and display honest status.
- `provisioning.py`, `vehicles.py`, and provisioning tests — OLA profile and honest spec completeness.
- `build.gradle`, Gradle wrapper properties, release scripts, and identity/config tests — version 4 signed build and release checks.
- `DEVELOPER_HANDOFF.md` and `docs/evidence/gates-1-to-4-status.md` — release closeout, artifact evidence, and remaining physical-device gates. The repository does not contain the separate Trickee `analysis/built_implementation_and_remaining_work.md` or `analysis/daily_logger.md` files.

---

### Task 1: Event-Time GPS and IMU Windows

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/GpsWindowBuffer.kt`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/collector/GpsWindowBufferTest.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/ImuWindowAccumulator.kt`
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/collector/ImuWindowAccumulatorTest.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/TripCollectorService.kt`

**Interfaces:**
- Consumes: existing `GpsPayload` and `ImuSummaryPayload` models.
- Produces: `GpsWindowBuffer.add(fixes: Iterable<GpsPayload>)` and `takeBest(windowStartNs: Long, windowEndNs: Long): GpsPayload?`.
- Produces: `ImuWindowAccumulator.closeWindow(windowStartNs: Long, windowEndNs: Long, expectedSamples: Int): ImuSummaryPayload`.

- [ ] **Step 1: Write failing GPS buffer tests**

```kotlin
@Test fun batchedFixesPopulateTheirOwnOneSecondWindows() {
    val buffer = GpsWindowBuffer()
    buffer.add(listOf(fix(100_000_000), fix(1_100_000_000), fix(2_100_000_000)))
    assertEquals(100_000_000, buffer.takeBest(0, 1_000_000_000)?.fixMonotonicTimeNs)
    assertEquals(1_100_000_000, buffer.takeBest(1_000_000_000, 2_000_000_000)?.fixMonotonicTimeNs)
    assertEquals(2_100_000_000, buffer.takeBest(2_000_000_000, 3_000_000_000)?.fixMonotonicTimeNs)
}

@Test fun latestFixWinsThenAccuracyBreaksEqualTimestampTie() {
    val buffer = GpsWindowBuffer()
    buffer.add(listOf(fix(800_000_000, accuracy = 20.0), fix(900_000_000, accuracy = 30.0), fix(900_000_000, accuracy = 5.0)))
    assertEquals(5.0, buffer.takeBest(0, 1_000_000_000)?.horizontalAccuracyM)
}

@Test fun windowEndBelongsToNextWindowAndOldFixesAreDiscarded() {
    val buffer = GpsWindowBuffer()
    buffer.add(listOf(fix(999_999_999), fix(1_000_000_000)))
    assertEquals(999_999_999, buffer.takeBest(0, 1_000_000_000)?.fixMonotonicTimeNs)
    assertEquals(1_000_000_000, buffer.takeBest(1_000_000_000, 2_000_000_000)?.fixMonotonicTimeNs)
}
```

- [ ] **Step 2: Run GPS tests and verify RED**

Run from `mobile/android`:

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests '*GpsWindowBufferTest' --console=plain
```

Expected: FAIL because `GpsWindowBuffer` does not exist.

- [ ] **Step 3: Implement the minimal pure GPS buffer**

```kotlin
class GpsWindowBuffer {
    private val fixes = mutableListOf<GpsPayload>()

    @Synchronized fun add(values: Iterable<GpsPayload>) {
        fixes.addAll(values)
        fixes.sortBy { it.fixMonotonicTimeNs }
    }

    @Synchronized fun takeBest(windowStartNs: Long, windowEndNs: Long): GpsPayload? {
        require(windowStartNs < windowEndNs)
        val candidates = fixes.filter { it.fixMonotonicTimeNs in windowStartNs until windowEndNs }
        fixes.removeAll { it.fixMonotonicTimeNs < windowEndNs }
        return candidates.maxWithOrNull(
            compareBy<GpsPayload> { it.fixMonotonicTimeNs }
                .thenByDescending { -(it.horizontalAccuracyM ?: Double.MAX_VALUE) }
        )
    }
}
```

Use an explicit comparator implementation if the compact comparator does not select lower accuracy on equal timestamps; the test is authoritative.

- [ ] **Step 4: Write failing timestamp-bounded IMU tests**

Add tests proving samples before `windowEndNs` are summarized, samples at or after the boundary remain for the next close, and out-of-order timestamps produce non-negative jerk.

```kotlin
@Test fun closeWindowRetainsSamplesForTheNextEventTimeWindow() {
    val accumulator = ImuWindowAccumulator()
    accumulator.addAccelerometer(1f, 0f, 0f, 500_000_000)
    accumulator.addAccelerometer(2f, 0f, 0f, 1_500_000_000)
    val first = accumulator.closeWindow(0, 1_000_000_000, 50)
    val second = accumulator.closeWindow(1_000_000_000, 2_000_000_000, 50)
    assertEquals(1, first.accelerometerSampleCount)
    assertEquals(1, second.accelerometerSampleCount)
}
```

- [ ] **Step 5: Run IMU tests and verify RED**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests '*ImuWindowAccumulatorTest' --console=plain
```

Expected: FAIL because the timestamp-bounded overload is absent.

- [ ] **Step 6: Implement timestamp-bounded IMU extraction**

Change `closeWindow` to partition both sensor lists by `[windowStartNs, windowEndNs)`, remove only samples older than `windowEndNs`, sort the selected samples by timestamp before jerk calculation, and retain later samples.

- [ ] **Step 7: Integrate event-time buffering into the service**

In `onLocationResult`, map every `result.locations` entry to `GpsPayload`, add all payloads to `GpsWindowBuffer`, and update status from the freshest entry. Set `setMaxUpdateDelayMillis(0)` to avoid intentional batching.

Anchor wall and monotonic clocks at capture start. Close the first full window after its end plus `LOCATION_LATENESS_NS = 2_000_000_000L`; subsequent windows close once per second. Derive `eventTimeUtcMs` from the anchor rather than calling the mutable wall clock for each boundary. On stop, cancel callbacks, close every remaining full window, then close one final partial window.

- [ ] **Step 8: Run focused and full native unit tests**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests '*GpsWindowBufferTest' --tests '*ImuWindowAccumulatorTest' --console=plain
.\gradlew.bat :app:testDebugUnitTest --console=plain
```

Expected: all tests PASS.

- [ ] **Step 9: Checkpoint the task**

Inspect `git diff` for only the five task paths. Commit task-owned hunks as `fix: preserve event-time telemetry windows` only if they can be isolated safely from pre-existing changes.

---

### Task 2: Atomic Trip Seal and Native Stop Handshake

**Files:**
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDao.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepository.kt`
- Modify: `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepositoryTest.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/TripCollectorService.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/bridge/TelemetryModule.kt`

**Interfaces:**
- Consumes: final windows produced by Task 1.
- Produces: `TelemetryRepository.beginEnding(tripId: String)` and `sealTrip(tripId: String, endedAtUtcMs: Long): Long`.
- Produces: `TelemetryModule.stopTrip` promise resolved only after Room contains `finalSequenceNo` and `SYNC_PENDING`.

- [ ] **Step 1: Write failing Room sealing tests**

```kotlin
@Test fun sealingReturnsThePersistedLastSequenceAndIsIdempotent() = runBlocking {
    repository.createTrip("trip", "device", "vehicle", 1_000)
    repository.setTripState("trip", TripState.ACTIVE)
    repository.commitWindowAndAdvanceCursor("trip", "s1", 2_000, 3_000, "{}", 2_001)
    repository.beginEnding("trip")
    assertEquals(1L, repository.sealTrip("trip", 3_001))
    assertEquals(1L, repository.sealTrip("trip", 3_002))
    assertEquals(TripState.SYNC_PENDING, repository.trip("trip")?.state)
    assertEquals(1L, repository.trip("trip")?.finalSequenceNo)
}
```

Add a test that a window committed while the trip is `ENDING` is included in the sealed sequence.
Add a test that an already-sealed trip returns its stored final sequence without changing its end timestamp.

- [ ] **Step 2: Run instrumentation test and verify RED**

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.trickee.gpsdriver.telemetry.storage.TelemetryRepositoryTest --console=plain
```

Expected: FAIL because `beginEnding` and `sealTrip` do not exist. If no emulator/device is available, record that environmental blocker and run the DAO compile gate; do not call the behavior verified.

- [ ] **Step 3: Implement the atomic DAO transaction**

Add conditional state updates and an idempotent transaction:

```kotlin
@Transaction
open suspend fun sealTrip(tripId: String, endedAtUtcMs: Long): Long {
    val trip = requireNotNull(trip(tripId)) { "Trip not found" }
    trip.finalSequenceNo?.let { return it }
    require(trip.state == TripState.ENDING) { "Trip must be ending before seal" }
    val finalSequence = trip.nextSequenceNo - 1
    check(markSealed(tripId, finalSequence, endedAtUtcMs) == 1)
    return finalSequence
}
```

`markSealed` must write `SYNC_PENDING`, `final_sequence_no`, and `ended_at_utc_ms` in one SQL update.

- [ ] **Step 4: Make service stop order deterministic**

Perform: set `ENDING` -> unregister new sensor/location callbacks -> flush buffered windows -> `sealTrip` -> run one upload -> enqueue backfill -> publish `SYNC_PENDING` -> stop foreground service.

When `START_STICKY` recreates the service, resume capture only for `ACTIVE`.
If the persisted trip is `ENDING`, seal the already-committed cursor
idempotently and enqueue backfill instead of starting new sensors. This makes a
process death during stop converge on a stable final sequence.

- [ ] **Step 5: Make the React Native promise wait for the database seal**

After sending `ACTION_STOP`, poll the known trip row on `Dispatchers.IO` with a 15-second timeout and 50 ms interval. Resolve with the persisted `finalSequenceNo`, pending count, and last location only when the state is `SYNC_PENDING`, `FINALIZING`, or `COMPLETED`. Reject with `TRIP_SEAL_TIMEOUT` on timeout; never return `nextSequenceNo` as the final sequence.

- [ ] **Step 6: Run Room, Kotlin compile, and JS type gates**

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:compileDebugKotlin --console=plain
npx tsc --noEmit
```

Expected: PASS, with stop result retaining the existing TypeScript interface.

- [ ] **Step 7: Checkpoint the task**

Commit isolated task-owned hunks as `fix: seal telemetry trips atomically`, or leave an explicit verified worktree checkpoint when pre-existing hunks overlap.

---

### Task 3: Offline Recovery and Storage Pressure

**Files:**
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryStoragePolicy.kt`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/storage/TelemetryStoragePolicyTest.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryDao.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/storage/TelemetryRepository.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/BackfillWorker.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/network/TelemetryUploader.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/collector/TripCollectorService.kt`

**Interfaces:**
- Produces: `TelemetryStoragePolicy.evaluate(databaseBytes: Long, availableBytes: Long): StoragePressure`.
- Produces: `TelemetryRepository.purgeAcknowledged(nowUtcMs: Long): Int` with a 24-hour ACK safety window.
- Produces: network-constrained unique WorkManager backfill.

- [ ] **Step 1: Write failing pure storage-policy tests**

```kotlin
@Test fun criticalSpaceBlocksNewTripsWithoutDeletingPendingRows() {
    val MIB = 1024L * 1024L
    val pressure = TelemetryStoragePolicy.evaluate(databaseBytes = 450L * MIB, availableBytes = 40L * MIB)
    assertEquals(StoragePressureLevel.CRITICAL, pressure.level)
}

@Test fun normalSpaceAllowsCapture() {
    val MIB = 1024L * 1024L
    val GIB = 1024L * MIB
    val pressure = TelemetryStoragePolicy.evaluate(databaseBytes = 20L * MIB, availableBytes = 2L * GIB)
    assertEquals(StoragePressureLevel.NORMAL, pressure.level)
}
```

- [ ] **Step 2: Run test and verify RED**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests '*TelemetryStoragePolicyTest' --console=plain
```

Expected: FAIL because the policy class does not exist.

- [ ] **Step 3: Implement deterministic thresholds**

Use warning at database >= 250 MiB or available space < 500 MiB, optional-capture blocked at database >= 400 MiB or available space < 250 MiB, and critical at database >= 500 MiB or available space < 100 MiB. Core pending telemetry is never deleted.

- [ ] **Step 4: Write failing cleanup and WorkManager tests**

Extend repository instrumentation tests to prove ACKed rows older than 24 hours are purged while pending, in-flight, rejected, and recent ACKed rows remain. Add a unit/config assertion that `BackfillWorker` uses `NetworkType.CONNECTED`.

- [ ] **Step 5: Implement cleanup and constrained recovery**

Build the request with:

```kotlin
val constraints = Constraints.Builder()
    .setRequiredNetworkType(NetworkType.CONNECTED)
    .build()
OneTimeWorkRequestBuilder<BackfillWorker>()
    .setConstraints(constraints)
    .build()
```

Recover expired leases, purge only safely aged ACKed rows, process pending trips, and enqueue unique backfill at capture start, trip stop, and service recovery.

- [ ] **Step 6: Enforce storage state at trip start**

Measure the Room database file and its filesystem's usable space. Reject a new trip in `TelemetryModule.startTrip` with `TELEMETRY_STORAGE_CRITICAL` when policy is critical. During an already-active trip, continue core timing/GPS windows and expose pressure in collector health; do not silently drop pending data.

- [ ] **Step 7: Run focused and full Android tests**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests '*TelemetryStoragePolicyTest' --tests '*UploadPolicyTest' --console=plain
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug --console=plain
```

Expected: PASS.

- [ ] **Step 8: Checkpoint the task**

Commit isolated hunks as `fix: recover offline telemetry safely`, or record the verified worktree checkpoint.

---

### Task 4: Provenance-Safe Trip Energy Labels

**Files:**
- Create: `backend/alembic/versions/0005_trip_energy_labels.py`
- Create: `backend/app/services/trip_energy_labels.py`
- Create: `backend/tests/test_trip_energy_labels.py`
- Modify: `backend/app/models/entities.py`
- Modify: `backend/app/models/__init__.py` if model exports are used there

**Interfaces:**
- Consumes: finalized trip, vehicle capacity snapshot, validated distance, GPS completeness, and observed charging state.
- Produces: `TripEnergyLabel` with the exact approved columns.
- Produces: `build_trip_energy_label(trip, vehicle, distance_km, gps_completeness_pct, charging_observed, captured_at) -> TripEnergyLabel`.

- [ ] **Step 1: Write failing model and policy tests**

```python
def test_manual_dashboard_label_uses_capacity_snapshot_and_normalized_target():
    label = build_trip_energy_label(
        trip=trip(starting_soc=90, ending_soc=80),
        vehicle=vehicle(usable_kwh=2.98),
        distance_km=20.0,
        gps_completeness_pct=98.0,
        charging_observed=False,
        captured_at=datetime(2026, 8, 30, 12, 0),
    )
    assert label.actual_energy_consumed_wh == pytest.approx(298.0)
    assert label.actual_wh_per_km == pytest.approx(14.9)
    assert label.usable_kwh_snapshot == 2.98
    assert label.label_source == "manual_dashboard"
    assert label.is_training_eligible is True

def test_prediction_values_can_never_be_substituted_for_missing_soc():
    label = build_trip_energy_label(
        trip=trip(starting_soc=None, ending_soc=80),
        vehicle=vehicle(usable_kwh=2.98),
        distance_km=20.0,
        gps_completeness_pct=98.0,
        charging_observed=False,
        captured_at=datetime(2026, 8, 30, 12, 0),
    )
    assert label.actual_energy_consumed_wh is None
    assert label.actual_wh_per_km is None
    assert label.is_training_eligible is False
    assert label.eligibility_reason == "missing_soc"
```

Add cases for SOC increase, delta below 5%, distance below 10 km, GPS completeness below 90%, charging observed, and Wh/km outside 5-300.

- [ ] **Step 2: Run tests and verify RED**

```powershell
python -m pytest backend/tests/test_trip_energy_labels.py -q
```

Expected: FAIL because the model and service do not exist.

- [ ] **Step 3: Add the SQLAlchemy model**

Define exact columns:

```python
class TripEnergyLabel(Base):
    __tablename__ = "trip_energy_labels"
    id = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id = mapped_column(String(36), ForeignKey("mobile_trip_sessions.id"), unique=True, nullable=False, index=True)
    starting_soc_pct = mapped_column(Float, nullable=True)
    ending_soc_pct = mapped_column(Float, nullable=True)
    soc_delta_pct = mapped_column(Float, nullable=True)
    actual_energy_consumed_wh = mapped_column(Float, nullable=True)
    actual_wh_per_km = mapped_column(Float, nullable=True)
    usable_kwh_snapshot = mapped_column(Float, nullable=True)
    label_source = mapped_column(String(50), nullable=False)
    label_confidence = mapped_column(Float, nullable=False)
    is_training_eligible = mapped_column(Boolean, nullable=False, default=False, index=True)
    eligibility_reason = mapped_column(String(80), nullable=False)
    captured_at = mapped_column(DateTime, nullable=False)
    created_at = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

- [ ] **Step 4: Add the additive Alembic migration**

Create the table, unique trip constraint, trip index, and training-eligibility index. Downgrade drops only `trip_energy_labels` and its indexes.

- [ ] **Step 5: Implement the deterministic label policy**

Calculate `soc_delta_pct = starting - ending`, `actual_energy_consumed_wh = delta / 100 * usable_kwh_snapshot * 1000`, and `actual_wh_per_km = energy / distance`. Set manual-dashboard confidence to `0.60` when eligible and `0.30` when retained but excluded. Return the first stable exclusion reason in this order: `missing_soc`, `soc_increase`, `soc_delta_below_5_pct`, `distance_below_10_km`, `gps_completeness_below_90_pct`, `charging_observed`, `physical_bounds_failed`; otherwise `eligible_manual_dashboard`.

- [ ] **Step 6: Verify migration and unit tests**

```powershell
python -m pytest backend/tests/test_trip_energy_labels.py -q
$db = Join-Path $env:TEMP 'gpsdriver-label-migration.db'
$env:TRICKEE_DATABASE_URL = "sqlite:///$($db.Replace('\','/'))"
python -m alembic -c backend/alembic.ini upgrade head
python -m alembic -c backend/alembic.ini downgrade 0004
python -m alembic -c backend/alembic.ini upgrade head
Remove-Item -LiteralPath $db -Force -ErrorAction SilentlyContinue
```

Expected: tests PASS and migration round-trip exits 0.

- [ ] **Step 7: Checkpoint the task**

Commit isolated task files as `feat: persist trip energy training labels`, or record the verified checkpoint.

---

### Task 5: Finalization Status and Honest Mobile Result

**Files:**
- Modify: `backend/app/processors/trip_finalizer.py`
- Modify: `backend/tests/test_trip_finalizer.py`
- Modify: `backend/app/telemetry/trip_routes.py`
- Modify: `backend/tests/test_telemetry_trip_lifecycle.py`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/components/DriverActionSheet.tsx`
- Create: `mobile/src/services/__tests__/tripFinalization.test.ts`
- Create: `mobile/src/services/tripFinalization.ts`

**Interfaces:**
- Consumes: `build_trip_energy_label` from Task 4.
- Produces: authenticated `GET /api/v2/trips/{trip_id}` with trip state and finalization summary.
- Produces: `waitForTripFinalization(token, tripId, options) -> Promise<FinalizedTripResult>`.

- [ ] **Step 1: Write failing finalizer integration tests**

Extend `test_finalizer_builds_physics_summary_from_contiguous_windows` to assert exactly one `TripEnergyLabel`, the 2.98/vehicle capacity snapshot, `actual_wh_per_km`, source, captured timestamp, and eligibility reason. Add an idempotency test calling `finalize_trip` twice and asserting one label row.

- [ ] **Step 2: Run tests and verify RED**

```powershell
python -m pytest backend/tests/test_trip_finalizer.py -q
```

Expected: FAIL because finalization does not persist a label.

- [ ] **Step 3: Integrate label persistence**

After contiguous-window validation and `_physics_summary`, derive `charging_observed` from any `health_payload.charging`, upsert one label by `trip_id`, and include this summary block:

```python
"energy_label": {
    "actual_energy_consumed_wh": label.actual_energy_consumed_wh,
    "actual_wh_per_km": label.actual_wh_per_km,
    "label_source": label.label_source,
    "label_confidence": label.label_confidence,
    "is_training_eligible": label.is_training_eligible,
    "eligibility_reason": label.eligibility_reason,
}
```

- [ ] **Step 4: Write failing authenticated status-route tests**

Test owner access, cross-user denial, waiting state with no summary, and completed state with summary.

```python
response = client.get(f"/api/v2/trips/{trip_id}", headers=identity["headers"])
assert response.status_code == 200
assert response.json()["data"]["finalization_state"] == "completed"
assert response.json()["data"]["summary"]["energy_label"]["label_source"] == "manual_dashboard"
```

- [ ] **Step 5: Implement the status route**

Load the trip by `trip_id` and `user_id`, load `TripFinalization`, and return `_trip_data` plus its `summary`. Never return another user's trip.

- [ ] **Step 6: Write failing TypeScript polling tests**

Use fake timers and a fake `fetchStatus` dependency to prove waiting -> completed, timeout -> saved/processing result, and permanent failed state -> error.

- [ ] **Step 7: Implement bounded polling and UI mapping**

Poll once per second for up to 30 seconds. Map finalizer summary to the existing `CalculationOverlay` shape: prediction values come from `summary.energy`; measured values come only from `summary.energy_label`. If the timeout expires, close the calculation animation with “Trip saved; processing continues” rather than claiming a calculated result.

- [ ] **Step 8: Run backend and mobile focused tests**

```powershell
python -m pytest backend/tests/test_trip_finalizer.py backend/tests/test_telemetry_trip_lifecycle.py -q
npm test -- --runInBand mobile/src/services/__tests__/tripFinalization.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 9: Checkpoint the task**

Commit isolated hunks as `feat: expose finalized trip energy results`, or record the verified checkpoint.

---

### Task 6: OLA S1 Pilot Provisioning and Spec Completeness

**Files:**
- Modify: `backend/app/services/provisioning.py`
- Modify: `backend/app/routers/vehicles.py`
- Modify: `backend/tests/test_provisioning.py`
- Modify: `backend/tests/test_gps_prediction.py`
- Runtime only, never commit: private provisioning JSON

**Interfaces:**
- Consumes: approved OLA S1 model-level specifications.
- Produces: idempotent driver `rhythm@trickee.co.in` assigned to `OLA-S1-PILOT-01` with role `driver`.

- [ ] **Step 1: Write failing OLA profile and completeness tests**

Use a non-real test email while asserting the approved vehicle values:

```python
def test_standard_ola_s1_profile_is_prediction_complete_without_unknown_voltage(db):
    payload = ola_s1_payload(email="pilot@example.test")
    provision_fleet(db, FleetProvisionRequest.model_validate(payload))
    vehicle = db.query(Vehicle).filter_by(vehicle_code="OLA-S1-PILOT-01").one()
    assert vehicle.usable_kwh == 2.98
    assert vehicle.kerb_weight == 121
    assert vehicle.motor_kw == 8.5
    assert vehicle.top_speed == 95
    assert vehicle.certified_range == 141
    assert vehicle.nominal_voltage is None
    assert vehicle.spec_incomplete is False
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
python -m pytest backend/tests/test_provisioning.py backend/tests/test_gps_prediction.py -q
```

Expected: FAIL because current provisioning marks completeness unconditionally and the router requires unused nominal voltage.

- [ ] **Step 3: Align completeness with actual physics inputs**

Use required fields: `category`, `make`, `model`, `usable_kwh`, `battery_chemistry`, `kerb_weight`, `regen_available`, and `certified_range`. Keep nominal voltage, rated Ah, GVW, payload, motor power, and top speed as valuable optional metadata unless a calculation actually consumes them.

Set `manufacture_year` through provisioning. Set `spec_incomplete = not _check_spec_complete(vehicle)` rather than forcing false.

- [ ] **Step 4: Run focused backend tests**

```powershell
python -m pytest backend/tests/test_provisioning.py backend/tests/test_gps_prediction.py -q
```

Expected: PASS.

- [ ] **Step 5: Prepare private live provisioning input**

Create it under a temporary directory, not the repository, with:

```json
{
  "fleet": {"name": "Trickee GPS Pilot", "city": "Ahmedabad"},
  "vehicles": [{
    "vehicle_code": "OLA-S1-PILOT-01",
    "make": "OLA Electric",
    "model": "S1",
    "variant": "Standard S1",
    "manufacture_year": 2023,
    "category": "2W_passenger",
    "usable_kwh": 2.98,
    "battery_chemistry": "Lithium-ion",
    "motor_kw": 8.5,
    "kerb_weight": 121,
    "top_speed": 95,
    "regen_available": true,
    "certified_range": 141
  }],
  "drivers": [{
    "email": "rhythm@trickee.co.in",
    "driver_code": "GPS-PILOT-01",
    "full_name": "Rhythm Pilot",
    "assigned_vehicle_code": "OLA-S1-PILOT-01"
  }]
}
```

Before applying live, query by email and vehicle code. If either belongs to another fleet or role, stop instead of reassigning silently.

- [ ] **Step 6: Apply live provisioning only after GCP reauthentication**

Use the deployed `provision` role or an approved one-shot Cloud Run job with the private database connection. Do not print the JSON or database URL. Re-query the driver, role, fleet, and assigned vehicle afterward. Current `gcloud` credentials are expired, so this step is an explicit external-auth gate.

- [ ] **Step 7: Checkpoint the task**

Commit only source/test changes as `feat: provision OLA S1 pilot profile`; never commit the private JSON.

---

### Task 7: Release Identity, Version, and Build Guards

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Modify: `mobile/android/gradle/wrapper/gradle-wrapper.properties`
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/AppIdentityTest.kt`
- Modify: `scripts/build-public-release.ps1`
- Modify: `scripts/verify-public-release-config.ps1`
- Modify: `scripts/start-local.ps1`
- Modify: `DEVELOPER_HANDOFF.md`

**Interfaces:**
- Produces: version `1.0.3 (4)` release configuration.
- Produces: release script defaulting to the accepted replacement upload certificate.

- [ ] **Step 1: Write failing identity/config assertions**

Update tests/scripts to expect:

```text
applicationId=com.trickee.gpsdriverapp
versionName=1.0.3
versionCode=4
targetSdk=36
uploadSha1=1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A
```

Assert that the release manifest has foreground-service location, precise location, Internet, notification, and wake-lock permissions, and lacks `ACCESS_BACKGROUND_LOCATION`, `RECORD_AUDIO`, and `AD_ID`.

- [ ] **Step 2: Run config tests and verify RED**

```powershell
.\scripts\verify-public-release-config.ps1
Set-Location mobile\android
.\gradlew.bat :app:testDebugUnitTest --tests '*AppIdentityTest' --console=plain
```

Expected: FAIL on old version and old default certificate.

- [ ] **Step 3: Update the release configuration**

Set `versionCode 4`, `versionName "1.0.3"`, replacement SHA-1 default, and the correct adb package in `start-local.ps1`. Increase Gradle wrapper `networkTimeout` to 120000 ms so the wrapper download does not fail at the previous 10-second environmental timeout.

- [ ] **Step 4: Strengthen the release script**

Build both `bundleRelease` and `assembleRelease` from the same source/config. Verify the APK launch artifact and AAB independently, then copy both into the private release directory with SHA-256 values. Never echo signing passwords.

- [ ] **Step 5: Re-run config and identity tests**

```powershell
.\scripts\verify-public-release-config.ps1
.\scripts\test-external-signing-properties.ps1
Set-Location mobile\android
.\gradlew.bat :app:testDebugUnitTest --tests '*AppIdentityTest' --console=plain
```

Expected: PASS.

- [ ] **Step 6: Checkpoint the task**

Commit isolated release hunks as `build: prepare GPS Driver 1.0.3`, or record the verified checkpoint.

---

### Task 8: Full Verification and Signed AAB

**Files:**
- Modify only if failures identify a root cause: files covered by Tasks 1-7
- Update: `docs/evidence/gates-1-to-4-status.md`
- Update: `DEVELOPER_HANDOFF.md`
- Generate outside Git: signed AAB/APK, checksums, manifests, and test logs

**Interfaces:**
- Consumes: all completed tasks and external signing properties.
- Produces: verified `Trickee-GPS-Driver-public-1.0.3-4.aab` plus checksum and evidence.

- [ ] **Step 1: Run backend verification in a clean Python 3.12 environment**

```powershell
python -m venv "$env:TEMP\gpsdriver-release-venv"
& "$env:TEMP\gpsdriver-release-venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
& "$env:TEMP\gpsdriver-release-venv\Scripts\python.exe" -m pytest backend\tests -q
```

Expected: zero failed tests. Report deprecation warnings separately; do not call warnings errors.

- [ ] **Step 2: Run mobile JavaScript verification**

From `mobile`:

```powershell
npm test -- --runInBand
npx tsc --noEmit
npx eslint src --max-warnings=0
npm audit --omit=dev
```

Expected: tests, TypeScript, and ESLint exit 0. Audit must show zero critical advisories; every remaining high advisory must be traced to a package and either fixed compatibly or recorded as a release risk requiring explicit acceptance. Do not perform an unplanned React Native major upgrade.

- [ ] **Step 3: Run Android verification**

From `mobile/android`:

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintRelease :app:assembleRelease :app:bundleRelease --console=plain
```

Supply endpoints, Web OAuth client ID, external signing properties, and external build root exactly as the release script does. Expected: exit 0.

- [ ] **Step 4: Build through the fail-closed release entrypoint**

```powershell
.\scripts\build-public-release.ps1 `
  -SigningPropertiesFile 'E:\vab-downloads\trickeeomen\trickee-evify-production-main-voice\production\trickee-driver-mobile\android\signing.properties' `
  -ExpectedUploadSha1 '1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A'
```

Expected output: application ID `com.trickee.gpsdriverapp`, version `1.0.3 (4)`, target 36, expected signer, signature verified, output AAB path, and SHA-256.

- [ ] **Step 5: Verify artifact contents independently**

Set `$releaseAab` to `$env:LOCALAPPDATA\Trickee\gpsdriver-public-android-build\release\Trickee-GPS-Driver-public-1.0.3-4.aab`. Run `jarsigner -verify $releaseAab`, `keytool -printcert -jarfile $releaseAab`, inspect the merged manifest, and run `bundletool validate --bundle=$releaseAab` when bundletool is installed. Confirm required and forbidden permissions, HTTPS origins, package, version, SDK, signature files, and certificate fingerprint.

- [ ] **Step 6: Install and launch the release APK**

On an Android 14+ emulator or physical device with Google Play Services:

```powershell
$releaseApk = Join-Path $env:LOCALAPPDATA 'Trickee\gpsdriver-public-android-build\release\Trickee-GPS-Driver-public-1.0.3-4.apk'
adb install -r $releaseApk
adb shell am start -n com.trickee.gpsdriverapp/com.trickee.gpsdriver.MainActivity
adb shell pidof com.trickee.gpsdriverapp
```

Expected: install succeeds, launcher opens, and the process remains alive without a fatal exception. This is not a road-test certification.

- [ ] **Step 7: Run live endpoint smoke checks**

Verify HTTP 200 for API health, WebSocket health, privacy, terms, and support URLs. Confirm the API health response remains GPS-first and does not claim BMS is active.

- [ ] **Step 8: Reconcile requirements and update closeout records**

Record exact commands, pass/fail counts, artifact path, hashes, signer, unresolved advisories, live-provisioning status, and physical-road-test status. Mark the AAB ready for upload only if all software gates pass. Mark live pilot certification pending until the Play-installed physical-phone route test succeeds.

- [ ] **Step 9: Final checkpoint**

Inspect all diffs and generated artifacts. Commit only isolated documentation and task-owned source hunks. Never commit `.env`, the provisioning payload, signing properties, keystore, AAB, APK, tokens, or build directories.

---

## Physical Play-Installed Pilot Checklist

This occurs after the AAB is uploaded to the internal track and installed from Play:

- Google Sign-In succeeds for `rhythm@trickee.co.in`.
- The backend returns the assigned `OLA-S1-PILOT-01` vehicle.
- Start SOC is captured from the scooter dashboard.
- Foreground notification remains visible during screen-off riding.
- A controlled network outage queues data without ending collection.
- Connectivity recovery drains the Room outbox.
- Stop SOC is captured and native sealing returns the persisted final sequence.
- Backend finalization reaches `completed` and shows explicit GPS gaps.
- Elapsed seconds reconcile with stored windows; no second disappears silently.
- Energy result distinguishes GPS estimate from dashboard-SOC label.
- Training eligibility and reason match the documented policy.
- Phone model, Android version, battery impact, GPS completeness, and OEM battery-optimization setting are recorded.
