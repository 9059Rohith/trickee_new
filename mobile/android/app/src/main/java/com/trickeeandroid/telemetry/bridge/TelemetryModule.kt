package com.trickeeandroid.telemetry.bridge

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.trickeeandroid.BuildConfig
import com.trickeeandroid.telemetry.collector.TripCollectorService
import com.trickeeandroid.telemetry.security.DeviceCredentialStore
import com.trickeeandroid.telemetry.security.DeviceSession
import com.trickeeandroid.telemetry.storage.TelemetryDatabase
import com.trickeeandroid.telemetry.storage.TelemetryRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID

class TelemetryModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val credentials = DeviceCredentialStore(context)
    private val repository = TelemetryRepository(TelemetryDatabase.open(context).telemetryDao())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun getName(): String = "TrickeeTelemetry"

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "apiOrigin" to BuildConfig.API_ORIGIN,
    )

    @ReactMethod
    fun installationInfo(promise: Promise) {
        val prefs = context.getSharedPreferences("trickee.telemetry.installation", Context.MODE_PRIVATE)
        val installationId = prefs.getString("id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("id", it).apply()
        }
        promise.resolve(Arguments.createMap().apply {
            putString("installationId", installationId)
            putString("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            putString("appVersion", BuildConfig.VERSION_NAME)
            putString("platform", "android")
        })
    }

    @ReactMethod
    fun registerDevice(config: com.facebook.react.bridge.ReadableMap, promise: Promise) {
        try {
            credentials.save(
                DeviceSession(
                    deviceId = requireNotNull(config.getString("deviceId")),
                    vehicleId = requireNotNull(config.getString("vehicleId")),
                    apiOrigin = requireNotNull(config.getString("apiOrigin")).trimEnd('/'),
                    accessToken = requireNotNull(config.getString("accessToken")),
                    refreshToken = requireNotNull(config.getString("refreshToken")),
                )
            )
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("DEVICE_REGISTRATION_FAILED", error)
        }
    }

    @ReactMethod
    fun startTrip(config: com.facebook.react.bridge.ReadableMap, promise: Promise) {
        val session = credentials.load()
        if (session == null) {
            promise.reject("DEVICE_NOT_REGISTERED", "Register this Android installation before starting telemetry")
            return
        }
        val vehicleId = config.getString("vehicleId")
        if (vehicleId != session.vehicleId) {
            promise.reject("DEVICE_VEHICLE_MISMATCH", "Registered device is assigned to another vehicle")
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("LOCATION_PERMISSION_REQUIRED", "Precise foreground location is required")
            return
        }
        val tripId = requireNotNull(config.getString("tripId"))
        ContextCompat.startForegroundService(
            context,
            TripCollectorService.startIntent(context, tripId, session.deviceId, session.vehicleId),
        )
        promise.resolve(statusMap())
    }

    @ReactMethod
    fun stopTrip(promise: Promise) {
        val before = TripCollectorService.currentStatus
        if (!before.active || before.tripId == null) {
            scope.launch {
                val ended = repository.latestEndedTrip()
                promise.resolve(Arguments.createMap().apply {
                    putString("tripId", ended?.tripId)
                    putInt("pendingWindowCount", ended?.let { repository.pendingCount(it.tripId) } ?: 0)
                    putDouble("finalSequenceNo", (ended?.finalSequenceNo ?: 0L).toDouble())
                    putString("collectorState", if (ended == null) before.collectorState else "SYNC_PENDING")
                })
            }
            return
        }
        scope.launch {
            val trip = repository.trip(before.tripId)
            val finalSequence = trip?.nextSequenceNo ?: 0L
            context.startService(TripCollectorService.stopIntent(context))
            promise.resolve(Arguments.createMap().apply {
                putString("tripId", before.tripId)
                putInt("pendingWindowCount", before.pendingWindowCount + 1)
                before.lastLatitude?.let { putDouble("lastLatitude", it) }
                before.lastLongitude?.let { putDouble("lastLongitude", it) }
                putDouble("finalSequenceNo", finalSequence.toDouble())
                putString("collectorState", "SYNC_PENDING")
            })
        }
    }

    @ReactMethod fun status(promise: Promise) = promise.resolve(statusMap())
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    private fun statusMap() = Arguments.createMap().apply {
        val status = TripCollectorService.currentStatus
        val session = credentials.load()
        putBoolean("active", status.active)
        putString("tripId", status.tripId)
        putInt("pendingWindowCount", status.pendingWindowCount)
        putString("collectorState", status.collectorState)
        putString("deviceId", session?.deviceId)
        putString("vehicleId", session?.vehicleId)
    }
}
