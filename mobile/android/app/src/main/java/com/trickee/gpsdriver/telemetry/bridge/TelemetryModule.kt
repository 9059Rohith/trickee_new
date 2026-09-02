package com.trickee.gpsdriver.telemetry.bridge

import android.Manifest
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.gson.GsonBuilder
import com.trickee.gpsdriver.BuildConfig
import com.trickee.gpsdriver.telemetry.collector.TripCollectorService
import com.trickee.gpsdriver.telemetry.diagnostics.TelemetryDiagnosticSnapshot
import com.trickee.gpsdriver.telemetry.network.BackfillWorker
import com.trickee.gpsdriver.telemetry.security.DeviceCredentialStore
import com.trickee.gpsdriver.telemetry.security.DeviceSession
import com.trickee.gpsdriver.telemetry.storage.TelemetryDatabase
import com.trickee.gpsdriver.telemetry.storage.LocalTripEntity
import com.trickee.gpsdriver.telemetry.storage.OutboxState
import com.trickee.gpsdriver.telemetry.storage.TelemetryRepository
import com.trickee.gpsdriver.telemetry.storage.TelemetryStoragePolicy
import com.trickee.gpsdriver.telemetry.storage.TripState
import com.trickee.gpsdriver.telemetry.storage.StoragePressureLevel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.UUID

class TelemetryModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val credentials = DeviceCredentialStore(context)
    private val repository = TelemetryRepository(TelemetryDatabase.open(context).telemetryDao())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        // Opening the app must resume durable telemetry even when an older job is backing off.
        scope.launch {
            repository.latestEndedTrip()?.let { BackfillWorker.enqueueRecovery(context, it.tripId) }
                ?: BackfillWorker.enqueue(context)
        }
    }

    override fun getName(): String = "TrickeeTelemetry"

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "apiOrigin" to BuildConfig.API_ORIGIN,
        "websocketOrigin" to BuildConfig.WEBSOCKET_ORIGIN,
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
        if (storagePressure().level == StoragePressureLevel.CRITICAL) {
            promise.reject(
                "TELEMETRY_STORAGE_CRITICAL",
                "Free device storage before starting a new trip",
            )
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
            context.startService(TripCollectorService.stopIntent(context))
            var sealed: LocalTripEntity? = null
            withTimeoutOrNull(TRIP_SEAL_TIMEOUT_MS) {
                while (sealed == null) {
                    val trip = repository.trip(before.tripId)
                    if (
                        trip?.finalSequenceNo != null &&
                        trip.state in setOf(TripState.SYNC_PENDING, TripState.FINALIZING, TripState.COMPLETED)
                    ) {
                        sealed = trip
                        continue
                    }
                    delay(TRIP_SEAL_POLL_MS)
                }
            }
            val sealedTrip = sealed
            if (sealedTrip == null) {
                promise.reject("TRIP_SEAL_TIMEOUT", "Trip capture did not finish sealing within 15 seconds")
                return@launch
            }
            promise.resolve(Arguments.createMap().apply {
                putString("tripId", before.tripId)
                putInt("pendingWindowCount", repository.pendingCount(before.tripId))
                before.lastLatitude?.let { putDouble("lastLatitude", it) }
                before.lastLongitude?.let { putDouble("lastLongitude", it) }
                putDouble("finalSequenceNo", sealedTrip.finalSequenceNo!!.toDouble())
                putString("collectorState", sealedTrip.state.name)
            })
        }
    }

    @ReactMethod
    fun exportTelemetryDiagnostics(promise: Promise) {
        scope.launch {
            try {
                val trip = requireNotNull(repository.latestEndedTrip()) {
                    "No completed or sync-pending trip is available"
                }
                val generatedAtUtcMs = System.currentTimeMillis()
                val snapshot = TelemetryDiagnosticSnapshot.create(
                    trip = trip,
                    rows = repository.outboxForTrip(trip.tripId),
                    generatedAtUtcMs = generatedAtUtcMs,
                    appVersion = BuildConfig.VERSION_NAME,
                    packageName = BuildConfig.APPLICATION_ID,
                )
                val diagnosticsDirectory = File(context.cacheDir, DIAGNOSTICS_DIRECTORY).apply {
                    check(mkdirs() || isDirectory) { "Could not prepare diagnostics directory" }
                }
                diagnosticsDirectory.listFiles()?.forEach { oldFile ->
                    if (oldFile.isFile) oldFile.delete()
                }
                val file = File(
                    diagnosticsDirectory,
                    "gpsdriver-telemetry-${trip.tripId.take(8)}-$generatedAtUtcMs.json",
                )
                file.writeText(GsonBuilder().setPrettyPrinting().create().toJson(snapshot))

                val uri = FileProvider.getUriForFile(
                    context,
                    "${BuildConfig.APPLICATION_ID}.diagnostics",
                    file,
                )
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/json"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri("Telemetry diagnostics", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                withContext(Dispatchers.Main) {
                    val chooser = Intent.createChooser(shareIntent, "Share telemetry diagnostics")
                    val activity = currentActivity
                    if (activity != null) {
                        activity.startActivity(chooser)
                    } else {
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(chooser)
                    }
                }

                promise.resolve(Arguments.createMap().apply {
                    putString("tripId", trip.tripId)
                    putString("fileName", file.name)
                    putDouble("finalSequenceNo", (trip.finalSequenceNo ?: 0L).toDouble())
                    putInt("rowCount", snapshot.rows.size)
                    putDouble(
                        "localMissingCount",
                        snapshot.localMissingRanges.sumOf { range -> range[1] - range[0] + 1 }.toDouble(),
                    )
                    putInt("pendingCount", snapshot.stateCounts[OutboxState.PENDING.name] ?: 0)
                    putInt("inFlightCount", snapshot.stateCounts[OutboxState.IN_FLIGHT.name] ?: 0)
                    putInt("ackedCount", snapshot.stateCounts[OutboxState.ACKED.name] ?: 0)
                    putInt(
                        "permanentlyRejectedCount",
                        snapshot.stateCounts[OutboxState.PERMANENTLY_REJECTED.name] ?: 0,
                    )
                })
            } catch (error: Exception) {
                promise.reject(
                    "TELEMETRY_DIAGNOSTIC_EXPORT_FAILED",
                    error.message ?: "Could not export telemetry diagnostics",
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun retryPendingTelemetry(promise: Promise) {
        scope.launch {
            try {
                val trip = requireNotNull(repository.latestEndedTrip()) {
                    "No completed or sync-pending trip is available"
                }
                repository.repairKnownContractRejections(
                    tripId = trip.tripId,
                    nowUtcMs = System.currentTimeMillis(),
                )
                val eligibleWindowCount = repository.prepareDiagnosticRetry(
                    tripId = trip.tripId,
                    nowUtcMs = System.currentTimeMillis(),
                )
                BackfillWorker.enqueueRecovery(context, trip.tripId)
                val rows = repository.outboxForTrip(trip.tripId)
                promise.resolve(Arguments.createMap().apply {
                    putString("tripId", trip.tripId)
                    putInt("eligibleWindowCount", eligibleWindowCount)
                    putInt(
                        "pendingWindowCount",
                        rows.count { it.state == OutboxState.PENDING || it.state == OutboxState.IN_FLIGHT },
                    )
                    putInt(
                        "permanentlyRejectedCount",
                        rows.count { it.state == OutboxState.PERMANENTLY_REJECTED },
                    )
                })
            } catch (error: Exception) {
                promise.reject(
                    "TELEMETRY_DIAGNOSTIC_RETRY_FAILED",
                    error.message ?: "Could not retry pending telemetry",
                    error,
                )
            }
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

    private fun storagePressure() = context.getDatabasePath(TelemetryDatabase.DATABASE_NAME).let { database ->
        TelemetryStoragePolicy.evaluate(
            databaseBytes = if (database.exists()) database.length() else 0L,
            availableBytes = database.parentFile?.usableSpace ?: context.filesDir.usableSpace,
        )
    }

    private companion object {
        const val DIAGNOSTICS_DIRECTORY = "telemetry-diagnostics"
        const val TRIP_SEAL_TIMEOUT_MS = 15_000L
        const val TRIP_SEAL_POLL_MS = 50L
    }
}
