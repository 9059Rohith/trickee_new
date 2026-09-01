package com.trickee.gpsdriver.telemetry.storage

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelemetryRepositoryTest {
    private val database = Room.inMemoryDatabaseBuilder(
        ApplicationProvider.getApplicationContext(),
        TelemetryDatabase::class.java,
    ).allowMainThreadQueries().build()
    private val repository = TelemetryRepository(database.telemetryDao())

    @After
    fun close() = database.close()

    @Test
    fun windowAndSequenceCursorCommitAtomically() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)

        val sequence = repository.commitWindowAndAdvanceCursor(
            tripId = "trip",
            sampleId = "sample-1",
            eventTimeUtcMs = 2_000L,
            monotonicTimeNs = 3_000L,
            payloadJson = "{\"schema_version\":1}",
            createdAtUtcMs = 2_001L,
        )

        assertEquals(1L, sequence)
        assertEquals(2L, database.telemetryDao().trip("trip")!!.nextSequenceNo)
        assertNotNull(database.telemetryDao().outboxBySampleId("sample-1"))
    }

    @Test
    fun expiredLeaseReturnsToPendingWithoutDeletingPayload() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)
        repository.commitWindowAndAdvanceCursor("trip", "sample-1", 2_000, 3_000, "{}", 2_001)
        repository.leasePending("trip", nowUtcMs = 3_000, limit = 20, leaseMs = 10_000)

        repository.recoverExpiredLeases(nowUtcMs = 13_001)

        val row = database.telemetryDao().outboxBySampleId("sample-1")!!
        assertEquals(OutboxState.PENDING, row.state)
        assertEquals("{}", row.payloadJson)
    }

    @Test
    fun exactAcknowledgementClearsAcceptedRowsWhileAnEarlierGapRemainsPending() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)
        repository.setTripState("trip", TripState.ACTIVE)
        repeat(10) { index ->
            val sequence = index + 1L
            repository.commitWindowAndAdvanceCursor(
                tripId = "trip",
                sampleId = "sample-$sequence",
                eventTimeUtcMs = 2_000L + sequence,
                monotonicTimeNs = 3_000L + sequence,
                payloadJson = "{\"sequence\":$sequence}",
                createdAtUtcMs = 2_001L,
            )
        }
        val leased = repository.leasePending("trip", nowUtcMs = 3_000L, limit = 20, leaseMs = 10_000L)

        repository.applyAcknowledgement(
            tripId = "trip",
            leasedRows = leased,
            highestContiguousSequence = 0L,
            acceptedSequences = (7L..10L).toSet(),
            duplicateSequences = emptySet(),
            permanentRejections = emptyMap(),
            serverCommittedAtUtcMs = 4_000L,
        )

        val rows = database.telemetryDao().outboxForTrip("trip").associateBy { it.sequenceNo }
        assertEquals((1L..6L).toSet(), rows.filterValues { it.state == OutboxState.PENDING }.keys)
        assertEquals((7L..10L).toSet(), rows.filterValues { it.state == OutboxState.ACKED }.keys)
    }

    @Test
    fun retryDiagnosticsArePersistedWithoutDiscardingThePayload() = runBlocking {
        createTripWithWindow("trip", "sample-1")
        val leased = repository.leasePending("trip", 3_000L, 20, 10_000L)

        repository.recordRetry(
            rows = leased,
            nextAttemptAtUtcMs = 8_000L,
            httpStatus = 403,
            errorCode = "HTTP_403",
            errorDetail = "HTTP 403 (HTTP_403)",
            failedAtUtcMs = 4_000L,
        )

        val row = database.telemetryDao().outboxBySampleId("sample-1")!!
        assertEquals(OutboxState.PENDING, row.state)
        assertEquals("{}", row.payloadJson)
        assertEquals(403, row.lastHttpStatus)
        assertEquals("HTTP_403", row.lastErrorCode)
        assertEquals(8_000L, row.nextAttemptAtUtcMs)
    }

    @Test
    fun onlyAnIsolatedInvalidRowCanEnterTheDeadLetterState() = runBlocking {
        createTripWithWindow("trip", "sample-1")
        val leased = repository.leasePending("trip", 3_000L, 20, 10_000L).single()

        repository.deadLetter(
            row = leased,
            httpStatus = 422,
            errorCode = "HTTP_422",
            errorDetail = "HTTP 422 (HTTP_422)",
            failedAtUtcMs = 4_000L,
        )

        val row = database.telemetryDao().outboxBySampleId("sample-1")!!
        assertEquals(OutboxState.PERMANENTLY_REJECTED, row.state)
        assertEquals("{}", row.payloadJson)
        assertEquals("HTTP_422", row.rejectionCode)
        assertEquals(4_000L, row.permanentlyRejectedAtUtcMs)
    }

    @Test
    fun endedTripIsBackfillEligibleButNeverCaptureRecoverable() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)
        repository.setTripState("trip", TripState.ACTIVE)
        repository.commitWindowAndAdvanceCursor("trip", "sample-1", 2_000, 3_000, "{}", 2_001)
        repository.recordEnd("trip", finalSequenceNo = 1, endedAtUtcMs = 3_001)

        assertEquals(null, repository.activeTrip())
        assertEquals("trip", repository.tripWithPendingOutbox()?.tripId)

        repository.applyAcknowledgement("trip", 1, emptyMap(), 4_000)
        assertEquals(TripState.SYNC_PENDING, repository.trip("trip")?.state)
        assertEquals(null, repository.tripWithPendingOutbox())
        assertEquals("trip", repository.latestEndedTrip()?.tripId)
    }

    @Test
    fun eligibleNewerTripIsSelectedWhenOlderTripIsStillInBackoff() = runBlocking {
        createTripWithWindow("older", "older-sample")
        createTripWithWindow("newer", "newer-sample")
        repository.recordRetry(
            rows = repository.leasePending("older", nowUtcMs = 3_000L, limit = 1, leaseMs = 10_000L),
            nextAttemptAtUtcMs = 50_000L,
            httpStatus = null,
            errorCode = "NETWORK_IO",
            errorDetail = "NETWORK_IO",
            failedAtUtcMs = 3_000L,
        )

        assertEquals("newer", repository.tripWithEligibleOutbox(nowUtcMs = 4_000L)?.tripId)
    }

    @Test
    fun sealingReturnsThePersistedLastSequenceAndIsIdempotent() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)
        repository.setTripState("trip", TripState.ACTIVE)
        repository.commitWindowAndAdvanceCursor("trip", "sample-1", 2_000, 3_000, "{}", 2_001)

        repository.beginEnding("trip")
        assertEquals(1L, repository.sealTrip("trip", 3_001))
        assertEquals(1L, repository.sealTrip("trip", 3_999))

        val trip = repository.trip("trip")!!
        assertEquals(TripState.SYNC_PENDING, trip.state)
        assertEquals(1L, trip.finalSequenceNo)
        assertEquals(3_001L, trip.endedAtUtcMs)
    }

    @Test
    fun windowCommittedWhileEndingIsIncludedInTheSeal() = runBlocking {
        repository.createTrip("trip", "device", "vehicle", 1_000L)
        repository.setTripState("trip", TripState.ACTIVE)

        repository.beginEnding("trip")
        repository.commitWindowAndAdvanceCursor("trip", "final-sample", 2_000, 3_000, "{}", 2_001)

        assertEquals(1L, repository.sealTrip("trip", 3_001))
        assertEquals(1L, repository.trip("trip")?.finalSequenceNo)
    }

    @Test
    fun sealedTripRejectsAnyLaterWindow() {
        runBlocking {
            repository.createTrip("trip", "device", "vehicle", 1_000L)
            repository.setTripState("trip", TripState.ACTIVE)
            repository.beginEnding("trip")
            repository.sealTrip("trip", 2_000L)

            assertThrows(IllegalArgumentException::class.java) {
                runBlocking {
                    repository.commitWindowAndAdvanceCursor(
                        "trip", "too-late", 3_000, 4_000, "{}", 3_001
                    )
                }
            }
        }
    }

    @Test
    fun cleanupPurgesOnlyAcknowledgedRowsOlderThanTwentyFourHours() = runBlocking {
        val now = 200_000_000L
        createTripWithWindow("old-acked", "old")
        repository.applyAcknowledgement("old-acked", 1, emptyMap(), 100_000_000L)
        createTripWithWindow("recent-acked", "recent")
        repository.applyAcknowledgement("recent-acked", 1, emptyMap(), now - 1_000L)
        createTripWithWindow("pending", "pending")
        createTripWithWindow("in-flight", "in-flight")
        repository.leasePending("in-flight", now, 20, 10_000L)
        createTripWithWindow("rejected", "rejected")
        repository.applyAcknowledgement("rejected", 0, mapOf(1L to "INVALID"), now)

        assertEquals(1, repository.purgeAcknowledged(now))

        assertEquals(null, database.telemetryDao().outboxBySampleId("old"))
        assertNotNull(database.telemetryDao().outboxBySampleId("recent"))
        assertNotNull(database.telemetryDao().outboxBySampleId("pending"))
        assertNotNull(database.telemetryDao().outboxBySampleId("in-flight"))
        assertNotNull(database.telemetryDao().outboxBySampleId("rejected"))
        assertEquals(setOf("in-flight", "pending"), repository.pendingTripIds().toSet())
    }

    private suspend fun createTripWithWindow(tripId: String, sampleId: String) {
        repository.createTrip(tripId, "device", "vehicle", 1_000L)
        repository.setTripState(tripId, TripState.ACTIVE)
        repository.commitWindowAndAdvanceCursor(tripId, sampleId, 2_000, 3_000, "{}", 2_001)
    }
}
