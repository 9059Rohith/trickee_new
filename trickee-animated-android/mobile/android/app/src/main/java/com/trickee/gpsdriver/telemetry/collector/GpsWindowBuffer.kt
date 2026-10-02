package com.trickee.gpsdriver.telemetry.collector

import com.trickee.gpsdriver.telemetry.model.GpsPayload

class GpsWindowBuffer {
    private val fixes = mutableListOf<GpsPayload>()

    @Synchronized
    fun add(values: Iterable<GpsPayload>) {
        fixes.addAll(values)
        fixes.sortBy { it.fixMonotonicTimeNs }
    }

    @Synchronized
    fun takeBest(windowStartNs: Long, windowEndNs: Long): GpsPayload? {
        require(windowStartNs < windowEndNs) { "windowStartNs must be before windowEndNs" }
        val best = fixes
            .asSequence()
            .filter { it.fixMonotonicTimeNs in windowStartNs until windowEndNs }
            .maxWithOrNull(
                compareBy<GpsPayload> { it.fixMonotonicTimeNs }
                    .thenBy { -(it.horizontalAccuracyM ?: Double.MAX_VALUE) }
            )
        fixes.removeAll { it.fixMonotonicTimeNs < windowEndNs }
        return best
    }
}
