"""Rebuildable live-state projection from canonical telemetry windows."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.entities import TelemetryWindow, VehicleLiveStateSnapshot
from app.streams.redis_client import StreamClient


def advance_live_distance_km(
    *,
    previous_trip_id: str | None,
    next_trip_id: str,
    previous_latitude: float | None,
    previous_longitude: float | None,
    next_latitude: float | None,
    next_longitude: float | None,
    previous_distance_km: float,
) -> float:
    if previous_trip_id != next_trip_id:
        return 0.0
    values = (
        previous_latitude,
        previous_longitude,
        next_latitude,
        next_longitude,
    )
    if any(value is None or not math.isfinite(float(value)) for value in values):
        return max(0.0, previous_distance_km)
    lat1, lng1, lat2, lng2 = (float(value) for value in values)
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    step = radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    # A one-window teleport is invalid GPS for live range accounting.
    if step > 2.0:
        return max(0.0, previous_distance_km)
    return max(0.0, previous_distance_km) + step


def new_live_state(vehicle_id: str) -> VehicleLiveStateSnapshot:
    """Create an in-memory projection with defaults available before flush."""
    return VehicleLiveStateSnapshot(
        vehicle_id=vehicle_id,
        state_version=0,
        sequence_no=0,
        freshness="OFFLINE",
        gps_available=False,
        projection_status="SYNCING",
    )


def freshness_label(received_at: datetime | None, *, now: datetime | None = None,
                    gps_available: bool = True, syncing: bool = False, degraded: bool = False) -> str:
    if degraded:
        return "DEGRADED"
    if syncing:
        return "SYNCING"
    if received_at is None:
        return "OFFLINE"
    current = now or datetime.now(timezone.utc)
    value = received_at.replace(tzinfo=timezone.utc) if received_at.tzinfo is None else received_at
    age = (current - value).total_seconds()
    if age > 30:
        return "OFFLINE"
    if not gps_available:
        return "GPS_LOST"
    if age > 5:
        return "DELAYED"
    return "LIVE"


def project_live_state(db: Session, event: dict, streams: StreamClient | None = None) -> None:
    if event.get("event_type") != "telemetry.batch_committed":
        return
    payload = event["payload"]
    trip_id = payload["trip_id"]
    latest = db.query(TelemetryWindow).filter(TelemetryWindow.trip_id == trip_id).order_by(
        TelemetryWindow.sequence_no.desc()
    ).first()
    if latest is None:
        return
    state = db.query(VehicleLiveStateSnapshot).filter_by(vehicle_id=latest.vehicle_id).with_for_update().first()
    if state is None:
        state = new_live_state(latest.vehicle_id)
        db.add(state)
    if latest.sequence_no <= state.sequence_no:
        return
    previous_health = state.health_payload or {}
    live_distance_km = advance_live_distance_km(
        previous_trip_id=state.trip_id,
        next_trip_id=latest.trip_id,
        previous_latitude=state.latitude,
        previous_longitude=state.longitude,
        next_latitude=latest.latitude if latest.gps_available else None,
        next_longitude=latest.longitude if latest.gps_available else None,
        previous_distance_km=float(previous_health.get("live_distance_km") or 0.0),
    )
    state.trip_id = latest.trip_id
    state.state_version += 1
    state.sequence_no = latest.sequence_no
    state.event_time = latest.event_time
    state.received_at = latest.received_at
    state.gps_available = latest.gps_available
    state.latitude = latest.latitude
    state.longitude = latest.longitude
    state.health_payload = {
        **(latest.health_payload or {}),
        "live_distance_km": round(live_distance_km, 4),
    }
    state.freshness = freshness_label(latest.received_at, gps_available=latest.gps_available)
    state.projection_status = "CURRENT"
    db.flush()


def snapshot_dict(state: VehicleLiveStateSnapshot, *, now: datetime | None = None) -> dict:
    return {
        "vehicle_id": state.vehicle_id,
        "trip_id": state.trip_id,
        "state_version": state.state_version or 0,
        "sequence_no": state.sequence_no or 0,
        "event_time": state.event_time.isoformat() if state.event_time else None,
        "received_at": state.received_at.isoformat() if state.received_at else None,
        "freshness": freshness_label(
            state.received_at,
            now=now,
            gps_available=bool(state.gps_available),
            syncing=state.projection_status == "SYNCING",
            degraded=state.projection_status == "DEGRADED",
        ),
        "gps_available": bool(state.gps_available),
        "location": {"lat": state.latitude, "lng": state.longitude} if state.gps_available else None,
        "health": state.health_payload,
        "distance_km": float((state.health_payload or {}).get("live_distance_km") or 0.0),
        "projection_status": state.projection_status,
    }
