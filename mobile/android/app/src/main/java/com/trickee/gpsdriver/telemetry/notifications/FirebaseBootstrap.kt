package com.trickee.gpsdriver.telemetry.notifications

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.trickee.gpsdriver.BuildConfig

object FirebaseBootstrap {
    fun isConfigured(): Boolean = listOf(
        BuildConfig.FIREBASE_API_KEY,
        BuildConfig.FIREBASE_APP_ID,
        BuildConfig.FIREBASE_PROJECT_ID,
        BuildConfig.FIREBASE_SENDER_ID,
    ).all { it.isNotBlank() }

    fun initialize(context: Context): Boolean {
        if (!isConfigured()) return false
        if (FirebaseApp.getApps(context).isEmpty()) {
            val initialized = runCatching {
                FirebaseApp.initializeApp(
                    context,
                    FirebaseOptions.Builder()
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }.getOrNull()
            if (initialized == null) return false
        }
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (token.isNotBlank()) PushTokenSyncWorker.storeAndEnqueue(context, token)
        }
        return true
    }
}
