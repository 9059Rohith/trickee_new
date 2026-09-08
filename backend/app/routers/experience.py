"""Compatibility endpoints used by the complete driver experience."""
from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import Driver, MobileTripSession, TripFeature, TripPrediction, User, Vehicle
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.daily_plan_tools import daily_plan_tools
from app.services.gps_prediction_service import get_vehicle_gps_summary
from app.services.vehicle_assistant import vehicle_assistant

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
                "started_at": utc_iso(trip.started_at),
                "ended_at": utc_iso(trip.ended_at),
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
    soc: float | None = Field(default=None, ge=0, le=100)
    destination_km: float = Field(ge=0)
    available_time_min: float = Field(ge=0)


@router.post("/chargers/recommend")
def recommend_chargers(
    body: ChargerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == body.driver_id).first()
    vehicle = db.query(Vehicle).filter(Vehicle.id == body.vehicle_id).first()
    if (
        not driver
        or not vehicle
        or current_user.driver_id != driver.id
        or driver.assigned_vehicle_id != vehicle.id
        or current_user.fleet_id != vehicle.fleet_id
    ):
        raise HTTPException(403, "Not allowed to request guidance for this vehicle")

    def haversine_km(lat: float, lng: float) -> float:
        radius = 6371.0
        d_lat = math.radians(lat - body.lat)
        d_lng = math.radians(lng - body.lng)
        a = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(body.lat))
            * math.cos(math.radians(lat))
            * math.sin(d_lng / 2) ** 2
        )
        return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    provider_rows = daily_plan_tools.find_route_chargers(
        {"lat": body.lat, "lng": body.lng}, radius_m=5000
    )
    chargers = []
    for row in provider_rows:
        coordinates = row.get("coordinates") or {}
        lat = coordinates.get("lat")
        lng = coordinates.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        chargers.append(
            {
                "place_id": row.get("place_id"),
                "name": row.get("name"),
                "formatted_address": row.get("formatted_address"),
                "distance_km": round(haversine_km(float(lat), float(lng)), 2),
                "rating": row.get("rating"),
                "charger_type": row.get("charger_type"),
                "estimated_soc_gain": None,
                "availability_confirmed": row.get("availability_confirmed") is True,
                "lat": float(lat),
                "lng": float(lng),
                "google_maps_uri": row.get("google_maps_uri"),
                "provider_source": row.get("source") or "unavailable",
            }
        )
    chargers.sort(key=lambda item: item["distance_km"])

    estimated_range = (
        vehicle.certified_range * body.soc / 100.0
        if body.soc is not None and vehicle.certified_range and vehicle.certified_range > 0
        else None
    )
    needs_charge = body.soc is not None and (body.soc <= 25 or (
        estimated_range is not None
        and body.destination_km > 0
        and estimated_range < body.destination_km * 1.2
    ))
    charge_advice = (
        "soc_required" if body.soc is None
        else "charge_now" if needs_charge
        else "plan_charging" if body.soc <= 40
        else "not_needed"
    )
    recommended = chargers[0] if needs_charge and chargers else None
    alternatives = chargers[1:] if recommended else chargers
    if not chargers:
        reason = "No verified nearby Google Places charger listing is available."
    elif body.soc is None:
        reason = "Nearby verified station listings are shown; add SOC for charging advice."
    elif needs_charge:
        reason = (
            "Charging is recommended from the current SOC and route reserve. "
            "The station listing is verified, but live connector availability is not."
        )
    else:
        reason = (
            "Charging is not required from the current SOC and destination estimate; "
            "nearby verified station listings are shown as options."
        )
    return ok({
        "recommended_charger": recommended,
        "reason": reason,
        "alternatives": alternatives,
        "fallback_used": not bool(chargers),
        "charge_advice": charge_advice,
        "provider_source": "google_places" if chargers else "unavailable",
        "evaluated_soc_pct": body.soc,
        "estimated_range_km": estimated_range,
    })


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
    if current_user.driver_id != body.driver_id:
        raise HTTPException(403, "Not allowed to use assistant for this driver")
    summary = get_vehicle_gps_summary(db, body.vehicle_id)
    if "error" in summary:
        raise HTTPException(404, "Vehicle not found")
    result = vehicle_assistant.answer(message=body.message, summary=summary)
    return ok({
        "intent": "gps_vehicle_summary",
        **result,
        "confidence": 0.8 if summary.get("latest_prediction") else 0.5,
        "escalated": False,
        "fallback_used": not result["llm_used"],
    })
