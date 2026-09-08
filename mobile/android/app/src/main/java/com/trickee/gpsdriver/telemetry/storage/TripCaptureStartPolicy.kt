package com.trickee.gpsdriver.telemetry.storage

/** Prevents a delayed/replayed start command from reopening an ending trip. */
object TripCaptureStartPolicy {
    fun canActivate(state: TripState, finalSequenceNo: Long?): Boolean =
        finalSequenceNo == null && state in setOf(
            TripState.CREATED_LOCAL,
            TripState.START_PENDING,
            TripState.ACTIVE,
        )
}
