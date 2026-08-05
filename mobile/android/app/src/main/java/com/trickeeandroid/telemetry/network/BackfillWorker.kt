package com.trickeeandroid.telemetry.network

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.trickeeandroid.telemetry.security.DeviceCredentialStore
import com.trickeeandroid.telemetry.storage.TelemetryDatabase
import com.trickeeandroid.telemetry.storage.TelemetryRepository

class BackfillWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = TelemetryRepository(TelemetryDatabase.open(applicationContext).telemetryDao())
        repository.recoverExpiredLeases(System.currentTimeMillis())
        val trip = repository.tripWithPendingOutbox() ?: return Result.success()
        val uploader = TelemetryUploader(repository, DeviceCredentialStore(applicationContext))
        repeat(MAX_BATCHES_PER_RUN) {
            if (!uploader.runOnce(trip.tripId, backfill = true)) {
                return if (repository.pendingCount(trip.tripId) == 0) Result.success() else Result.retry()
            }
        }
        return if (repository.pendingCount(trip.tripId) == 0) Result.success() else Result.retry()
    }

    companion object {
        private const val UNIQUE_NAME = "trickee-telemetry-backfill"
        private const val MAX_BATCHES_PER_RUN = 20

        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NAME,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<BackfillWorker>().build(),
            )
        }
    }
}
