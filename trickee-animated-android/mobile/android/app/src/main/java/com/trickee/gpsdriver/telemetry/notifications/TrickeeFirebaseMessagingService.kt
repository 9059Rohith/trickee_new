package com.trickee.gpsdriver.telemetry.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class TrickeeFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushTokenSyncWorker.storeAndEnqueue(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: message.notification?.title ?: "Trickee route update"
        val body = data["body"] ?: message.notification?.body ?: "Open Trickee for current guidance."
        TrickeeNotificationPresenter.show(
            context = this,
            occurrenceId = data["occurrence_id"] ?: data["nudge_id"] ?: message.messageId ?: System.currentTimeMillis().toString(),
            title = title,
            body = body,
            screen = data["screen"] ?: "route_nudge",
            planId = data["plan_id"],
        )
    }
}
