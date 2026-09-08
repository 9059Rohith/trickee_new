package com.trickee.gpsdriver.telemetry.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters

class DailyPlanReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return Result.failure()
        }
        val title = inputData.getString(KEY_TITLE)?.take(120) ?: return Result.failure()
        val body = inputData.getString(KEY_BODY)?.take(500) ?: return Result.failure()
        val occurrenceId = inputData.getString(KEY_OCCURRENCE) ?: return Result.failure()
        TrickeeNotificationPresenter.show(
            context = applicationContext,
            occurrenceId = occurrenceId,
            title = title,
            body = body,
            screen = "daily_planner",
            planId = inputData.getString(KEY_PLAN_ID),
        )
        return Result.success()
    }

    companion object {
        const val CHANNEL_ID = TrickeeNotificationPresenter.HIGH_PRIORITY_CHANNEL_ID
        const val KEY_TITLE = "title"
        const val KEY_BODY = "body"
        const val KEY_OCCURRENCE = "occurrence_id"
        const val KEY_PLAN_ID = "plan_id"
    }
}
