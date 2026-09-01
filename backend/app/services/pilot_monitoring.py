from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.entities import (
    DeviceTripUploadCursor,
    MobileTripSession,
    ServerOutbox,
    TelemetryRejection,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    Vehicle,
    VehicleLiveStateSnapshot,
)
from app.schemas.api import utc_iso


RECENT_LIMIT = 20
RECENT_WINDOW = timedelta(hours=24)
STUCK_AFTER = timedelta(minutes=5)
MAX_MISSING_RANGES = 100


def _percentage(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100.0, 1)


def _age_seconds(now: datetime, value: datetime | None) -> int | None:
    if value is None:
        return None
    return max(0, int((now - value).total_seconds()))


def _missing_ranges(
    received_sequences: set[int],
    final_sequence_no: int | None,
) -> list[list[int]] | None:
    if final_sequence_no is None:
        return None
    ranges: list[list[int]] = []
    start: int | None = None
    for sequence in range(1, final_sequence_no + 1):
        if sequence not in received_sequences and start is None:
            start = sequence
        if sequence in received_sequences and start is not None:
            ranges.append([start, sequence - 1])
            start = None
            if len(ranges) >= MAX_MISSING_RANGES:
                return ranges
    if start is not None and len(ranges) < MAX_MISSING_RANGES:
        ranges.append([start, final_sequence_no])
    return ranges


