from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.daily_plan_tools import DailyPlanTools, estimate_leg_energy


def _local_datetime(service_date: date, local_time: str, timezone_name: str) -> datetime:
    hour, minute = (int(part) for part in local_time.split(":"))
    return datetime(service_date.year, service_date.month, service_date.day, hour, minute, tzinfo=ZoneInfo(timezone_name))


def build_plan_result(
    *,
    stops: list[dict],
    service_date: date,
    timezone_name: str,
    origin: dict[str, float],
    starting_soc_pct: float,
    usable_kwh: float | None,
    wh_per_km: float | None,
    tools: DailyPlanTools,
    energy_rate_source: str = "vehicle_spec_range_implied",
    now: datetime | None = None,
) -> dict:
    timezone = ZoneInfo(timezone_name)
    if now is None:
        local_now = datetime.now(timezone)
    elif now.tzinfo is None or now.utcoffset() is None:
        local_now = now.replace(tzinfo=timezone)
    else:
        local_now = now.astimezone(timezone)
    current_origin = origin
    current_soc: float | None = starting_soc_pct
    legs: list[dict] = []
    for index, stop in enumerate(stops):
        resolved = tools.resolve_destination(stop["label"])
        coordinates = resolved.get("coordinates")
        if not coordinates:
            legs.append({
                "index": index, "origin": current_origin, "destination": resolved,
                "requested_arrival_local": stop.get("requested_arrival_local"),
                "planned_departure_at": None, "estimated_arrival_at": None,
                "distance_m": None, "duration_s": None, "traffic_delay_s": None,
                "starting_soc_pct": current_soc, "energy_wh": None, "arrival_soc_pct": None,
                "chargers": [], "route_source": "unavailable", "energy_source": "unavailable",
                "confidence": 0.0, "degraded_reason": resolved.get("degraded_reason") or "destination_unresolved",
            })
            current_soc = None
            continue
        if not stop.get("requested_arrival_local"):
            legs.append({
                "index": index, "origin": current_origin, "destination": resolved,
                "requested_arrival_local": None, "planned_departure_at": None, "estimated_arrival_at": None,
                "distance_m": None, "duration_s": None, "traffic_delay_s": None,
                "starting_soc_pct": current_soc, "energy_wh": None, "arrival_soc_pct": None,
                "chargers": [], "route_source": "unavailable", "energy_source": "unavailable",
                "confidence": 0.0, "degraded_reason": "arrival_time_required",
            })
            current_origin = coordinates
            current_soc = None
            continue
        requested_arrival = _local_datetime(service_date, stop["requested_arrival_local"], timezone_name)
        if requested_arrival <= local_now:
            legs.append({
                "index": index, "origin": current_origin, "destination": resolved,
                "requested_arrival_local": stop["requested_arrival_local"],
                "planned_departure_at": None, "estimated_arrival_at": None,
                "distance_m": None, "duration_s": None, "traffic_delay_s": None,
                "starting_soc_pct": current_soc, "energy_wh": None, "arrival_soc_pct": None,
                "chargers": [], "route_source": "unavailable", "energy_source": "unavailable",
                "confidence": 0.0, "degraded_reason": "schedule_time_in_past",
            })
            continue
        route_query_departure = max(
            requested_arrival - timedelta(minutes=30),
            local_now + timedelta(minutes=1),
        )
        route = tools.plan_route_leg(current_origin, coordinates, route_query_departure)
        energy = estimate_leg_energy(distance_m=route.get("distance_m"), starting_soc_pct=current_soc, usable_kwh=usable_kwh, wh_per_km=wh_per_km, rate_source=energy_rate_source)
        duration_s = route.get("duration_s")
        departure = requested_arrival - timedelta(seconds=duration_s) if duration_s is not None else None
        degraded_reason = route.get("degraded_reason") or energy.get("degraded_reason")
        chargers = tools.find_route_chargers(coordinates, radius_m=5000) if energy.get("arrival_soc_pct") is not None and energy["arrival_soc_pct"] < 25 else []
        legs.append({
            "index": index, "origin": current_origin, "destination": resolved,
            "requested_arrival_local": stop["requested_arrival_local"],
            "planned_departure_at": departure.isoformat() if departure else None,
            "estimated_arrival_at": requested_arrival.isoformat() if duration_s is not None else None,
            "distance_m": route.get("distance_m"), "duration_s": duration_s,
            "traffic_delay_s": route.get("traffic_delay_s"), "starting_soc_pct": current_soc,
            "energy_wh": energy.get("energy_wh"), "arrival_soc_pct": energy.get("arrival_soc_pct"),
            "chargers": chargers, "route_source": route.get("source"),
            "energy_source": energy.get("energy_source"),
            "confidence": min(float(route.get("confidence") or 0), float(energy.get("confidence") or 0)),
            "degraded_reason": degraded_reason,
        })
        current_origin = coordinates
        current_soc = energy.get("arrival_soc_pct")
    return {
        "service_date": service_date.isoformat(), "timezone": timezone_name,
        "starting_soc_pct": starting_soc_pct, "legs": legs,
        "final_soc_pct": current_soc,
        "complete": bool(legs) and all(leg["degraded_reason"] is None for leg in legs),
    }
