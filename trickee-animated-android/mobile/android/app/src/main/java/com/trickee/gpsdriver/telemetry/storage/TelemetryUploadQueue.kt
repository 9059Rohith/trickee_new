package com.trickee.gpsdriver.telemetry.storage

interface TelemetryUploadQueue {
    suspend fun leasePending(
        tripId: String,
        nowUtcMs: Long,
        limit: Int,
        leaseMs: Long,
    ): List<TelemetryOutboxEntity>

    suspend fun applyAcknowledgement(
        tripId: String,
        leasedRows: List<TelemetryOutboxEntity>,
        highestContiguousSequence: Long,
        acceptedSequences: Set<Long>,
        duplicateSequences: Set<Long>,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    )

    suspend fun recordRetry(
        rows: List<TelemetryOutboxEntity>,
        nextAttemptAtUtcMs: Long,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    )

    suspend fun deadLetter(
        row: TelemetryOutboxEntity,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    )
}
