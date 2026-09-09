"""Compatibility endpoints used by the complete driver experience."""
from __future__ import annotations

import math
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import (
    Driver,
    MobileTripSession,
    TelemetryEvent,
    TelemetryWindow,
    TripEnergyLabel,
    TripFeature,
    TripFinalization,
    TripPrediction,
    User,
    Vehicle,
)
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.daily_plan_tools import daily_plan_tools
from app.services.gps_prediction_service import get_vehicle_gps_summary
from app.services.trip_history import downsample_route_points, telemetry_quality, valid_route_points
from app.services.vehicle_assistant import vehicle_assistant

router = APIRouter(tags=["driver-experience"])


def _require_trip_history_access(current_user: User, driver_id: str) -> None:
    if current_user.driver_id != driver_id and current_user.role not in {"admin", "fleet_admin"}:
        raise HTTPException(403, "Not allowed to view this driver")


def _iso_or_none(value: datetime | None) -> str | None:
    return utc_iso(value) if value else None


@router.get("/drivers/{driver_id}/trips")
def driver_trips(
    driver_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_trip_history_access(current_user, driver_id)
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


@router.get("/drivers/{driver_id}/trip-days/{service_date}")
def driver_trip_day(
    driver_id: str,
    service_date: date,
    timezone_name: str = Query("Asia/Kolkata", alias="timezone", min_length=3, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_trip_history_access(current_user, driver_id)
    try:
        local_zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(422, "Invalid IANA timezone") from exc

    local_start = datetime.combine(service_date, time.min, tzinfo=local_zone)
    local_end = datetime.combine(service_date, time.max, tzinfo=local_zone)
    utc_start = local_start.astimezone(timezone.utc).replace(tzinfo=None)
    utc_end = local_end.astimezone(timezone.utc).replace(tzinfo=None)
    trips = (
        db.query(MobileTripSession)
        .filter(
            MobileTripSession.driver_id == driver_id,
            MobileTripSession.started_at >= utc_start,
            MobileTripSession.started_at <= utc_end,
        )
        .order_by(MobileTripSession.started_at.asc())
        .limit(100)
        .all()
    )

    details = []
    for trip in trips:
        windows = (
            db.query(TelemetryWindow)
            .filter(TelemetryWindow.trip_id == trip.id)
            .order_by(TelemetryWindow.sequence_no.asc())
            .all()
        )
        route_points = downsample_route_points(valid_route_points(windows))
        feature = db.query(TripFeature).filter(TripFeature.trip_id == trip.id).first()
        finalization = db.query(TripFinalization).filter(TripFinalization.trip_id == trip.id).first()
        label = db.query(TripEnergyLabel).filter(TripEnergyLabel.trip_id == trip.id).first()
        prediction = (
            db.query(TripPrediction)
            .filter(TripPrediction.trip_id == trip.id)
            .order_by(TripPrediction.created_at.desc())
            .first()
        )
        events = (
            db.query(TelemetryEvent)
            .filter(TelemetryEvent.trip_id == trip.id)
            .order_by(TelemetryEvent.created_at.desc())
            .limit(20)
            .all()
        )
        severity_counts = dict(
            db.query(TelemetryEvent.severity, func.count(TelemetryEvent.id))
            .filter(TelemetryEvent.trip_id == trip.id)
            .group_by(TelemetryEvent.severity)
            .all()
        )
        type_counts = dict(
            db.query(TelemetryEvent.event_type, func.count(TelemetryEvent.id))
            .filter(TelemetryEvent.trip_id == trip.id)
            .group_by(TelemetryEvent.event_type)
            .all()
        )
        details.append({
            "id": trip.id,
            "vehicle_id": trip.vehicle_id,
            "driver_id": trip.driver_id,
            "status": trip.status,
            "started_at": _iso_or_none(trip.started_at),
            "ended_at": _iso_or_none(trip.ended_at),
            "origin": {"lat": trip.origin_lat, "lng": trip.origin_lng},
            "destination": {
                "label": trip.destination_text,
                "lat": trip.destination_lat,
                "lng": trip.destination_lng,
            },
            "route_points": route_points,
            "route_trace_available": bool(route_points),
            "route_trace_unavailable_reason": None if route_points else "recorded_gps_unavailable_or_expired",
            "features": None if not feature else {
                "distance_km": feature.distance_km,
                "duration_minutes": feature.duration_minutes,
                "avg_speed_kmh": feature.avg_speed_kmh,
                "max_speed_kmh": feature.max_speed_kmh,
                "stops_count": feature.stops_count,
                "total_dwell_minutes": feature.total_dwell_minutes,
            },
            "telemetry_quality": telemetry_quality(
                stored_windows=len(windows), final_sequence_no=trip.final_sequence_no
            ),
            "finalization": None if not finalization else {
                "state": finalization.state,
                "processed_sequence_no": finalization.processed_sequence_no,
                "summary": finalization.summary,
                "completed_at": _iso_or_none(finalization.completed_at),
            },
            "energy_label": None if not label else {
                "starting_soc_pct": label.starting_soc_pct,
                "ending_soc_pct": label.ending_soc_pct,
                "soc_delta_pct": label.soc_delta_pct,
                "actual_energy_consumed_wh": label.actual_energy_consumed_wh,
                "actual_wh_per_km": label.actual_wh_per_km,
                "usable_kwh_snapshot": label.usable_kwh_snapshot,
                "source": label.label_source,
                "confidence": label.label_confidence,
                "is_training_eligible": label.is_training_eligible,
                "eligibility_reason": label.eligibility_reason,
            },
            "prediction": None if not prediction else {
                "route_energy_wh": prediction.route_energy_wh,
                "wh_per_km": prediction.wh_per_km,
                "soc_consumed_pct": prediction.soc_consumed_pct,
                "source": prediction.source,
                "confidence": prediction.confidence,
                "estimated": bool(prediction.estimated),
            },
            "events": {
                "by_severity": dict(severity_counts),
                "by_type": dict(type_counts),
                "latest": [
                    {
                        "type": event.event_type,
                        "severity": event.severity,
                        "confidence": event.confidence,
                        "created_at": _iso_or_none(event.created_at),
                    }
                    for event in events
                ],
            },
        })
    return ok({
        "service_date": service_date.isoformat(),
        "timezone": timezone_name,
        "trips": details,
    })


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


class AssistantLocation(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AssistantRequest(BaseModel):
    driver_id: str
    vehicle_id: str
    message: str = Field(min_length=1, max_length=1000)
    channel: str = "app"
    location: AssistantLocation | None = None


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
    location_context = None
    nearby_chargers = []
    if body.location:
        location_context = {
            **body.location.model_dump(),
            "source": "phone_gps",
            "confidence": 0.9,
        }
        normalized = body.message.casefold()
        if any(word in normalized for word in ("charge", "charger", "nearby", "nearest")):
            nearby_chargers = daily_plan_tools.find_route_chargers(
                body.location.model_dump(), radius_m=5000
            )[:10]
    result = vehicle_assistant.answer(
        message=body.message,
        summary=summary,
        location_context=location_context,
        nearby_chargers=nearby_chargers,
    )
    return ok({
        "intent": "gps_vehicle_summary",
        **result,
        "confidence": 0.8 if summary.get("latest_prediction") else 0.5,
        "escalated": False,
        "fallback_used": not result["llm_used"],
    })
