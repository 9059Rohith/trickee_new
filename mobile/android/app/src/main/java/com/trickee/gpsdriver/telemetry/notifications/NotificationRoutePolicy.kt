package com.trickee.gpsdriver.telemetry.notifications

object NotificationRoutePolicy {
    private val boundedId = Regex("^[A-Za-z0-9_-]{1,80}$")

    fun deepLink(screen: String, planId: String?, legIndex: Int?): String? = when (screen) {
        "trip_start" -> if (
            planId != null && boundedId.matches(planId) && legIndex != null && legIndex in 0..99
        ) {
            "trickeegps://start-trip/$planId/$legIndex"
        } else {
            null
        }
        "route_nudge" -> "trickeegps://route-nudges"
        "daily_planner" -> "trickeegps://daily-planner"
        else -> null
    }
}
