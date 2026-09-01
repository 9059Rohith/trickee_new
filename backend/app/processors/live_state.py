"""Rebuildable live-state projection from canonical telemetry windows."""
from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.entities import TelemetryWindow, VehicleLiveStateSnapshot
from app.streams.redis_client import StreamClient


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
    state.trip_id = latest.trip_id
    state.state_version += 1
    state.sequence_no = latest.sequence_no
    state.event_time = latest.event_time
    state.received_at = latest.received_at
    state.gps_available = latest.gps_available
    state.latitude = latest.latitude
    state.longitude = latest.longitude
    state.health_payload = latest.health_payload
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
        "projection_status": state.projection_status,
    }
