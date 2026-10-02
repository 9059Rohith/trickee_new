package com.trickee.gpsdriver.telemetry.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class TripEndRecoveryPolicyTest {
    @Test
    fun `an active legacy trip with a final sequence resumes as sync pending`() {
        assertEquals(
            TripState.SYNC_PENDING,
            TripEndRecoveryPolicy.stateAfterStopRequest(
                state = TripState.ACTIVE,
                finalSequenceNo = 1_345,
            ),
        )
    }

    @Test
    fun `an unsealed active trip enters ending`() {
        assertEquals(
            TripState.ENDING,
            TripEndRecoveryPolicy.stateAfterStopRequest(
                state = TripState.ACTIVE,
                finalSequenceNo = null,
            ),
        )
    }
}
