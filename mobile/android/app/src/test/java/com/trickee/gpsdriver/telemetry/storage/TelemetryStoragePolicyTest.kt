package com.trickee.gpsdriver.telemetry.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class TelemetryStoragePolicyTest {
    private val mib = 1024L * 1024L
    private val gib = 1024L * mib

    @Test
    fun criticalSpaceBlocksNewTripsWithoutDeletingPendingRows() {
        val pressure = TelemetryStoragePolicy.evaluate(
            databaseBytes = 450L * mib,
            availableBytes = 40L * mib,
        )

        assertEquals(StoragePressureLevel.CRITICAL, pressure.level)
    }

    @Test
    fun databaseSizeAndAvailableSpaceUseTheStricterThreshold() {
        assertEquals(
            StoragePressureLevel.WARNING,
            TelemetryStoragePolicy.evaluate(250L * mib, 2L * gib).level,
        )
        assertEquals(
            StoragePressureLevel.OPTIONAL_CAPTURE_BLOCKED,
            TelemetryStoragePolicy.evaluate(20L * mib, 200L * mib).level,
        )
        assertEquals(
            StoragePressureLevel.CRITICAL,
            TelemetryStoragePolicy.evaluate(500L * mib, 2L * gib).level,
        )
    }

    @Test
    fun normalSpaceAllowsCapture() {
        val pressure = TelemetryStoragePolicy.evaluate(
            databaseBytes = 20L * mib,
            availableBytes = 2L * gib,
        )

        assertEquals(StoragePressureLevel.NORMAL, pressure.level)
    }
}
