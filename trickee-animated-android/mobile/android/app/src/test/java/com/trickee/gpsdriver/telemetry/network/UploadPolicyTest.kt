package com.trickee.gpsdriver.telemetry.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadPolicyTest {
    @Test
    fun authorizationAndDeploymentFailuresRemainRetryable() {
        listOf(403, 404).forEach { status ->
            assertTrue(
                "$status must retain telemetry for retry",
                UploadFailurePolicy.decide(status, rowCount = 10, retryAfterSeconds = null) is
                    UploadFailureDecision.Retry,
            )
        }
        assertEquals(
            UploadFailureDecision.RefreshThenRetry,
            UploadFailurePolicy.decide(401, rowCount = 10, retryAfterSeconds = null),
        )
    }

    @Test
    fun payloadTooLargeRequestsBatchReduction() {
        assertEquals(
            UploadFailureDecision.ReduceBatch,
            UploadFailurePolicy.decide(413, rowCount = 20, retryAfterSeconds = null),
        )
        assertEquals(
            UploadFailureDecision.RetainOversizeSingle,
            UploadFailurePolicy.decide(413, rowCount = 1, retryAfterSeconds = null),
        )
    }

    @Test
    fun contractFailureBisectsBeforeDeadLetter() {
        assertEquals(
            UploadFailureDecision.BisectBatch,
            UploadFailurePolicy.decide(422, rowCount = 4, retryAfterSeconds = null),
        )
        assertEquals(
            UploadFailureDecision.DeadLetterSingle,
            UploadFailurePolicy.decide(422, rowCount = 1, retryAfterSeconds = null),
        )
    }

    @Test
    fun retryAfterIsCappedAtFiveMinutes() {
        assertEquals(
            UploadFailureDecision.Retry(300_000L),
            UploadFailurePolicy.decide(429, rowCount = 10, retryAfterSeconds = 3_600L),
        )
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

    @Test
    fun processWideLeaseRejectsForegroundAndWorkManagerInstances() {
        ProcessWideUploaderLease.release()
        assertTrue(ProcessWideUploaderLease.tryAcquire())
        assertFalse(ProcessWideUploaderLease.tryAcquire())
        ProcessWideUploaderLease.release()
    }
}
