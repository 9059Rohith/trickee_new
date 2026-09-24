"""Bounded, evidence-backed guidance for active GPS Driver trips."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import (
    DailyPlan, Driver, LiveNudgeEvaluation, MobileTripSession,
    NotificationOutbox, SOCReading, TripPrediction, User, Vehicle,
    VehicleLiveStateSnapshot,
)


EVALUATION_INTERVAL = timedelta(minutes=5)
GPS_MAX_AGE = timedelta(seconds=90)
NUDGE_EXPIRY = timedelta(minutes=30)


class MobilityTools(Protocol):
    def plan_route_leg(self, origin: dict[str, float], destination: dict[str, float], departure_at: datetime) -> dict: ...
    def find_route_chargers(self, center: dict[str, float], radius_m: int = 5000) -> list[dict]: ...


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _coordinates(lat: object, lng: object) -> dict[str, float] | None:
    if isinstance(lat, bool) or isinstance(lng, bool) or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": float(lat), "lng": float(lng)}


def _distance_km(a: dict[str, float], b: dict[str, float]) -> float:
    radius = 6371.0
    d_lat = math.radians(b["lat"] - a["lat"])
    d_lng = math.radians(b["lng"] - a["lng"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(d_lng / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1 - h)))


def _destination(db: Session, trip: MobileTripSession, now: datetime) -> tuple[dict[str, float], str] | None:
    explicit = _coordinates(trip.destination_lat, trip.destination_lng)
    if explicit:
        return explicit, (trip.destination_text or "Destination")[:120]
    plans = (
        db.query(DailyPlan)
        .filter(DailyPlan.user_id == trip.user_id, DailyPlan.vehicle_id == trip.vehicle_id, DailyPlan.status == "confirmed")
        .order_by(DailyPlan.confirmed_at.desc())
        .limit(5)
        .all()
    )
    candidates: list[tuple[datetime, dict[str, float], str]] = []
    for plan in plans:
        for leg in (plan.result_payload or {}).get("legs", []):
            raw_departure = leg.get("planned_departure_at")
            raw_arrival = leg.get("estimated_arrival_at")
            coordinates = (leg.get("destination") or {}).get("coordinates") or {}
            location = _coordinates(coordinates.get("lat"), coordinates.get("lng"))
            if not (raw_departure and raw_arrival and location):
                continue
            try:
                departure = _utc_naive(datetime.fromisoformat(raw_departure.replace("Z", "+00:00")))
                arrival = _utc_naive(datetime.fromisoformat(raw_arrival.replace("Z", "+00:00")))
            except ValueError:
                continue
            if departure - timedelta(hours=1) <= now <= arrival + timedelta(minutes=15):
                destination = leg.get("destination") or {}
                label = destination.get("name") or destination.get("query") or "Next stop"
                candidates.append((arrival, location, str(label)[:120]))
    if not candidates:
        return None
    _, location, label = min(candidates, key=lambda item: item[0])
    return location, label


def _energy_rate(db: Session, vehicle: Vehicle, now: datetime) -> tuple[float, str] | None:
    if not vehicle.usable_kwh or vehicle.usable_kwh <= 0:
        return None
    prediction = (
        db.query(TripPrediction)
        .filter(TripPrediction.vehicle_id == vehicle.id, TripPrediction.created_at >= now - timedelta(days=90), TripPrediction.created_at <= now)
        .order_by(TripPrediction.created_at.desc())
        .first()
    )
    if prediction and prediction.wh_per_km and prediction.confidence_numeric is not None:
        rate = float(prediction.wh_per_km)
        if 5 <= rate <= 200 and prediction.confidence_numeric >= 0.5 and math.isfinite(rate):
            return rate * 1.25, f"gps_prediction:{prediction.source}"
    if vehicle.certified_range and vehicle.certified_range > 0:
        rate = float(vehicle.usable_kwh) * 1000 / float(vehicle.certified_range) * 1.5
        if 5 <= rate <= 200 and math.isfinite(rate):
            return rate, "conservative_vehicle_spec"
    return None


def _confirmed_soc(db: Session, trip: MobileTripSession, now: datetime) -> tuple[str, datetime, float] | None:
    reading = (
        db.query(SOCReading)
        .filter(
            SOCReading.vehicle_id == trip.vehicle_id,
            SOCReading.driver_id == trip.driver_id,
            SOCReading.recorded_at >= trip.started_at,
            SOCReading.recorded_at <= now,
            SOCReading.confidence >= 0.75,
        )
        .order_by(SOCReading.recorded_at.desc())
        .first()
    )
    if reading and 0 <= reading.value <= 100:
        return reading.id, reading.recorded_at, float(reading.value)
    starting = (trip.context or {}).get("starting_soc")
    if isinstance(starting, (int, float)) and math.isfinite(starting) and 0 <= starting <= 100:
        return "trip_start", trip.started_at, float(starting)
    return None


def _claim_checkpoint(db: Session, trip: MobileTripSession, now: datetime) -> LiveNudgeEvaluation | None:
    cutoff = now - EVALUATION_INTERVAL
    checkpoint = db.get(LiveNudgeEvaluation, trip.id)
    if checkpoint is None:
        checkpoint = LiveNudgeEvaluation(trip_id=trip.id, last_evaluated_at=now, updated_at=now)
        db.add(checkpoint)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return None
        return checkpoint
    if checkpoint.last_evaluated_at and checkpoint.last_evaluated_at > cutoff:
        return None
    claimed = (
        db.query(LiveNudgeEvaluation)
        .filter(
            LiveNudgeEvaluation.trip_id == trip.id,
            or_(LiveNudgeEvaluation.last_evaluated_at.is_(None), LiveNudgeEvaluation.last_evaluated_at <= cutoff),
        )
        .update({LiveNudgeEvaluation.last_evaluated_at: now, LiveNudgeEvaluation.updated_at: now}, synchronize_session=False)
    )
    db.commit()
    if claimed != 1:
        return None
    db.refresh(checkpoint)
    return checkpoint


def _recent_count(db: Session, trip: MobileTripSession, now: datetime) -> int:
    return (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.vehicle_id == trip.vehicle_id,
            NotificationOutbox.created_at >= now - timedelta(hours=1),
            NotificationOutbox.idempotency_key.like(f"live:{trip.id}:%"),
        )
        .count()
    )


def _recent_type(db: Session, trip: MobileTripSession, nudge_type: str, now: datetime, cooldown: timedelta) -> bool:
    return db.query(NotificationOutbox.id).filter(
        NotificationOutbox.vehicle_id == trip.vehicle_id,
        NotificationOutbox.nudge_type == nudge_type,
        NotificationOutbox.created_at >= now - cooldown,
        NotificationOutbox.idempotency_key.like(f"live:{trip.id}:%"),
    ).first() is not None


def _enqueue(db: Session, trip: MobileTripSession, *, key: str, kind: str, title: str, body: str,
             payload: dict, now: datetime) -> None:
    db.add(NotificationOutbox(
        idempotency_key=key, user_id=trip.user_id, driver_id=trip.driver_id,
        vehicle_id=trip.vehicle_id, nudge_type=kind, title=title[:120], body=body[:500],
        payload={
            "screen": "route_nudge", "trip_id": trip.id,
            "android_channel_id": "trickee_route_alerts_high", "delivery_priority": "high",
            "expires_at": (now + NUDGE_EXPIRY).replace(tzinfo=timezone.utc).isoformat(),
            **payload,
        },
        status="pending", due_at=now, created_at=now, updated_at=now,
    ))


def evaluate_active_trip_nudges(db: Session, *, tools: MobilityTools, now: datetime | None = None,
                                limit: int = 500) -> dict[str, int]:
    """Queue at most one bounded evaluation per live trip every five minutes."""
    now = _utc_naive(now or datetime.now(timezone.utc))
    stats = {"scanned": 0, "eligible": 0, "queued": 0, "provider_errors": 0}
    trips = db.query(MobileTripSession).filter(MobileTripSession.status == "active").order_by(
        MobileTripSession.started_at.desc()
    ).limit(max(1, min(limit, 1000))).all()
    for trip in trips:
        stats["scanned"] += 1
        if not trip.vehicle_id:
            continue
        state = db.get(VehicleLiveStateSnapshot, trip.vehicle_id)
        if not state or state.trip_id != trip.id or not state.received_at or not state.gps_available:
            continue
        age = now - _utc_naive(state.received_at)
        location = _coordinates(state.latitude, state.longitude)
        if not (timedelta(0) <= age <= GPS_MAX_AGE and location):
            continue
        if any(wait.get("ended_at") is None for wait in (trip.context or {}).get("waits", [])):
            continue
        user = db.get(User, trip.user_id)
        driver = db.get(Driver, trip.driver_id)
        vehicle = db.get(Vehicle, trip.vehicle_id)
        if not (user and user.is_active and user.role == "driver" and user.driver_id == trip.driver_id
                and driver and driver.assigned_vehicle_id == trip.vehicle_id
                and vehicle and vehicle.is_active and user.fleet_id == driver.fleet_id == vehicle.fleet_id):
            continue
        checkpoint = _claim_checkpoint(db, trip, now)
        if checkpoint is None:
            continue
        stats["eligible"] += 1
        live_distance = float((state.health_payload or {}).get("live_distance_km") or 0)
        if not math.isfinite(live_distance) or live_distance < 0:
            live_distance = 0.0
        soc_reading = _confirmed_soc(db, trip, now)
        if soc_reading and soc_reading[0] != checkpoint.soc_anchor_key:
            key, recorded_at, pct = soc_reading
            checkpoint.soc_anchor_key = key
            checkpoint.soc_anchor_at = recorded_at
            checkpoint.soc_anchor_pct = pct
            checkpoint.soc_anchor_distance_km = 0.0 if recorded_at <= trip.started_at + timedelta(minutes=1) else live_distance
            db.commit()
        energy = _energy_rate(db, vehicle, now)
        current_soc = None
        if energy and checkpoint.soc_anchor_pct is not None and vehicle.usable_kwh:
            driven = max(0.0, live_distance - float(checkpoint.soc_anchor_distance_km or 0))
            current_soc = round(max(0.0, min(100.0, checkpoint.soc_anchor_pct - driven * energy[0] / (vehicle.usable_kwh * 10))), 1)
        destination = _destination(db, trip, now)
        route: dict = {}
        if destination:
            try:
                route = tools.plan_route_leg(
                    location, destination[0], (now + timedelta(minutes=1)).replace(tzinfo=timezone.utc)
                )
            except Exception:
                stats["provider_errors"] += 1
        distance_m = route.get("distance_m")
        duration_s = route.get("duration_s")
        verified_route = (
            route.get("source") == "google_routes"
            and isinstance(distance_m, (int, float)) and not isinstance(distance_m, bool)
            and isinstance(duration_s, (int, float)) and not isinstance(duration_s, bool)
            and math.isfinite(distance_m) and math.isfinite(duration_s)
            and distance_m >= 0 and duration_s > 0
        )
        arrival_soc = None
        if verified_route and current_soc is not None and energy and vehicle.usable_kwh:
            arrival_soc = round(max(0.0, current_soc - route["distance_m"] / 1000 * energy[0] / (vehicle.usable_kwh * 10)), 1)
        base_payload = {
            "destination_lat": destination[0]["lat"] if destination else None,
            "destination_lng": destination[0]["lng"] if destination else None,
            "route_name": destination[1] if destination else None,
            "current_soc_pct": current_soc,
            "arrival_soc_pct": arrival_soc,
            "soc_source": energy[1] if energy else "unavailable",
            "provider_source": route.get("source") or "unavailable",
            "evidence_at": route.get("evidence_at") or now.replace(tzinfo=timezone.utc).isoformat(),
        }
        queued = 0
        recent = _recent_count(db, trip, now)
        critical_soc = current_soc is not None and current_soc <= 10
        if current_soc is not None and (current_soc <= 20 or (arrival_soc is not None and arrival_soc < 15)):
            threshold = "10" if current_soc <= 10 else "20" if current_soc <= 20 else "arrival15"
            anchor_key = checkpoint.soc_anchor_key or "unknown"
            key = f"live:{trip.id}:soc:{anchor_key}:{threshold}"
            if (critical_soc or recent + queued < 4) and not db.query(NotificationOutbox.id).filter_by(idempotency_key=key).first():
                message = (
                    f"Estimated battery is near {current_soc:.0f}%. Check your dashboard SOC and charging options."
                    if current_soc <= 20 else
                    f"Estimated arrival battery is near {arrival_soc:.0f}%. Check your dashboard SOC."
                )
                _enqueue(db, trip, key=key, kind="live_soc", title="Battery check recommended", body=message,
                         payload={**base_payload, "soc_threshold": threshold}, now=now)
                queued += 1
        traffic_delay = route.get("traffic_delay_s")
        duration = route.get("duration_s")
        if (verified_route and isinstance(traffic_delay, (int, float)) and not isinstance(traffic_delay, bool)
                and math.isfinite(traffic_delay) and traffic_delay >= 600
                and duration > traffic_delay and traffic_delay >= (duration - traffic_delay) * 0.2
                and recent + queued < 4
                and not _recent_type(db, trip, "live_route", now, timedelta(minutes=30))):
            bucket = int(now.timestamp() // (30 * 60))
            _enqueue(
                db, trip, key=f"live:{trip.id}:route:{bucket}", kind="live_route",
                title="Traffic has changed your route",
                body=f"Traffic adds about {round(traffic_delay / 60)} min to {destination[1]}. Open the map to review.",
                payload={**base_payload, "traffic_delay_s": int(traffic_delay), "route_duration_s": int(duration)}, now=now,
            )
            queued += 1
        needs_charger = current_soc is not None and (current_soc <= 25 or (arrival_soc is not None and arrival_soc <= 20))
        if needs_charger and energy and recent + queued < 4 and not _recent_type(db, trip, "live_charger", now, timedelta(hours=1)):
            try:
                places = tools.find_route_chargers(location, radius_m=5000)
            except Exception:
                places = []
                stats["provider_errors"] += 1
            reachable_range_km = current_soc * vehicle.usable_kwh * 10 / energy[0]
            viable = []
            for place in places[:10]:
                if not isinstance(place, dict):
                    continue
                point = _coordinates((place.get("coordinates") or {}).get("lat"), (place.get("coordinates") or {}).get("lng"))
                if place.get("source") != "google_places" or not point:
                    continue
                distance_km = _distance_km(location, point)
                if distance_km <= 5 and distance_km * 1.2 <= reachable_range_km:
                    viable.append((distance_km, place, point))
            if viable:
                distance_km, place, point = min(viable, key=lambda item: item[0])
                name = str(place.get("name") or "Nearby charger")[:80]
                bucket = int(now.timestamp() // 3600)
                _enqueue(
                    db, trip, key=f"live:{trip.id}:charger:{bucket}", kind="live_charger",
                    title=f"Charging option: {name}",
                    body=f"Listed about {distance_km:.1f} km away. Connector availability is unconfirmed.",
                    payload={
                        **base_payload, "destination_lat": point["lat"], "destination_lng": point["lng"],
                        "route_name": name, "charger_place_id": place.get("place_id"),
                        "provider_source": "google_places", "place_confirmed": True,
                        "availability_confirmed": False,
                        "charger_distance_km": round(distance_km, 2), "evidence_at": place.get("evidence_at"),
                    }, now=now,
                )
                queued += 1
        db.refresh(trip, with_for_update=True)
        if trip.status != "active":
            db.rollback()
            continue
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Another evaluator created the same unique occurrence first.
            queued = 0
        stats["queued"] += queued
    return stats
