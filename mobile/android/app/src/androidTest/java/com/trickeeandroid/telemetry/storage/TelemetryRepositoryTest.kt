package com.trickeeandroid.telemetry.storage

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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
}
