package com.trickee.gpsdriver.telemetry.bridge

internal suspend fun <T> requestGoogleCredentialWithRecovery(
    request: suspend () -> T,
    clearProviderState: suspend () -> Unit,
    isRecoverable: (Throwable) -> Boolean,
): T {
    return try {
        request()
    } catch (firstFailure: Throwable) {
        if (!isRecoverable(firstFailure)) throw firstFailure
        clearProviderState()
        request()
    }
}
