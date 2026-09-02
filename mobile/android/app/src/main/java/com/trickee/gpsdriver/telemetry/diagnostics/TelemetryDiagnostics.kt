package com.trickee.gpsdriver.telemetry.diagnostics

import com.google.gson.annotations.SerializedName
import com.trickee.gpsdriver.telemetry.storage.LocalTripEntity
import com.trickee.gpsdriver.telemetry.storage.OutboxState
import com.trickee.gpsdriver.telemetry.storage.TelemetryOutboxEntity

data class TelemetryDiagnosticTrip(
    @SerializedName("trip_id") val tripId: String,
    val state: String,
    @SerializedName("next_sequence_no") val nextSequenceNo: Long,
    @SerializedName("final_sequence_no") val finalSequenceNo: Long?,
    @SerializedName("started_at_utc_ms") val startedAtUtcMs: Long,
    @SerializedName("ended_at_utc_ms") val endedAtUtcMs: Long?,
)

data class TelemetryDiagnosticRow(
    @SerializedName("sequence_no") val sequenceNo: Long,
    val state: String,
    @SerializedName("attempt_count") val attemptCount: Int,
    @SerializedName("next_attempt_at_utc_ms") val nextAttemptAtUtcMs: Long,
    @SerializedName("lease_until_utc_ms") val leaseUntilUtcMs: Long?,
    @SerializedName("server_committed_at_utc_ms") val serverCommittedAtUtcMs: Long?,
    @SerializedName("created_at_utc_ms") val createdAtUtcMs: Long,
    @SerializedName("rejection_code") val rejectionCode: String?,
    @SerializedName("last_http_status") val lastHttpStatus: Int?,
    @SerializedName("last_error_code") val lastErrorCode: String?,
    @SerializedName("last_error_detail") val lastErrorDetail: String?,
    @SerializedName("last_failure_at_utc_ms") val lastFailureAtUtcMs: Long?,
    @SerializedName("permanently_rejected_at_utc_ms") val permanentlyRejectedAtUtcMs: Long?,
)

data class TelemetryDiagnosticSnapshot(
    @SerializedName("schema_version") val schemaVersion: Int,
    @SerializedName("generated_at_utc_ms") val generatedAtUtcMs: Long,
    @SerializedName("app_version") val appVersion: String,
    @SerializedName("package_name") val packageName: String,
    val trip: TelemetryDiagnosticTrip,
    @SerializedName("state_counts") val stateCounts: Map<String, Int>,
    @SerializedName("local_missing_ranges") val localMissingRanges: List<List<Long>>,
    val rows: List<TelemetryDiagnosticRow>,
) {
    companion object {
        fun create(
            trip: LocalTripEntity,
            rows: List<TelemetryOutboxEntity>,
            generatedAtUtcMs: Long,
            appVersion: String,
            packageName: String,
        ): TelemetryDiagnosticSnapshot {
            val sortedRows = rows.sortedBy { it.sequenceNo }
            val counts = OutboxState.entries.associate { state ->
                state.name to sortedRows.count { it.state == state }
            }
            return TelemetryDiagnosticSnapshot(
                schemaVersion = 1,
                generatedAtUtcMs = generatedAtUtcMs,
                appVersion = appVersion,
                packageName = packageName,
                trip = TelemetryDiagnosticTrip(
                    tripId = trip.tripId,
                    state = trip.state.name,
                    nextSequenceNo = trip.nextSequenceNo,
                    finalSequenceNo = trip.finalSequenceNo,
                    startedAtUtcMs = trip.startedAtUtcMs,
                    endedAtUtcMs = trip.endedAtUtcMs,
                ),
                stateCounts = counts,
                localMissingRanges = localMissingRanges(trip.finalSequenceNo, sortedRows),
                rows = sortedRows.map { row ->
                    TelemetryDiagnosticRow(
                        sequenceNo = row.sequenceNo,
                        state = row.state.name,
                        attemptCount = row.attemptCount,
                        nextAttemptAtUtcMs = row.nextAttemptAtUtcMs,
                        leaseUntilUtcMs = row.leaseUntilUtcMs,
                        serverCommittedAtUtcMs = row.serverCommittedAtUtcMs,
                        createdAtUtcMs = row.createdAtUtcMs,
                        rejectionCode = row.rejectionCode,
                        lastHttpStatus = row.lastHttpStatus,
                        lastErrorCode = row.lastErrorCode,
                        lastErrorDetail = DiagnosticPrivacy.sanitize(row.lastErrorDetail),
                        lastFailureAtUtcMs = row.lastFailureAtUtcMs,
                        permanentlyRejectedAtUtcMs = row.permanentlyRejectedAtUtcMs,
                    )
                },
            )
        }

        private fun localMissingRanges(
            finalSequenceNo: Long?,
            rows: List<TelemetryOutboxEntity>,
        ): List<List<Long>> {
            val final = finalSequenceNo ?: return emptyList()
            if (final <= 0) return emptyList()
            val ranges = mutableListOf<List<Long>>()
            var expected = 1L
            rows.asSequence()
                .map { it.sequenceNo }
                .filter { it in 1..final }
                .distinct()
                .forEach { sequence ->
                    if (sequence > expected) ranges += listOf(expected, sequence - 1)
                    if (sequence >= expected) expected = sequence + 1
                }
            if (expected <= final) ranges += listOf(expected, final)
            return ranges
        }
    }
}

private object DiagnosticPrivacy {
    private val bearer = Regex("(?i)\\bBearer\\s+[^\\s,;]+")
    private val jsonSecret = Regex(
        "(?i)([\\\"'])(access[_-]?token|refresh[_-]?token|token|password|secret)\\1\\s*:\\s*([\\\"'])[^\\\"']+\\3",
    )
    private val assignedSecret = Regex(
        "(?i)\\b(access[_-]?token|refresh[_-]?token|token|password|secret)=([^\\s&]+)",
    )

    fun sanitize(detail: String?): String? = detail
        ?.take(MAX_DETAIL_LENGTH)
        ?.replace(bearer, "Bearer [REDACTED]")
        ?.replace(jsonSecret) { match ->
            val keyQuote = match.groupValues[1]
            val valueQuote = match.groupValues[3]
            "$keyQuote${match.groupValues[2]}$keyQuote:$valueQuote[REDACTED]$valueQuote"
        }
        ?.replace(assignedSecret) { match -> "${match.groupValues[1]}=[REDACTED]" }

    private const val MAX_DETAIL_LENGTH = 255
}
