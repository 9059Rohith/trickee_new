package com.trickee.gpsdriver.telemetry.network

import com.trickee.gpsdriver.telemetry.security.DeviceSession
import com.trickee.gpsdriver.telemetry.security.DeviceSessionStore
import com.trickee.gpsdriver.telemetry.storage.OutboxState
import com.trickee.gpsdriver.telemetry.storage.TelemetryOutboxEntity
import com.trickee.gpsdriver.telemetry.storage.TelemetryUploadQueue
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TelemetryUploaderTest {
    private lateinit var server: MockWebServer
    private lateinit var queue: FakeUploadQueue
    private lateinit var credentials: FakeSessionStore
    private val batchIds = ArrayDeque(listOf("batch-0", "batch-1", "batch-2", "batch-3"))

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        queue = FakeUploadQueue()
        credentials = FakeSessionStore(
            DeviceSession(
                deviceId = "device-1",
                vehicleId = "vehicle-1",
                apiOrigin = server.url("/").toString().removeSuffix("/"),
                accessToken = "access-old",
                refreshToken = "refresh-old",
            )
        )
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun acceptsRowsAboveABlockedContiguousCursor() = runBlocking {
        queue.rows += row(7)
        queue.rows += row(8)
        server.enqueue(successAck("batch-0", acceptedRanges = "[[7,8]]"))

        assertTrue(uploader().runOnce("trip-1"))

        assertEquals(OutboxState.ACKED, queue.row(7).state)
        assertEquals(OutboxState.ACKED, queue.row(8).state)
        assertEquals(0L, queue.lastContiguousSequence)
    }

    @Test
    fun authorizationAndDeploymentFailuresAreRetriedWithDiagnostics() = runBlocking {
        queue.rows += row(7)
        server.enqueue(MockResponse().setResponseCode(403).setBody("secret bearer token must not persist"))

        assertEquals(false, uploader().runOnce("trip-1"))

        val retained = queue.row(7)
        assertEquals(OutboxState.PENDING, retained.state)
        assertEquals(403, retained.lastHttpStatus)
        assertEquals("HTTP_403", retained.lastErrorCode)
        assertNull(retained.permanentlyRejectedAtUtcMs)
        assertTrue(retained.lastErrorDetail.orEmpty().contains("403"))
        assertEquals(false, retained.lastErrorDetail.orEmpty().contains("secret"))
    }

    @Test
    fun contractFailureBisectsUntilOnlyTheInvalidRowIsDeadLettered() = runBlocking {
        queue.rows += row(1)
        queue.rows += row(2)
        server.enqueue(MockResponse().setResponseCode(422))
        server.enqueue(successAck("batch-1", acceptedRanges = "[[1,1]]"))
        server.enqueue(MockResponse().setResponseCode(422))

        assertTrue(uploader().runOnce("trip-1"))

        assertEquals(OutboxState.ACKED, queue.row(1).state)
        assertEquals(OutboxState.PERMANENTLY_REJECTED, queue.row(2).state)
        assertEquals("HTTP_422", queue.row(2).rejectionCode)
        assertEquals("{}", queue.row(2).payloadJson)
    }

    @Test
    fun refreshesOnceAndRetriesTheSameLeaseAfterUnauthorized() = runBlocking {
        queue.rows += row(1)
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"data":{"device":{},"access_token":"access-new","refresh_token":"refresh-new"}}"""
            )
        )
        server.enqueue(successAck("batch-0", acceptedRanges = "[[1,1]]"))

        assertTrue(uploader().runOnce("trip-1"))

        assertEquals(OutboxState.ACKED, queue.row(1).state)
        assertEquals("access-new", credentials.load()?.accessToken)
        assertEquals(3, server.requestCount)
    }

    @Test
    fun malformedSuccessAckRetainsRowsForRetry() = runBlocking {
        queue.rows += row(1)
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"data\":{\"committed\":true}}"))

        assertEquals(false, uploader().runOnce("trip-1"))

        assertEquals(OutboxState.PENDING, queue.row(1).state)
        assertEquals("ACK_CONTRACT_INVALID", queue.row(1).lastErrorCode)
    }

    @Test
    fun singleRow413IsRetainedInsteadOfDeadLettered() = runBlocking {
        queue.rows += row(1)
        server.enqueue(MockResponse().setResponseCode(413))

        assertEquals(false, uploader().runOnce("trip-1"))

        assertEquals(OutboxState.PENDING, queue.row(1).state)
        assertEquals("PAYLOAD_TOO_LARGE_SINGLE", queue.row(1).lastErrorCode)
        assertNull(queue.row(1).permanentlyRejectedAtUtcMs)
    }

    private fun uploader() = TelemetryUploader(
        repository = queue,
        credentials = credentials,
        client = OkHttpClient(),
        batchIdFactory = { batchIds.removeFirst() },
        clock = { 10_000L },
        randomFraction = { 0.0 },
    )

    private fun successAck(batchId: String, acceptedRanges: String) = MockResponse()
        .setResponseCode(200)
        .setBody(
            """{"data":{"batch_id":"$batchId","trip_id":"trip-1","committed":true,"highest_contiguous_sequence":0,"accepted_sequences":$acceptedRanges,"duplicate_sequences":[],"rejections":[],"missing_ranges":[[1,6]]}}"""
        )

    private fun row(sequence: Long) = TelemetryOutboxEntity(
        sampleId = "sample-$sequence",
        tripId = "trip-1",
        sequenceNo = sequence,
        eventTimeUtcMs = sequence * 1_000,
        monotonicTimeNs = sequence * 1_000_000_000,
        payloadJson = "{}",
        state = OutboxState.PENDING,
        attemptCount = 0,
        nextAttemptAtUtcMs = 0,
        leaseUntilUtcMs = null,
        serverCommittedAtUtcMs = null,
        createdAtUtcMs = 0,
        rejectionCode = null,
        lastHttpStatus = null,
        lastErrorCode = null,
        lastErrorDetail = null,
        lastFailureAtUtcMs = null,
        permanentlyRejectedAtUtcMs = null,
    )

    private class FakeSessionStore(private var session: DeviceSession?) : DeviceSessionStore {
        override fun save(session: DeviceSession) {
            this.session = session
        }

        override fun load(): DeviceSession? = session
    }

    private class FakeUploadQueue : TelemetryUploadQueue {
        val rows = mutableListOf<TelemetryOutboxEntity>()
        var lastContiguousSequence: Long? = null

        override suspend fun leasePending(
            tripId: String,
            nowUtcMs: Long,
            limit: Int,
            leaseMs: Long,
        ): List<TelemetryOutboxEntity> = rows
            .filter { it.tripId == tripId && it.state == OutboxState.PENDING }
            .take(limit)
            .map { leased ->
                update(leased.copy(state = OutboxState.IN_FLIGHT, attemptCount = leased.attemptCount + 1))
            }

        override suspend fun applyAcknowledgement(
            tripId: String,
            leasedRows: List<TelemetryOutboxEntity>,
            highestContiguousSequence: Long,
            acceptedSequences: Set<Long>,
            duplicateSequences: Set<Long>,
            permanentRejections: Map<Long, String>,
            serverCommittedAtUtcMs: Long,
        ) {
            lastContiguousSequence = highestContiguousSequence
            leasedRows.forEach { leased ->
                when {
                    leased.sequenceNo in permanentRejections -> update(
                        leased.copy(
                            state = OutboxState.PERMANENTLY_REJECTED,
                            rejectionCode = permanentRejections[leased.sequenceNo],
                            permanentlyRejectedAtUtcMs = serverCommittedAtUtcMs,
                        )
                    )
                    leased.sequenceNo <= highestContiguousSequence ||
                        leased.sequenceNo in acceptedSequences ||
                        leased.sequenceNo in duplicateSequences -> update(
                            leased.copy(state = OutboxState.ACKED, serverCommittedAtUtcMs = serverCommittedAtUtcMs)
                        )
                    else -> update(leased.copy(state = OutboxState.PENDING))
                }
            }
        }

        override suspend fun recordRetry(
            rows: List<TelemetryOutboxEntity>,
            nextAttemptAtUtcMs: Long,
            httpStatus: Int?,
            errorCode: String,
            errorDetail: String,
            failedAtUtcMs: Long,
        ) = rows.forEach { leased ->
            update(
                leased.copy(
                    state = OutboxState.PENDING,
                    nextAttemptAtUtcMs = nextAttemptAtUtcMs,
                    lastHttpStatus = httpStatus,
                    lastErrorCode = errorCode,
                    lastErrorDetail = errorDetail,
                    lastFailureAtUtcMs = failedAtUtcMs,
                )
            )
        }

        override suspend fun deadLetter(
            row: TelemetryOutboxEntity,
            httpStatus: Int?,
            errorCode: String,
            errorDetail: String,
            failedAtUtcMs: Long,
        ) {
            update(
                row.copy(
                    state = OutboxState.PERMANENTLY_REJECTED,
                    rejectionCode = errorCode,
                    lastHttpStatus = httpStatus,
                    lastErrorCode = errorCode,
                    lastErrorDetail = errorDetail,
                    lastFailureAtUtcMs = failedAtUtcMs,
                    permanentlyRejectedAtUtcMs = failedAtUtcMs,
                )
            )
        }

        fun row(sequence: Long) = rows.single { it.sequenceNo == sequence }

        private fun update(row: TelemetryOutboxEntity): TelemetryOutboxEntity {
            val index = rows.indexOfFirst { it.sampleId == row.sampleId }
            rows[index] = row
            return row
        }
    }
}
