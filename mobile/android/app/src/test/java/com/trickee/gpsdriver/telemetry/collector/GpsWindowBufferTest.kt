package com.trickee.gpsdriver.telemetry.collector

import com.trickee.gpsdriver.telemetry.model.GpsPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GpsWindowBufferTest {
    @Test
    fun batchedFixesPopulateTheirOwnOneSecondWindows() {
        val buffer = GpsWindowBuffer()
        buffer.add(listOf(fix(100_000_000L), fix(1_100_000_000L), fix(2_100_000_000L)))

        assertEquals(100_000_000L, buffer.takeBest(0, 1_000_000_000)?.fixMonotonicTimeNs)
        assertEquals(1_100_000_000L, buffer.takeBest(1_000_000_000, 2_000_000_000)?.fixMonotonicTimeNs)
        assertEquals(2_100_000_000L, buffer.takeBest(2_000_000_000, 3_000_000_000)?.fixMonotonicTimeNs)
    }

    @Test
    fun latestFixWinsThenAccuracyBreaksEqualTimestampTie() {
        val buffer = GpsWindowBuffer()
        buffer.add(
            listOf(
                fix(800_000_000L, accuracy = 20.0),
                fix(900_000_000L, accuracy = 30.0),
                fix(900_000_000L, accuracy = 5.0),
            )
        )

        assertEquals(5.0, buffer.takeBest(0, 1_000_000_000)?.horizontalAccuracyM ?: -1.0, 0.0)
    }

    @Test
    fun windowEndBelongsToNextWindowAndOldFixesAreDiscarded() {
        val buffer = GpsWindowBuffer()
        buffer.add(listOf(fix(999_999_999L), fix(1_000_000_000L)))

        assertEquals(999_999_999L, buffer.takeBest(0, 1_000_000_000)?.fixMonotonicTimeNs)
        assertEquals(1_000_000_000L, buffer.takeBest(1_000_000_000, 2_000_000_000)?.fixMonotonicTimeNs)
        assertNull(buffer.takeBest(0, 1_000_000_000))
    }

    private fun fix(timeNs: Long, accuracy: Double = 10.0) = GpsPayload(
        latitude = 23.0225,
        longitude = 72.5714,
        altitudeM = null,
        speedMps = null,
        bearingDeg = null,
        horizontalAccuracyM = accuracy,
        verticalAccuracyM = null,
        provider = "fused",
        isMockLocation = false,
        fixTimeUtcMs = timeNs / 1_000_000,
        fixMonotonicTimeNs = timeNs,
        fixAgeMs = 0,
    )
}
