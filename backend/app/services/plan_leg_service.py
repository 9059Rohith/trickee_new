from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.entities import DailyPlan, DailyPlanLeg, Driver, MobileTripSession, User, Vehicle


ArrivalOutcome = Literal["arrived", "skipped", "ended_elsewhere"]


def _utc_naive(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def materialize_plan_legs(db: Session, plan: DailyPlan) -> list[DailyPlanLeg]:
    existing = {
        row.leg_index: row
        for row in db.query(DailyPlanLeg).filter(DailyPlanLeg.plan_id == plan.id).all()
    }
    for payload in (plan.result_payload or {}).get("legs", []):
        index = payload.get("index")
        destination = payload.get("destination") or {}
        coordinates = destination.get("coordinates") or {}
        if index is None or coordinates.get("lat") is None or coordinates.get("lng") is None:
            continue
        if index in existing:
            continue
        row = DailyPlanLeg(
            plan_id=plan.id,
            leg_index=index,
            destination_text=(destination.get("name") or destination.get("query") or "Planned stop")[:255],
            destination_lat=coordinates["lat"],
            destination_lng=coordinates["lng"],
            planned_departure_at=_utc_naive(payload.get("planned_departure_at")),
            planned_arrival_at=_utc_naive(payload.get("estimated_arrival_at")),
            status="pending",
        )
        db.add(row)
        existing[index] = row
    return [existing[index] for index in sorted(existing)]


def resolve_owned_plan_leg(
    db: Session,
    user: User,
    driver: Driver,
    vehicle: Vehicle,
    plan_id: str,
    leg_index: int,
) -> DailyPlanLeg:
    plan = db.query(DailyPlan).filter(
        DailyPlan.id == plan_id,
        DailyPlan.user_id == user.id,
        DailyPlan.driver_id == driver.id,
        DailyPlan.vehicle_id == vehicle.id,
    ).first()
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Daily plan not found")
    if plan.status != "confirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily plan is not confirmed")
    try:
        local_today = datetime.now(ZoneInfo(plan.timezone)).date()
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily plan timezone is invalid") from exc
    if plan.service_date != local_today:
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily plan is not for today")

    leg = db.query(DailyPlanLeg).filter(
        DailyPlanLeg.plan_id == plan.id,
        DailyPlanLeg.leg_index == leg_index,
    ).with_for_update().first()
    if leg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Daily plan leg not found")
    if leg.status != "pending" or leg.trip_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily plan leg is no longer available")

    result_leg = next(
        (item for item in (plan.result_payload or {}).get("legs", []) if item.get("index") == leg_index),
        None,
    )
    coordinates = ((result_leg or {}).get("destination") or {}).get("coordinates") or {}
    if (
        result_leg is None
        or coordinates.get("lat") is None
        or coordinates.get("lng") is None
        or abs(float(coordinates["lat"]) - leg.destination_lat) > 1e-7
        or abs(float(coordinates["lng"]) - leg.destination_lng) > 1e-7
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Daily plan changed after confirmation")
    return leg


def transition_leg_for_trip(
    db: Session,
    trip: MobileTripSession,
    outcome: ArrivalOutcome,
    reason: str | None = None,
) -> DailyPlanLeg | None:
    if trip.planned_trip_id is None or trip.planned_leg_index is None:
        return None
    leg = db.query(DailyPlanLeg).filter(
        DailyPlanLeg.plan_id == trip.planned_trip_id,
        DailyPlanLeg.leg_index == trip.planned_leg_index,
    ).with_for_update().first()
    if leg is None or leg.trip_id != trip.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Trip is not linked to its planned leg")
    if leg.status == outcome:
        return leg
    if leg.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "Planned leg already has a different outcome")
    leg.status = outcome
    leg.outcome_reason = reason
    leg.completed_at = trip.ended_at or datetime.utcnow()
    return leg
