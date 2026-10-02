package com.trickee.gpsdriver.telemetry.storage

object TripEndRecoveryPolicy {
    fun stateAfterStopRequest(state: TripState, finalSequenceNo: Long?): TripState {
        if (
            finalSequenceNo != null &&
            state in setOf(
                TripState.CREATED_LOCAL,
                TripState.START_PENDING,
                TripState.ACTIVE,
                TripState.ENDING,
            )
        ) {
            return TripState.SYNC_PENDING
        }
        return if (state == TripState.ACTIVE) TripState.ENDING else state
    }
}
