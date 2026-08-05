package com.trickeeandroid.telemetry.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
abstract class TelemetryDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertTrip(trip: LocalTripEntity)

    @Query("SELECT * FROM local_trips WHERE trip_id = :tripId")
    abstract suspend fun trip(tripId: String): LocalTripEntity?

    @Query("SELECT * FROM local_trips WHERE state NOT IN ('COMPLETED', 'CAPTURE_FAILED') ORDER BY started_at_utc_ms DESC LIMIT 1")
    abstract suspend fun recoverableTrip(): LocalTripEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    protected abstract suspend fun insertOutbox(row: TelemetryOutboxEntity)

    @Query("SELECT * FROM telemetry_outbox WHERE sample_id = :sampleId")
    abstract suspend fun outboxBySampleId(sampleId: String): TelemetryOutboxEntity?

    @Query("SELECT * FROM telemetry_outbox WHERE trip_id = :tripId ORDER BY sequence_no")
    abstract suspend fun outboxForTrip(tripId: String): List<TelemetryOutboxEntity>

    @Query("UPDATE local_trips SET next_sequence_no = :next WHERE trip_id = :tripId AND next_sequence_no = :expected")
    protected abstract suspend fun advanceCursor(tripId: String, expected: Long, next: Long): Int

    @Transaction
    open suspend fun commitWindowAndAdvanceCursor(
        tripId: String,
        sampleId: String,
        eventTimeUtcMs: Long,
        monotonicTimeNs: Long,
        payloadJson: String,
        createdAtUtcMs: Long,
    ): Long {
        val trip = requireNotNull(trip(tripId)) { "Trip not found" }
        require(trip.state !in setOf(TripState.COMPLETED, TripState.CAPTURE_FAILED)) { "Trip is not writable" }
        val sequence = trip.nextSequenceNo
        insertOutbox(
            TelemetryOutboxEntity(
                sampleId = sampleId,
                tripId = tripId,
                sequenceNo = sequence,
                eventTimeUtcMs = eventTimeUtcMs,
                monotonicTimeNs = monotonicTimeNs,
                payloadJson = payloadJson,
                state = OutboxState.PENDING,
                attemptCount = 0,
                nextAttemptAtUtcMs = createdAtUtcMs,
                leaseUntilUtcMs = null,
                serverCommittedAtUtcMs = null,
                createdAtUtcMs = createdAtUtcMs,
                rejectionCode = null,
            )
        )
        check(advanceCursor(tripId, sequence, sequence + 1) == 1) { "Trip cursor changed concurrently" }
        return sequence
    }

    @Query("SELECT * FROM telemetry_outbox WHERE trip_id = :tripId AND next_attempt_at_utc_ms <= :nowUtcMs AND (state = 'PENDING' OR (state = 'IN_FLIGHT' AND lease_until_utc_ms < :nowUtcMs)) ORDER BY sequence_no LIMIT :limit")
    protected abstract suspend fun leaseCandidates(tripId: String, nowUtcMs: Long, limit: Int): List<TelemetryOutboxEntity>

    @Query("UPDATE telemetry_outbox SET state = 'IN_FLIGHT', lease_until_utc_ms = :leaseUntilUtcMs, attempt_count = attempt_count + 1 WHERE sample_id = :sampleId AND (state = 'PENDING' OR lease_until_utc_ms < :nowUtcMs)")
    protected abstract suspend fun markLeased(sampleId: String, nowUtcMs: Long, leaseUntilUtcMs: Long): Int

    @Transaction
    open suspend fun leasePending(tripId: String, nowUtcMs: Long, limit: Int, leaseMs: Long): List<TelemetryOutboxEntity> {
        require(limit in 1..100)
        require(leaseMs > 0)
        return leaseCandidates(tripId, nowUtcMs, limit).filter {
            markLeased(it.sampleId, nowUtcMs, nowUtcMs + leaseMs) == 1
        }.map { it.copy(state = OutboxState.IN_FLIGHT, attemptCount = it.attemptCount + 1, leaseUntilUtcMs = nowUtcMs + leaseMs) }
    }

    @Query("UPDATE telemetry_outbox SET state = 'PENDING', lease_until_utc_ms = NULL WHERE state = 'IN_FLIGHT' AND lease_until_utc_ms < :nowUtcMs")
    abstract suspend fun recoverExpiredLeases(nowUtcMs: Long): Int

    @Query("UPDATE telemetry_outbox SET state = 'PENDING', lease_until_utc_ms = NULL, next_attempt_at_utc_ms = :nextAttemptAtUtcMs WHERE sample_id IN (:sampleIds) AND state = 'IN_FLIGHT'")
    abstract suspend fun releaseForRetry(sampleIds: List<String>, nextAttemptAtUtcMs: Long): Int

    @Query("UPDATE telemetry_outbox SET state = 'ACKED', lease_until_utc_ms = NULL, server_committed_at_utc_ms = :serverCommittedAtUtcMs WHERE trip_id = :tripId AND sequence_no <= :highestContiguousSequence AND state != 'PERMANENTLY_REJECTED'")
    abstract suspend fun acknowledgeThrough(tripId: String, highestContiguousSequence: Long, serverCommittedAtUtcMs: Long): Int

    @Query("UPDATE telemetry_outbox SET state = 'PERMANENTLY_REJECTED', lease_until_utc_ms = NULL, rejection_code = :code WHERE trip_id = :tripId AND sequence_no = :sequenceNo")
    abstract suspend fun permanentlyReject(tripId: String, sequenceNo: Long, code: String): Int

    @Query("DELETE FROM telemetry_outbox WHERE state = 'ACKED' AND server_committed_at_utc_ms < :cutoffUtcMs")
    abstract suspend fun purgeAckedBefore(cutoffUtcMs: Long): Int

    @Query("SELECT COUNT(*) FROM telemetry_outbox WHERE trip_id = :tripId AND state IN ('PENDING', 'IN_FLIGHT')")
    abstract suspend fun pendingCount(tripId: String): Int

    @Query("UPDATE local_trips SET state = :state, final_sequence_no = :finalSequenceNo, ended_at_utc_ms = :endedAtUtcMs WHERE trip_id = :tripId")
    abstract suspend fun recordEnd(tripId: String, state: TripState, finalSequenceNo: Long, endedAtUtcMs: Long): Int
}
