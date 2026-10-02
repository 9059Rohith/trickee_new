package com.trickee.gpsdriver.telemetry.bridge

import android.util.Base64
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
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
    private val credentialManager = CredentialManager.create(context)
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
        val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val activity = currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "Google sign-in requires the foreground activity")
            return
        }
        scope.launch {
            try {
                val credential = requestGoogleCredentialWithRecovery(
                    request = { credentialManager.getCredential(activity, request).credential },
                    clearProviderState = {
                        credentialManager.clearCredentialState(ClearCredentialStateRequest())
                    },
                    isRecoverable = { error ->
                        error is GetCredentialException &&
                            error !is GetCredentialCancellationException &&
                            error !is GetCredentialProviderConfigurationException &&
                            error !is GetCredentialUnsupportedException
                    },
                )
                if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    error("Unsupported Google credential type")
                }
                val google = GoogleIdTokenCredential.createFrom(credential.data)
                promise.resolve(Arguments.createMap().apply {
                    putString("idToken", google.idToken)
                    putString("nonce", nonce)
                })
            } catch (error: GetCredentialCancellationException) {
                promise.reject("GOOGLE_SIGN_IN_CANCELLED", "Google sign-in was cancelled", error)
            } catch (error: GetCredentialProviderConfigurationException) {
                promise.reject("GOOGLE_PROVIDER_CONFIGURATION", "Google sign-in provider is unavailable or misconfigured", error)
            } catch (error: GetCredentialUnsupportedException) {
                promise.reject("GOOGLE_CREDENTIALS_UNSUPPORTED", "Google sign-in is not supported by this device", error)
            } catch (error: Exception) {
                promise.reject(
                    "GOOGLE_SIGN_IN_FAILED",
                    error.message ?: "Google Credential Manager could not complete sign-in",
                    error,
                )
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
        scope.launch {
            try {
                credentialManager.clearCredentialState(ClearCredentialStateRequest())
            } catch (error: Exception) {
                Log.w(TAG, "Could not clear Google credential provider state during logout", error)
            }
            promise.resolve(null)
        }
    }

    companion object {
        private const val TAG = "TrickeeGoogleAuth"
    }
}
