package com.trickee.gpsdriver.voice

import org.junit.Assert.assertEquals
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
}
