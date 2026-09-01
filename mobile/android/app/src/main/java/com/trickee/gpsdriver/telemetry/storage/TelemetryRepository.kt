package com.trickee.gpsdriver.telemetry.storage

class TelemetryRepository(private val dao: TelemetryDao) : TelemetryUploadQueue {
    suspend fun createTrip(tripId: String, deviceId: String, vehicleId: String, startedAtUtcMs: Long) {
        dao.insertTrip(
            LocalTripEntity(
                tripId = tripId,
                deviceId = deviceId,
                vehicleId = vehicleId,
                state = TripState.CREATED_LOCAL,
                nextSequenceNo = 1,
                finalSequenceNo = null,
                startedAtUtcMs = startedAtUtcMs,
                endedAtUtcMs = null,
            )
        )
    }

    suspend fun commitWindowAndAdvanceCursor(
        tripId: String,
        sampleId: String,
        eventTimeUtcMs: Long,
        monotonicTimeNs: Long,
        payloadJson: String,
        createdAtUtcMs: Long,
    ): Long = dao.commitWindowAndAdvanceCursor(
        tripId, sampleId, eventTimeUtcMs, monotonicTimeNs, payloadJson, createdAtUtcMs
    )

    override suspend fun leasePending(tripId: String, nowUtcMs: Long, limit: Int, leaseMs: Long) =
        dao.leasePending(tripId, nowUtcMs, limit, leaseMs)

    suspend fun applyAcknowledgement(
        tripId: String,
        highestContiguousSequence: Long,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    ) = dao.applyLegacyAcknowledgement(
        tripId,
        highestContiguousSequence,
        permanentRejections,
        serverCommittedAtUtcMs,
    )

    override suspend fun applyAcknowledgement(
        tripId: String,
        leasedRows: List<TelemetryOutboxEntity>,
        highestContiguousSequence: Long,
        acceptedSequences: Set<Long>,
        duplicateSequences: Set<Long>,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    ) = dao.applyAcknowledgement(
        tripId,
        leasedRows,
        highestContiguousSequence,
        acceptedSequences,
        duplicateSequences,
        permanentRejections,
        serverCommittedAtUtcMs,
    )

    override suspend fun recordRetry(
        rows: List<TelemetryOutboxEntity>,
        nextAttemptAtUtcMs: Long,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    ) {
        if (rows.isEmpty()) return
        dao.recordRetry(
            sampleIds = rows.map { it.sampleId },
            nextAttemptAtUtcMs = nextAttemptAtUtcMs,
            httpStatus = httpStatus,
            errorCode = errorCode,
            errorDetail = errorDetail.take(MAX_ERROR_DETAIL_LENGTH),
            failedAtUtcMs = failedAtUtcMs,
        )
    }

    override suspend fun deadLetter(
        row: TelemetryOutboxEntity,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    ) {
        dao.deadLetter(
            sampleId = row.sampleId,
            httpStatus = httpStatus,
            errorCode = errorCode,
            errorDetail = errorDetail.take(MAX_ERROR_DETAIL_LENGTH),
            failedAtUtcMs = failedAtUtcMs,
        )
    }

    suspend fun beginEnding(tripId: String) = dao.beginEnding(tripId)
    suspend fun sealTrip(tripId: String, endedAtUtcMs: Long): Long = dao.sealTrip(tripId, endedAtUtcMs)

    suspend fun recordEnd(tripId: String, finalSequenceNo: Long, endedAtUtcMs: Long) {
        beginEnding(tripId)
        check(sealTrip(tripId, endedAtUtcMs) == finalSequenceNo) { "Final sequence changed while sealing" }
    }

    suspend fun recoverExpiredLeases(nowUtcMs: Long): Int = dao.recoverExpiredLeases(nowUtcMs)
    suspend fun releaseForRetry(sampleIds: List<String>, nextAttemptAtUtcMs: Long): Int =
        if (sampleIds.isEmpty()) 0 else dao.releaseForRetry(sampleIds, nextAttemptAtUtcMs)
    suspend fun rejectBatch(tripId: String, rows: List<TelemetryOutboxEntity>, code: String) {
        dao.applyLegacyAcknowledgement(
            tripId = tripId,
            highestContiguousSequence = 0,
            permanentRejections = rows.associate { it.sequenceNo to code },
            serverCommittedAtUtcMs = System.currentTimeMillis(),
        )
    }
    suspend fun purgeAcknowledged(nowUtcMs: Long): Int =
        dao.purgeAckedBefore(nowUtcMs - ACK_RETENTION_MS)
    suspend fun activeTrip(): LocalTripEntity? = dao.activeTrip()
    suspend fun endingTrip(): LocalTripEntity? = dao.endingTrip()
    suspend fun tripWithPendingOutbox(): LocalTripEntity? = dao.tripWithPendingOutbox()
    suspend fun latestEndedTrip(): LocalTripEntity? = dao.latestEndedTrip()
    suspend fun trip(tripId: String): LocalTripEntity? = dao.trip(tripId)
    suspend fun pendingCount(tripId: String): Int = dao.pendingCount(tripId)
    suspend fun pendingTripIds(): List<String> = dao.pendingTripIds()
    suspend fun setTripState(tripId: String, state: TripState) {
        check(dao.setTripState(tripId, state) == 1) { "Trip not found" }
    }

    fun storagePressure(databaseBytes: Long, availableBytes: Long): StoragePressure =
        TelemetryStoragePolicy.evaluate(databaseBytes, availableBytes)

    private companion object {
        const val ACK_RETENTION_MS = 24L * 60L * 60L * 1_000L
        const val MAX_ERROR_DETAIL_LENGTH = 255
    }
}
