package com.trickee.gpsdriver.telemetry.collector

import com.trickee.gpsdriver.telemetry.model.ImuSummaryPayload
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class ImuWindowAccumulator(
    private val accelerometerPresent: Boolean = true,
    private val gyroscopePresent: Boolean = true,
) {
    private data class Sample(val x: Double, val y: Double, val z: Double, val timeNs: Long)

    private val accelerometer = mutableListOf<Sample>()
    private val gyroscope = mutableListOf<Sample>()
    private var accelerometerAccuracy: Int = 0
    private var gyroscopeAccuracy: Int = 0

    @Synchronized
    fun addAccelerometer(x: Float, y: Float, z: Float, timestampNs: Long, accuracy: Int = 0) {
        accelerometer += Sample(x.toDouble(), y.toDouble(), z.toDouble(), timestampNs)
        accelerometerAccuracy = accuracy
    }

    @Synchronized
    fun addGyroscope(x: Float, y: Float, z: Float, timestampNs: Long, accuracy: Int = 0) {
        gyroscope += Sample(x.toDouble(), y.toDouble(), z.toDouble(), timestampNs)
        gyroscopeAccuracy = accuracy
    }

    @Synchronized
    fun closeWindow(expectedSamples: Int): ImuSummaryPayload {
        require(expectedSamples > 0) { "expectedSamples must be positive" }
        val accel = accelerometer.sortedBy { it.timeNs }
        val gyro = gyroscope.sortedBy { it.timeNs }
        accelerometer.clear()
        gyroscope.clear()

        return summarize(accel, gyro, expectedSamples)
    }

    @Synchronized
    fun closeWindow(
        windowStartNs: Long,
        windowEndNs: Long,
        expectedSamples: Int,
    ): ImuSummaryPayload {
        require(windowStartNs < windowEndNs) { "windowStartNs must be before windowEndNs" }
        require(expectedSamples > 0) { "expectedSamples must be positive" }
        val accel = accelerometer
            .filter { it.timeNs in windowStartNs until windowEndNs }
            .sortedBy { it.timeNs }
        val gyro = gyroscope
            .filter { it.timeNs in windowStartNs until windowEndNs }
            .sortedBy { it.timeNs }
        accelerometer.removeAll { it.timeNs < windowEndNs }
        gyroscope.removeAll { it.timeNs < windowEndNs }

        return summarize(accel, gyro, expectedSamples)
    }

    private fun summarize(
        accel: List<Sample>,
        gyro: List<Sample>,
        expectedSamples: Int,
    ): ImuSummaryPayload {

        val accelStats = axisStats(accel)
        val gyroStats = axisStats(gyro)
        val magnitudes = accel.map { magnitude(it) }
        val jerks = accel.zipWithNext().mapNotNull { (first, second) ->
            val seconds = (second.timeNs - first.timeNs) / 1_000_000_000.0
            if (seconds <= 0.0) null else sqrt(
                square((second.x - first.x) / seconds) +
                    square((second.y - first.y) / seconds) +
                    square((second.z - first.z) / seconds)
            )
        }

        return ImuSummaryPayload(
            accelerometerSampleCount = accel.size,
            gyroscopeSampleCount = gyro.size,
            accelerometerCompletePct = completeness(accel.size, expectedSamples),
            gyroscopeCompletePct = completeness(gyro.size, expectedSamples),
            accelMeanMps2 = accelStats.mean,
            accelStdMps2 = accelStats.std,
            accelRmsMps2 = accelStats.rms,
            accelMinMps2 = accelStats.min,
            accelMaxMps2 = accelStats.max,
            accelMagnitudeRmsMps2 = rms(magnitudes),
            accelMagnitudeMaxMps2 = magnitudes.maxOrNull() ?: 0.0,
            jerkRmsMps3 = rms(jerks),
            jerkMaxMps3 = jerks.maxOrNull() ?: 0.0,
            gyroMeanRads = gyroStats.mean,
            gyroRmsRads = gyroStats.rms,
            gyroMaxAbsRads = maxAbs(gyro),
            accelerometerPresent = accelerometerPresent,
            gyroscopePresent = gyroscopePresent,
            accelerometerAccuracy = accelerometerAccuracy,
            gyroscopeAccuracy = gyroscopeAccuracy,
        )
    }

    private data class AxisStats(
        val mean: List<Double>,
        val std: List<Double>,
        val rms: List<Double>,
        val min: List<Double>,
        val max: List<Double>,
    )

    private fun axisStats(samples: List<Sample>): AxisStats {
        if (samples.isEmpty()) {
            val zeros = listOf(0.0, 0.0, 0.0)
            return AxisStats(zeros, zeros, zeros, zeros, zeros)
        }
        val axes = listOf(
            samples.map { it.x },
            samples.map { it.y },
            samples.map { it.z },
        )
        val means = axes.map { values -> values.average() }
        return AxisStats(
            mean = means,
            std = axes.zip(means).map { (values, mean) ->
                sqrt(values.sumOf { square(it - mean) } / values.size)
            },
            rms = axes.map(::rms),
            min = axes.map { it.minOrNull() ?: 0.0 },
            max = axes.map { it.maxOrNull() ?: 0.0 },
        )
    }

    private fun maxAbs(samples: List<Sample>): List<Double> = listOf(
        samples.maxOfOrNull { abs(it.x) } ?: 0.0,
        samples.maxOfOrNull { abs(it.y) } ?: 0.0,
        samples.maxOfOrNull { abs(it.z) } ?: 0.0,
    )

    private fun magnitude(sample: Sample): Double = sqrt(
        square(sample.x) + square(sample.y) + square(sample.z)
    )

    private fun rms(values: List<Double>): Double =
        if (values.isEmpty()) 0.0 else sqrt(values.sumOf(::square) / values.size)

    private fun completeness(count: Int, expected: Int): Double =
        min(100.0, max(0.0, count.toDouble() * 100.0 / expected))

    private fun square(value: Double): Double = value * value
}
