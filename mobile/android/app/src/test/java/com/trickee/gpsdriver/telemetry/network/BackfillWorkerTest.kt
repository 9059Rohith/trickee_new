package com.trickee.gpsdriver.telemetry.network

import androidx.work.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Test

class BackfillWorkerTest {
    @Test
    fun backfillRequiresAConnectedNetwork() {
        assertEquals(NetworkType.CONNECTED, BackfillWorker.request().workSpec.constraints.requiredNetworkType)
    }
}
