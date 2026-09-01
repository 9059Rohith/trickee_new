package com.trickee.gpsdriver.telemetry.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName
import com.trickee.gpsdriver.telemetry.security.DeviceSession
import com.trickee.gpsdriver.telemetry.security.DeviceSessionStore
import com.trickee.gpsdriver.telemetry.storage.TelemetryOutboxEntity
import com.trickee.gpsdriver.telemetry.storage.TelemetryUploadQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

private data class RefreshedDevice(
    val device: Map<String, Any>,
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
)

class TelemetryUploader(
    private val repository: TelemetryUploadQueue,
    private val credentials: DeviceSessionStore,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build(),
    private val batchIdFactory: () -> String = { UUID.randomUUID().toString() },
    private val clock: () -> Long = System::currentTimeMillis,
    private val randomFraction: () -> Double = Math::random,
    private val uploaderLease: UploaderLease = ProcessWideUploaderLease,
) {
    private val gson = Gson()

    suspend fun runOnce(tripId: String, backfill: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        if (!uploaderLease.tryAcquire()) return@withContext false
        try {
            val session = credentials.load() ?: return@withContext false
            val now = clock()
            val limit = if (backfill) UploadPolicy.BACKFILL_BATCH_LIMIT else UploadPolicy.ONLINE_BATCH_LIMIT
            val rows = repository.leasePending(tripId, now, limit, LEASE_MS)
            if (rows.isEmpty()) return@withContext false
            sendRows(session, tripId, rows, allowRefresh = true)
        } finally {
            uploaderLease.release()
        }
    }

    private suspend fun sendRows(
        session: DeviceSession,
        tripId: String,
        rows: List<TelemetryOutboxEntity>,
        allowRefresh: Boolean,
        retainedBatchId: String? = null,
    ): Boolean {
        val batchId = retainedBatchId ?: batchIdFactory()
        val batch = encodeBatch(batchId, tripId, session, rows)
        if (batch.size > UploadPolicy.MAX_UNCOMPRESSED_BYTES) {
            if (rows.size == 1) {
                retainForRetry(rows, null, "PAYLOAD_TOO_LARGE_SINGLE", UploadPolicy.MAX_RETRY_DELAY_MS)
                return false
            }
            return splitOrDeadLetter(session, tripId, rows, null, "PAYLOAD_TOO_LARGE", allowRefresh)
        }
        val request = Request.Builder()
            .url("${session.apiOrigin}/api/v2/trips/$tripId/telemetry-batches")
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Content-Encoding", "gzip")
            .header("Idempotency-Key", batchId)
            .post(gzip(batch).toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    return handleSuccessfulAck(response, batchId, tripId, rows)
                }
                when (val decision = UploadFailurePolicy.decide(
                    status = response.code,
                    rowCount = rows.size,
                    retryAfterSeconds = retryAfterSeconds(response.header("Retry-After")),
                )) {
                    UploadFailureDecision.RefreshThenRetry -> {
                        val refreshed = if (allowRefresh) refreshSession(session) else null
                        if (refreshed != null) {
                            sendRows(refreshed, tripId, rows, allowRefresh = false, retainedBatchId = batchId)
                        } else {
                            retainForRetry(rows, response.code, "AUTH_REFRESH_FAILED", null)
                            false
                        }
                    }
                    UploadFailureDecision.ReduceBatch,
                    UploadFailureDecision.BisectBatch -> splitOrDeadLetter(
                        session, tripId, rows, response.code, "HTTP_${response.code}", allowRefresh
                    )
                    UploadFailureDecision.RetainOversizeSingle -> {
                        retainForRetry(rows, response.code, "PAYLOAD_TOO_LARGE_SINGLE", UploadPolicy.MAX_RETRY_DELAY_MS)
                        false
                    }
                    UploadFailureDecision.DeadLetterSingle -> {
                        deadLetter(rows.single(), response.code, "HTTP_${response.code}")
                        true
                    }
                    is UploadFailureDecision.Retry -> {
                        retainForRetry(rows, response.code, "HTTP_${response.code}", decision.minimumDelayMs)
                        false
                    }
                }
            }
        } catch (error: Exception) {
            retainForRetry(rows, null, "NETWORK_FAILURE", null, error.javaClass.simpleName)
            false
        }
    }

    private suspend fun handleSuccessfulAck(
        response: Response,
        batchId: String,
        tripId: String,
        rows: List<TelemetryOutboxEntity>,
    ): Boolean = try {
        val body = response.body?.string() ?: error("Missing telemetry ACK")
        val data = JsonParser.parseString(body).asJsonObject.getAsJsonObject("data")
            ?: error("Missing telemetry ACK data")
        val ack = gson.fromJson(data, TelemetryBatchAck::class.java)
        val validated = ack.validateFor(batchId, tripId, rows.mapTo(mutableSetOf()) { it.sequenceNo })
        repository.applyAcknowledgement(
            tripId = tripId,
            leasedRows = rows,
            highestContiguousSequence = validated.highestContiguousSequence,
            acceptedSequences = validated.acceptedSequences,
            duplicateSequences = validated.duplicateSequences,
            permanentRejections = validated.permanentRejections,
            serverCommittedAtUtcMs = clock(),
        )
        true
    } catch (error: Exception) {
        retainForRetry(rows, response.code, "ACK_CONTRACT_INVALID", null, error.javaClass.simpleName)
        false
    }

    private suspend fun splitOrDeadLetter(
        session: DeviceSession,
        tripId: String,
        rows: List<TelemetryOutboxEntity>,
        httpStatus: Int?,
        errorCode: String,
        allowRefresh: Boolean,
    ): Boolean {
        if (rows.size == 1) {
            deadLetter(rows.single(), httpStatus, errorCode)
            return true
        }
        val middle = rows.size / 2
        val firstProgress = sendRows(session, tripId, rows.subList(0, middle), allowRefresh)
        val secondProgress = sendRows(session, tripId, rows.subList(middle, rows.size), allowRefresh)
        return firstProgress || secondProgress
    }

    private suspend fun retainForRetry(
        rows: List<TelemetryOutboxEntity>,
        httpStatus: Int?,
        errorCode: String,
        minimumDelayMs: Long?,
        detail: String = diagnosticDetail(httpStatus, errorCode),
    ) {
        val now = clock()
        val attempt = rows.maxOfOrNull { it.attemptCount } ?: 1
        val delay = maxOf(
            minimumDelayMs ?: 0,
            UploadPolicy.fullJitterDelayMs(attempt, randomFraction()),
        )
        repository.recordRetry(rows, now + delay, httpStatus, errorCode, detail, now)
    }

    private suspend fun deadLetter(row: TelemetryOutboxEntity, httpStatus: Int?, errorCode: String) {
        val now = clock()
        repository.deadLetter(row, httpStatus, errorCode, diagnosticDetail(httpStatus, errorCode), now)
    }

    private fun encodeBatch(
        batchId: String,
        tripId: String,
        session: DeviceSession,
        rows: List<TelemetryOutboxEntity>,
    ): ByteArray {
        val windows = rows.map { JsonParser.parseString(it.payloadJson) }
        return gson.toJson(
            mapOf(
                "schema_version" to 1,
                "batch_id" to batchId,
                "trip_id" to tripId,
                "device_id" to session.deviceId,
                "windows" to windows,
            )
        ).toByteArray(Charsets.UTF_8)
    }

    private fun refreshSession(session: DeviceSession): DeviceSession? {
        val body = gson.toJson(mapOf("device_id" to session.deviceId, "refresh_token" to session.refreshToken))
        val request = Request.Builder()
            .url("${session.apiOrigin}/api/v2/devices/token")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val data = JsonParser.parseString(response.body?.string()).asJsonObject.getAsJsonObject("data")
                    ?: return null
                val refreshed = gson.fromJson(data, RefreshedDevice::class.java)
                session.copy(accessToken = refreshed.accessToken, refreshToken = refreshed.refreshToken).also {
                    credentials.save(it)
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun diagnosticDetail(httpStatus: Int?, errorCode: String): String =
        if (httpStatus == null) errorCode else "HTTP $httpStatus ($errorCode)"

    private fun retryAfterSeconds(header: String?): Long? {
        val seconds = header?.trim()?.toLongOrNull()
        if (seconds != null) return seconds.coerceAtLeast(0)
        val retryAt = runCatching {
            ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        }.getOrNull() ?: return null
        return ((retryAt - clock()).coerceAtLeast(0) / 1_000L)
    }

    private fun gzip(bytes: ByteArray): ByteArray = ByteArrayOutputStream().use { output ->
        GZIPOutputStream(output).use { it.write(bytes) }
        output.toByteArray()
    }

    companion object { private const val LEASE_MS = 30L * 60L * 1_000L }
}
