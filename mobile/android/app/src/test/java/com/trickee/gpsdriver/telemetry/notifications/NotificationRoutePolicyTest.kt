package com.trickee.gpsdriver.telemetry.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationRoutePolicyTest {
    @Test
    fun plannedOccurrenceUsesBoundedStartRoute() {
        assertEquals(
            "trickeegps://start-trip/plan-1/2",
            NotificationRoutePolicy.deepLink("trip_start", "plan-1", 2),
        )
        assertNull(NotificationRoutePolicy.deepLink("trip_start", "../../admin", 2))
        assertNull(NotificationRoutePolicy.deepLink("trip_start", "plan-1", -1))
    }

    @Test
    fun knownNonPlanScreensUseFixedRoutes() {
        assertEquals("trickeegps://route-nudges", NotificationRoutePolicy.deepLink("route_nudge", null, null))
        assertEquals("trickeegps://daily-planner", NotificationRoutePolicy.deepLink("daily_planner", null, null))
        assertNull(NotificationRoutePolicy.deepLink("https://attacker.example", null, null))
    }
}
