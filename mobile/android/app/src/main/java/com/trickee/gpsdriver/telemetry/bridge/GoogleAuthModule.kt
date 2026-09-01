package com.trickee.gpsdriver.telemetry.bridge

import android.util.Base64
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.trickee.gpsdriver.BuildConfig
import com.trickee.gpsdriver.telemetry.security.HumanCredentialStore
import com.trickee.gpsdriver.telemetry.security.HumanSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.SecureRandom

class GoogleAuthModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val store = HumanCredentialStore(context)
    override fun getName() = "TrickeeGoogleAuth"

    @ReactMethod
    fun getGoogleIdToken(promise: Promise) {
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
            promise.reject("OAUTH_NOT_CONFIGURED", "TRICKEE_GOOGLE_WEB_CLIENT_ID is not configured")
            return
        }
        val nonce = Base64.encodeToString(
            ByteArray(32).also { SecureRandom().nextBytes(it) },
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val activity = currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "Google sign-in requires the foreground activity")
            return
        }
        scope.launch {
            try {
                val credential = CredentialManager.create(activity).getCredential(activity, request).credential
                if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    error("Unsupported Google credential type")
                }
                val google = GoogleIdTokenCredential.createFrom(credential.data)
                promise.resolve(Arguments.createMap().apply {
                    putString("idToken", google.idToken)
                    putString("nonce", nonce)
                })
            } catch (error: Exception) {
                promise.reject("GOOGLE_SIGN_IN_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun saveSession(value: ReadableMap, promise: Promise) {
        store.save(HumanSession(
            accessToken = requireNotNull(value.getString("accessToken")),
            refreshToken = if (value.hasKey("refreshToken") && !value.isNull("refreshToken")) value.getString("refreshToken") else null,
        ))
        promise.resolve(null)
    }

    @ReactMethod
    fun loadSession(promise: Promise) {
        val session = store.load() ?: return promise.resolve(null)
        promise.resolve(Arguments.createMap().apply {
            putString("accessToken", session.accessToken)
            putString("refreshToken", session.refreshToken)
        })
    }

    @ReactMethod
    fun clearSession(promise: Promise) {
        store.clear()
        promise.resolve(null)
    }
}
