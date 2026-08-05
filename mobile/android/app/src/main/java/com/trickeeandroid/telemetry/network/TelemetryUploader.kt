package com.trickeeandroid.telemetry.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName
import com.trickeeandroid.telemetry.security.DeviceCredentialStore
import com.trickeeandroid.telemetry.security.DeviceSession
import com.trickeeandroid.telemetry.storage.TelemetryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

private data class Rejection(
    @SerializedName("sequence_no") val sequenceNo: Long,
    val code: String,
)

private data class BatchAck(
    @SerializedName("highest_contiguous_sequence") val highestContiguousSequence: Long,
    val rejections: List<Rejection>,
)

private data class ApiEnvelope<T>(val data: T)

private data class RefreshedDevice(
    val device: Map<String, Any>,
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
)

class TelemetryUploader(
    private val repository: TelemetryRepository,
    private val credentials: DeviceCredentialStore,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(UploadPolicy.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build(),
) {
    private val gson = Gson()
    private val lease = SingleUploaderLease()

    suspend fun runOnce(tripId: String, backfill: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        if (!lease.tryAcquire()) return@withContext false
        try {
            val session = credentials.load() ?: return@withContext false
            val now = System.currentTimeMillis()
            val limit = if (backfill) UploadPolicy.BACKFILL_BATCH_LIMIT else UploadPolicy.ONLINE_BATCH_LIMIT
            val rows = repository.leasePending(tripId, now, limit, LEASE_MS)
            if (rows.isEmpty()) return@withContext false
            val batchId = UUID.randomUUID().toString()
            val windows = rows.map { JsonParser.parseString(it.payloadJson) }
            val batch = gson.toJson(
                mapOf(
                    "schema_version" to 1,
                    "batch_id" to batchId,
                    "trip_id" to tripId,
                    "device_id" to session.deviceId,
                    "windows" to windows,
                )
            ).toByteArray(Charsets.UTF_8)
            if (batch.size > UploadPolicy.MAX_UNCOMPRESSED_BYTES) {
                repository.releaseForRetry(rows.map { it.sampleId }, now)
                return@withContext false
            }
            val request = Request.Builder()
                .url("${session.apiOrigin}/api/v2/trips/$tripId/telemetry-batches")
                .header("Authorization", "Bearer ${session.accessToken}")
                .header("Content-Encoding", "gzip")
                .header("Idempotency-Key", batchId)
                .post(gzip(batch).toRequestBody("application/json".toMediaType()))
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string() ?: error("Missing telemetry ACK")
                        val ack = gson.fromJson(body, ApiEnvelope::class.java).data
                        val parsed = gson.fromJson(gson.toJson(ack), BatchAck::class.java)
                        repository.applyAcknowledgement(
                            tripId,
                            parsed.highestContiguousSequence,
                            parsed.rejections.associate { it.sequenceNo to it.code },
                            System.currentTimeMillis(),
                        )
                        return@withContext true
                    }
                    if (response.code == 401 && refreshSession(session)) {
                        repository.releaseForRetry(rows.map { it.sampleId }, now)
                        return@withContext false
                    }
                    if (UploadPolicy.isRetryableStatus(response.code)) {
                        val attempt = (rows.maxOfOrNull { it.attemptCount } ?: 0) + 1
                        repository.releaseForRetry(
                            rows.map { it.sampleId },
                            now + UploadPolicy.fullJitterDelayMs(attempt),
                        )
                    } else {
                        repository.rejectBatch(tripId, rows, "HTTP_${response.code}")
                    }
                }
            } catch (_: Exception) {
                val attempt = (rows.maxOfOrNull { it.attemptCount } ?: 0) + 1
                repository.releaseForRetry(
                    rows.map { it.sampleId },
                    now + UploadPolicy.fullJitterDelayMs(attempt),
                )
            }
            false
        } finally {
            lease.release()
        }
    }

    private fun refreshSession(session: DeviceSession): Boolean {
        val body = gson.toJson(mapOf("device_id" to session.deviceId, "refresh_token" to session.refreshToken))
        val request = Request.Builder()
            .url("${session.apiOrigin}/api/v2/devices/token")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return false
                val envelope = gson.fromJson(response.body?.string(), ApiEnvelope::class.java)
                val refreshed = gson.fromJson(gson.toJson(envelope.data), RefreshedDevice::class.java)
                credentials.save(session.copy(accessToken = refreshed.accessToken, refreshToken = refreshed.refreshToken))
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun gzip(bytes: ByteArray): ByteArray = ByteArrayOutputStream().use { output ->
        GZIPOutputStream(output).use { it.write(bytes) }
        output.toByteArray()
    }

    companion object { private const val LEASE_MS = 30_000L }
}
