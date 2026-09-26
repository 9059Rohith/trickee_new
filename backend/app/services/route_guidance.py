from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy.orm import Session

from app.models.entities import (
    MobileTripSession,
    NotificationOutbox,
    RouteGuidanceSnapshot,
    Vehicle,
    VehicleLiveStateSnapshot,
)


GPS_MAX_AGE = timedelta(seconds=90)
PROVIDER_MAX_AGE = timedelta(minutes=5)
REFRESH_INTERVAL = timedelta(minutes=2)
RESERVE_SOC_PCT = 15.0


class GuidanceTools(Protocol):
    def plan_route_leg(self, origin: dict[str, float], destination: dict[str, float], departure_at: datetime) -> dict: ...
    def find_route_chargers(self, center: dict[str, float], radius_m: int = 5000) -> list[dict]: ...


@dataclass(frozen=True)
class GuidanceDecision:
    scanned: int = 0
    committed: int = 0
    queued: int = 0
    provider_errors: int = 0
    stale_rejections: int = 0


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _evidence_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return _utc_naive(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def _distance_km(left: dict[str, float], right: dict[str, float]) -> float:
    radius = 6371.0
    lat = math.radians(right["lat"] - left["lat"])
    lng = math.radians(right["lng"] - left["lng"])
    value = math.sin(lat / 2) ** 2 + math.cos(math.radians(left["lat"])) * math.cos(math.radians(right["lat"])) * math.sin(lng / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def route_corridor_centers(
    origin: dict[str, float],
    destination: dict[str, float],
    *,
    max_points: int = 5,
) -> list[dict[str, float]]:
    count = max(2, min(int(max_points), 5))
    return [{
        "lat": origin["lat"] + (destination["lat"] - origin["lat"]) * index / (count - 1),
        "lng": origin["lng"] + (destination["lng"] - origin["lng"]) * index / (count - 1),
    } for index in range(count)]


def rank_corridor_chargers(candidates: list[dict], centers: list[dict[str, float]]) -> list[dict]:
    ranked = []
    for candidate in candidates:
        coordinates = candidate.get("coordinates") or {}
        try:
            point = {"lat": float(coordinates["lat"]), "lng": float(coordinates["lng"])}
        except (KeyError, TypeError, ValueError):
            continue
        if candidate.get("source") != "google_places" or not centers:
            continue
        ranked.append((min(_distance_km(point, center) for center in centers), candidate))
    return [candidate for _, candidate in sorted(ranked, key=lambda item: item[0])]


def departure_change_is_material(previous: datetime | None, current: datetime | None) -> bool:
    return bool(previous and current and abs((current - previous).total_seconds()) >= 600)


def _arrival_soc(vehicle: Vehicle, starting_soc: object, distance_m: float) -> tuple[float | None, str]:
    if not isinstance(starting_soc, (int, float)) or isinstance(starting_soc, bool) or not 0 <= starting_soc <= 100:
        return None, "unavailable"
    if not vehicle.usable_kwh or not vehicle.certified_range or vehicle.certified_range <= 0:
        return None, "unavailable"
    rate = vehicle.usable_kwh * 1000.0 / vehicle.certified_range * 1.25
    arrival = max(0.0, float(starting_soc) - distance_m / 1000.0 * rate / (vehicle.usable_kwh * 10.0))
    return round(arrival, 1), "conservative_vehicle_spec"


def _enqueue(db: Session, trip: MobileTripSession, snapshot: RouteGuidanceSnapshot, kind: str, title: str, body: str, payload: dict, now: datetime) -> None:
    db.add(NotificationOutbox(
        idempotency_key=f"guidance:{snapshot.id}:{kind}",
        user_id=trip.user_id,
        driver_id=trip.driver_id,
        vehicle_id=trip.vehicle_id,
        planned_trip_id=trip.planned_trip_id,
        route_decision_id=snapshot.id,
        nudge_type=kind,
        title=title[:120],
        body=body[:500],
        payload={
            "screen": "route_nudge",
            "trip_id": trip.id,
            "guidance_snapshot_id": snapshot.id,
            "android_channel_id": "trickee_route_alerts_high",
            "delivery_priority": "high",
            **payload,
        },
        status="pending",
        due_at=now,
        created_at=now,
        updated_at=now,
    ))


def evaluate_active_trip_guidance(
    db: Session,
    *,
    tools: GuidanceTools,
    now: datetime | None = None,
    limit: int = 200,
) -> GuidanceDecision:
    now = _utc_naive(now or datetime.now(timezone.utc))
    scanned = committed = queued = provider_errors = stale_rejections = 0
    trips = db.query(MobileTripSession).filter(
        MobileTripSession.status == "active",
        MobileTripSession.destination_lat.is_not(None),
        MobileTripSession.destination_lng.is_not(None),
    ).order_by(MobileTripSession.started_at.desc()).limit(max(1, min(limit, 500))).all()
    for trip in trips:
        scanned += 1
        if not trip.vehicle_id:
            continue
        previous = db.query(RouteGuidanceSnapshot).filter_by(trip_id=trip.id).order_by(
            RouteGuidanceSnapshot.created_at.desc()
        ).first()
        if previous and previous.created_at > now - REFRESH_INTERVAL:
            continue
        state = db.get(VehicleLiveStateSnapshot, trip.vehicle_id)
        if not state or state.trip_id != trip.id or not state.gps_available or not state.received_at:
            continue
        gps_age = now - _utc_naive(state.received_at)
        if gps_age < timedelta(0) or gps_age > GPS_MAX_AGE or state.latitude is None or state.longitude is None:
            stale_rejections += 1
            continue
        origin = {"lat": float(state.latitude), "lng": float(state.longitude)}
        destination = {"lat": float(trip.destination_lat), "lng": float(trip.destination_lng)}
        try:
            route = tools.plan_route_leg(origin, destination, now.replace(tzinfo=timezone.utc))
        except Exception:
            provider_errors += 1
            db.rollback()
            continue
        evidence_at = _evidence_time(route.get("evidence_at"))
        distance_m = route.get("distance_m")
        duration_s = route.get("duration_s")
        if (
            route.get("source") != "google_routes"
            or evidence_at is None
            or now - evidence_at > PROVIDER_MAX_AGE
            or evidence_at - now > timedelta(minutes=1)
            or not isinstance(distance_m, (int, float))
            or isinstance(distance_m, bool)
            or not isinstance(duration_s, (int, float))
            or isinstance(duration_s, bool)
            or not math.isfinite(distance_m)
            or not math.isfinite(duration_s)
            or distance_m < 0
            or duration_s <= 0
        ):
            stale_rejections += 1
            continue
        vehicle = db.get(Vehicle, trip.vehicle_id)
        if vehicle is None:
            continue
        arrival_soc, soc_source = _arrival_soc(vehicle, (trip.context or {}).get("starting_soc"), float(distance_m))
        recommended_departure = None
        if trip.planned_trip_id is not None and trip.planned_leg_index is not None:
            from app.models.entities import DailyPlanLeg
            leg = db.query(DailyPlanLeg).filter_by(
                plan_id=trip.planned_trip_id, leg_index=trip.planned_leg_index
            ).first()
            if leg and leg.planned_arrival_at:
                recommended_departure = leg.planned_arrival_at - timedelta(seconds=float(duration_s))
        centers = route_corridor_centers(origin, destination)
        charger_candidates: list[dict] = []
        if arrival_soc is not None and arrival_soc < RESERVE_SOC_PCT:
            seen: set[str] = set()
            for center in centers:
                try:
                    rows = tools.find_route_chargers(center, radius_m=5000)
                except Exception:
                    provider_errors += 1
                    rows = []
                for row in rows[:10]:
                    key = str(row.get("place_id") or row.get("name") or row.get("coordinates"))
                    if key not in seen:
                        seen.add(key)
                        charger_candidates.append(row)
        ranked_chargers = rank_corridor_chargers(charger_candidates, centers)
        payload = {
            "provider_source": route["source"],
            "provider_evidence_at": evidence_at.replace(tzinfo=timezone.utc).isoformat(),
            "soc_source": soc_source,
            "recommended_departure_at": recommended_departure.replace(tzinfo=timezone.utc).isoformat() if recommended_departure else None,
            "charger_candidates": ranked_chargers[:3],
        }
        snapshot = RouteGuidanceSnapshot(
            trip_id=trip.id,
            provider=route["source"],
            route_id=route.get("route_id"),
            origin_lat=origin["lat"], origin_lng=origin["lng"],
            destination_lat=destination["lat"], destination_lng=destination["lng"],
            distance_km=round(float(distance_m) / 1000.0, 3),
            duration_seconds=int(duration_s),
            eta_at=now + timedelta(seconds=float(duration_s)),
            predicted_arrival_soc_pct=arrival_soc,
            reserve_soc_pct=RESERVE_SOC_PCT,
            confidence=float(route.get("confidence") or 0.0),
            is_estimated=True,
            stale_after=now + PROVIDER_MAX_AGE,
            payload=payload,
            created_at=now,
        )
        db.add(snapshot); db.flush()
        previous_arrival = previous.predicted_arrival_soc_pct if previous else None
        nudge = None
        if previous_arrival is not None and previous_arrival >= RESERVE_SOC_PCT and arrival_soc is not None and arrival_soc < RESERVE_SOC_PCT:
            nudge = (
                "low_arrival_soc",
                "Low predicted arrival battery",
                f"Estimated arrival SOC is {arrival_soc:.0f}%. Review a charging stop before relying on this route.",
            )
        else:
            previous_departure_raw = (previous.payload or {}).get("recommended_departure_at") if previous else None
            previous_departure = _evidence_time(previous_departure_raw)
            if departure_change_is_material(previous_departure, recommended_departure):
                nudge = (
                    "departure_changed",
                    "Recommended departure changed",
                    "Traffic changed the recommended departure by at least 10 minutes. Review the route before leaving.",
                )
            elif arrival_soc is not None and arrival_soc < RESERVE_SOC_PCT and ranked_chargers:
                charger = ranked_chargers[0]
                nudge = (
                    "charger_recommendation",
                    f"Charging option: {charger.get('name') or 'verified place'}",
                    "This charger is near the route corridor. Live connector availability is not confirmed.",
                )
        if nudge:
            _enqueue(db, trip, snapshot, nudge[0], nudge[1], nudge[2], {
                "destination_lat": destination["lat"],
                "destination_lng": destination["lng"],
                "arrival_soc_pct": arrival_soc,
                "provider_source": route["source"],
                "charger_place_id": ranked_chargers[0].get("place_id") if ranked_chargers else None,
                "availability_confirmed": False,
            }, now)
            queued += 1
        db.commit()
        committed += 1
    return GuidanceDecision(scanned, committed, queued, provider_errors, stale_rejections)
