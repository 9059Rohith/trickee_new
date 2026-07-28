"""
GPS prediction service — orchestrator (§4 architecture).

Connects the feature pipeline → physics baseline → TripPrediction output.
Handles SOC-present vs SOC-absent logic.
Every output includes value + confidence + source triplet.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.entities import (
    GPSRawSample,
    MobileTripSession,
    SOCReading,
    TripFeature,
    TripPrediction,
    Vehicle,
)
from app.schemas.api import utc_iso
from app.services.gps_feature_pipeline import process_trip_gps_samples
from app.services.physics_energy import (
    TripEnergyEstimate,
    estimate_remaining_range,
    estimate_soc_consumed,
    estimate_trip_energy,
)


SOC_STALENESS_MINUTES = 120  # SOC older than this is "not recent"


def _cap_range_to_vehicle_limit(
    range_km: float | None,
    vehicle: Vehicle,
    current_soc_pct: float,
) -> tuple[float | None, float | None, bool]:
    """Cap short-trip extrapolation at the SOC-adjusted certified range."""
    full_charge_range = vehicle.certified_range or vehicle.max_range_km
    if range_km is None or not full_charge_range or full_charge_range <= 0:
        return range_km, None, False
    ceiling = round(full_charge_range * current_soc_pct / 100.0, 1)
    capped = min(range_km, ceiling)
    return round(capped, 1), ceiling, capped < range_km


def compute_trip_prediction(
    db: Session,
    trip_id: str,
) -> TripPrediction | None:
    """
    Full prediction pipeline for a completed trip:
    1. Fetch raw GPS samples
    2. Run feature pipeline (quality filters + movement features)
    3. Run physics baseline
    4. Check for recent SOC → range estimate (only if SOC exists)
    5. Persist TripPrediction + TripFeature
    """
    trip = db.query(MobileTripSession).filter(MobileTripSession.id == trip_id).first()
    if not trip:
        return None

    vehicle = db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first() if trip.vehicle_id else None
    if vehicle and vehicle.spec_incomplete:
        # Cannot produce GPS-model predictions without complete specs
        # Return a minimal prediction flagged as low confidence
        pred = TripPrediction(
            trip_id=trip_id,
            vehicle_id=trip.vehicle_id,
            confidence="low",
            confidence_numeric=0.1,
            source="physics_baseline",
            estimated=True,
            provenance={"reason": "vehicle_spec_incomplete"},
        )
        db.add(pred)
        db.commit()
        db.refresh(pred)
        return pred

    # 1. Fetch raw samples
    raw_samples = (
        db.query(GPSRawSample)
        .filter(GPSRawSample.trip_id == trip_id)
        .order_by(GPSRawSample.sequence)
        .all()
    )
    if not raw_samples:
        return None

    # 2. Feature pipeline
    validated_samples, trip_feature = process_trip_gps_samples(trip_id, raw_samples)
    if (
        len(validated_samples) < 2
        or not trip_feature.distance_km
        or trip_feature.distance_km <= 0
    ):
        return None

    # Persist validated samples and features
    for vs in validated_samples:
        db.add(vs)
    db.add(trip_feature)

    # 3. Physics baseline
    speeds = [v.speed_mps or 0.0 for v in validated_samples[1:]]
    accels = [v.acceleration_mps2 or 0.0 for v in validated_samples[1:]]
    grades = [v.grade_pct or 0.0 for v in validated_samples[1:]]
    dists = [v.distance_delta_m or 0.0 for v in validated_samples[1:]]
    durs = [v.time_delta_s or 0.0 for v in validated_samples[1:]]

    energy_est: TripEnergyEstimate = estimate_trip_energy(
        speeds_mps=speeds,
        accelerations_mps2=accels,
        grades_pct=grades,
        distances_m=dists,
        durations_s=durs,
        category=vehicle.category if vehicle else None,
        kerb_weight_kg=vehicle.kerb_weight if vehicle else None,
        regen_available=vehicle.regen_available if vehicle else None,
        usable_kwh=vehicle.usable_kwh if vehicle else None,
    )

    # 4. SOC-dependent outputs
    soc_consumed = None
    range_km = None
    range_cap_km = None
    range_cap_applied = False

    if vehicle and vehicle.usable_kwh:
        soc_consumed = estimate_soc_consumed(
            energy_wh=energy_est.total_energy_wh,
            usable_kwh=vehicle.usable_kwh,
        )

        # Check for recent SOC
        recent_soc = _get_recent_soc(db, vehicle.id)
        if recent_soc is not None and energy_est.wh_per_km > 0:
            range_km = estimate_remaining_range(
                current_soc_pct=recent_soc,
                usable_kwh=vehicle.usable_kwh,
                wh_per_km=energy_est.wh_per_km,
            )
            range_km, range_cap_km, range_cap_applied = _cap_range_to_vehicle_limit(
                range_km, vehicle, recent_soc
            )

    # 5. Persist prediction
    pred = TripPrediction(
        trip_id=trip_id,
        vehicle_id=trip.vehicle_id,
        wh_per_km=energy_est.wh_per_km,
        route_energy_wh=energy_est.total_energy_wh,
        demand_score=energy_est.demand_score,
        soc_consumed_pct=soc_consumed,
        range_km=range_km,  # NULL if no recent SOC — never fabricated
        confidence=energy_est.confidence,
        confidence_numeric=energy_est.confidence_numeric,
        source=energy_est.source,
        estimated=energy_est.estimated,
        uncertainty_lower=energy_est.uncertainty_lower_wh,
        uncertainty_upper=energy_est.uncertainty_upper_wh,
        provenance={
            "assumptions": energy_est.assumptions,
            "sample_count": len(validated_samples),
            "rejected_count": len(raw_samples) - len(validated_samples),
            "distance_km": energy_est.total_distance_km,
            "duration_min": energy_est.total_duration_min,
            "range_cap_km": range_cap_km,
            "range_cap_applied": range_cap_applied,
        },
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return pred


def _get_recent_soc(db: Session, vehicle_id: str) -> float | None:
    """Get the most recent SOC reading if it's not stale."""
    cutoff = datetime.utcnow() - timedelta(minutes=SOC_STALENESS_MINUTES)
    reading = (
        db.query(SOCReading)
        .filter(SOCReading.vehicle_id == vehicle_id)
        .filter(SOCReading.recorded_at >= cutoff)
        .order_by(SOCReading.recorded_at.desc())
        .first()
    )
    return reading.value if reading else None


