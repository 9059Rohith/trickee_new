package com.trickee.gpsdriver

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchPresentationTest {
    private fun source(relative: String): String {
        val direct = File("src/main/$relative")
        val module = File(System.getProperty("user.dir"), "app/src/main/$relative")
        val file = if (direct.exists()) direct else module
        assertTrue("Missing Android source resource: ${file.absolutePath}", file.exists())
        return file.readText()
    }

    @Test
    fun appThemeUsesBrandedNonBlankLaunchDrawable() {
        val styles = source("res/values/styles.xml")
        val launchDrawable = source("res/drawable/trickee_launch_background.xml")
        val colors = source("res/values/colors.xml")

        assertTrue(styles.contains("<item name=\"android:windowBackground\">@drawable/trickee_launch_background</item>"))
        assertTrue(launchDrawable.contains("@color/app_background"))
        assertTrue(launchDrawable.contains("@drawable/trickee_splash_logo"))
        assertTrue(colors.contains("<color name=\"app_background\">#04060A</color>"))
    }

    @Test
    fun androidTwelveSplashHandsOffToTheSameSurface() {
        val styles31 = source("res/values-v31/styles.xml")
        assertTrue(styles31.contains("android:windowSplashScreenBackground\">@color/app_background"))
        assertTrue(styles31.contains("android:windowSplashScreenAnimatedIcon\">@drawable/trickee_splash_logo"))
        assertTrue(styles31.contains("android:windowSplashScreenAnimationDuration\">0</item>"))
    }

    @Test
    fun telemetryPermissionsAndServicesRemainUnchanged() {
        val manifest = source("AndroidManifest.xml")
        val permissions = Regex("<uses-permission android:name=\"([^\"]+)\"")
            .findAll(manifest)
            .map { it.groupValues[1] }
            .toSet()
        assertEquals(
            setOf(
                "android.permission.INTERNET",
                "android.permission.ACCESS_FINE_LOCATION",
                "android.permission.ACCESS_COARSE_LOCATION",
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_LOCATION",
                "android.permission.WAKE_LOCK",
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.RECORD_AUDIO",
            ),
            permissions,
        )
        assertTrue(manifest.contains("android:name=\".telemetry.collector.TripCollectorService\""))
        assertTrue(manifest.contains("android:foregroundServiceType=\"location\""))
        assertTrue(manifest.contains("android:name=\".telemetry.notifications.TrickeeFirebaseMessagingService\""))
    }
}
