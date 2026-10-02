package com.trickee.gpsdriver.telemetry.storage

object TelemetryStoragePolicy {
    private const val MIB = 1024L * 1024L

    fun evaluate(databaseBytes: Long, availableBytes: Long): StoragePressure {
        require(databaseBytes >= 0) { "databaseBytes must not be negative" }
        require(availableBytes >= 0) { "availableBytes must not be negative" }
        val level = when {
            databaseBytes >= 500L * MIB || availableBytes < 100L * MIB -> StoragePressureLevel.CRITICAL
            databaseBytes >= 400L * MIB || availableBytes < 250L * MIB -> StoragePressureLevel.OPTIONAL_CAPTURE_BLOCKED
            databaseBytes >= 250L * MIB || availableBytes < 500L * MIB -> StoragePressureLevel.WARNING
            else -> StoragePressureLevel.NORMAL
        }
        return StoragePressure(level, databaseBytes, availableBytes)
    }
}
