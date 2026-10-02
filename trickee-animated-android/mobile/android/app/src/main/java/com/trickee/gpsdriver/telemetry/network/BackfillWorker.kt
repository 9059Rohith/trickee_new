package com.trickee.gpsdriver.telemetry.network

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.trickee.gpsdriver.telemetry.security.DeviceCredentialStore
import com.trickee.gpsdriver.telemetry.storage.TelemetryDatabase
import com.trickee.gpsdriver.telemetry.storage.TelemetryRepository

class BackfillWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = TelemetryRepository(TelemetryDatabase.open(applicationContext).telemetryDao())
        val now = System.currentTimeMillis()
        val targetTripId = inputData.getString(INPUT_TRIP_ID)
        repository.recoverExpiredLeases(now)
        repository.repairKnownContractRejections(targetTripId, now)
        repository.purgeAcknowledged(now)
        val uploader = TelemetryUploader(repository, DeviceCredentialStore(applicationContext))
        repeat(MAX_BATCHES_PER_RUN) {
            if (targetTripId != null) {
                if (repository.pendingCount(targetTripId) == 0) return Result.success()
                if (!uploader.runOnce(targetTripId, backfill = true)) return Result.retry()
                return@repeat
            }
            val trip = repository.tripWithEligibleOutbox(now) ?: return if (repository.pendingTripIds().isEmpty()) {
                Result.success()
            } else {
                Result.retry()
            }
            if (!uploader.runOnce(trip.tripId, backfill = true)) {
                if (repository.pendingCount(trip.tripId) > 0) return Result.retry()
            }
        }
        if (targetTripId != null) {
            return if (repository.pendingCount(targetTripId) == 0) Result.success() else Result.retry()
        }
        return if (repository.pendingTripIds().isEmpty()) Result.success() else Result.retry()
    }

    companion object {
        private const val UNIQUE_NAME = "trickee-telemetry-backfill"
        private const val RECOVERY_PREFIX = "trickee-telemetry-recovery"
        private const val MAX_BATCHES_PER_RUN = 20
        internal const val INPUT_TRIP_ID = "trip_id"

        internal fun request(tripId: String? = null, expedited: Boolean = false): OneTimeWorkRequest {
            val builder = OneTimeWorkRequestBuilder<BackfillWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            if (tripId != null) builder.setInputData(workDataOf(INPUT_TRIP_ID to tripId))
            if (expedited) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            return builder.build()
        }

        internal fun schedule(
            tripId: String? = null,
            forceRecovery: Boolean = false,
        ): BackfillSchedule {
            require(!forceRecovery || !tripId.isNullOrBlank()) { "Forced recovery requires a trip" }
            return if (forceRecovery) {
                BackfillSchedule(
                    uniqueName = "$RECOVERY_PREFIX-$tripId",
                    existingWorkPolicy = ExistingWorkPolicy.REPLACE,
                    request = request(tripId = tripId, expedited = true),
                )
            } else {
                BackfillSchedule(UNIQUE_NAME, ExistingWorkPolicy.KEEP, request())
            }
        }

        fun enqueue(context: Context) {
            enqueue(context, schedule())
        }

        fun enqueueRecovery(context: Context, tripId: String) {
            enqueue(context, schedule(tripId = tripId, forceRecovery = true))
        }

        private fun enqueue(context: Context, schedule: BackfillSchedule) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                schedule.uniqueName,
                schedule.existingWorkPolicy,
                schedule.request,
            )
        }
    }
}

internal data class BackfillSchedule(
    val uniqueName: String,
    val existingWorkPolicy: ExistingWorkPolicy,
    val request: OneTimeWorkRequest,
)
