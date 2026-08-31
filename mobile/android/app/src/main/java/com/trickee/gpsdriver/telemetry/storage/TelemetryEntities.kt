package com.trickee.gpsdriver.telemetry.storage

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverter

enum class TripState { CREATED_LOCAL, START_PENDING, ACTIVE, ENDING, SYNC_PENDING, FINALIZING, COMPLETED, CAPTURE_FAILED }
enum class OutboxState { PENDING, IN_FLIGHT, ACKED, PERMANENTLY_REJECTED }

class TelemetryConverters {
    @TypeConverter fun tripState(value: String): TripState = TripState.valueOf(value)
    @TypeConverter fun tripState(value: TripState): String = value.name
    @TypeConverter fun outboxState(value: String): OutboxState = OutboxState.valueOf(value)
    @TypeConverter fun outboxState(value: OutboxState): String = value.name
}

@Entity(tableName = "local_trips")
data class LocalTripEntity(
    @PrimaryKey @ColumnInfo(name = "trip_id") val tripId: String,
    @ColumnInfo(name = "device_id") val deviceId: String,
    @ColumnInfo(name = "vehicle_id") val vehicleId: String,
    val state: TripState,
    @ColumnInfo(name = "next_sequence_no") val nextSequenceNo: Long,
    @ColumnInfo(name = "final_sequence_no") val finalSequenceNo: Long?,
    @ColumnInfo(name = "started_at_utc_ms") val startedAtUtcMs: Long,
    @ColumnInfo(name = "ended_at_utc_ms") val endedAtUtcMs: Long?,
)

@Entity(
    tableName = "telemetry_outbox",
    indices = [
        Index(value = ["trip_id", "sequence_no"], unique = true),
        Index(value = ["trip_id", "state", "next_attempt_at_utc_ms"]),
        Index(value = ["state", "lease_until_utc_ms"]),
    ],
)
data class TelemetryOutboxEntity(
    @PrimaryKey @ColumnInfo(name = "sample_id") val sampleId: String,
    @ColumnInfo(name = "trip_id") val tripId: String,
    @ColumnInfo(name = "sequence_no") val sequenceNo: Long,
    @ColumnInfo(name = "event_time_utc_ms") val eventTimeUtcMs: Long,
    @ColumnInfo(name = "monotonic_time_ns") val monotonicTimeNs: Long,
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    val state: OutboxState,
    @ColumnInfo(name = "attempt_count") val attemptCount: Int,
    @ColumnInfo(name = "next_attempt_at_utc_ms") val nextAttemptAtUtcMs: Long,
    @ColumnInfo(name = "lease_until_utc_ms") val leaseUntilUtcMs: Long?,
    @ColumnInfo(name = "server_committed_at_utc_ms") val serverCommittedAtUtcMs: Long?,
    @ColumnInfo(name = "created_at_utc_ms") val createdAtUtcMs: Long,
    @ColumnInfo(name = "rejection_code") val rejectionCode: String?,
    @ColumnInfo(name = "last_http_status") val lastHttpStatus: Int?,
    @ColumnInfo(name = "last_error_code") val lastErrorCode: String?,
    @ColumnInfo(name = "last_error_detail") val lastErrorDetail: String?,
    @ColumnInfo(name = "last_failure_at_utc_ms") val lastFailureAtUtcMs: Long?,
    @ColumnInfo(name = "permanently_rejected_at_utc_ms") val permanentlyRejectedAtUtcMs: Long?,
)

enum class StoragePressureLevel { NORMAL, WARNING, OPTIONAL_CAPTURE_BLOCKED, CRITICAL }

data class StoragePressure(
    val level: StoragePressureLevel,
    val databaseBytes: Long,
    val availableBytes: Long,
)

data class AckDecision(
    val acknowledged: Set<Long>,
    val permanentlyRejected: Set<Long>,
    val pending: Set<Long>,
)

object OutboxAckPolicy {
    fun classify(
        sequences: Collection<Long>,
        highestContiguousSequence: Long,
        acceptedSequences: Set<Long>,
        duplicateSequences: Set<Long>,
        permanentRejections: Set<Long>,
    ): AckDecision {
        require(highestContiguousSequence >= 0)
        val rejected = sequences.filterTo(mutableSetOf()) { it in permanentRejections }
        val acknowledged = sequences.filterTo(mutableSetOf()) {
            it !in rejected && (
                it <= highestContiguousSequence ||
                    it in acceptedSequences ||
                    it in duplicateSequences
            )
        }
        return AckDecision(
            acknowledged = acknowledged,
            permanentlyRejected = rejected,
            pending = sequences.toSet() - acknowledged - rejected,
        )
    }
}
