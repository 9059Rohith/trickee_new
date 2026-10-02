package com.trickee.gpsdriver.telemetry.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class DeviceSession(
    val deviceId: String,
    val vehicleId: String,
    val apiOrigin: String,
    val accessToken: String,
    val refreshToken: String,
)

class DeviceCredentialStore(context: Context) : DeviceSessionStore {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun save(session: DeviceSession) {
        preferences.edit()
            .putString("device_id", session.deviceId)
            .putString("vehicle_id", session.vehicleId)
            .putString("api_origin", session.apiOrigin)
            .putString("access_token", encrypt(session.accessToken))
            .putString("refresh_token", encrypt(session.refreshToken))
            .apply()
    }

    override fun load(): DeviceSession? {
        val deviceId = preferences.getString("device_id", null) ?: return null
        val vehicleId = preferences.getString("vehicle_id", null) ?: return null
        val apiOrigin = preferences.getString("api_origin", null) ?: return null
        val access = preferences.getString("access_token", null) ?: return null
        val refresh = preferences.getString("refresh_token", null) ?: return null
        return try {
            DeviceSession(deviceId, vehicleId, apiOrigin, decrypt(access), decrypt(refresh))
        } catch (_: Exception) {
            clear()
            null
        }
    }

    fun clear() = preferences.edit().clear().apply()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val output = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(output, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val iv = bytes.copyOfRange(0, 12)
        val encrypted = bytes.copyOfRange(12, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }

    companion object {
        private const val PREFS = "trickee.device.credentials"
        private const val KEY_ALIAS = "trickee_device_credential_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