def get_vehicle_gps_summary(db: Session, vehicle_id: str) -> dict:
    """GPS-model vehicle summary for the UI."""
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        return {"error": "Vehicle not found"}

    # Latest prediction
    latest_pred = (
        db.query(TripPrediction)
        .filter(TripPrediction.vehicle_id == vehicle_id)
        .order_by(TripPrediction.created_at.desc())
        .first()
    )

    # Latest SOC
    latest_soc = (
        db.query(SOCReading)
        .filter(SOCReading.vehicle_id == vehicle_id)
        .order_by(SOCReading.recorded_at.desc())
        .first()
    )

    recent_soc = _get_recent_soc(db, vehicle_id)

    # Estimated range only if we have both SOC and Wh/km
    estimated_range = None
    if recent_soc is not None and latest_pred and latest_pred.wh_per_km and vehicle.usable_kwh:
        estimated_range = estimate_remaining_range(
            current_soc_pct=recent_soc,
            usable_kwh=vehicle.usable_kwh,
            wh_per_km=latest_pred.wh_per_km,
        )
        estimated_range, _, _ = _cap_range_to_vehicle_limit(
            estimated_range, vehicle, recent_soc
        )

    return {
        "vehicle_id": vehicle_id,
        "vehicle_code": vehicle.vehicle_code,
        "spec_complete": not vehicle.spec_incomplete,
        "category": vehicle.category,
        "latest_prediction": {
            "wh_per_km": latest_pred.wh_per_km if latest_pred else None,
            "route_energy_wh": latest_pred.route_energy_wh if latest_pred else None,
            "demand_score": latest_pred.demand_score if latest_pred else None,
            "soc_consumed_pct": latest_pred.soc_consumed_pct if latest_pred else None,
            "confidence": latest_pred.confidence if latest_pred else None,
            "source": latest_pred.source if latest_pred else None,
            "estimated": True,
            "created_at": utc_iso(latest_pred.created_at) if latest_pred else None,
        } if latest_pred else None,
        "soc": {
            "value": latest_soc.value if latest_soc else None,
            "source": latest_soc.source if latest_soc else None,
            "recorded_at": utc_iso(latest_soc.recorded_at) if latest_soc else None,
            "is_recent": recent_soc is not None,
        },
        "estimated_range_km": estimated_range,
        "range_available": estimated_range is not None,
    }
