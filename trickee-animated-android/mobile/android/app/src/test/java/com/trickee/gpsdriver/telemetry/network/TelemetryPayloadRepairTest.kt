package com.trickee.gpsdriver.telemetry.network

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryPayloadRepairTest {
    @Test
    fun repairsAndroidNoContactSensorAccuracyWithoutChangingMeasurements() {
        val payload = """{
            "schema_version":1,
            "sequence_no":1,
            "imu":{
                "accelerometer_accuracy":-1,
                "gyroscope_accuracy":-1,
                "gyro_mean_rads":[0.1,0.2,0.3]
            }
        }""".trimIndent()

        val repaired = TelemetryPayloadRepair.repairKnownContractViolation(payload)
        assertNotNull(repaired)
        val root = JsonParser.parseString(requireNotNull(repaired)).asJsonObject
        val imu = root.getAsJsonObject("imu")

        assertEquals(0, imu.get("accelerometer_accuracy").asInt)
        assertEquals(0, imu.get("gyroscope_accuracy").asInt)
        assertEquals(0.2, imu.getAsJsonArray("gyro_mean_rads")[1].asDouble, 0.0)
    }

    @Test
    fun restoresExplicitNullGpsForAWindowThatReportsNoFix() {
        val payload = """{
            "schema_version":1,
            "sequence_no":42,
            "gps_available":false,
            "imu":{"accelerometer_accuracy":0,"gyroscope_accuracy":3}
        }""".trimIndent()

        val repaired = TelemetryPayloadRepair.repairKnownContractViolation(payload)

        assertNotNull(repaired)
        val root = JsonParser.parseString(requireNotNull(repaired)).asJsonObject
        assertTrue(root.has("gps"))
        assertTrue(root.get("gps").isJsonNull)
        assertEquals(42, root.get("sequence_no").asInt)
    }

    @Test
    fun doesNotInventGpsForAWindowThatClaimsAValidFix() {
        val payload = """{
            "schema_version":1,
            "sequence_no":43,
            "gps_available":true,
            "imu":{"accelerometer_accuracy":0,"gyroscope_accuracy":3}
        }""".trimIndent()

        val repaired = TelemetryPayloadRepair.repairKnownContractViolation(payload)

        assertNull(repaired)
        assertFalse(JsonParser.parseString(payload).asJsonObject.has("gps"))
    }

    @Test
    fun doesNotRewriteAlreadyValidOrUnknownPayloads() {
        assertNull(
            TelemetryPayloadRepair.repairKnownContractViolation(
                """{"schema_version":1,"imu":{"accelerometer_accuracy":0,"gyroscope_accuracy":3}}""",
            ),
        )
        assertNull(TelemetryPayloadRepair.repairKnownContractViolation("not-json"))
    }
}
