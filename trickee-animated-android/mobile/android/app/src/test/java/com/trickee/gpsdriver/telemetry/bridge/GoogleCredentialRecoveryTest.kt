package com.trickee.gpsdriver.telemetry.bridge

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class GoogleCredentialRecoveryTest {
    @Test
    fun recoverableFailureClearsProviderStateAndRetriesOnce() = runBlocking {
        var attempts = 0
        var clears = 0

        val result = requestGoogleCredentialWithRecovery(
            request = {
                attempts += 1
                if (attempts == 1) throw RecoverableCredentialFailure()
                "google-id-token"
            },
            clearProviderState = { clears += 1 },
            isRecoverable = { it is RecoverableCredentialFailure },
        )

        assertEquals("google-id-token", result)
        assertEquals(2, attempts)
        assertEquals(1, clears)
    }

    @Test
    fun nonRecoverableFailureIsReturnedWithoutClearingOrRetrying() {
        var attempts = 0
        var clears = 0

        assertThrows(NonRecoverableCredentialFailure::class.java) {
            runBlocking {
                requestGoogleCredentialWithRecovery(
                    request = {
                        attempts += 1
                        throw NonRecoverableCredentialFailure()
                    },
                    clearProviderState = { clears += 1 },
                    isRecoverable = { it is RecoverableCredentialFailure },
                )
            }
        }

        assertEquals(1, attempts)
        assertEquals(0, clears)
    }

    private class RecoverableCredentialFailure : RuntimeException()
    private class NonRecoverableCredentialFailure : RuntimeException()
}
