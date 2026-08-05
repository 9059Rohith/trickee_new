package com.trickeeandroid.telemetry.collector

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.trickeeandroid.BuildConfig
import com.trickeeandroid.MainActivity
import com.trickeeandroid.R
import com.trickeeandroid.telemetry.model.DeviceHealthPayload
import com.trickeeandroid.telemetry.model.GpsPayload
import com.trickeeandroid.telemetry.model.TelemetryJson
import com.trickeeandroid.telemetry.model.TelemetryWindowPayload
import com.trickeeandroid.telemetry.network.BackfillWorker
import com.trickeeandroid.telemetry.network.TelemetryUploader
import com.trickeeandroid.telemetry.security.DeviceCredentialStore
import com.trickeeandroid.telemetry.storage.TelemetryDatabase
import com.trickeeandroid.telemetry.storage.TelemetryRepository
import com.trickeeandroid.telemetry.storage.TripState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

data class CollectorStatus(
    val active: Boolean,
    val tripId: String?,
    val pendingWindowCount: Int,
    val lastLatitude: Double?,
    val lastLongitude: Double?,
    val collectorState: String,
)

class TripCollectorService : Service(), SensorEventListener {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var repository: TelemetryRepository
    private lateinit var uploader: TelemetryUploader
    private lateinit var sensorManager: SensorManager
    private lateinit var locationClient: FusedLocationProviderClient
    private var activeTripId: String? = null
    private var windowJob: Job? = null
    private var uploadJob: Job? = null
    private var accumulator = ImuWindowAccumulator()
    private var windowStartedNs = 0L
    private var latestLocation: Location? = null
    private var lastConsumedFixNs = -1L
    private var accelerometerAccuracy = 0
    private var gyroscopeAccuracy = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private val bootId by lazy { BootIdentity.current(this) }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let { latestLocation = it }
        }
    }

    override fun onCreate() {
        super.onCreate()
        repository = TelemetryRepository(TelemetryDatabase.open(this).telemetryDao())
        uploader = TelemetryUploader(repository, DeviceCredentialStore(this))
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val tripId = intent.getStringExtra(EXTRA_TRIP_ID) ?: return START_NOT_STICKY
                val deviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: return START_NOT_STICKY
                val vehicleId = intent.getStringExtra(EXTRA_VEHICLE_ID) ?: return START_NOT_STICKY
                startForegroundCollector(tripId, deviceId, vehicleId)
            }
            ACTION_STOP -> stopForegroundCollector()
            else -> recoverCollector()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundCollector(tripId: String, deviceId: String, vehicleId: String) {
        startForeground(NOTIFICATION_ID, notification("Recording GPS and motion"))
        scope.launch {
            if (repository.trip(tripId) == null) {
                repository.createTrip(tripId, deviceId, vehicleId, System.currentTimeMillis())
            }
            repository.setTripState(tripId, TripState.ACTIVE)
            beginCapture(tripId)
        }
    }

    private fun recoverCollector() {
        scope.launch {
            val trip = repository.activeTrip() ?: run { stopSelf(); return@launch }
            startForeground(NOTIFICATION_ID, notification("Recovering telemetry capture"))
            beginCapture(trip.tripId)
        }
    }

    private fun beginCapture(tripId: String) {
        if (activeTripId == tripId && windowJob?.isActive == true) return
        activeTripId = tripId
        if (wakeLock?.isHeld != true) {
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Trickee:TripTelemetry")
                .apply {
                    setReferenceCounted(false)
                    acquire()
                }
        }
        registerSensors()
        requestLocationUpdates()
        windowStartedNs = SystemClock.elapsedRealtimeNanos()
        windowJob?.cancel()
        windowJob = scope.launch {
            while (isActive) {
                val due = windowStartedNs + WINDOW_NS
                val delayMs = ((due - SystemClock.elapsedRealtimeNanos()) / 1_000_000).coerceAtLeast(1)
                delay(delayMs)
                commitElapsedWindow(partial = false)
            }
        }
        uploadJob?.cancel()
        uploadJob = scope.launch {
            while (isActive) {
                delay(2_000)
                uploader.runOnce(tripId)
                publishStatus("ACTIVE")
            }
        }
        publishStatus("ACTIVE")
    }

    private suspend fun commitElapsedWindow(partial: Boolean) {
        val tripId = activeTripId ?: return
        val trip = repository.trip(tripId) ?: return
        val nowNs = SystemClock.elapsedRealtimeNanos()
        val durationMs = ((nowNs - windowStartedNs) / 1_000_000).coerceAtLeast(1)
        if (!partial && durationMs < 900) return
        val imu = accumulator.closeWindow(EXPECTED_IMU_SAMPLES)
        val location = latestLocation?.takeIf {
            it.elapsedRealtimeNanos > lastConsumedFixNs && it.elapsedRealtimeNanos <= nowNs
        }
        val gps = location?.let {
            lastConsumedFixNs = it.elapsedRealtimeNanos
            GpsPayload(
                latitude = it.latitude,
                longitude = it.longitude,
                altitudeM = if (it.hasAltitude()) it.altitude else null,
                speedMps = if (it.hasSpeed()) it.speed.toDouble() else null,
                bearingDeg = if (it.hasBearing()) it.bearing.toDouble() else null,
                horizontalAccuracyM = if (it.hasAccuracy()) it.accuracy.toDouble() else null,
                verticalAccuracyM = if (Build.VERSION.SDK_INT >= 26 && it.hasVerticalAccuracy()) it.verticalAccuracyMeters.toDouble() else null,
                provider = it.provider ?: "fused",
                isMockLocation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) it.isMock else it.isFromMockProvider,
                fixTimeUtcMs = it.time,
                fixMonotonicTimeNs = it.elapsedRealtimeNanos,
                fixAgeMs = ((nowNs - it.elapsedRealtimeNanos) / 1_000_000).coerceAtLeast(0),
            )
        }
        val payload = TelemetryWindowPayload(
            sampleId = UUID.randomUUID().toString(),
            tripId = tripId,
            deviceId = trip.deviceId,
            vehicleId = trip.vehicleId,
            sequenceNo = trip.nextSequenceNo,
            bootId = bootId,
            eventTimeUtcMs = System.currentTimeMillis(),
            monotonicTimeNs = nowNs,
            windowDurationMs = durationMs,
            gpsAvailable = gps != null,
            gps = gps,
            imu = imu,
            health = deviceHealth(tripId),
        )
        repository.commitWindowAndAdvanceCursor(
            tripId,
            payload.sampleId,
            payload.eventTimeUtcMs,
            payload.monotonicTimeNs,
            TelemetryJson.encodeWindow(payload),
            System.currentTimeMillis(),
        )
        windowStartedNs = nowNs
    }

    private fun stopForegroundCollector() {
        scope.launch {
            val tripId = activeTripId
            windowJob?.cancel()
            if (tripId != null) {
                commitElapsedWindow(partial = true)
                val trip = repository.trip(tripId)
                val finalSequence = (trip?.nextSequenceNo ?: 1L) - 1L
                repository.recordEnd(tripId, finalSequence, System.currentTimeMillis())
                uploader.runOnce(tripId, backfill = true)
                BackfillWorker.enqueue(this@TripCollectorService)
            }
            unregisterCapture()
            activeTripId = null
            publishStatus("SYNC_PENDING")
            ServiceCompat.stopForeground(this@TripCollectorService, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun registerSensors() {
        val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        accumulator = ImuWindowAccumulator(accel != null, gyro != null)
        accel?.let { sensorManager.registerListener(this, it, SENSOR_PERIOD_US) }
        gyro?.let { sensorManager.registerListener(this, it, SENSOR_PERIOD_US) }
    }

    private fun requestLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            publishStatus("DEGRADED")
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000)
            .setMinUpdateIntervalMillis(500)
            .setMaxUpdateDelayMillis(2_000)
            .build()
        locationClient.requestLocationUpdates(request, locationCallback, mainLooper)
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> accumulator.addAccelerometer(
                event.values[0], event.values[1], event.values[2], event.timestamp, accelerometerAccuracy
            )
            Sensor.TYPE_GYROSCOPE -> accumulator.addGyroscope(
                event.values[0], event.values[1], event.values[2], event.timestamp, gyroscopeAccuracy
            )
        }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        when (sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> accelerometerAccuracy = accuracy
            Sensor.TYPE_GYROSCOPE -> gyroscopeAccuracy = accuracy
        }
    }

    private suspend fun deviceHealth(tripId: String): DeviceHealthPayload {
        val battery = (getSystemService(BATTERY_SERVICE) as BatteryManager)
        val locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        return DeviceHealthPayload(
            batteryPct = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100).toDouble(),
            charging = battery.isCharging,
            networkType = networkType(),
            locationPermission = if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) "PRECISE_FOREGROUND" else "DENIED",
            gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER),
            collectorState = "ACTIVE",
            localOutboxPending = repository.pendingCount(tripId),
            appVersion = BuildConfig.VERSION_NAME,
            osVersion = "Android ${Build.VERSION.RELEASE}",
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
        )
    }

    private fun networkType(): String {
        val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return "OFFLINE"
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            else -> "OTHER"
        }
    }

    private fun unregisterCapture() {
        windowJob?.cancel()
        uploadJob?.cancel()
        sensorManager.unregisterListener(this)
        locationClient.removeLocationUpdates(locationCallback)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private fun publishStatus(state: String) {
        val location = latestLocation
        val tripId = activeTripId
        scope.launch {
            currentStatus = CollectorStatus(
                active = tripId != null,
                tripId = tripId,
                pendingWindowCount = if (tripId == null) 0 else repository.pendingCount(tripId),
                lastLatitude = location?.latitude,
                lastLongitude = location?.longitude,
                collectorState = state,
            )
        }
    }

    private fun notification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Trickee trip recording")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(
            PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        ).build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Trip telemetry", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        unregisterCapture()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.trickeeandroid.telemetry.START"
        const val ACTION_STOP = "com.trickeeandroid.telemetry.STOP"
        const val EXTRA_TRIP_ID = "trip_id"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_VEHICLE_ID = "vehicle_id"
        private const val CHANNEL_ID = "trickee_trip_telemetry"
        private const val NOTIFICATION_ID = 2101
        private const val SENSOR_PERIOD_US = 20_000
        private const val EXPECTED_IMU_SAMPLES = 50
        private const val WINDOW_NS = 1_000_000_000L
        @Volatile var currentStatus = CollectorStatus(false, null, 0, null, null, "IDLE")
            private set

        fun startIntent(context: Context, tripId: String, deviceId: String, vehicleId: String) =
            Intent(context, TripCollectorService::class.java).setAction(ACTION_START)
                .putExtra(EXTRA_TRIP_ID, tripId)
                .putExtra(EXTRA_DEVICE_ID, deviceId)
                .putExtra(EXTRA_VEHICLE_ID, vehicleId)

        fun stopIntent(context: Context) = Intent(context, TripCollectorService::class.java).setAction(ACTION_STOP)
    }
}
