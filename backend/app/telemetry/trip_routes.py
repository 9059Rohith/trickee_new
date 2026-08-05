"""Offline-first, user-authenticated telemetry trip lifecycle commands."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import (
    DeviceTripUploadCursor,
    Driver,
    MobileTripSession,
    SOCReading,
    ServerOutbox,
    TripFinalization,
    User,
    Vehicle,
)
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/v2/trips", tags=["telemetry-trips"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Coordinate(StrictBody):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class StartTripBody(StrictBody):
    trip_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    vehicle_id: str
    starting_soc: float | None = Field(default=None, ge=0, le=100)
    started_at: datetime | None = None
    origin: Coordinate | None = None
    idempotency_key: str = Field(min_length=1, max_length=80)


class CompleteTripBody(StrictBody):
    ending_soc: float = Field(ge=0, le=100)
    final_sequence_no: int = Field(ge=0)
    location: Coordinate | None = None
    idempotency_key: str = Field(min_length=1, max_length=80)


def _driver(db: Session, user: User) -> Driver:
    driver = db.query(Driver).filter(Driver.id == user.driver_id, Driver.fleet_id == user.fleet_id).first()
    if driver is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver profile required")
    return driver


def _trip_data(trip: MobileTripSession, cursor: int = 0) -> dict:
    return {
        "id": trip.id,
        "vehicle_id": trip.vehicle_id,
        "status": trip.status,
        "finalization_state": trip.finalization_state,
        "highest_contiguous_sequence": cursor,
        "final_sequence_no": trip.final_sequence_no,
        "started_at": utc_iso(trip.started_at),
        "ended_at": utc_iso(trip.ended_at),
    }


@router.post("/start")
def start_trip(
    body: StartTripBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = db.query(MobileTripSession).filter(
        (MobileTripSession.id == body.trip_id)
        | (MobileTripSession.idempotency_key == body.idempotency_key)
    ).first()
    if existing:
        if existing.user_id != user.id or existing.vehicle_id != body.vehicle_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Trip identity already belongs to another assignment")
        return ok(_trip_data(existing), "Trip already started")

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == body.vehicle_id,
        Vehicle.fleet_id == user.fleet_id,
        Vehicle.is_active.is_(True),
    ).first()
    if vehicle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    driver = _driver(db, user)
    started_at = body.started_at or datetime.utcnow()
    if started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)
    trip = MobileTripSession(
        id=body.trip_id,
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=started_at,
        origin_lat=body.origin.lat if body.origin else None,
        origin_lng=body.origin.lng if body.origin else None,
        status="active",
        source="android_foreground_service",
        idempotency_key=body.idempotency_key,
        finalization_state="collecting",
        context={"starting_soc": body.starting_soc, "soc_source": "manual_dashboard"},
    )
    db.add(trip)
    if body.starting_soc is not None:
        db.add(SOCReading(
            vehicle_id=vehicle.id,
            driver_id=driver.id,
            value=body.starting_soc,
            source="manual",
            confidence=1.0,
            recorded_at=trip.started_at,
        ))
    db.commit()
    return ok(_trip_data(trip), "Trip started")


@router.post("/{trip_id}/complete")
def complete_trip(
    trip_id: str,
    body: CompleteTripBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.user_id == user.id,
    ).with_for_update().first()
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    if trip.completion_idempotency_key:
        if trip.completion_idempotency_key != body.idempotency_key or trip.final_sequence_no != body.final_sequence_no:
            raise HTTPException(status.HTTP_409_CONFLICT, "Trip was completed with a different command")
        cursor = max((row[0] for row in db.query(DeviceTripUploadCursor.highest_contiguous_sequence).filter(
            DeviceTripUploadCursor.trip_id == trip.id
        ).all()), default=0)
        return ok(_trip_data(trip, cursor), "Trip completion already accepted")

    cursor = max((row[0] for row in db.query(DeviceTripUploadCursor.highest_contiguous_sequence).filter(
        DeviceTripUploadCursor.trip_id == trip.id
    ).all()), default=0)
    now = datetime.utcnow()
    trip.ended_at = now
    trip.status = "sync_pending" if cursor < body.final_sequence_no else "finalizing"
    trip.finalization_state = "waiting_for_telemetry" if cursor < body.final_sequence_no else "eligible"
    trip.final_sequence_no = body.final_sequence_no
    trip.completion_idempotency_key = body.idempotency_key
    trip.completion_requested_at = now
    if body.location:
        trip.destination_lat = body.location.lat
        trip.destination_lng = body.location.lng
    context = dict(trip.context or {})
    context.update({"ending_soc": body.ending_soc, "ending_soc_source": "manual_dashboard"})
    trip.context = context
    finalization = TripFinalization(
        trip_id=trip.id,
        final_sequence_no=body.final_sequence_no,
        processed_sequence_no=cursor,
        state=trip.finalization_state,
    )
    db.add(finalization)
    db.add(SOCReading(
        vehicle_id=trip.vehicle_id,
        driver_id=trip.driver_id,
        value=body.ending_soc,
        source="manual",
        confidence=1.0,
        recorded_at=now,
    ))
    if cursor >= body.final_sequence_no:
        db.add(ServerOutbox(
            event_type="trip.finalization_eligible",
            aggregate_type="trip",
            aggregate_id=trip.id,
            payload={"trip_id": trip.id, "final_sequence_no": body.final_sequence_no},
        ))
    db.commit()
    return ok(_trip_data(trip, cursor), "Trip completion accepted")
