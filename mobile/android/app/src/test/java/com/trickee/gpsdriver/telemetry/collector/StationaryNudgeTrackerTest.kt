package com.trickee.gpsdriver.telemetry.collector

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StationaryNudgeTrackerTest {
    @Test
    fun `prompts once after seven stationary minutes`() {
        val tracker = StationaryNudgeTracker(stationaryThresholdMs = 420_000)
        tracker.start(nowMs = 1_000, latitude = 21.1702, longitude = 72.8311)

        assertFalse(tracker.observe(420_999, 21.1702, 72.8311, 0.0))
        assertTrue(tracker.observe(421_000, 21.1702, 72.8311, 0.0))
        assertFalse(tracker.observe(430_000, 21.1702, 72.8311, 0.0))
    }

    @Test
    fun `waiting acknowledgement suppresses repeats until movement resumes`() {
        val tracker = StationaryNudgeTracker(stationaryThresholdMs = 420_000)
        tracker.start(nowMs = 0, latitude = 21.1702, longitude = 72.8311)
        assertTrue(tracker.observe(420_000, 21.1702, 72.8311, 0.0))

        tracker.acknowledgeWaiting()
        assertFalse(tracker.observe(900_000, 21.1702, 72.8311, 0.0))

        assertFalse(tracker.observe(901_000, 21.1710, 72.8311, 4.0))
        assertFalse(tracker.observe(1_320_999, 21.1710, 72.8311, 0.0))
        assertTrue(tracker.observe(1_321_000, 21.1710, 72.8311, 0.0))
    }
}
