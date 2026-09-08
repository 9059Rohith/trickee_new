package com.trickee.gpsdriver.telemetry.storage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripCaptureStartPolicyTest {
    @Test
    fun `a repeated start cannot reopen a trip that is ending or sealed`() {
        assertFalse(TripCaptureStartPolicy.canActivate(TripState.ENDING, null))
        assertFalse(TripCaptureStartPolicy.canActivate(TripState.SYNC_PENDING, 120))
        assertFalse(TripCaptureStartPolicy.canActivate(TripState.FINALIZING, 120))
        assertFalse(TripCaptureStartPolicy.canActivate(TripState.COMPLETED, 120))
    }

    @Test
    fun `a new or already active trip remains startable`() {
        assertTrue(TripCaptureStartPolicy.canActivate(TripState.CREATED_LOCAL, null))
        assertTrue(TripCaptureStartPolicy.canActivate(TripState.START_PENDING, null))
        assertTrue(TripCaptureStartPolicy.canActivate(TripState.ACTIVE, null))
    }
}
