package com.trickee.gpsdriver.telemetry.network

import androidx.work.NetworkType
import androidx.work.ExistingWorkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackfillWorkerTest {
    @Test
    fun backfillRequiresAConnectedNetwork() {
        assertEquals(NetworkType.CONNECTED, BackfillWorker.request().workSpec.constraints.requiredNetworkType)
    }

    @Test
    fun manualRecoveryCannotBeSuppressedByTheAutomaticBackoffJob() {
        val automatic = BackfillWorker.schedule()
        val recovery = BackfillWorker.schedule(tripId = "trip-519f2aaa", forceRecovery = true)

        assertEquals(ExistingWorkPolicy.KEEP, automatic.existingWorkPolicy)
        assertEquals(ExistingWorkPolicy.REPLACE, recovery.existingWorkPolicy)
        assertNotEquals(automatic.uniqueName, recovery.uniqueName)
        assertEquals(
            "trip-519f2aaa",
            recovery.request.workSpec.input.getString(BackfillWorker.INPUT_TRIP_ID),
        )
        assertTrue(recovery.request.workSpec.expedited)
    }
}
