package com.trickee.gpsdriver.telemetry.network

import com.google.gson.annotations.SerializedName

internal data class TelemetryAckRejection(
    @SerializedName("sequence_no") val sequenceNo: Long,
    val code: String,
    @SerializedName("sample_id") val sampleId: String? = null,
    val message: String? = null,
)

internal data class TelemetryBatchAck(
    @SerializedName("batch_id") val batchId: String,
    @SerializedName("trip_id") val tripId: String,
    val committed: Boolean,
    @SerializedName("highest_contiguous_sequence") val highestContiguousSequence: Long,
    @SerializedName("accepted_sequences") val acceptedSequences: List<List<Long>>,
    @SerializedName("duplicate_sequences") val duplicateSequences: List<Long>,
    val rejections: List<TelemetryAckRejection>,
    @SerializedName("missing_ranges") val missingRanges: List<List<Long>>,
) {
    fun validateFor(
        expectedBatchId: String,
        expectedTripId: String,
        leasedSequences: Set<Long>,
    ): ValidatedBatchAck {
        require(committed) { "Telemetry ACK is not committed" }
        require(batchId == expectedBatchId) { "Telemetry ACK batch mismatch" }
        require(tripId == expectedTripId) { "Telemetry ACK trip mismatch" }
        require(highestContiguousSequence >= 0) { "Telemetry ACK cursor is invalid" }

        val accepted = expandRanges(acceptedSequences, leasedSequences, "accepted")
        val duplicates = duplicateSequences.toSet()
        require(duplicates.size == duplicateSequences.size) { "Telemetry ACK repeats a duplicate sequence" }
        require(duplicates.all { it in leasedSequences }) { "Telemetry ACK duplicates a sequence outside the lease" }

        val rejected = rejections.associate { rejection ->
            require(rejection.sequenceNo in leasedSequences) {
                "Telemetry ACK rejects a sequence outside the lease"
            }
            require(rejection.code.isNotBlank()) { "Telemetry ACK rejection code is blank" }
            rejection.sequenceNo to rejection.code
        }
        require(rejected.size == rejections.size) { "Telemetry ACK repeats a rejected sequence" }

        val acknowledged = accepted + duplicates
        require(accepted.intersect(duplicates).isEmpty()) {
            "Telemetry ACK marks a sequence accepted and duplicate"
        }
        require(acknowledged.intersect(rejected.keys).isEmpty()) {
            "Telemetry ACK acknowledges and rejects the same sequence"
        }

        return ValidatedBatchAck(
            highestContiguousSequence = highestContiguousSequence,
            acceptedSequences = accepted,
            duplicateSequences = duplicates,
            permanentRejections = rejected,
        )
    }

    private fun expandRanges(
        ranges: List<List<Long>>,
        leasedSequences: Set<Long>,
        label: String,
    ): Set<Long> {
        val expanded = mutableSetOf<Long>()
        ranges.forEach { range ->
            require(range.size == 2) { "Telemetry ACK $label range must contain two bounds" }
            val start = range[0]
            val end = range[1]
            require(start >= 1 && end >= start) { "Telemetry ACK $label range is invalid" }
            require(end - start < leasedSequences.size.toLong().coerceAtLeast(1L)) {
                "Telemetry ACK $label range exceeds the leased batch"
            }
            for (sequence in start..end) {
                require(sequence in leasedSequences) {
                    "Telemetry ACK $label range contains a sequence outside the lease"
                }
                require(expanded.add(sequence)) { "Telemetry ACK repeats an $label sequence" }
            }
        }
        return expanded
    }
}

internal data class ValidatedBatchAck(
    val highestContiguousSequence: Long,
    val acceptedSequences: Set<Long>,
    val duplicateSequences: Set<Long>,
    val permanentRejections: Map<Long, String>,
)
