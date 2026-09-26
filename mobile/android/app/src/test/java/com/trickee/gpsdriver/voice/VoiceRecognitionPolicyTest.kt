package com.trickee.gpsdriver.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceRecognitionPolicyTest {
    @Test
    fun `permission and service are both required before listening`() {
        assertEquals(VoiceStartDecision.PERMISSION_REQUIRED, VoiceRecognitionPolicy.startDecision(false, true))
        assertEquals(VoiceStartDecision.UNAVAILABLE, VoiceRecognitionPolicy.startDecision(true, false))
        assertEquals(VoiceStartDecision.START, VoiceRecognitionPolicy.startDecision(true, true))
    }

    @Test
    fun `recognizer errors are reduced to stable bridge codes`() {
        assertEquals("network", VoiceRecognitionPolicy.errorCode(2))
        assertEquals("no_match", VoiceRecognitionPolicy.errorCode(7))
        assertEquals("permission_denied", VoiceRecognitionPolicy.errorCode(9))
        assertEquals("unknown", VoiceRecognitionPolicy.errorCode(999))
    }

    @Test
    fun `unsupported requested locale uses the platform recognizer`() {
        assertEquals(
            RecognizerMode.PLATFORM,
            VoiceRecognitionPolicy.selectRecognizerMode(
                apiLevel = 35,
                requestedLocaleSupported = false,
                onDeviceAvailable = true,
            ),
        )
        assertEquals(
            RecognizerMode.ON_DEVICE,
            VoiceRecognitionPolicy.selectRecognizerMode(
                apiLevel = 35,
                requestedLocaleSupported = true,
                onDeviceAvailable = true,
            ),
        )
    }

    @Test
    fun `locale failure falls back to platform only once`() {
        assertTrue(
            VoiceRecognitionPolicy.shouldFallback(
                errorCode = "locale_unavailable",
                mode = RecognizerMode.ON_DEVICE,
                fallbackAlreadyUsed = false,
            ),
        )
        assertFalse(
            VoiceRecognitionPolicy.shouldFallback(
                errorCode = "locale_unavailable",
                mode = RecognizerMode.ON_DEVICE,
                fallbackAlreadyUsed = true,
            ),
        )
        assertFalse(
            VoiceRecognitionPolicy.shouldFallback(
                errorCode = "network",
                mode = RecognizerMode.ON_DEVICE,
                fallbackAlreadyUsed = false,
            ),
        )
    }

    @Test
    fun `starting session rejects a concurrent start and times out visibly`() {
        val session = VoiceSessionPolicy()

        assertTrue(session.begin())
        assertEquals(VoiceSessionState.STARTING, session.state)
        assertFalse(session.begin())

        assertEquals("start_timeout", session.readyTimeout())
        assertEquals(VoiceSessionState.FAILED, session.state)
    }
}