def build_pilot_monitoring_snapshot(
    db: Session,
    *,
    now: datetime | None = None,
) -> dict:
    generated_at = now or datetime.utcnow()
    recent_after = generated_at - RECENT_WINDOW
    stuck_before = generated_at - STUCK_AFTER

    active_trips = (
        db.query(func.count(MobileTripSession.id))
        .filter(MobileTripSession.status == "active")
        .scalar()
        or 0
    )
    recent_windows, gps_windows = (
        db.query(
            func.count(TelemetryWindow.sample_id),
            func.sum(case((TelemetryWindow.gps_available.is_(True), 1), else_=0)),
        )
        .filter(TelemetryWindow.received_at >= recent_after)
        .one()
    )
    recent_windows = int(recent_windows or 0)
    gps_windows = int(gps_windows or 0)
    gps_gaps = recent_windows - gps_windows

    recent_rejection_count = (
        db.query(func.count(TelemetryRejection.id))
        .filter(TelemetryRejection.received_at >= recent_after)
        .scalar()
        or 0
    )
    pending_outbox, oldest_outbox = (
        db.query(func.count(ServerOutbox.id), func.min(ServerOutbox.created_at))
        .filter(ServerOutbox.state == "pending")
        .one()
    )
    pending_outbox = int(pending_outbox or 0)
    oldest_outbox_age = _age_seconds(generated_at, oldest_outbox)
    stuck_finalizations = (
        db.query(func.count(TripFinalization.trip_id))
        .filter(
            TripFinalization.state != "completed",
            TripFinalization.updated_at < stuck_before,
        )
        .scalar()
        or 0
    )

    live_rows = (
        db.query(VehicleLiveStateSnapshot, Vehicle.vehicle_code)
        .join(Vehicle, Vehicle.id == VehicleLiveStateSnapshot.vehicle_id)
        .order_by(VehicleLiveStateSnapshot.updated_at.desc())
        .limit(RECENT_LIMIT)
        .all()
    )
    live_vehicles = []
    for state, vehicle_code in live_rows:
        health = state.health_payload or {}
        live_vehicles.append(
            {
                "vehicle_id": state.vehicle_id,
                "vehicle_code": vehicle_code,
                "trip_id": state.trip_id,
                "freshness": state.freshness,
                "projection_status": state.projection_status,
                "sequence_no": state.sequence_no,
                "last_packet_at": utc_iso(state.received_at),
                "last_packet_age_seconds": _age_seconds(generated_at, state.received_at),
                "gps_available": state.gps_available,
                "latitude": state.latitude,
                "longitude": state.longitude,
                "collector_state": health.get("collector_state"),
                "local_outbox_pending": health.get("local_outbox_pending"),
            }
        )

    trips = (
        db.query(MobileTripSession)
        .order_by(MobileTripSession.started_at.desc())
        .limit(RECENT_LIMIT)
        .all()
    )
    trip_ids = [trip.id for trip in trips]
    vehicle_ids = {trip.vehicle_id for trip in trips if trip.vehicle_id}

    vehicle_codes = {
        row.id: row.vehicle_code
        for row in db.query(Vehicle).filter(Vehicle.id.in_(vehicle_ids)).all()
    } if vehicle_ids else {}
    window_counts = {
        trip_id: (int(total or 0), int(gps or 0))
        for trip_id, total, gps in (
            db.query(
                TelemetryWindow.trip_id,
                func.count(TelemetryWindow.sample_id),
                func.sum(case((TelemetryWindow.gps_available.is_(True), 1), else_=0)),
            )
            .filter(TelemetryWindow.trip_id.in_(trip_ids))
            .group_by(TelemetryWindow.trip_id)
            .all()
            if trip_ids
            else []
        )
    }
    cursor_by_trip = {
        trip_id: (int(contiguous or 0), int(received or 0))
        for trip_id, contiguous, received in (
            db.query(
                DeviceTripUploadCursor.trip_id,
                func.max(DeviceTripUploadCursor.highest_contiguous_sequence),
                func.max(DeviceTripUploadCursor.highest_received_sequence),
            )
            .filter(DeviceTripUploadCursor.trip_id.in_(trip_ids))
            .group_by(DeviceTripUploadCursor.trip_id)
            .all()
            if trip_ids
            else []
        )
    }
    received_sequences: dict[str, set[int]] = {trip_id: set() for trip_id in trip_ids}
    latest_phone_health: dict[str, tuple[int, datetime, dict]] = {}
    if trip_ids:
        for trip_id, sequence_no, received_at, health_payload in (
            db.query(
                TelemetryWindow.trip_id,
                TelemetryWindow.sequence_no,
                TelemetryWindow.received_at,
                TelemetryWindow.health_payload,
            )
            .filter(TelemetryWindow.trip_id.in_(trip_ids))
            .order_by(TelemetryWindow.trip_id, TelemetryWindow.sequence_no)
            .all()
        ):
            received_sequences.setdefault(trip_id, set()).add(int(sequence_no))
            latest_phone_health[trip_id] = (
                int(sequence_no),
                received_at,
                health_payload or {},
            )
    finalizations = {
        row.trip_id: row
        for row in (
            db.query(TripFinalization).filter(TripFinalization.trip_id.in_(trip_ids)).all()
            if trip_ids
            else []
        )
    }
    labels = {
        row.trip_id: row
        for row in (
            db.query(TripEnergyLabel).filter(TripEnergyLabel.trip_id.in_(trip_ids)).all()
            if trip_ids
            else []
        )
    }

    recent_trips = []
    for trip in trips:
        stored, gps = window_counts.get(trip.id, (0, 0))
        contiguous, cursor_highest_received = cursor_by_trip.get(trip.id, (0, 0))
        sequences = received_sequences.get(trip.id, set())
        highest_received = max(sequences, default=cursor_highest_received)
        finalization = finalizations.get(trip.id)
        label = labels.get(trip.id)
        stored_in_final_range = (
            sum(1 for sequence in sequences if sequence <= trip.final_sequence_no)
            if trip.final_sequence_no is not None
            else None
        )
        missing = (
            max(0, trip.final_sequence_no - (stored_in_final_range or 0))
            if trip.final_sequence_no is not None
            else None
        )
        phone_health = latest_phone_health.get(trip.id)
        phone_backlog = phone_health[2].get("local_outbox_pending") if phone_health else None
        phone_backlog_observed_at = phone_health[1] if phone_health else None
        stored_gps_pct = _percentage(gps, stored)
        upload_completeness_pct = (
            _percentage(stored_in_final_range or 0, trip.final_sequence_no)
            if trip.final_sequence_no is not None
            else None
        )
        recent_trips.append(
            {
                "trip_id": trip.id,
                "vehicle_id": trip.vehicle_id,
                "vehicle_code": vehicle_codes.get(trip.vehicle_id),
                "started_at": utc_iso(trip.started_at),
                "ended_at": utc_iso(trip.ended_at),
                "status": trip.status,
                "finalization_state": trip.finalization_state,
                "final_sequence_no": trip.final_sequence_no,
                "stored_windows": stored,
                "gps_windows": gps,
                "gps_availability_pct": stored_gps_pct,
                "stored_gps_pct": stored_gps_pct,
                "end_to_end_gps_pct": (
                    _percentage(gps, trip.final_sequence_no)
                    if trip.final_sequence_no is not None
                    else None
                ),
                "upload_completeness_pct": upload_completeness_pct,
                "highest_contiguous_sequence": contiguous,
                "highest_received_sequence": highest_received,
                "actual_missing_sequences": missing,
                "missing_ranges": _missing_ranges(sequences, trip.final_sequence_no),
                "phone_backlog": phone_backlog,
                "phone_backlog_observed_at": utc_iso(phone_backlog_observed_at),
                # Legacy keys remain during the dashboard rollout; their values now use honest semantics.
                "uploaded_through": contiguous,
                "processed_through": finalization.processed_sequence_no if finalization else None,
                "missing_sequences": missing,
                "finalizer_state": finalization.state if finalization else None,
                "training_eligible": label.is_training_eligible if label else None,
                "label_confidence": label.label_confidence if label else None,
            }
        )

    rejection_rows = (
        db.query(TelemetryRejection)
        .filter(TelemetryRejection.received_at >= recent_after)
        .order_by(TelemetryRejection.received_at.desc())
        .limit(RECENT_LIMIT)
        .all()
    )
    recent_rejections = [
        {
            "received_at": utc_iso(row.received_at),
            "trip_id": row.trip_id,
            "sequence_no": row.sequence_no,
            "code": row.code,
            "message": row.message,
        }
        for row in rejection_rows
    ]

    if stuck_finalizations or (oldest_outbox_age is not None and oldest_outbox_age > 300):
        service_status = "degraded"
    elif recent_rejection_count or pending_outbox or gps_gaps:
        service_status = "attention"
    else:
        service_status = "healthy"

    return {
        "generated_at": utc_iso(generated_at),
        "service_status": service_status,
        "summary": {
            "active_trips": int(active_trips),
            "recent_windows": recent_windows,
            "gps_gaps": gps_gaps,
            "gps_availability_pct": _percentage(gps_windows, recent_windows),
            "recent_rejections": int(recent_rejection_count),
            "pending_outbox": pending_outbox,
            "stuck_finalizations": int(stuck_finalizations),
            "oldest_outbox_age_seconds": oldest_outbox_age,
        },
        "live_vehicles": live_vehicles,
        "recent_trips": recent_trips,
        "recent_rejections": recent_rejections,
    }
