package com.trickee.gpsdriver.voice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

class VoiceRecognitionModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), RecognitionListener, LifecycleEventListener {
    private var recognizer: SpeechRecognizer? = null
    private var recognizerMode = RecognizerMode.PLATFORM
    private var fallbackAttempted = false
    private var requestedLocale = "en-IN"
    private val session = VoiceSessionPolicy()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val readyTimeout = Runnable {
        val code = session.readyTimeout() ?: return@Runnable
        emit("failed", code = code)
        releaseRecognizer(resetSession = false)
    }

    init {
        context.addLifecycleEventListener(this)
    }

    override fun getName() = "TrickeeVoiceRecognition"

    @ReactMethod
    fun isAvailable(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val available = SpeechRecognizer.isRecognitionAvailable(context)
            val onDeviceAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
            promise.resolve(Arguments.createMap().apply {
                putBoolean("available", available)
                putBoolean("on_device_available", onDeviceAvailable)
            })
        }
    }

    @ReactMethod
    fun start(locale: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            val available = SpeechRecognizer.isRecognitionAvailable(context)
            when (VoiceRecognitionPolicy.startDecision(hasPermission, available)) {
                VoiceStartDecision.PERMISSION_REQUIRED -> {
                    promise.reject("permission_denied", "Microphone permission is required for voice entry")
                    return@runOnUiThread
                }
                VoiceStartDecision.UNAVAILABLE -> {
                    promise.reject("recognizer_unavailable", "Speech recognition is unavailable on this device")
                    return@runOnUiThread
                }
                VoiceStartDecision.START -> Unit
            }
            if (!session.begin()) {
                promise.reject("recognizer_busy", "A voice-entry session is already active")
                return@runOnUiThread
            }
            try {
                releaseRecognizer()
                session.begin()
                requestedLocale = locale.ifBlank { "en-IN" }
                fallbackAttempted = false
                // Android does not expose trustworthy locale capability data on all supported
                // versions. Prefer the platform recognizer unless the requested locale has been
                // positively verified; this avoids selecting an en-US-only offline recognizer for en-IN.
                recognizerMode = VoiceRecognitionPolicy.selectRecognizerMode(
                    apiLevel = Build.VERSION.SDK_INT,
                    requestedLocaleSupported = false,
                    onDeviceAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        SpeechRecognizer.isOnDeviceRecognitionAvailable(context),
                )
                startRecognizer(recognizerMode)
                emit("starting", onDevice = recognizerMode == RecognizerMode.ON_DEVICE)
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("started", true)
                    putBoolean("on_device", recognizerMode == RecognizerMode.ON_DEVICE)
                })
            } catch (error: Exception) {
                session.failed()
                releaseRecognizer(resetSession = false)
                promise.reject("recognizer_unavailable", error.message ?: "Could not start speech recognition", error)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            if (session.state == VoiceSessionState.STARTING || session.state == VoiceSessionState.LISTENING) {
                session.processing()
                emit("processing")
            }
            recognizer?.stopListening()
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            recognizer?.cancel()
            releaseRecognizer()
            emit("end")
            promise.resolve(null)
        }
    }

    override fun onReadyForSpeech(params: Bundle?) {
        mainHandler.removeCallbacks(readyTimeout)
        session.listening()
        emit("listening", onDevice = recognizerMode == RecognizerMode.ON_DEVICE)
    }
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() {
        session.processing()
        emit("processing")
    }

    override fun onError(error: Int) {
        mainHandler.removeCallbacks(readyTimeout)
        val code = VoiceRecognitionPolicy.errorCode(error)
        if (VoiceRecognitionPolicy.shouldFallback(code, recognizerMode, fallbackAttempted)) {
            fallbackAttempted = true
            releaseRecognizer(resetSession = false)
            session.reset()
            session.begin()
            recognizerMode = RecognizerMode.PLATFORM
            try {
                startRecognizer(recognizerMode)
                emit("starting", code = "platform_fallback", onDevice = false)
                return
            } catch (_: Exception) {
                // The stable failure below is actionable without exposing device internals.
            }
        }
        session.failed()
        emit("failed", code = code)
        releaseRecognizer(resetSession = false)
        emit("end")
    }

    override fun onResults(results: Bundle?) {
        mainHandler.removeCallbacks(readyTimeout)
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        session.completed()
        emit("completed", text = text)
        releaseRecognizer(resetSession = false)
        emit("end")
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!text.isNullOrBlank()) emit("partial", text = text)
    }

    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    private fun emit(type: String, text: String? = null, code: String? = null, onDevice: Boolean? = null) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("TrickeeVoiceRecognitionEvent", Arguments.createMap().apply {
                putString("type", type)
                if (text != null) putString("text", text)
                if (code != null) putString("code", code)
                if (onDevice != null) putBoolean("on_device", onDevice)
            })
    }

    private fun startRecognizer(mode: RecognizerMode) {
        recognizer = if (mode == RecognizerMode.ON_DEVICE && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }.also { it.setRecognitionListener(this) }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, requestedLocale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        recognizer?.startListening(intent)
        mainHandler.removeCallbacks(readyTimeout)
        mainHandler.postDelayed(readyTimeout, READY_TIMEOUT_MS)
    }

    private fun releaseRecognizer(resetSession: Boolean = true) {
        mainHandler.removeCallbacks(readyTimeout)
        recognizer?.destroy()
        recognizer = null
        recognizerMode = RecognizerMode.PLATFORM
        if (resetSession) session.reset()
    }

    override fun onHostResume() = Unit
    override fun onHostPause() = Unit
    override fun onHostDestroy() {
        UiThreadUtil.runOnUiThread { releaseRecognizer() }
    }

    override fun invalidate() {
        context.removeLifecycleEventListener(this)
        UiThreadUtil.runOnUiThread { releaseRecognizer() }
        super.invalidate()
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    companion object {
        private const val READY_TIMEOUT_MS = 8_000L
    }
}
