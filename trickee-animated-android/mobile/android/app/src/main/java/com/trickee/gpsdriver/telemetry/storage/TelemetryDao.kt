package com.trickee.gpsdriver.telemetry.storage

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

    @Query("SELECT * FROM local_trips WHERE state = 'ACTIVE' ORDER BY started_at_utc_ms DESC LIMIT 1")
    abstract suspend fun activeTrip(): LocalTripEntity?

    @Query("SELECT * FROM local_trips WHERE state = 'ENDING' ORDER BY started_at_utc_ms DESC LIMIT 1")
    abstract suspend fun endingTrip(): LocalTripEntity?

    @Query("SELECT t.* FROM local_trips t WHERE EXISTS (SELECT 1 FROM telemetry_outbox o WHERE o.trip_id = t.trip_id AND o.state IN ('PENDING', 'IN_FLIGHT')) ORDER BY t.started_at_utc_ms ASC LIMIT 1")
    abstract suspend fun tripWithPendingOutbox(): LocalTripEntity?

    @Query("SELECT t.* FROM local_trips t JOIN telemetry_outbox o ON o.trip_id = t.trip_id WHERE o.next_attempt_at_utc_ms <= :nowUtcMs AND (o.state = 'PENDING' OR (o.state = 'IN_FLIGHT' AND o.lease_until_utc_ms < :nowUtcMs)) ORDER BY o.created_at_utc_ms ASC, o.sequence_no ASC LIMIT 1")
    abstract suspend fun tripWithEligibleOutbox(nowUtcMs: Long): LocalTripEntity?

    @Query("SELECT DISTINCT trip_id FROM telemetry_outbox WHERE state IN ('PENDING', 'IN_FLIGHT') ORDER BY trip_id")
    abstract suspend fun pendingTripIds(): List<String>

    @Query("SELECT * FROM local_trips WHERE final_sequence_no IS NOT NULL ORDER BY ended_at_utc_ms DESC LIMIT 1")
    abstract suspend fun latestEndedTrip(): LocalTripEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    protected abstract suspend fun insertOutbox(row: TelemetryOutboxEntity)

    @Query("SELECT * FROM telemetry_outbox WHERE sample_id = :sampleId")
    abstract suspend fun outboxBySampleId(sampleId: String): TelemetryOutboxEntity?

    @Query("SELECT * FROM telemetry_outbox WHERE trip_id = :tripId ORDER BY sequence_no")
    abstract suspend fun outboxForTrip(tripId: String): List<TelemetryOutboxEntity>

    @Query("""
        UPDATE telemetry_outbox
        SET state = 'PENDING', lease_until_utc_ms = NULL, next_attempt_at_utc_ms = :nowUtcMs
        WHERE trip_id = :tripId
          AND (
            state = 'PENDING'
            OR (state = 'IN_FLIGHT' AND (lease_until_utc_ms IS NULL OR lease_until_utc_ms <= :nowUtcMs))
          )
    """)
    abstract suspend fun prepareDiagnosticRetry(tripId: String, nowUtcMs: Long): Int

    @Query("""
        SELECT * FROM telemetry_outbox
        WHERE state = 'PERMANENTLY_REJECTED'
          AND (last_http_status = 422 OR rejection_code = 'HTTP_422')
          AND (:tripId IS NULL OR trip_id = :tripId)
        ORDER BY created_at_utc_ms ASC, sequence_no ASC
    """)
    abstract suspend fun repairableContractRejections(tripId: String?): List<TelemetryOutboxEntity>

    @Query("""
        UPDATE telemetry_outbox
        SET payload_json = :payloadJson,
            state = 'PENDING',
            attempt_count = 0,
            next_attempt_at_utc_ms = :nowUtcMs,
            lease_until_utc_ms = NULL,
            rejection_code = NULL,
            last_http_status = NULL,
            last_error_code = 'HTTP_422_REPAIRED',
            last_error_detail = 'Known Android telemetry contract mismatch repaired',
            last_failure_at_utc_ms = NULL,
            permanently_rejected_at_utc_ms = NULL
        WHERE sample_id = :sampleId AND state = 'PERMANENTLY_REJECTED'
    """)
    abstract suspend fun requeueRepairedContractRow(
        sampleId: String,
        payloadJson: String,
        nowUtcMs: Long,
    ): Int

    @Query("UPDATE local_trips SET next_sequence_no = :next WHERE trip_id = :tripId AND next_sequence_no = :expected")
    protected abstract suspend fun advanceCursor(tripId: String, expected: Long, next: Long): Int

    @Query("UPDATE local_trips SET state = 'ENDING' WHERE trip_id = :tripId AND state = 'ACTIVE' AND final_sequence_no IS NULL")
    protected abstract suspend fun markEnding(tripId: String): Int

    @Query("UPDATE local_trips SET state = 'SYNC_PENDING' WHERE trip_id = :tripId AND final_sequence_no IS NOT NULL AND state IN ('CREATED_LOCAL', 'START_PENDING', 'ACTIVE', 'ENDING')")
    protected abstract suspend fun normalizeLegacySealedTrip(tripId: String): Int

    @Transaction
    open suspend fun beginEnding(tripId: String) {
        val trip = requireNotNull(trip(tripId)) { "Trip not found" }
        val targetState = TripEndRecoveryPolicy.stateAfterStopRequest(trip.state, trip.finalSequenceNo)
        if (targetState == TripState.SYNC_PENDING && trip.state != TripState.SYNC_PENDING) {
            check(normalizeLegacySealedTrip(tripId) == 1) { "Sealed trip state changed concurrently" }
            return
        }
        if (trip.finalSequenceNo != null || trip.state == TripState.ENDING) return
        require(trip.state == TripState.ACTIVE) { "Only an active trip can begin ending" }
        check(markEnding(tripId) == 1) { "Trip state changed concurrently" }
    }

    @Query("UPDATE local_trips SET state = 'SYNC_PENDING', final_sequence_no = :finalSequenceNo, ended_at_utc_ms = :endedAtUtcMs WHERE trip_id = :tripId AND state = 'ENDING' AND final_sequence_no IS NULL")
    protected abstract suspend fun markSealed(
        tripId: String,
        finalSequenceNo: Long,
        endedAtUtcMs: Long,
    ): Int

    @Transaction
    open suspend fun sealTrip(tripId: String, endedAtUtcMs: Long): Long {
        val trip = requireNotNull(trip(tripId)) { "Trip not found" }
        trip.finalSequenceNo?.let { return it }
        require(trip.state == TripState.ENDING) { "Trip must be ending before seal" }
        val finalSequence = trip.nextSequenceNo - 1
        check(markSealed(tripId, finalSequence, endedAtUtcMs) == 1) { "Trip state changed concurrently" }
        return finalSequence
    }

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
        require(
            trip.state in setOf(
                TripState.CREATED_LOCAL,
                TripState.START_PENDING,
                TripState.ACTIVE,
                TripState.ENDING,
            )
        ) { "Trip is not writable" }
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
                lastHttpStatus = null,
                lastErrorCode = null,
                lastErrorDetail = null,
                lastFailureAtUtcMs = null,
                permanentlyRejectedAtUtcMs = null,
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

    @Query("UPDATE telemetry_outbox SET state = 'PENDING', lease_until_utc_ms = NULL, next_attempt_at_utc_ms = :nextAttemptAtUtcMs, last_http_status = :httpStatus, last_error_code = :errorCode, last_error_detail = :errorDetail, last_failure_at_utc_ms = :failedAtUtcMs WHERE sample_id IN (:sampleIds) AND state = 'IN_FLIGHT'")
    abstract suspend fun recordRetry(
        sampleIds: List<String>,
        nextAttemptAtUtcMs: Long,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    ): Int

    @Query("UPDATE telemetry_outbox SET state = 'PERMANENTLY_REJECTED', lease_until_utc_ms = NULL, rejection_code = :errorCode, last_http_status = :httpStatus, last_error_code = :errorCode, last_error_detail = :errorDetail, last_failure_at_utc_ms = :failedAtUtcMs, permanently_rejected_at_utc_ms = :failedAtUtcMs WHERE sample_id = :sampleId AND state = 'IN_FLIGHT'")
    abstract suspend fun deadLetter(
        sampleId: String,
        httpStatus: Int?,
        errorCode: String,
        errorDetail: String,
        failedAtUtcMs: Long,
    ): Int

    @Query("UPDATE telemetry_outbox SET state = 'ACKED', lease_until_utc_ms = NULL, server_committed_at_utc_ms = :serverCommittedAtUtcMs, last_http_status = NULL, last_error_code = NULL, last_error_detail = NULL, last_failure_at_utc_ms = NULL WHERE trip_id = :tripId AND sequence_no <= :highestContiguousSequence AND state != 'PERMANENTLY_REJECTED'")
    abstract suspend fun acknowledgeThrough(tripId: String, highestContiguousSequence: Long, serverCommittedAtUtcMs: Long): Int

    @Query("UPDATE telemetry_outbox SET state = 'ACKED', lease_until_utc_ms = NULL, server_committed_at_utc_ms = :serverCommittedAtUtcMs, last_http_status = NULL, last_error_code = NULL, last_error_detail = NULL, last_failure_at_utc_ms = NULL WHERE trip_id = :tripId AND sequence_no IN (:sequences) AND state != 'PERMANENTLY_REJECTED'")
    protected abstract suspend fun acknowledgeSequences(
        tripId: String,
        sequences: List<Long>,
        serverCommittedAtUtcMs: Long,
    ): Int

    @Query("UPDATE telemetry_outbox SET state = 'PERMANENTLY_REJECTED', lease_until_utc_ms = NULL, rejection_code = :code, last_error_code = :code, last_failure_at_utc_ms = :failedAtUtcMs, permanently_rejected_at_utc_ms = :failedAtUtcMs WHERE trip_id = :tripId AND sequence_no = :sequenceNo")
    protected abstract suspend fun permanentlyReject(
        tripId: String,
        sequenceNo: Long,
        code: String,
        failedAtUtcMs: Long,
    ): Int

    @Transaction
    open suspend fun applyAcknowledgement(
        tripId: String,
        leasedRows: List<TelemetryOutboxEntity>,
        highestContiguousSequence: Long,
        acceptedSequences: Set<Long>,
        duplicateSequences: Set<Long>,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    ) {
        val decision = OutboxAckPolicy.classify(
            sequences = leasedRows.map { it.sequenceNo },
            highestContiguousSequence = highestContiguousSequence,
            acceptedSequences = acceptedSequences,
            duplicateSequences = duplicateSequences,
            permanentRejections = permanentRejections.keys,
        )
        decision.permanentlyRejected.forEach { sequence ->
            permanentlyReject(
                tripId = tripId,
                sequenceNo = sequence,
                code = requireNotNull(permanentRejections[sequence]),
                failedAtUtcMs = serverCommittedAtUtcMs,
            )
        }
        acknowledgeThrough(tripId, highestContiguousSequence, serverCommittedAtUtcMs)
        val exactAcknowledged = decision.acknowledged.filter { it > highestContiguousSequence }
        if (exactAcknowledged.isNotEmpty()) {
            acknowledgeSequences(tripId, exactAcknowledged, serverCommittedAtUtcMs)
        }
        val pendingSampleIds = leasedRows
            .filter { it.sequenceNo in decision.pending }
            .map { it.sampleId }
        if (pendingSampleIds.isNotEmpty()) {
            releaseForRetry(pendingSampleIds, serverCommittedAtUtcMs)
        }
    }

    @Transaction
    open suspend fun applyLegacyAcknowledgement(
        tripId: String,
        highestContiguousSequence: Long,
        permanentRejections: Map<Long, String>,
        serverCommittedAtUtcMs: Long,
    ) {
        permanentRejections.forEach { (sequence, code) ->
            permanentlyReject(tripId, sequence, code, serverCommittedAtUtcMs)
        }
        acknowledgeThrough(tripId, highestContiguousSequence, serverCommittedAtUtcMs)
    }

    @Query("DELETE FROM telemetry_outbox WHERE state = 'ACKED' AND server_committed_at_utc_ms < :cutoffUtcMs")
    abstract suspend fun purgeAckedBefore(cutoffUtcMs: Long): Int

    @Query("SELECT COUNT(*) FROM telemetry_outbox WHERE trip_id = :tripId AND state IN ('PENDING', 'IN_FLIGHT')")
    abstract suspend fun pendingCount(tripId: String): Int

    @Query("UPDATE local_trips SET state = 'ACTIVE' WHERE trip_id = :tripId AND final_sequence_no IS NULL AND state IN ('CREATED_LOCAL', 'START_PENDING', 'ACTIVE')")
    abstract suspend fun activateForCapture(tripId: String): Int
}
