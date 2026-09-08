package com.trickee.gpsdriver.telemetry.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

class PushTokenSyncPolicyTest {
    @Test
    fun retries_auth_once_and_transient_failures() {
        assertEquals(PushTokenSyncDecision.REFRESH, decidePushTokenSync(401, allowRefresh = true))
        assertEquals(PushTokenSyncDecision.RETRY, decidePushTokenSync(401, allowRefresh = false))
        assertEquals(PushTokenSyncDecision.RETRY, decidePushTokenSync(429, allowRefresh = true))
        assertEquals(PushTokenSyncDecision.RETRY, decidePushTokenSync(503, allowRefresh = true))
    }

    @Test
    fun succeeds_only_on_2xx_and_does_not_loop_on_bad_payloads() {
        assertEquals(PushTokenSyncDecision.SUCCESS, decidePushTokenSync(204, allowRefresh = true))
        assertEquals(PushTokenSyncDecision.FAILURE, decidePushTokenSync(422, allowRefresh = true))
    }
}
