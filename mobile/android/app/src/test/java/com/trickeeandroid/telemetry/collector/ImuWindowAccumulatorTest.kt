package com.trickeeandroid.telemetry.collector

import com.trickeeandroid.telemetry.model.DeviceHealthPayload
import com.trickeeandroid.telemetry.model.TelemetryJson
import com.trickeeandroid.telemetry.model.TelemetryWindowPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

class ImuWindowAccumulatorTest {
    @Test
    fun closeWindowComputesLiteralAxisAndJerkStatistics() {
        val accumulator = ImuWindowAccumulator()
        accumulator.addAccelerometer(1f, 2f, 3f, 1_000_000_000L)
        accumulator.addAccelerometer(3f, 4f, 5f, 1_020_000_000L)
        accumulator.addGyroscope(-1f, 2f, -3f, 1_000_000_000L)
        accumulator.addGyroscope(3f, -4f, 5f, 1_020_000_000L)

        val summary = accumulator.closeWindow(expectedSamples = 50)

        assertEquals(listOf(2.0, 3.0, 4.0), summary.accelMeanMps2, 1e-9)
        assertEquals(listOf(1.0, 1.0, 1.0), summary.accelStdMps2, 1e-9)
        assertEquals(sqrt(5.0), summary.accelRmsMps2[0], 1e-9)
        assertEquals(sqrt(32.0), summary.accelMagnitudeRmsMps2, 1e-9)
        assertEquals(sqrt(50.0), summary.accelMagnitudeMaxMps2, 1e-9)
        assertEquals(sqrt(30_000.0), summary.jerkRmsMps3, 1e-6)
        assertEquals(listOf(1.0, -1.0, 1.0), summary.gyroMeanRads, 1e-9)
        assertEquals(listOf(3.0, 4.0, 5.0), summary.gyroMaxAbsRads, 1e-9)
        assertEquals(2, summary.accelerometerSampleCount)
        assertEquals(4.0, summary.accelerometerCompletePct, 1e-9)
    }

    @Test
    fun closeWindowResetsSamplesForTheNextElapsedSecond() {
        val accumulator = ImuWindowAccumulator()
        accumulator.addAccelerometer(1f, 1f, 1f, 10L)
        accumulator.closeWindow(expectedSamples = 50)

        val empty = accumulator.closeWindow(expectedSamples = 50)

        assertEquals(0, empty.accelerometerSampleCount)
        assertEquals(0.0, empty.accelerometerCompletePct, 0.0)
        assertEquals(listOf(0.0, 0.0, 0.0), empty.accelMeanMps2)
    }

    @Test
    fun missingGpsSerializesAsExplicitNullWithoutBmsFields() {
        val payload = TelemetryWindowPayload(
            sampleId = "sample-1",
            tripId = "trip-1",
            deviceId = "device-1",
            vehicleId = "vehicle-1",
            sequenceNo = 1,
            bootId = "boot-1",
            eventTimeUtcMs = 1_000,
            monotonicTimeNs = 1_000_000_000,
            windowDurationMs = 1_000,
            gpsAvailable = false,
            gps = null,
            imu = ImuWindowAccumulator().closeWindow(50),
            health = DeviceHealthPayload(
                batteryPct = 70.0,
                charging = false,
                networkType = "OFFLINE",
                locationPermission = "PRECISE_FOREGROUND",
                gpsEnabled = false,
                collectorState = "ACTIVE",
                localOutboxPending = 4,
                appVersion = "2.1.0",
                osVersion = "Android",
                deviceModel = "pilot-device",
            ),
        )

        val encoded = TelemetryJson.encodeWindow(payload)

        assertTrue(encoded.contains("\"gps_available\":false"))
        assertTrue(encoded.contains("\"gps\":null"))
        assertFalse(encoded.contains("soc"))
        assertFalse(encoded.contains("bms"))
    }

    private fun assertEquals(expected: List<Double>, actual: List<Double>, delta: Double) {
        assertEquals(expected.size, actual.size)
        expected.zip(actual).forEach { (want, got) -> assertEquals(want, got, delta) }
    }
}
