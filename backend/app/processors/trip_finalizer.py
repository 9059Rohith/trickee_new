"""Deterministic trip finalizer that never treats manual SOC as BMS data."""
from __future__ import annotations

from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.entities import MobileTripSession, TelemetryWindow, TripFinalization


def finalize_trip(db: Session, event: dict) -> None:
    if event.get("event_type") != "trip.finalization_eligible":
        return
    trip_id = event["payload"]["trip_id"]
    trip = db.query(MobileTripSession).filter_by(id=trip_id).with_for_update().one()
    record = db.query(TripFinalization).filter_by(trip_id=trip_id).with_for_update().one()
    count, maximum = db.query(func.count(TelemetryWindow.sample_id), func.max(TelemetryWindow.sequence_no)).filter(
        TelemetryWindow.trip_id == trip_id,
        TelemetryWindow.sequence_no <= record.final_sequence_no,
    ).one()
    if int(maximum or 0) < record.final_sequence_no or int(count) < record.final_sequence_no:
        record.state = "waiting_for_telemetry"
        return
    record.processed_sequence_no = record.final_sequence_no
    record.summary = {
        "window_count": int(count),
        "final_sequence_no": record.final_sequence_no,
        "soc_source": "manual_dashboard",
        "estimated": True,
    }
    record.state = "completed"
    record.completed_at = datetime.utcnow()
    trip.finalization_state = "completed"
    trip.status = "completed"
