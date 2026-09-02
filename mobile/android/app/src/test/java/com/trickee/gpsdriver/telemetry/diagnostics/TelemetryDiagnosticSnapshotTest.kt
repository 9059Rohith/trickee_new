package com.trickee.gpsdriver.telemetry.diagnostics

import com.google.gson.Gson
import com.trickee.gpsdriver.telemetry.storage.LocalTripEntity
import com.trickee.gpsdriver.telemetry.storage.OutboxState
import com.trickee.gpsdriver.telemetry.storage.TelemetryOutboxEntity
import com.trickee.gpsdriver.telemetry.storage.TripState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryDiagnosticSnapshotTest {
    @Test
    fun snapshotReportsExactStatesAndLocalGapsWithoutPrivatePayloadData() {
        val trip = LocalTripEntity(
            tripId = "trip-visible",
            deviceId = "device-private",
            vehicleId = "vehicle-private",
            state = TripState.SYNC_PENDING,
            nextSequenceNo = 5,
            finalSequenceNo = 4,
            startedAtUtcMs = 1_000,
            endedAtUtcMs = 5_000,
        )
        val rows = listOf(
            row(1, OutboxState.ACKED, payload = "gps-private-1"),
            row(
                3,
                OutboxState.PENDING,
                payload = "gps-private-3",
                errorDetail = "Bearer secret-access-token token=secret-refresh-token " +
                    "{\"refresh_token\":\"json-secret-token\"}",
            ),
            row(4, OutboxState.PERMANENTLY_REJECTED, payload = "gps-private-4"),
        )

        val snapshot = TelemetryDiagnosticSnapshot.create(
            trip = trip,
            rows = rows,
            generatedAtUtcMs = 6_000,
            appVersion = "1.0.7",
            packageName = "com.trickee.gpsdriverapp",
        )

        assertEquals(1, snapshot.stateCounts["ACKED"])
        assertEquals(1, snapshot.stateCounts["PENDING"])
        assertEquals(0, snapshot.stateCounts["IN_FLIGHT"])
        assertEquals(1, snapshot.stateCounts["PERMANENTLY_REJECTED"])
        assertEquals(listOf(listOf(2L, 2L)), snapshot.localMissingRanges)
        assertEquals(listOf(1L, 3L, 4L), snapshot.rows.map { it.sequenceNo })

        val json = Gson().toJson(snapshot)
        assertTrue(json.contains("trip-visible"))
        assertTrue(json.contains("[REDACTED]"))
        assertFalse(json.contains("gps-private"))
        assertFalse(json.contains("sample-private"))
        assertFalse(json.contains("device-private"))
        assertFalse(json.contains("vehicle-private"))
        assertFalse(json.contains("secret-access-token"))
        assertFalse(json.contains("secret-refresh-token"))
        assertFalse(json.contains("json-secret-token"))
    }

    private fun row(
        sequence: Long,
        state: OutboxState,
        payload: String,
        errorDetail: String? = null,
    ) = TelemetryOutboxEntity(
        sampleId = "sample-private-$sequence",
        tripId = "trip-visible",
        sequenceNo = sequence,
        eventTimeUtcMs = 2_000 + sequence,
        monotonicTimeNs = 3_000 + sequence,
        payloadJson = payload,
        state = state,
        attemptCount = sequence.toInt(),
        nextAttemptAtUtcMs = 4_000 + sequence,
        leaseUntilUtcMs = null,
        serverCommittedAtUtcMs = if (state == OutboxState.ACKED) 4_500 else null,
        createdAtUtcMs = 2_000 + sequence,
        rejectionCode = if (state == OutboxState.PERMANENTLY_REJECTED) "HTTP_422" else null,
        lastHttpStatus = if (state == OutboxState.PERMANENTLY_REJECTED) 422 else null,
        lastErrorCode = if (errorDetail == null) null else "AUTH_REFRESH_FAILED",
        lastErrorDetail = errorDetail,
        lastFailureAtUtcMs = if (errorDetail == null) null else 4_700,
        permanentlyRejectedAtUtcMs = if (state == OutboxState.PERMANENTLY_REJECTED) 4_800 else null,
    )
}
