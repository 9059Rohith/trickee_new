package com.trickeeandroid.telemetry.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadPolicyTest {
    @Test
    fun retriesOnlyTransientHttpResponses() {
        listOf(408, 425, 429, 500, 503, 599).forEach {
            assertTrue("$it must retry", UploadPolicy.isRetryableStatus(it))
        }
        listOf(400, 401, 403, 404, 409, 422).forEach {
            assertFalse("$it must be permanent", UploadPolicy.isRetryableStatus(it))
        }
    }

    @Test
    fun fullJitterBackoffStartsAtOneSecondAndCapsAtFiveMinutes() {
        assertEquals(500L, UploadPolicy.fullJitterDelayMs(attempt = 1, randomFraction = 0.5))
        assertEquals(2_000L, UploadPolicy.fullJitterDelayMs(attempt = 3, randomFraction = 0.5))
        assertEquals(150_000L, UploadPolicy.fullJitterDelayMs(attempt = 20, randomFraction = 0.5))
    }

    @Test
    fun oneUploaderLeaseRejectsConcurrentFlushesAndCanBeReleased() {
        val lease = SingleUploaderLease()

        assertTrue(lease.tryAcquire())
        assertFalse(lease.tryAcquire())
        lease.release()
        assertTrue(lease.tryAcquire())
    }
}
