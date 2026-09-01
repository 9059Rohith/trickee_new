package com.trickee.gpsdriver.telemetry.network

import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

object UploadPolicy {
    const val ONLINE_BATCH_LIMIT = 20
    const val BACKFILL_BATCH_LIMIT = 100
    const val MAX_UNCOMPRESSED_BYTES = 512 * 1024
    const val REQUEST_TIMEOUT_SECONDS = 15L
    const val MAX_RETRY_DELAY_MS = 300_000L

    fun isRetryableStatus(status: Int): Boolean =
        status in 500..599 || status == 408 || status == 425 || status == 429

    fun fullJitterDelayMs(attempt: Int, randomFraction: Double = Math.random()): Long {
        require(attempt >= 1)
        require(randomFraction in 0.0..1.0)
        val exponent = (attempt - 1).coerceAtMost(20)
        val ceiling = min(MAX_RETRY_DELAY_MS, 1_000L * (1L shl exponent))
        return (ceiling * randomFraction).toLong()
    }
}

class SingleUploaderLease {
    private val acquired = AtomicBoolean(false)
    fun tryAcquire(): Boolean = acquired.compareAndSet(false, true)
    fun release() = acquired.set(false)
}
