package com.trickee.gpsdriver.telemetry.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.trickee.gpsdriver.MainActivity
import com.trickee.gpsdriver.R

class DailyPlanReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return Result.failure()
        }
        val title = inputData.getString(KEY_TITLE)?.take(120) ?: return Result.failure()
        val body = inputData.getString(KEY_BODY)?.take(500) ?: return Result.failure()
        val occurrenceId = inputData.getString(KEY_OCCURRENCE) ?: return Result.failure()
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Important route and departure alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Time-sensitive Trickee daily plan, route and charging alerts"
                enableVibration(true)
            })
        }
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("screen", "daily_planner")
            putExtra("plan_id", inputData.getString(KEY_PLAN_ID))
        }
        val pendingIntent = PendingIntent.getActivity(applicationContext, occurrenceId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val rawId = occurrenceId.hashCode() and Int.MAX_VALUE
        val notificationId = if (rawId == 2101 || rawId == 2102) rawId + 10_000 else rawId
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        manager.notify(notificationId, notification)
        return Result.success()
    }

    companion object {
        const val CHANNEL_ID = "trickee_route_alerts_high"
        const val KEY_TITLE = "title"
        const val KEY_BODY = "body"
        const val KEY_OCCURRENCE = "occurrence_id"
        const val KEY_PLAN_ID = "plan_id"
    }
}
