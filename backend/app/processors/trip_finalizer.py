"""Deterministic telemetry trip finalizer with explicit GPS/SOC provenance."""
from __future__ import annotations

from datetime import datetime
from statistics import mean

from sqlalchemy.orm import Session

from app.models.entities import MobileTripSession, TelemetryWindow, TripEnergyLabel, TripFinalization, Vehicle
from app.services.physics_energy import estimate_remaining_range, estimate_soc_consumed, estimate_trip_energy
from app.services.physics_gps import calculate_acceleration_mps2, calculate_grade_pct, calculate_speed_mps, haversine_distance
from app.services.reconciliation import MAX_FINAL_SEQUENCE_NO, bounded_missing_ranges
from app.services.trip_energy_labels import build_trip_energy_label


CALCULATION_VERSION = "telemetry-physics-v1"
MAX_ACCURACY_M = 50.0
MAX_SPEED_MPS = 45.0
MAX_ACCELERATION_MPS2 = 8.0
MAX_MISSING_SEQUENCE_PREVIEW = 100


def _valid_gps(window: TelemetryWindow) -> bool:
    payload = window.gps_payload or {}
    accuracy = payload.get("horizontal_accuracy_m")
    return bool(
        window.gps_available
        and window.latitude is not None
        and window.longitude is not None
        and not payload.get("is_mock_location", False)
        and (accuracy is None or 0 <= float(accuracy) <= MAX_ACCURACY_M)
    )


def _physics_summary(windows: list[TelemetryWindow], vehicle: Vehicle | None) -> dict | None:
    gps_windows = [window for window in windows if _valid_gps(window)]
    if len(gps_windows) < 2:
        return None

    speeds: list[float] = []
    accelerations: list[float] = []
    grades: list[float] = []
    distances: list[float] = []
    durations: list[float] = []
    previous_speed = 0.0

    for previous, current in zip(gps_windows, gps_windows[1:]):
        duration = (current.event_time - previous.event_time).total_seconds()
        if duration <= 0:
            continue
        distance = haversine_distance(
            previous.latitude,
            previous.longitude,
            current.latitude,
            current.longitude,
        )
        calculated_speed = calculate_speed_mps(distance, duration)
        reported_speed = (current.gps_payload or {}).get("speed_mps")
        speed = float(reported_speed) if reported_speed is not None else calculated_speed
        if speed < 0.5 <= calculated_speed:
            speed = calculated_speed
        if speed > MAX_SPEED_MPS or calculated_speed > MAX_SPEED_MPS * 2:
            continue
        acceleration = calculate_acceleration_mps2(previous_speed, speed, duration)
        if abs(acceleration) > MAX_ACCELERATION_MPS2:
            acceleration = 0.0
        previous_altitude = (previous.gps_payload or {}).get("altitude_m")
        current_altitude = (current.gps_payload or {}).get("altitude_m")
        grade = calculate_grade_pct(previous_altitude, current_altitude, distance)

        speeds.append(speed)
        accelerations.append(acceleration)
        grades.append(grade)
        distances.append(distance)
        durations.append(duration)
        previous_speed = speed

    if not distances or sum(distances) <= 0:
        return None

    estimate = estimate_trip_energy(
        speeds_mps=speeds,
        accelerations_mps2=accelerations,
        grades_pct=grades,
        distances_m=distances,
        durations_s=durations,
        category=vehicle.category if vehicle else None,
        kerb_weight_kg=vehicle.kerb_weight if vehicle else None,
        regen_available=vehicle.regen_available if vehicle else None,
        usable_kwh=vehicle.usable_kwh if vehicle else None,
    )
    return {
        "route_energy_wh": estimate.total_energy_wh,
        "wh_per_km": estimate.wh_per_km,
        "demand_score": estimate.demand_score,
        "uncertainty_lower_wh": estimate.uncertainty_lower_wh,
        "uncertainty_upper_wh": estimate.uncertainty_upper_wh,
        "confidence": estimate.confidence,
        "confidence_numeric": estimate.confidence_numeric,
        "source": estimate.source,
        "estimated": estimate.estimated,
        "assumptions": estimate.assumptions,
        "distance_km": estimate.total_distance_km,
        "duration_minutes": estimate.total_duration_min,
    }


def _imu_summary(windows: list[TelemetryWindow]) -> dict:
    jerk_rms = [float(value) for window in windows if (value := (window.imu_payload or {}).get("jerk_rms_mps3")) is not None]
    jerk_max = [float(value) for window in windows if (value := (window.imu_payload or {}).get("jerk_max_mps3")) is not None]
    return {
        "windows_with_imu": sum(bool(window.imu_payload) for window in windows),
        "mean_jerk_rms_mps3": round(mean(jerk_rms), 3) if jerk_rms else None,
        "max_jerk_mps3": round(max(jerk_max), 3) if jerk_max else None,
    }


def _missing_sequence_preview(missing_ranges: list[list[int]]) -> list[int]:
    """Keep finalizer diagnostics useful without expanding an unbounded gap."""
    preview: list[int] = []
    for start, end in missing_ranges:
        remaining = MAX_MISSING_SEQUENCE_PREVIEW - len(preview)
        if remaining <= 0:
            break
        preview.extend(range(start, min(end, start + remaining - 1) + 1))
    return preview


