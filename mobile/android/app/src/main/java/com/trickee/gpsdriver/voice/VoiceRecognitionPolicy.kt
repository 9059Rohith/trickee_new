package com.trickee.gpsdriver.voice

enum class VoiceStartDecision {
    START,
    PERMISSION_REQUIRED,
    UNAVAILABLE,
}

enum class RecognizerMode {
    ON_DEVICE,
    PLATFORM,
}

enum class VoiceSessionState {
    IDLE,
    STARTING,
    LISTENING,
    PROCESSING,
    COMPLETED,
    FAILED,
}

class VoiceSessionPolicy {
    var state: VoiceSessionState = VoiceSessionState.IDLE
        private set

    fun begin(): Boolean {
        if (state == VoiceSessionState.STARTING || state == VoiceSessionState.LISTENING || state == VoiceSessionState.PROCESSING) {
            return false
        }
        state = VoiceSessionState.STARTING
        return true
    }

    fun listening() {
        state = VoiceSessionState.LISTENING
    }

    fun processing() {
        state = VoiceSessionState.PROCESSING
    }

    fun completed() {
        state = VoiceSessionState.COMPLETED
    }

    fun failed() {
        state = VoiceSessionState.FAILED
    }

    fun reset() {
        state = VoiceSessionState.IDLE
    }

    fun readyTimeout(): String? {
        if (state != VoiceSessionState.STARTING) return null
        failed()
        return "start_timeout"
    }
}

object VoiceRecognitionPolicy {
    fun selectRecognizerMode(
        apiLevel: Int,
        requestedLocaleSupported: Boolean,
        onDeviceAvailable: Boolean,
    ): RecognizerMode = if (apiLevel >= 31 && onDeviceAvailable && requestedLocaleSupported) {
        RecognizerMode.ON_DEVICE
    } else {
        RecognizerMode.PLATFORM
    }

    fun shouldFallback(
        errorCode: String,
        mode: RecognizerMode,
        fallbackAlreadyUsed: Boolean,
    ): Boolean = mode == RecognizerMode.ON_DEVICE &&
        !fallbackAlreadyUsed &&
        errorCode == "locale_unavailable"

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
