package com.trickee.gpsdriver.telemetry.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName
import com.trickee.gpsdriver.telemetry.security.DeviceCredentialStore
import com.trickee.gpsdriver.telemetry.security.DeviceSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

internal enum class PushTokenSyncDecision { SUCCESS, REFRESH, RETRY, FAILURE }

internal fun decidePushTokenSync(status: Int, allowRefresh: Boolean): PushTokenSyncDecision = when {
    status in 200..299 -> PushTokenSyncDecision.SUCCESS
    status == 401 && allowRefresh -> PushTokenSyncDecision.REFRESH
    status == 401 || status == 408 || status == 425 || status == 429 || status >= 500 -> PushTokenSyncDecision.RETRY
    else -> PushTokenSyncDecision.FAILURE
}

private data class RefreshedPushDevice(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
)

class PushTokenSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val credentials = DeviceCredentialStore(applicationContext)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val token = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, null)
            ?.takeIf { it.isNotBlank() }
            ?: return@withContext Result.success()
        val session = credentials.load() ?: return@withContext Result.retry()
        sync(session, token, allowRefresh = true)
    }

    private fun sync(session: DeviceSession, token: String, allowRefresh: Boolean): Result {
        val body = gson.toJson(mapOf("token" to token))
        val request = Request.Builder()
            .url("${session.apiOrigin}/api/v2/devices/self/push-token")
            .put(body.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer ${session.accessToken}")
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                when (decidePushTokenSync(response.code, allowRefresh)) {
                    PushTokenSyncDecision.SUCCESS -> Result.success()
                    PushTokenSyncDecision.REFRESH -> {
                        val refreshed = refreshSession(session) ?: return Result.retry()
                        sync(refreshed, token, allowRefresh = false)
                    }
                    PushTokenSyncDecision.RETRY -> Result.retry()
                    PushTokenSyncDecision.FAILURE -> Result.failure()
                }
            }
        } catch (_: Exception) {
            Result.retry()
        }
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
                val refreshed = gson.fromJson(data, RefreshedPushDevice::class.java)
                session.copy(
                    accessToken = refreshed.accessToken,
                    refreshToken = refreshed.refreshToken,
                ).also(credentials::save)
            }
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val UNIQUE_NAME = "trickee-fcm-token-sync"
        private const val PREFS = "trickee.push"
        private const val KEY_TOKEN = "fcm_token"

        fun storeAndEnqueue(context: Context, token: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_TOKEN, token)
                .apply()
            val request = OneTimeWorkRequestBuilder<PushTokenSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
