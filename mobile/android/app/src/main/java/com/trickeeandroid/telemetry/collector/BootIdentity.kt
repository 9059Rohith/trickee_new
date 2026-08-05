package com.trickeeandroid.telemetry.collector

import android.content.Context
import android.os.SystemClock
import java.util.UUID

object BootIdentity {
    fun current(context: Context): String {
        val prefs = context.getSharedPreferences("trickee.telemetry.boot", Context.MODE_PRIVATE)
        val elapsed = SystemClock.elapsedRealtime()
        val previousElapsed = prefs.getLong("elapsed_ms", -1)
        val previousId = prefs.getString("boot_id", null)
        val bootId = if (previousId == null || previousElapsed < 0 || elapsed < previousElapsed) {
            UUID.randomUUID().toString()
        } else {
            previousId
        }
        prefs.edit().putString("boot_id", bootId).putLong("elapsed_ms", elapsed).apply()
        return bootId
    }
}
