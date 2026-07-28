"""
GPS intelligence router — prediction endpoints.

Every response carries value + confidence + source (§1 rule 3).
Range is NULL unless recent SOC exists (§1 rule 2).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import TripPrediction, User
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.gps_prediction_service import compute_trip_prediction, get_vehicle_gps_summary

router = APIRouter(prefix="/gps", tags=["gps-intelligence"])


def _prediction_dict(p: TripPrediction) -> dict:
    return {
        "id": p.id,
        "trip_id": p.trip_id,
        "vehicle_id": p.vehicle_id,
        "wh_per_km": {"value": p.wh_per_km, "confidence": p.confidence, "source": p.source, "estimated": p.estimated},
        "route_energy_wh": {"value": p.route_energy_wh, "confidence": p.confidence, "source": p.source, "estimated": p.estimated},
        "demand_score": {"value": p.demand_score, "confidence": p.confidence, "source": p.source, "estimated": p.estimated},
        "soc_consumed_pct": {"value": p.soc_consumed_pct, "confidence": p.confidence, "source": p.source, "estimated": p.estimated},
        "range_km": {"value": p.range_km, "confidence": p.confidence, "source": p.source, "estimated": p.estimated} if p.range_km is not None else None,
        "uncertainty_lower": p.uncertainty_lower,
        "uncertainty_upper": p.uncertainty_upper,
        "ood_score": p.ood_score,
        "provenance": p.provenance,
        "created_at": utc_iso(p.created_at),
    }


@router.get("/trips/{trip_id}/prediction")
def get_trip_prediction(
    trip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pred = (
        db.query(TripPrediction)
        .filter(TripPrediction.trip_id == trip_id)
        .order_by(TripPrediction.created_at.desc())
        .first()
    )
    if not pred:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No prediction found for this trip")
    return ok(_prediction_dict(pred))


@router.post("/trips/{trip_id}/compute")
def trigger_prediction(
    trip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pred = compute_trip_prediction(db, trip_id)
    if not pred:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cannot compute — no trip or GPS data")
    return ok(_prediction_dict(pred), "Prediction computed")


@router.get("/vehicles/{vehicle_id}/summary")
def vehicle_gps_summary(
    vehicle_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    summary = get_vehicle_gps_summary(db, vehicle_id)
    if "error" in summary:
        raise HTTPException(status.HTTP_404_NOT_FOUND, summary["error"])
    return ok(summary)
