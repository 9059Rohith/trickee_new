package com.trickeeandroid.telemetry.model

import com.google.gson.GsonBuilder
import com.google.gson.annotations.SerializedName

data class GpsPayload(
    val latitude: Double,
    val longitude: Double,
    @SerializedName("altitude_m") val altitudeM: Double?,
    @SerializedName("speed_mps") val speedMps: Double?,
    @SerializedName("bearing_deg") val bearingDeg: Double?,
    @SerializedName("horizontal_accuracy_m") val horizontalAccuracyM: Double?,
    @SerializedName("vertical_accuracy_m") val verticalAccuracyM: Double?,
    val provider: String,
    @SerializedName("is_mock_location") val isMockLocation: Boolean,
    @SerializedName("fix_time_utc_ms") val fixTimeUtcMs: Long,
    @SerializedName("fix_monotonic_time_ns") val fixMonotonicTimeNs: Long,
    @SerializedName("fix_age_ms") val fixAgeMs: Long,
)

data class ImuSummaryPayload(
    @SerializedName("accelerometer_sample_count") val accelerometerSampleCount: Int,
    @SerializedName("gyroscope_sample_count") val gyroscopeSampleCount: Int,
    @SerializedName("accelerometer_complete_pct") val accelerometerCompletePct: Double,
    @SerializedName("gyroscope_complete_pct") val gyroscopeCompletePct: Double,
    @SerializedName("accel_mean_mps2") val accelMeanMps2: List<Double>,
    @SerializedName("accel_std_mps2") val accelStdMps2: List<Double>,
    @SerializedName("accel_rms_mps2") val accelRmsMps2: List<Double>,
    @SerializedName("accel_min_mps2") val accelMinMps2: List<Double>,
    @SerializedName("accel_max_mps2") val accelMaxMps2: List<Double>,
    @SerializedName("accel_magnitude_rms_mps2") val accelMagnitudeRmsMps2: Double,
    @SerializedName("accel_magnitude_max_mps2") val accelMagnitudeMaxMps2: Double,
    @SerializedName("jerk_rms_mps3") val jerkRmsMps3: Double,
    @SerializedName("jerk_max_mps3") val jerkMaxMps3: Double,
    @SerializedName("gyro_mean_rads") val gyroMeanRads: List<Double>,
    @SerializedName("gyro_rms_rads") val gyroRmsRads: List<Double>,
    @SerializedName("gyro_max_abs_rads") val gyroMaxAbsRads: List<Double>,
    @SerializedName("accelerometer_present") val accelerometerPresent: Boolean,
    @SerializedName("gyroscope_present") val gyroscopePresent: Boolean,
    @SerializedName("accelerometer_accuracy") val accelerometerAccuracy: Int,
    @SerializedName("gyroscope_accuracy") val gyroscopeAccuracy: Int,
)

data class DeviceHealthPayload(
    @SerializedName("battery_pct") val batteryPct: Double,
    val charging: Boolean,
    @SerializedName("network_type") val networkType: String,
    @SerializedName("location_permission") val locationPermission: String,
    @SerializedName("gps_enabled") val gpsEnabled: Boolean,
    @SerializedName("collector_state") val collectorState: String,
    @SerializedName("local_outbox_pending") val localOutboxPending: Int,
    @SerializedName("app_version") val appVersion: String,
    @SerializedName("os_version") val osVersion: String,
    @SerializedName("device_model") val deviceModel: String,
)

data class TelemetryWindowPayload(
    @SerializedName("schema_version") val schemaVersion: Int = 1,
    @SerializedName("sample_id") val sampleId: String,
    @SerializedName("trip_id") val tripId: String,
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("vehicle_id") val vehicleId: String,
    @SerializedName("sequence_no") val sequenceNo: Long,
    @SerializedName("boot_id") val bootId: String,
    @SerializedName("event_time_utc_ms") val eventTimeUtcMs: Long,
    @SerializedName("monotonic_time_ns") val monotonicTimeNs: Long,
    @SerializedName("window_duration_ms") val windowDurationMs: Long,
    @SerializedName("gps_available") val gpsAvailable: Boolean,
    val gps: GpsPayload?,
    val imu: ImuSummaryPayload,
    val health: DeviceHealthPayload,
) {
    init {
        require(schemaVersion == 1) { "Only telemetry schema version 1 is supported" }
        require(sequenceNo >= 1) { "sequenceNo must be positive" }
        require(windowDurationMs > 0) { "windowDurationMs must be positive" }
        require(gpsAvailable == (gps != null)) { "gpsAvailable must agree with gps" }
    }
}

data class TelemetryBatchPayload(
    @SerializedName("schema_version") val schemaVersion: Int = 1,
    @SerializedName("batch_id") val batchId: String,
    @SerializedName("trip_id") val tripId: String,
    @SerializedName("device_id") val deviceId: String,
    val windows: List<TelemetryWindowPayload>,
)

object TelemetryJson {
    private val gson = GsonBuilder().serializeNulls().disableHtmlEscaping().create()

    fun encodeWindow(window: TelemetryWindowPayload): String = gson.toJson(window)

    fun encodeBatch(batch: TelemetryBatchPayload): String = gson.toJson(batch)
}
