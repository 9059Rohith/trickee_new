"""Offline-first, user-authenticated telemetry trip lifecycle commands."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
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
from app.services.reconciliation import MAX_FINAL_SEQUENCE_NO
from app.services.plan_leg_service import resolve_owned_plan_leg, transition_leg_for_trip

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
    destination_text: str | None = Field(default=None, max_length=255)
    destination_lat: float | None = Field(default=None, ge=-90, le=90)
    destination_lng: float | None = Field(default=None, ge=-180, le=180)
    planned_trip_id: str | None = Field(default=None, max_length=36)
    planned_leg_index: int | None = Field(default=None, ge=0)
    destination_source: str | None = Field(default=None, max_length=30)
    record_without_destination: bool = False

    @model_validator(mode="after")
    def validate_destination_contract(self) -> "StartTripBody":
        if (self.planned_trip_id is None) != (self.planned_leg_index is None):
            raise ValueError("planned_trip_id and planned_leg_index must be supplied together")
        if (self.destination_lat is None) != (self.destination_lng is None):
            raise ValueError("destination latitude and longitude must be supplied together")
        if self.record_without_destination:
            if self.planned_trip_id is not None or self.destination_lat is not None:
                raise ValueError("destinationless recording cannot include a destination")
            if self.destination_source not in (None, "destinationless"):
                raise ValueError("destinationless recording has an invalid destination source")
        elif self.planned_trip_id is None and self.destination_lat is not None:
            if not self.destination_text or self.destination_source not in ("search_result", "map_pin"):
                raise ValueError("manual destinations require resolved text and provenance")
        return self


class CompleteTripBody(StrictBody):
    ending_soc: float = Field(ge=0, le=100)
    final_sequence_no: int = Field(ge=0, le=MAX_FINAL_SEQUENCE_NO)
    location: Coordinate | None = None
    idempotency_key: str = Field(min_length=1, max_length=80)
    arrival_outcome: str | None = Field(default=None, pattern="^(arrived|skipped|ended_elsewhere)$")
    outcome_reason: str | None = Field(default=None, max_length=255)


class WaitTripBody(StrictBody):
    wait_id: str = Field(min_length=1, max_length=80)
    vehicle_charging: bool
    started_at: datetime | None = None


class ResumeTripBody(StrictBody):
    wait_id: str = Field(min_length=1, max_length=80)
    resume_soc: float | None = Field(default=None, ge=0, le=100)
    ended_at: datetime | None = None


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
        "destination_text": trip.destination_text,
        "destination_lat": trip.destination_lat,
        "destination_lng": trip.destination_lng,
        "destination_source": trip.destination_source,
        "planned_trip_id": trip.planned_trip_id,
        "planned_leg_index": trip.planned_leg_index,
        "ended_lat": trip.ended_lat,
        "ended_lng": trip.ended_lng,
        "waits": (trip.context or {}).get("waits", []),
    }


def _owned_active_trip(db: Session, trip_id: str, user: User) -> MobileTripSession:
    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.user_id == user.id,
    ).with_for_update().first()
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    if trip.status != "active" or trip.completion_idempotency_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "Trip is no longer active")
    return trip


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@router.post("/{trip_id}/wait")
def wait_trip(
    trip_id: str,
    body: WaitTripBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = _owned_active_trip(db, trip_id, user)
    context = dict(trip.context or {})
    waits = list(context.get("waits") or [])
    prior = next((item for item in waits if item["id"] == body.wait_id), None)
    if prior:
        if prior["vehicle_charging"] != body.vehicle_charging or (
            body.started_at is not None and prior.get("device_started_at") != utc_iso(body.started_at)
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Wait command conflicts with an earlier response")
        return ok(prior, "Wait already recorded")
    if any(item.get("ended_at") is None for item in waits):
        raise HTTPException(status.HTTP_409_CONFLICT, "Trip is already waiting")
    if len(waits) >= 512:
        raise HTTPException(status.HTTP_409_CONFLICT, "Trip has reached the wait event limit")
    wait = {
        "id": body.wait_id,
        "started_at": utc_iso(datetime.utcnow()),
        "device_started_at": utc_iso(body.started_at),
        "vehicle_charging": body.vehicle_charging,
        "ended_at": None,
        "resume_soc": None,
    }
    waits.append(wait)
    context["waits"] = waits
    if body.vehicle_charging:
        context["vehicle_charging_observed"] = True
    trip.context = context
    db.commit()
    return ok(wait, "Wait recorded")


@router.post("/{trip_id}/resume")
def resume_trip(
    trip_id: str,
    body: ResumeTripBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = _owned_active_trip(db, trip_id, user)
    context = dict(trip.context or {})
    waits = list(context.get("waits") or [])
    index = next((i for i, item in enumerate(waits) if item["id"] == body.wait_id), None)
    if index is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Wait not found")
    wait = dict(waits[index])
    if wait.get("ended_at") is not None:
        if wait.get("resume_soc") != body.resume_soc or (
            body.ended_at is not None and wait.get("device_ended_at") != utc_iso(body.ended_at)
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Resume command conflicts with the saved SOC")
        return ok(wait, "Trip already resumed")
    if wait["vehicle_charging"] and body.resume_soc is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Post-charge SOC is required")
    if not wait["vehicle_charging"] and body.resume_soc is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "SOC is only required after charging")
    if body.ended_at is not None and wait.get("device_started_at") and _as_utc(body.ended_at) < datetime.fromisoformat(wait["device_started_at"].replace("Z", "+00:00")):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Stop end precedes its start")
    wait["ended_at"] = utc_iso(datetime.utcnow())
    wait["device_ended_at"] = utc_iso(body.ended_at)
    wait["resume_soc"] = body.resume_soc
    waits[index] = wait
    context["waits"] = waits
    trip.context = context
    if body.resume_soc is not None:
        db.add(SOCReading(
            vehicle_id=trip.vehicle_id,
            driver_id=trip.driver_id,
            value=body.resume_soc,
            source="dashboard_confirmed",
            confidence=1.0,
            recorded_at=min(_as_utc(body.ended_at), datetime.now(timezone.utc)).replace(tzinfo=None)
            if body.ended_at is not None else datetime.utcnow(),
        ))
    db.commit()
    return ok(wait, "Trip resumed")


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
    if not driver.assigned_vehicle_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "No vehicle is assigned to this driver")
    if driver.assigned_vehicle_id != vehicle.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vehicle is not assigned to this driver")
    plan_leg = None
    if body.planned_trip_id is not None and body.planned_leg_index is not None:
        plan_leg = resolve_owned_plan_leg(
            db, user, driver, vehicle, body.planned_trip_id, body.planned_leg_index
        )
        destination_text = plan_leg.destination_text
        destination_lat = plan_leg.destination_lat
        destination_lng = plan_leg.destination_lng
        destination_source = "planned_stop"
    else:
        destination_text = None if body.record_without_destination else body.destination_text
        destination_lat = None if body.record_without_destination else body.destination_lat
        destination_lng = None if body.record_without_destination else body.destination_lng
        destination_source = "destinationless" if body.record_without_destination else body.destination_source
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
        destination_text=destination_text,
        destination_lat=destination_lat,
        destination_lng=destination_lng,
        planned_trip_id=body.planned_trip_id,
        planned_leg_index=body.planned_leg_index,
        destination_source=destination_source,
        status="active",
        source="android_foreground_service",
        idempotency_key=body.idempotency_key,
        finalization_state="collecting",
        context={"starting_soc": body.starting_soc, "soc_source": "manual_dashboard"},
    )
    db.add(trip)
    db.flush()
    if plan_leg is not None:
        plan_leg.trip_id = trip.id
        plan_leg.status = "active"
        plan_leg.started_at = trip.started_at
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


@router.get("/{trip_id}")
def get_trip_status(
    trip_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.user_id == user.id,
    ).first()
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")

    cursor = max((row[0] for row in db.query(DeviceTripUploadCursor.highest_contiguous_sequence).filter(
        DeviceTripUploadCursor.trip_id == trip.id
    ).all()), default=0)
    finalization = db.query(TripFinalization).filter(TripFinalization.trip_id == trip.id).first()
    data = _trip_data(trip, cursor)
    data["summary"] = finalization.summary if finalization else None
    return ok(data, "Trip status")


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
        prior_outcome = (trip.context or {}).get("arrival_outcome")
        if (
            trip.completion_idempotency_key != body.idempotency_key
            or trip.final_sequence_no != body.final_sequence_no
            or prior_outcome != body.arrival_outcome
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Trip was completed with a different command")
        cursor = max((row[0] for row in db.query(DeviceTripUploadCursor.highest_contiguous_sequence).filter(
            DeviceTripUploadCursor.trip_id == trip.id
        ).all()), default=0)
        return ok(_trip_data(trip, cursor), "Trip completion already accepted")

    if any(wait.get("ended_at") is None for wait in (trip.context or {}).get("waits", [])):
        raise HTTPException(status.HTTP_409_CONFLICT, "Resume the waiting or charging stop before ending the trip")

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
        trip.ended_lat = body.location.lat
        trip.ended_lng = body.location.lng
    context = dict(trip.context or {})
    if trip.planned_trip_id is not None and body.arrival_outcome is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "arrival_outcome is required for a planned trip")
    context.update({
        "ending_soc": body.ending_soc,
        "ending_soc_source": "manual_dashboard",
        "arrival_outcome": body.arrival_outcome,
        "outcome_reason": body.outcome_reason,
    })
    trip.context = context
    if body.arrival_outcome is not None:
        transition_leg_for_trip(db, trip, body.arrival_outcome, body.outcome_reason)
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
