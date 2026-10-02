package com.trickee.gpsdriver.telemetry.collector

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Monotonic, GPS-drift-tolerant stationary timer used by the foreground collector. */
class StationaryNudgeTracker(
    private val stationaryThresholdMs: Long = 7L * 60L * 1_000L,
    private val movementThresholdM: Double = 35.0,
    private val movingSpeedThresholdMps: Double = 1.0,
) {
    private var started = false
    private var lastMovementAtMs = 0L
    private var anchorLatitude: Double? = null
    private var anchorLongitude: Double? = null
    private var waitingAcknowledged = false
    var isPending: Boolean = false
        private set

    fun start(nowMs: Long, latitude: Double? = null, longitude: Double? = null) {
        started = true
        lastMovementAtMs = nowMs
        anchorLatitude = latitude
        anchorLongitude = longitude
        waitingAcknowledged = false
        isPending = false
    }

    fun observe(
        nowMs: Long,
        latitude: Double,
        longitude: Double,
        speedMps: Double?,
    ): Boolean {
        if (!started) start(nowMs, latitude, longitude)
        val anchorLat = anchorLatitude
        val anchorLng = anchorLongitude
        val displaced = if (anchorLat == null || anchorLng == null) {
            anchorLatitude = latitude
            anchorLongitude = longitude
            false
        } else {
            distanceMeters(anchorLat, anchorLng, latitude, longitude) >= movementThresholdM
        }
        val moving = (speedMps ?: 0.0) >= movingSpeedThresholdMps || displaced
        if (moving) {
            lastMovementAtMs = nowMs
            anchorLatitude = latitude
            anchorLongitude = longitude
            waitingAcknowledged = false
            isPending = false
            return false
        }
        if (!waitingAcknowledged && !isPending && nowMs - lastMovementAtMs >= stationaryThresholdMs) {
            isPending = true
            return true
        }
        return false
    }

    fun acknowledgeWaiting() {
        isPending = false
        waitingAcknowledged = true
    }

    fun reset() {
        started = false
        anchorLatitude = null
        anchorLongitude = null
        waitingAcknowledged = false
        isPending = false
    }

    private fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val earthRadiusM = 6_371_000.0
        val latitudeDelta = Math.toRadians(lat2 - lat1)
        val longitudeDelta = Math.toRadians(lng2 - lng1)
        val a = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return earthRadiusM * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
