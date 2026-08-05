package com.trickeeandroid.telemetry.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class OutboxAckPolicyTest {
    @Test
    fun contiguousCursorAcknowledgesOnlyRowsAtOrBelowTheCursor() {
        val decision = OutboxAckPolicy.classify(
            sequences = listOf(1L, 2L, 3L, 4L),
            highestContiguousSequence = 2L,
            permanentRejections = emptySet(),
        )

        assertEquals(setOf(1L, 2L), decision.acknowledged)
        assertEquals(setOf(3L, 4L), decision.pending)
        assertEquals(emptySet<Long>(), decision.permanentlyRejected)
    }

    @Test
    fun permanentRejectionNeverBecomesAcknowledged() {
        val decision = OutboxAckPolicy.classify(
            sequences = listOf(1L, 2L, 3L),
            highestContiguousSequence = 1L,
            permanentRejections = setOf(2L),
        )

        assertEquals(setOf(1L), decision.acknowledged)
        assertEquals(setOf(2L), decision.permanentlyRejected)
        assertEquals(setOf(3L), decision.pending)
    }
}
