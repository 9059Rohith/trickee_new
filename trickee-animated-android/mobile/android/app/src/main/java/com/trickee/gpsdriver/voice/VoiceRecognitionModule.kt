package com.trickee.gpsdriver.voice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
    private var usingOnDevice = false

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
            try {
                releaseRecognizer()
                recognizer = if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
                ) {
                    usingOnDevice = true
                    SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                } else {
                    usingOnDevice = false
                    SpeechRecognizer.createSpeechRecognizer(context)
                }.also { it.setRecognitionListener(this) }

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale.ifBlank { "en-IN" })
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                }
                recognizer?.startListening(intent)
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("started", true)
                    putBoolean("on_device", usingOnDevice)
                })
            } catch (error: Exception) {
                releaseRecognizer()
                promise.reject("recognizer_unavailable", error.message ?: "Could not start speech recognition", error)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        UiThreadUtil.runOnUiThread {
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

    override fun onReadyForSpeech(params: Bundle?) = emit("listening", onDevice = usingOnDevice)
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = emit("processing")

    override fun onError(error: Int) {
        emit("error", code = VoiceRecognitionPolicy.errorCode(error))
        releaseRecognizer()
        emit("end")
    }

    override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!text.isNullOrBlank()) emit("final", text = text)
        releaseRecognizer()
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

    private fun releaseRecognizer() {
        recognizer?.destroy()
        recognizer = null
        usingOnDevice = false
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
}
