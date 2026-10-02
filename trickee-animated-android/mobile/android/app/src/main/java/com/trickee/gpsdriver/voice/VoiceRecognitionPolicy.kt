package com.trickee.gpsdriver.voice

enum class VoiceStartDecision {
    START,
    PERMISSION_REQUIRED,
    UNAVAILABLE,
}

object VoiceRecognitionPolicy {
    fun startDecision(hasPermission: Boolean, recognizerAvailable: Boolean): VoiceStartDecision = when {
        !hasPermission -> VoiceStartDecision.PERMISSION_REQUIRED
        !recognizerAvailable -> VoiceStartDecision.UNAVAILABLE
        else -> VoiceStartDecision.START
    }

    fun errorCode(error: Int): String = when (error) {
        1, 2, 4, 10, 11 -> "network"
        6 -> "silence"
        7 -> "no_match"
        8 -> "recognizer_busy"
        9 -> "permission_denied"
        12, 13 -> "locale_unavailable"
        else -> "unknown"
    }
}
