from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import DailyPlan, Driver, NotificationOutbox, TripPrediction, User, Vehicle
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.daily_plan_conversation import daily_plan_conversation
from app.services.daily_plan_orchestrator import build_plan_result
from app.services.daily_plan_tools import daily_plan_tools


router = APIRouter(prefix="/daily-plans", tags=["daily plans"])


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=3, max_length=2000)
    service_date: date
    timezone: str = Field(min_length=3, max_length=64)
    starting_soc_pct: float = Field(ge=0, le=100)


class Coordinates(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_key: str = Field(min_length=8, max_length=255)
    origin: Coordinates


def _require_driver(db: Session, user: User) -> Driver:
    if user.role != "driver" or not user.driver_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver account required")
    driver = db.query(Driver).filter(Driver.id == user.driver_id).first()
    if not driver:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver record not found")
    return driver


def _assigned_vehicle(db: Session, driver: Driver) -> Vehicle:
    if not driver.assigned_vehicle_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Assigned vehicle required")
    vehicle = db.query(Vehicle).filter(Vehicle.id == driver.assigned_vehicle_id, Vehicle.is_active.is_(True)).first()
    if not vehicle:
        raise HTTPException(status.HTTP_409_CONFLICT, "Assigned active vehicle required")
    return vehicle


def _plan_dict(plan: DailyPlan) -> dict[str, Any]:
    return {
        "id": plan.id, "driver_id": plan.driver_id, "vehicle_id": plan.vehicle_id,
        "service_date": plan.service_date.isoformat(), "timezone": plan.timezone,
        "starting_soc_pct": plan.starting_soc_pct, "status": plan.status,
        "draft": plan.draft_payload, "result": plan.result_payload,
        "confirmed_at": utc_iso(plan.confirmed_at), "created_at": utc_iso(plan.created_at),
    }


def _owned_plan(db: Session, plan_id: str, user: User, driver: Driver) -> DailyPlan:
    plan = db.query(DailyPlan).filter(
        DailyPlan.id == plan_id,
        DailyPlan.user_id == user.id,
        DailyPlan.driver_id == driver.id,
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Daily plan not found")
    return plan


@router.post("/chat")
def chat_daily_plan(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    vehicle = _assigned_vehicle(db, driver)
    try:
        conversation = daily_plan_conversation.handle(
            message=body.message,
            service_date=body.service_date,
            timezone_name=body.timezone,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    draft = conversation.plan.to_dict()
    plan = DailyPlan(
        user_id=current_user.id, driver_id=driver.id, vehicle_id=vehicle.id,
        service_date=body.service_date, timezone=body.timezone,
        starting_soc_pct=body.starting_soc_pct, source_message=body.message,
        parser_source=conversation.plan.parser_source, draft_payload=draft, status="draft",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return ok({
        "plan": _plan_dict(plan),
        "conversation": {
            "reply": conversation.reply, "tool_calls": conversation.tool_calls,
            "llm_fallback_used": conversation.llm_fallback_used,
            "model_name": conversation.model_name, "error_code": conversation.error_code,
        },
    }, "Daily plan draft created")


@router.get("/{plan_id}")
def get_daily_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    return ok(_plan_dict(_owned_plan(db, plan_id, current_user, driver)))


@router.post("/{plan_id}/confirm")
def confirm_daily_plan(
    plan_id: str,
    body: ConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    plan = _owned_plan(db, plan_id, current_user, driver)
    vehicle = _assigned_vehicle(db, driver)
    if plan.status == "confirmed":
        if plan.confirmation_key != body.confirmation_key:
            raise HTTPException(status.HTTP_409_CONFLICT, "Plan already confirmed")
        return ok(_plan_dict(plan), "Daily plan already confirmed")
    if (plan.draft_payload or {}).get("warnings"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Resolve schedule warnings before confirmation")

    # Vehicle specification is the only fallback energy-rate source; no trained-model claim is made.
    wh_per_km = None
    energy_rate_source = "unavailable"
    usable_kwh = vehicle.usable_kwh
    latest_prediction = (
        db.query(TripPrediction)
        .filter(TripPrediction.vehicle_id == vehicle.id, TripPrediction.wh_per_km.is_not(None))
        .order_by(desc(TripPrediction.created_at))
        .first()
    )
    if latest_prediction and latest_prediction.wh_per_km and latest_prediction.wh_per_km > 0:
        wh_per_km = latest_prediction.wh_per_km
        energy_rate_source = f"gps_prediction:{latest_prediction.source}"
    elif usable_kwh and vehicle.certified_range and vehicle.certified_range > 0:
        wh_per_km = usable_kwh * 1000.0 / vehicle.certified_range
        energy_rate_source = "vehicle_spec_range_implied"
    result = build_plan_result(
        stops=(plan.draft_payload or {}).get("stops") or [],
        service_date=plan.service_date, timezone_name=plan.timezone,
        origin=body.origin.model_dump(), starting_soc_pct=plan.starting_soc_pct,
        usable_kwh=usable_kwh, wh_per_km=wh_per_km,
        energy_rate_source=energy_rate_source, tools=daily_plan_tools,
    )
    plan.result_payload = result
    plan.status = "confirmed"
    plan.confirmation_key = body.confirmation_key
    plan.confirmed_at = datetime.now(timezone.utc).replace(tzinfo=None)

    for leg in result["legs"]:
        departure_raw = leg.get("planned_departure_at")
        if not departure_raw:
            continue
        departure = datetime.fromisoformat(departure_raw)
        departure_utc = departure.astimezone(timezone.utc).replace(tzinfo=None)
        expires_at_utc = departure_utc + timedelta(minutes=30)
        if expires_at_utc <= datetime.now(timezone.utc).replace(tzinfo=None):
            continue
        destination = (leg.get("destination") or {}).get("name") or (leg.get("destination") or {}).get("query") or "your stop"
        arrival_soc = leg.get("arrival_soc_pct")
        soc_text = f" Estimated arrival SOC {arrival_soc:.1f}%." if arrival_soc is not None else " Arrival SOC is unavailable."
        db.add(NotificationOutbox(
            idempotency_key=f"daily-plan:{plan.id}:leg:{leg['index']}:departure",
            user_id=current_user.id, driver_id=driver.id, vehicle_id=vehicle.id,
            planned_trip_id=plan.id, nudge_type="daily_departure",
            title=f"Leave soon for {destination}"[:120],
            body=(f"Planned departure is {departure.strftime('%H:%M')}.{soc_text}")[:500],
            payload={
                "screen": "route_nudge", "plan_id": plan.id, "leg_index": leg["index"],
                "occurrence_id": f"{plan.id}-leg-{leg['index']}",
                "delivery_priority": "high", "android_channel_id": "trickee_route_alerts_high",
                "expires_at": expires_at_utc.replace(tzinfo=timezone.utc).isoformat(),
                "route_source": leg.get("route_source"),
                "provider_source": leg.get("route_source"),
                "confidence": leg.get("confidence"),
                "degraded_reason": leg.get("degraded_reason"),
                "destination_lat": ((leg.get("destination") or {}).get("coordinates") or {}).get("lat"),
                "destination_lng": ((leg.get("destination") or {}).get("coordinates") or {}).get("lng"),
                "route_name": destination,
                "leave_at": departure_raw,
                "arrival_soc_pct": arrival_soc,
            },
            status="pending", due_at=departure_utc - timedelta(minutes=15),
        ))
    db.commit()
    db.refresh(plan)
    return ok(_plan_dict(plan), "Daily plan confirmed")
