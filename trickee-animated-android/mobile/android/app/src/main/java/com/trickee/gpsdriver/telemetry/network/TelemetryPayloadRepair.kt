package com.trickee.gpsdriver.telemetry.network

import com.google.gson.JsonNull
import com.google.gson.JsonParser

/** Repairs only known Android-to-server representation mismatches; measurements are untouched. */
object TelemetryPayloadRepair {
    fun repairKnownContractViolation(payloadJson: String): String? = runCatching {
        val root = JsonParser.parseString(payloadJson).asJsonObject
        if (root.get("schema_version")?.asInt != 1) return null
        val imu = root.getAsJsonObject("imu") ?: return null
        var changed = false
        if (root.get("gps_available")?.asBoolean == false && !root.has("gps")) {
            root.add("gps", JsonNull.INSTANCE)
            changed = true
        }
        listOf("accelerometer_accuracy", "gyroscope_accuracy").forEach { field ->
            val value = imu.get(field)?.takeUnless { it.isJsonNull }?.asInt ?: return@forEach
            if (value == ANDROID_SENSOR_STATUS_NO_CONTACT) {
                imu.addProperty(field, SERVER_SENSOR_STATUS_UNRELIABLE)
                changed = true
            }
        }
        if (changed) root.toString() else null
    }.getOrNull()

    private const val ANDROID_SENSOR_STATUS_NO_CONTACT = -1
    private const val SERVER_SENSOR_STATUS_UNRELIABLE = 0
}
