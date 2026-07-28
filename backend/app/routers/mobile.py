"""
Mobile router — trip lifecycle, GPS batch upload, location, alerts.

GPS batch endpoint: POST /mobile/v2/trips/{trip_id}/gps-batch
Idempotent, quality-gated, provenance-tagged (§6.1).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import (
    Alert,
    Driver,
    GPSRawSample,
    MobileTripSession,
    SOCReading,
    TripFeature,
    User,
    Vehicle,
)
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.gps_prediction_service import compute_trip_prediction, get_vehicle_gps_summary

router = APIRouter(prefix="/mobile", tags=["mobile"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class MobileLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class GPSPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sequence: int | None = Field(default=None, ge=0)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    timestamp: datetime
    altitude: float | None = None
    accuracy: float | None = None
    speed: float | None = None
    heading: float | None = None
    provider: str | None = None
    mocked: bool = False
    app_version: str | None = None
    device_model: str | None = None


class GPSBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_id: str = Field(max_length=80)
    points: list[GPSPoint] = Field(max_length=500)


class TripStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    destination_text: str | None = Field(default=None, max_length=255)
    destination_lat: float | None = None
    destination_lng: float | None = None
    origin: MobileLocation | None = None
    vehicle_id: str | None = Field(default=None, max_length=36)
    starting_soc: float | None = Field(default=None, ge=0, le=100)
    idempotency_key: str | None = Field(default=None, max_length=80)


class TripEndRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trip_session_id: str | None = Field(default=None, max_length=36)
    location: MobileLocation | None = None
    ending_soc: float = Field(ge=0, le=100)
    idempotency_key: str | None = Field(default=None, max_length=80)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_driver(db: Session, user: User) -> Driver:
    if not user.driver_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a driver account")
    driver = db.query(Driver).filter(Driver.id == user.driver_id).first()
    if not driver:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver record not found")
    return driver


def _trip_dict(t: MobileTripSession) -> dict:
    return {
        "id": t.id, "user_id": t.user_id, "driver_id": t.driver_id,
        "vehicle_id": t.vehicle_id, "started_at": utc_iso(t.started_at),
        "ended_at": utc_iso(t.ended_at),
        "status": t.status, "origin_lat": t.origin_lat, "origin_lng": t.origin_lng,
        "destination_text": t.destination_text,
        "destination_lat": t.destination_lat, "destination_lng": t.destination_lng,
        "confidence": t.confidence, "source": t.source,
    }


def _alert_dict(a: Alert) -> dict:
    return {
        "id": a.id, "vehicle_id": a.vehicle_id, "driver_id": a.driver_id,
        "alert_type": a.alert_type, "message": a.message,
        "soc_at_alert": a.soc_at_alert, "is_resolved": a.is_resolved,
        "created_at": utc_iso(a.created_at),
    }


def _vehicle_dict(v: Vehicle) -> dict:
    return {
        "id": v.id, "vehicle_code": v.vehicle_code, "make": v.make, "model": v.model,
        "battery_capacity_kwh": v.battery_capacity_kwh, "max_range_km": v.max_range_km,
        "battery_chemistry": v.battery_chemistry, "category": v.category,
        "usable_kwh": v.usable_kwh, "kerb_weight": v.kerb_weight,
        "motor_kw": v.motor_kw, "regen_available": v.regen_available,
        "spec_incomplete": v.spec_incomplete, "is_active": v.is_active,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me")
def mobile_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    vehicle = db.query(Vehicle).filter(Vehicle.fleet_id == driver.fleet_id, Vehicle.is_active == True).first()

    active_trip = (
        db.query(MobileTripSession)
        .filter(MobileTripSession.driver_id == driver.id, MobileTripSession.status == "active")
        .first()
    )

    alerts = (
        db.query(Alert)
        .filter(Alert.driver_id == driver.id)
        .order_by(desc(Alert.created_at))
        .limit(50)
        .all()
    )

    # GPS summary for vehicle
    gps_summary = get_vehicle_gps_summary(db, vehicle.id) if vehicle else None

    return ok({
        "user": {"id": current_user.id, "email": current_user.email,
                 "full_name": current_user.full_name, "role": current_user.role},
        "driver": {"id": driver.id, "driver_code": driver.driver_code,
                   "full_name": driver.full_name, "style_label": driver.style_label},
        "vehicle": _vehicle_dict(vehicle) if vehicle else None,
        "gps_summary": gps_summary,
        "active_trip": _trip_dict(active_trip) if active_trip else None,
        "active_waiting": None,
        "active_charging": None,
        "alerts": [_alert_dict(a) for a in alerts],
    })


@router.get("/alerts")
def mobile_alerts(
    unresolved_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    q = db.query(Alert).filter(Alert.driver_id == driver.id)
    if unresolved_only:
        q = q.filter(Alert.is_resolved == False)
    alerts = q.order_by(desc(Alert.created_at)).limit(limit).all()
    return ok([_alert_dict(a) for a in alerts])


@router.post("/alerts/{alert_id}/ack")
def ack_alert(
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    alert.is_resolved = True
    db.commit()
    db.refresh(alert)
    return ok(_alert_dict(alert), "Alert acknowledged")


@router.post("/trips/start")
def start_trip(
    body: TripStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)

    # Check idempotency
    if body.idempotency_key:
        existing = db.query(MobileTripSession).filter(
            MobileTripSession.idempotency_key == body.idempotency_key
        ).first()
        if existing:
            return ok(_trip_dict(existing), "Trip already started")

    trip = MobileTripSession(
        user_id=current_user.id,
        driver_id=driver.id,
        vehicle_id=body.vehicle_id,
        started_at=datetime.utcnow(),
        origin_lat=body.origin.lat if body.origin else None,
        origin_lng=body.origin.lng if body.origin else None,
        destination_text=body.destination_text,
        destination_lat=body.destination_lat,
        destination_lng=body.destination_lng,
        status="active",
        idempotency_key=body.idempotency_key,
        context={"starting_soc": body.starting_soc} if body.starting_soc is not None else {},
    )
    db.add(trip)

    # Record starting SOC if provided (manual entry)
    if body.starting_soc is not None and body.vehicle_id:
        soc = SOCReading(
            vehicle_id=body.vehicle_id,
            driver_id=driver.id,
            value=body.starting_soc,
            source="manual",
            recorded_at=datetime.utcnow(),
        )
        db.add(soc)

    db.commit()
    db.refresh(trip)
    return ok(_trip_dict(trip), "Trip started")


@router.post("/trips/end")
def end_trip(
    body: TripEndRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)

    trip = (
        db.query(MobileTripSession)
        .filter(MobileTripSession.driver_id == driver.id, MobileTripSession.status == "active")
        .first()
    )
    if not trip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No active trip")

    trip.ended_at = datetime.utcnow()
    trip.status = "completed"
    if body.location:
        trip.destination_lat = body.location.lat
        trip.destination_lng = body.location.lng

    trip_context = dict(trip.context or {})
    trip_context["ending_soc"] = body.ending_soc
    trip_context["end_idempotency_key"] = body.idempotency_key
    trip.context = trip_context

    # Record ending SOC if provided
    if trip.vehicle_id:
        soc = SOCReading(
            vehicle_id=trip.vehicle_id,
            driver_id=driver.id,
            value=body.ending_soc,
            source="manual",
            recorded_at=datetime.utcnow(),
        )
        db.add(soc)

    db.commit()
    db.refresh(trip)

    # Trigger GPS prediction computation
    prediction = compute_trip_prediction(db, trip.id)

    result = _trip_dict(trip)
    if prediction:
        result["prediction"] = {
            "wh_per_km": prediction.wh_per_km,
            "route_energy_wh": prediction.route_energy_wh,
            "demand_score": prediction.demand_score,
            "soc_consumed_pct": prediction.soc_consumed_pct,
            "range_km": prediction.range_km,
            "confidence": prediction.confidence,
            "source": prediction.source,
            "estimated": prediction.estimated,
        }

    feature = db.query(TripFeature).filter(TripFeature.trip_id == trip.id).first()
    vehicle = db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first() if trip.vehicle_id else None
    gps_sample_count = db.query(GPSRawSample).filter(GPSRawSample.trip_id == trip.id).count()
    starting_soc = trip_context.get("starting_soc")
    soc_used_pct = None
    measured_energy_wh = None
    measured_wh_per_km = None
    if starting_soc is not None:
        soc_used_pct = round(float(starting_soc) - body.ending_soc, 2)
        if soc_used_pct >= 0 and vehicle and vehicle.usable_kwh:
            measured_energy_wh = round(soc_used_pct / 100.0 * vehicle.usable_kwh * 1000.0, 2)
            if feature and feature.distance_km and feature.distance_km > 0:
                measured_wh_per_km = round(measured_energy_wh / feature.distance_km, 2)

    duration_minutes = None
    if trip.started_at and trip.ended_at:
        duration_minutes = round((trip.ended_at - trip.started_at).total_seconds() / 60.0, 2)

    result["calculation_status"] = "complete" if prediction else "insufficient_gps"
    result["calculation"] = {
        "gps_sample_count": gps_sample_count,
        "distance_km": feature.distance_km if feature else None,
        "duration_minutes": duration_minutes,
        "starting_soc": starting_soc,
        "ending_soc": body.ending_soc,
        "measured_soc_used_pct": soc_used_pct,
        "measured_energy_wh": measured_energy_wh,
        "measured_wh_per_km": measured_wh_per_km,
        "method": "GPS distance + dashboard SOC delta + usable battery capacity",
    }

    return ok(result, "Trip ended")


@router.post("/v2/trips/{trip_id}/gps-batch")
def upload_gps_batch(
    trip_id: str,
    payload: GPSBatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Idempotent GPS batch upload (§6.1).
    Deduplicates by client_batch_id. Stores but marks rejected samples.
    """
    driver = _require_driver(db, current_user)

    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.driver_id == driver.id,
    ).first()
    if not trip:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")

    # Idempotency check
    existing = db.query(GPSRawSample).filter(
        GPSRawSample.client_batch_id == payload.batch_id
    ).first()
    if existing:
        return ok({"batch_id": payload.batch_id, "inserted": 0}, "Batch already processed")

    samples = []
    for idx, pt in enumerate(payload.points):
        samples.append(GPSRawSample(
            trip_id=trip.id,
            client_batch_id=payload.batch_id,
            sequence=pt.sequence if pt.sequence is not None else idx,
            timestamp=pt.timestamp,
            lat=pt.lat,
            lng=pt.lng,
            altitude=pt.altitude,
            accuracy=pt.accuracy,
            speed=pt.speed,
            heading=pt.heading,
            provider=pt.provider,
            mock_location_flag=pt.mocked,
            app_version=pt.app_version,
            device_model=pt.device_model,
        ))

    if samples:
        db.bulk_save_objects(samples)
        db.commit()

    return ok({"batch_id": payload.batch_id, "inserted": len(samples)}, "Batch processed")