def finalize_trip(db: Session, event: dict) -> None:
    if event.get("event_type") != "trip.finalization_eligible":
        return
    trip_id = event["payload"]["trip_id"]
    trip = db.query(MobileTripSession).filter_by(id=trip_id).with_for_update().one()
    record = db.query(TripFinalization).filter_by(trip_id=trip_id).with_for_update().one()
    if record.state == "completed":
        return
    if not 0 <= record.final_sequence_no <= MAX_FINAL_SEQUENCE_NO:
        raise ValueError("final sequence is outside the supported bound")

    rows = db.query(TelemetryWindow).filter(
        TelemetryWindow.trip_id == trip_id,
        TelemetryWindow.sequence_no >= 1,
        TelemetryWindow.sequence_no <= record.final_sequence_no,
    ).order_by(TelemetryWindow.sequence_no).all()
    by_sequence = {window.sequence_no: window for window in rows}
    missing_ranges = bounded_missing_ranges(by_sequence, record.final_sequence_no)
    if missing_ranges:
        record.state = "waiting_for_telemetry"
        record.summary = {
            "calculation_version": CALCULATION_VERSION,
            "window_count": len(by_sequence),
            "final_sequence_no": record.final_sequence_no,
            "actual_missing_sequences": record.final_sequence_no - len(by_sequence),
            "missing_ranges": missing_ranges,
            "missing_sequences": _missing_sequence_preview(missing_ranges),
            "calculation_status": "waiting_for_telemetry",
        }
        return

    windows = [by_sequence[sequence] for sequence in sorted(by_sequence)]
    vehicle = db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first() if trip.vehicle_id else None
    energy = _physics_summary(windows, vehicle)
    gps_count = sum(_valid_gps(window) for window in windows)
    gps_completeness = round(gps_count / len(windows) * 100.0, 2) if windows else 0.0
    context = trip.context or {}
    ending_soc = context.get("ending_soc")
    starting_soc = context.get("starting_soc")
    usable_kwh = vehicle.usable_kwh if vehicle else None
    completed_at = datetime.utcnow()
    label = build_trip_energy_label(
        trip=trip,
        vehicle=vehicle,
        distance_km=energy["distance_km"] if energy else None,
        gps_completeness_pct=gps_completeness,
        charging_observed=bool(context.get("vehicle_charging_observed")),
        captured_at=completed_at,
    )
    existing_label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).first()
    if existing_label is None:
        db.add(label)
    else:
        for column in (
            "starting_soc_pct",
            "ending_soc_pct",
            "soc_delta_pct",
            "actual_energy_consumed_wh",
            "actual_wh_per_km",
            "usable_kwh_snapshot",
            "label_source",
            "label_confidence",
            "is_training_eligible",
            "eligibility_reason",
            "captured_at",
        ):
            setattr(existing_label, column, getattr(label, column))
        label = existing_label
    remaining_range = None
    estimated_soc_consumed = None
    if energy and usable_kwh:
        estimated_soc_consumed = estimate_soc_consumed(
            energy_wh=energy["route_energy_wh"],
            usable_kwh=usable_kwh,
        )
        if ending_soc is not None:
            remaining_range = estimate_remaining_range(
                current_soc_pct=float(ending_soc),
                usable_kwh=usable_kwh,
                wh_per_km=energy["wh_per_km"],
            )
            certified_range = vehicle.certified_range or vehicle.max_range_km
            if remaining_range is not None and certified_range:
                remaining_range = min(remaining_range, round(certified_range * float(ending_soc) / 100.0, 1))

    record.processed_sequence_no = record.final_sequence_no
    record.summary = {
        "calculation_version": CALCULATION_VERSION,
        "calculation_status": "complete" if energy else "insufficient_gps",
        "window_count": len(windows),
        "final_sequence_no": record.final_sequence_no,
        "missing_sequences": [],
        "gps_window_count": gps_count,
        "gps_missing_window_count": len(windows) - gps_count,
        "gps_completeness_pct": gps_completeness,
        "distance_km": energy["distance_km"] if energy else None,
        "duration_minutes": energy["duration_minutes"] if energy else None,
        "energy": energy,
        "energy_label": {
            "actual_energy_consumed_wh": label.actual_energy_consumed_wh,
            "actual_wh_per_km": label.actual_wh_per_km,
            "label_source": label.label_source,
            "label_confidence": label.label_confidence,
            "is_training_eligible": label.is_training_eligible,
            "eligibility_reason": label.eligibility_reason,
        },
        "imu": _imu_summary(windows),
        "soc": {
            "starting_pct": starting_soc,
            "ending_pct": ending_soc,
            "measured_delta_pct": round(float(starting_soc) - float(ending_soc), 2)
            if starting_soc is not None and ending_soc is not None and not context.get("vehicle_charging_observed")
            else None,
            "estimated_consumed_pct": estimated_soc_consumed,
            "source": "manual_dashboard",
            "is_bms_measurement": False,
        },
        "range": {
            "estimated_remaining_km": remaining_range,
            "source": "physics_baseline_and_manual_soc" if remaining_range is not None else None,
            "estimated": remaining_range is not None,
        },
        "provenance": {
            "canonical_source": "telemetry_windows",
            "gps_quality_accuracy_threshold_m": MAX_ACCURACY_M,
            "soc_source": "manual_dashboard",
        },
    }
    record.state = "completed"
    record.completed_at = completed_at
    trip.finalization_state = "completed"
    trip.status = "completed"
