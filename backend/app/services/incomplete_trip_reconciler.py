from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.entities import (
    DeviceTripUploadCursor,
    MobileTripSession,
    ServerOutbox,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    Vehicle,
)
from app.services.reconciliation import (
    MAX_MISSING_RANGES,
    MAX_RECONCILIATION_CANDIDATES,
    bounded_missing_ranges,
    percentage,
)


def _write_incomplete_label(
    db: Session,
    *,
    trip: MobileTripSession,
    captured_at: datetime,
) -> None:
    vehicle = (
        db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first()
        if trip.vehicle_id
        else None
    )
    context = trip.context or {}
    starting_soc = context.get("starting_soc")
    ending_soc = context.get("ending_soc")
    soc_delta = (
        round(float(starting_soc) - float(ending_soc), 2)
        if starting_soc is not None and ending_soc is not None
        else None
    )
    values = {
        "starting_soc_pct": starting_soc,
        "ending_soc_pct": ending_soc,
        "soc_delta_pct": soc_delta,
        "actual_energy_consumed_wh": None,
        "actual_wh_per_km": None,
        "usable_kwh_snapshot": vehicle.usable_kwh if vehicle else None,
        "label_source": "manual_dashboard",
        "label_confidence": 0.0,
        "is_training_eligible": False,
        "eligibility_reason": "incomplete_telemetry",
        "captured_at": captured_at,
    }
    label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).first()
    if label is None:
        db.add(TripEnergyLabel(trip_id=trip.id, **values))
        return
    for field, value in values.items():
        setattr(label, field, value)


def reconcile_incomplete_finalizations(
    db: Session,
    *,
    now: datetime | None = None,
    timeout_hours: int = 24,
) -> list[str]:
    """Close stale gaps honestly while retaining their data for late repair."""
    observed_at = now or datetime.utcnow()
    cutoff = observed_at - timedelta(hours=timeout_hours)
    candidates = (
        db.query(MobileTripSession, TripFinalization)
        .join(TripFinalization, TripFinalization.trip_id == MobileTripSession.id)
        .filter(
            MobileTripSession.finalization_state == "waiting_for_telemetry",
            MobileTripSession.completion_requested_at.is_not(None),
            MobileTripSession.completion_requested_at <= cutoff,
            TripFinalization.state == "waiting_for_telemetry",
        )
        .with_for_update()
        .order_by(MobileTripSession.completion_requested_at.asc())
        .limit(MAX_RECONCILIATION_CANDIDATES)
        .all()
    )
    reconciled: list[str] = []
    for trip, record in candidates:
        received = {
            int(sequence): bool(gps_available)
            for sequence, gps_available in db.query(TelemetryWindow.sequence_no, TelemetryWindow.gps_available).filter(
                TelemetryWindow.trip_id == trip.id,
                TelemetryWindow.sequence_no >= 1,
                TelemetryWindow.sequence_no <= record.final_sequence_no,
            ).all()
        }
        missing_ranges = bounded_missing_ranges(received, record.final_sequence_no, limit=MAX_MISSING_RANGES)
        missing_count = max(0, record.final_sequence_no - len(received))
        if missing_count == 0:
            continue
        record.state = "incomplete"
        record.completed_at = observed_at
        record.summary = {
            "calculation_status": "incomplete_telemetry",
            "final_sequence_no": record.final_sequence_no,
            "stored_windows": len(received),
            "actual_missing_sequences": missing_count,
            "missing_ranges": missing_ranges,
            "upload_completeness_pct": percentage(len(received), record.final_sequence_no),
            "gps_windows": sum(received.values()),
            "gps_availability_pct": percentage(sum(received.values()), len(received)),
            "end_to_end_gps_pct": percentage(sum(received.values()), record.final_sequence_no),
            "timeout_hours": timeout_hours,
            "timed_out_at": observed_at.isoformat(),
            "training_eligible": False,
        }
        trip.status = "incomplete"
        trip.finalization_state = "incomplete"
        _write_incomplete_label(db, trip=trip, captured_at=observed_at)
        reconciled.append(trip.id)
    db.commit()
    return reconciled


def promote_finalization_if_complete(
    db: Session,
    *,
    trip: MobileTripSession,
    cursor: DeviceTripUploadCursor,
    observed_at: datetime,
) -> bool:
    if trip.final_sequence_no is None:
        return False
    if trip.finalization_state not in {"waiting_for_telemetry", "incomplete"}:
        return False
    if cursor.highest_contiguous_sequence < trip.final_sequence_no:
        return False

    late_reconciliation = trip.finalization_state == "incomplete"
    trip.status = "finalizing"
    trip.finalization_state = "eligible"
    finalization = db.query(TripFinalization).filter_by(trip_id=trip.id).first()
    if finalization is not None:
        finalization.processed_sequence_no = cursor.highest_contiguous_sequence
        finalization.state = "eligible"
        finalization.completed_at = None
        finalization.updated_at = observed_at
        if late_reconciliation:
            finalization.summary = {
                "calculation_status": "late_telemetry_reconciliation_pending",
                "final_sequence_no": trip.final_sequence_no,
            }
    db.add(
        ServerOutbox(
            event_type="trip.finalization_eligible",
            aggregate_type="trip",
            aggregate_id=trip.id,
            payload={
                "trip_id": trip.id,
                "final_sequence_no": trip.final_sequence_no,
                "late_reconciliation": late_reconciliation,
            },
        )
    )
    return True
