package com.trickee.gpsdriver.telemetry.security

interface DeviceSessionStore {
    fun save(session: DeviceSession)
    fun load(): DeviceSession?
}
