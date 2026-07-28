"""Compatibility endpoints used by the complete driver experience."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import MobileTripSession, TripFeature, TripPrediction, User
from app.schemas.api import ok
from app.services.auth import get_current_user
from app.services.gps_prediction_service import get_vehicle_gps_summary

router = APIRouter(tags=["driver-experience"])


@router.get("/drivers/{driver_id}/trips")
def driver_trips(
    driver_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.driver_id != driver_id and current_user.role not in {"admin", "fleet_admin"}:
        raise HTTPException(403, "Not allowed to view this driver")
    trips = (
        db.query(MobileTripSession)
        .filter(MobileTripSession.driver_id == driver_id)
        .order_by(MobileTripSession.started_at.desc())
        .limit(min(max(limit, 1), 100))
        .all()
    )
    result = []
    for trip in trips:
        feature = db.query(TripFeature).filter(TripFeature.trip_id == trip.id).first()
        prediction = (
            db.query(TripPrediction)
            .filter(TripPrediction.trip_id == trip.id)
            .order_by(TripPrediction.created_at.desc())
            .first()
        )
        result.append(
            {
                "id": trip.id,
                "vehicle_id": trip.vehicle_id,
                "driver_id": trip.driver_id,
                "started_at": trip.started_at.isoformat(),
                "ended_at": trip.ended_at.isoformat() if trip.ended_at else None,
                "origin_lat": trip.origin_lat,
                "origin_lng": trip.origin_lng,
                "dest_lat": trip.destination_lat,
                "dest_lng": trip.destination_lng,
                "dest_label": trip.destination_text,
                "distance_km": feature.distance_km if feature else None,
                "kwh_used": (
                    prediction.route_energy_wh / 1000.0
                    if prediction and prediction.route_energy_wh is not None
                    else None
                ),
                "route_taken": "GPS tracked" if feature else None,
                "recommended_route": None,
                "followed_nudge": None,
                "estimated": bool(prediction.estimated) if prediction else False,
                "confidence": prediction.confidence if prediction else None,
                "source": prediction.source if prediction else None,
                "soc_start": (trip.context or {}).get("starting_soc"),
                "soc_end": (trip.context or {}).get("ending_soc"),
            }
        )
    return ok(result)


class ChargerRequest(BaseModel):
    driver_id: str
    vehicle_id: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    soc: float = Field(ge=0, le=100)
    destination_km: float = Field(ge=0)
    available_time_min: float = Field(ge=0)


@router.post("/chargers/recommend")
def recommend_chargers(
    _body: ChargerRequest,
    current_user: User = Depends(get_current_user),
):
    return ok(
        {
            "recommended_charger": None,
            "reason": "No verified charger provider is configured for this build.",
            "alternatives": [],
            "fallback_used": True,
        }
    )


class AssistantRequest(BaseModel):
    driver_id: str
    vehicle_id: str
    message: str = Field(min_length=1, max_length=1000)
    channel: str = "app"
    location: dict | None = None


@router.post("/assistant/message")
def assistant_message(
    body: AssistantRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    summary = get_vehicle_gps_summary(db, body.vehicle_id)
    if "error" in summary:
        raise HTTPException(404, "Vehicle not found")
    prediction = summary.get("latest_prediction") or {}
    soc = summary.get("soc") or {}
    parts = ["I can only report verified or explicitly estimated GPS-first data."]
    if prediction.get("wh_per_km") is not None:
        parts.append(
            f"Estimated efficiency is {prediction['wh_per_km']:.1f} Wh/km "
            f"with {prediction.get('confidence') or 'low'} confidence."
        )
    if soc.get("is_recent"):
        parts.append(f"The latest SOC reading is {soc['value']:.1f}%.")
    else:
        parts.append("Add a recent SOC reading before using any remaining-range estimate.")
    return ok(
        {
            "intent": "gps_vehicle_summary",
            "answer": " ".join(parts),
            "tools_called": ["gps_vehicle_summary"],
            "confidence": 0.8 if prediction else 0.5,
            "escalated": False,
            "fallback_used": False,
        }
    )
