package com.trickee.gpsdriver.telemetry.network

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.trickee.gpsdriver.telemetry.security.DeviceCredentialStore
import com.trickee.gpsdriver.telemetry.storage.TelemetryDatabase
import com.trickee.gpsdriver.telemetry.storage.TelemetryRepository

class BackfillWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = TelemetryRepository(TelemetryDatabase.open(applicationContext).telemetryDao())
        val now = System.currentTimeMillis()
        repository.recoverExpiredLeases(now)
        repository.purgeAcknowledged(now)
        val uploader = TelemetryUploader(repository, DeviceCredentialStore(applicationContext))
        repeat(MAX_BATCHES_PER_RUN) {
            val trip = repository.tripWithEligibleOutbox(now) ?: return if (repository.pendingTripIds().isEmpty()) {
                Result.success()
            } else {
                Result.retry()
            }
            if (!uploader.runOnce(trip.tripId, backfill = true)) {
                if (repository.pendingCount(trip.tripId) > 0) return Result.retry()
            }
        }
        return if (repository.pendingTripIds().isEmpty()) Result.success() else Result.retry()
    }

    companion object {
        private const val UNIQUE_NAME = "trickee-telemetry-backfill"
        private const val MAX_BATCHES_PER_RUN = 20

        internal fun request(): OneTimeWorkRequest = OneTimeWorkRequestBuilder<BackfillWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()

        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NAME,
                ExistingWorkPolicy.KEEP,
                request(),
            )
        }
    }
}
