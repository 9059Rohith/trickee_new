package com.trickee.gpsdriver.telemetry.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class OutboxAckPolicyTest {
    @Test
    fun acceptedRowsAreAcknowledgedWhenContiguousCursorIsBlocked() {
        val decision = OutboxAckPolicy.classify(
            sequences = (1L..20L).toList(),
            highestContiguousSequence = 0L,
            acceptedSequences = setOf(7L, 8L, 9L, 20L),
            duplicateSequences = emptySet(),
            permanentRejections = emptySet(),
        )

        assertEquals(setOf(7L, 8L, 9L, 20L), decision.acknowledged)
        assertEquals((1L..6L).toSet(), decision.pending.intersect((1L..6L).toSet()))
    }

    @Test
    fun duplicateRowsAreAcknowledgedWhenContiguousCursorIsBlocked() {
        val decision = OutboxAckPolicy.classify(
            sequences = listOf(7L, 8L, 9L),
            highestContiguousSequence = 0L,
            acceptedSequences = emptySet(),
            duplicateSequences = setOf(7L, 8L),
            permanentRejections = emptySet(),
        )

        assertEquals(setOf(7L, 8L), decision.acknowledged)
        assertEquals(setOf(9L), decision.pending)
    }

    @Test
    fun contiguousCursorAcknowledgesOnlyRowsAtOrBelowTheCursor() {
        val decision = OutboxAckPolicy.classify(
            sequences = listOf(1L, 2L, 3L, 4L),
            highestContiguousSequence = 2L,
            acceptedSequences = emptySet(),
            duplicateSequences = emptySet(),
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
            acceptedSequences = emptySet(),
            duplicateSequences = emptySet(),
            permanentRejections = setOf(2L),
        )

        assertEquals(setOf(1L), decision.acknowledged)
        assertEquals(setOf(2L), decision.permanentlyRejected)
        assertEquals(setOf(3L), decision.pending)
    }
}
