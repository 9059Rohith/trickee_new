package com.trickee.gpsdriver.telemetry.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TelemetryBatchAckTest {
    @Test
    fun validatesAndExpandsAcceptedRanges() {
        val ack = ack(
            accepted = listOf(listOf(7L, 9L)),
            duplicates = listOf(10L),
        )

        val result = ack.validateFor(
            expectedBatchId = "batch-1",
            expectedTripId = "trip-1",
            leasedSequences = (7L..10L).toSet(),
        )

        assertEquals(setOf(7L, 8L, 9L), result.acceptedSequences)
        assertEquals(setOf(10L), result.duplicateSequences)
    }

    @Test
    fun rejectsOverlappingAcknowledgementAndRejection() {
        val ack = ack(
            accepted = listOf(listOf(7L, 7L)),
            rejections = listOf(TelemetryAckRejection(7L, "PAYLOAD_CONFLICT")),
        )

        assertThrows(IllegalArgumentException::class.java) {
            ack.validateFor("batch-1", "trip-1", setOf(7L))
        }
    }

    @Test
    fun rejectsAcknowledgementOutsideTheLeasedBatch() {
        val ack = ack(accepted = listOf(listOf(7L, 9L)))

        assertThrows(IllegalArgumentException::class.java) {
            ack.validateFor("batch-1", "trip-1", setOf(7L, 8L))
        }
    }

    @Test
    fun rejectsUncommittedSuccessfulEnvelope() {
        val ack = ack(committed = false)

        assertThrows(IllegalArgumentException::class.java) {
            ack.validateFor("batch-1", "trip-1", emptySet())
        }
    }

    private fun ack(
        committed: Boolean = true,
        accepted: List<List<Long>> = emptyList(),
        duplicates: List<Long> = emptyList(),
        rejections: List<TelemetryAckRejection> = emptyList(),
    ) = TelemetryBatchAck(
        batchId = "batch-1",
        tripId = "trip-1",
        committed = committed,
        highestContiguousSequence = 0L,
        acceptedSequences = accepted,
        duplicateSequences = duplicates,
        rejections = rejections,
        missingRanges = emptyList(),
    )
}
