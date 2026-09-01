package com.trickee.gpsdriver.telemetry.network

sealed interface UploadFailureDecision {
    data class Retry(val minimumDelayMs: Long? = null) : UploadFailureDecision
    data object RefreshThenRetry : UploadFailureDecision
    data object ReduceBatch : UploadFailureDecision
    data object BisectBatch : UploadFailureDecision
    data object DeadLetterSingle : UploadFailureDecision
}

object UploadFailurePolicy {
    private val contractFailureStatuses = setOf(400, 409, 415, 422)

    fun decide(
        status: Int,
        rowCount: Int,
        retryAfterSeconds: Long?,
    ): UploadFailureDecision {
        require(status in 100..599)
        require(rowCount >= 1)
        if (status == 401) return UploadFailureDecision.RefreshThenRetry
        if (status == 413) return UploadFailureDecision.ReduceBatch
        if (status in contractFailureStatuses) {
            return if (rowCount == 1) {
                UploadFailureDecision.DeadLetterSingle
            } else {
                UploadFailureDecision.BisectBatch
            }
        }
        val retryAfterMs = retryAfterSeconds
            ?.coerceAtLeast(0L)
            ?.times(1_000L)
            ?.coerceAtMost(UploadPolicy.MAX_RETRY_DELAY_MS)
        return UploadFailureDecision.Retry(retryAfterMs)
    }
}
