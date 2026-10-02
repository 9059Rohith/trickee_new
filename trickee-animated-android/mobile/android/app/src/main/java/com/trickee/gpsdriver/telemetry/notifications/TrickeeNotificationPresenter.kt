package com.trickee.gpsdriver.telemetry.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.trickee.gpsdriver.MainActivity
import com.trickee.gpsdriver.R

object TrickeeNotificationPresenter {
    const val HIGH_PRIORITY_CHANNEL_ID = "trickee_route_alerts_high"

    fun show(
        context: Context,
        occurrenceId: String,
        title: String,
        body: String,
        screen: String = "route_nudge",
        planId: String? = null,
    ): Boolean {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    HIGH_PRIORITY_CHANNEL_ID,
                    "Important route and departure alerts",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Time-sensitive Trickee route, charging and departure alerts"
                    enableVibration(true)
                }
            )
        }
        val route = if (screen == "daily_planner") "daily-planner" else "route-nudges"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("trickeegps://$route"), context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("screen", screen)
            putExtra("plan_id", planId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            occurrenceId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val rawId = occurrenceId.hashCode() and Int.MAX_VALUE
        val notificationId = if (rawId == 2101 || rawId == 2102) rawId + 10_000 else rawId
        return runCatching {
            manager.notify(
                notificationId,
                NotificationCompat.Builder(context, HIGH_PRIORITY_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title.take(120))
                    .setContentText(body.take(500))
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(500)))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .build(),
            )
            true
        }.getOrDefault(false)
    }
}
