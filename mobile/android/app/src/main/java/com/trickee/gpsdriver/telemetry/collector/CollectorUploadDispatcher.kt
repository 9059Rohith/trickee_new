package com.trickee.gpsdriver.telemetry.collector

import com.trickee.gpsdriver.telemetry.network.TelemetryUploadRunner

/** Narrow seam from collector lifecycle events to the exact-ACK uploader. */
internal class CollectorUploadDispatcher(private val uploader: TelemetryUploadRunner) {
    suspend fun flush(tripId: String, backfill: Boolean = false): Boolean =
        uploader.runOnce(tripId, backfill)
}
