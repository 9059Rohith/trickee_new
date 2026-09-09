package com.trickee.gpsdriver

import com.trickee.gpsdriver.telemetry.collector.TripCollectorService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppIdentityTest {
    @Test
    fun applicationIdBelongsToStandaloneGpsDriver() {
        assertEquals("com.trickee.gpsdriverapp", BuildConfig.APPLICATION_ID)
    }

    @Test
    fun appVersionMatchesDailyPlannerRelease() {
        assertEquals(15, BuildConfig.VERSION_CODE)
        assertEquals("1.0.14", BuildConfig.VERSION_NAME)
    }

    @Test
    fun collectorActionsAreScopedToStandaloneGpsDriver() {
        assertEquals("com.trickee.gpsdriver.telemetry.START", TripCollectorService.ACTION_START)
        assertEquals("com.trickee.gpsdriver.telemetry.STOP", TripCollectorService.ACTION_STOP)
    }

    @Test
    fun pilotArtifactIsBundledForTheHostedBackend() {
        if (BuildConfig.BUILD_TYPE == "pilot") {
            assertTrue(BuildConfig.API_ORIGIN.startsWith("https://"))
            assertTrue(BuildConfig.WEBSOCKET_ORIGIN.startsWith("https://"))
            assertFalse(BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank())
        }
    }
}
