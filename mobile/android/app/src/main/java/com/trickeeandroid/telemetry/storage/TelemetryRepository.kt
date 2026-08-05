package com.trickeeandroid.telemetry.storage

class TelemetryRepository(private val dao: TelemetryDao) {
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

    suspend fun leasePending(tripId: String, nowUtcMs: Long, limit: Int, leaseMs: Long) =
        dao.leasePending(tripId, nowUtcMs, limit, leaseMs)

    suspend fun applyAcknowledgement(
        tripId: String,
        highestContiguousSequence: Long,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    ) {
        permanentRejections.forEach { (sequence, code) ->
            dao.permanentlyReject(tripId, sequence, code)
        }
        dao.acknowledgeThrough(tripId, highestContiguousSequence, serverCommittedAtUtcMs)
    }

    suspend fun recordEnd(tripId: String, finalSequenceNo: Long, endedAtUtcMs: Long) {
        check(dao.recordEnd(tripId, TripState.SYNC_PENDING, finalSequenceNo, endedAtUtcMs) == 1) {
            "Trip not found"
        }
    }

    suspend fun recoverExpiredLeases(nowUtcMs: Long): Int = dao.recoverExpiredLeases(nowUtcMs)
    suspend fun releaseForRetry(sampleIds: List<String>, nextAttemptAtUtcMs: Long): Int =
        if (sampleIds.isEmpty()) 0 else dao.releaseForRetry(sampleIds, nextAttemptAtUtcMs)
    suspend fun rejectBatch(tripId: String, rows: List<TelemetryOutboxEntity>, code: String) {
        rows.forEach { dao.permanentlyReject(tripId, it.sequenceNo, code) }
    }
    suspend fun purgeAckedBefore(cutoffUtcMs: Long): Int = dao.purgeAckedBefore(cutoffUtcMs)
    suspend fun activeTrip(): LocalTripEntity? = dao.activeTrip()
    suspend fun tripWithPendingOutbox(): LocalTripEntity? = dao.tripWithPendingOutbox()
    suspend fun latestEndedTrip(): LocalTripEntity? = dao.latestEndedTrip()
    suspend fun trip(tripId: String): LocalTripEntity? = dao.trip(tripId)
    suspend fun pendingCount(tripId: String): Int = dao.pendingCount(tripId)
    suspend fun setTripState(tripId: String, state: TripState) {
        check(dao.setTripState(tripId, state) == 1) { "Trip not found" }
    }

    fun storagePressure(usedBytes: Long, maxBytes: Long = 2L * 1024 * 1024 * 1024): StoragePressure {
        require(usedBytes >= 0 && maxBytes > 0)
        val pct = (usedBytes.toDouble() * 100.0 / maxBytes).coerceAtMost(100.0)
        val level = when {
            pct >= 95 -> StoragePressureLevel.CRITICAL
            pct >= 85 -> StoragePressureLevel.OPTIONAL_CAPTURE_BLOCKED
            pct >= 75 -> StoragePressureLevel.WARNING
            else -> StoragePressureLevel.NORMAL
        }
        return StoragePressure(level, pct)
    }
}
