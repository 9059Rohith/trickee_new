from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import DailyPlan, DailyPlanLeg, Driver, NotificationOutbox, RecurringPlanStop, RecurringPlanTemplate, TripPrediction, User, Vehicle
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user
from app.services.daily_plan_conversation import daily_plan_conversation
from app.services.daily_plan_orchestrator import build_plan_result
from app.services.daily_plan_tools import daily_plan_tools
from app.services.plan_leg_service import materialize_plan_legs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


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


class ConfirmStop(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=160)
    requested_arrival_local: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    coordinates: Coordinates | None = None

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Stop label is required")
        return cleaned


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_key: str = Field(min_length=8, max_length=255)
    origin: Coordinates
    stops: list[ConfirmStop] | None = Field(default=None, min_length=1, max_length=10)


class RecurringStopRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=255)
    arrival_local_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RecurringTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    timezone: str = Field(min_length=3, max_length=64)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    starting_soc_pct: float = Field(ge=0, le=100)
    effective_from: date | None = None
    effective_until: date | None = None
    stops: list[RecurringStopRequest] = Field(min_length=1, max_length=10)

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value) or len(set(value)) != len(value):
            raise ValueError("weekdays must contain unique values from 0 through 6")
        return sorted(value)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone is not recognized") from exc
        return value

    @model_validator(mode="after")
    def valid_effective_range(self) -> "RecurringTemplateRequest":
        if self.effective_from and self.effective_until and self.effective_until < self.effective_from:
            raise ValueError("effective_until must not precede effective_from")
        return self


class DestinationSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=3, max_length=160)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3:
            raise ValueError("Destination search needs at least three characters")
        return cleaned


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


def _template_dict(template: RecurringPlanTemplate, stops: list[RecurringPlanStop]) -> dict[str, Any]:
    return {
        "id": template.id,
        "name": template.name,
        "timezone": template.timezone,
        "weekdays": template.weekdays,
        "starting_soc_pct": template.starting_soc_pct,
        "effective_from": template.effective_from.isoformat() if template.effective_from else None,
        "effective_until": template.effective_until.isoformat() if template.effective_until else None,
        "is_active": template.is_active,
        "stops": [{
            "index": stop.stop_index,
            "label": stop.destination_text,
            "arrival_local_time": stop.arrival_local_time,
            "lat": stop.destination_lat,
            "lng": stop.destination_lng,
        } for stop in stops],
    }


def _owned_template(db: Session, template_id: str, user: User, driver: Driver) -> RecurringPlanTemplate:
    template = db.query(RecurringPlanTemplate).filter(
        RecurringPlanTemplate.id == template_id,
        RecurringPlanTemplate.user_id == user.id,
        RecurringPlanTemplate.driver_id == driver.id,
    ).first()
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recurring plan not found")
    return template


def _replace_template_stops(db: Session, template: RecurringPlanTemplate, stops: list[RecurringStopRequest]) -> None:
    db.query(RecurringPlanStop).filter(RecurringPlanStop.template_id == template.id).delete()
    for index, stop in enumerate(stops):
        db.add(RecurringPlanStop(
            template_id=template.id,
            stop_index=index,
            destination_text=" ".join(stop.label.split()),
            destination_lat=stop.lat,
            destination_lng=stop.lng,
            arrival_local_time=stop.arrival_local_time,
        ))


def _owned_plan(db: Session, plan_id: str, user: User, driver: Driver) -> DailyPlan:
    plan = db.query(DailyPlan).filter(
        DailyPlan.id == plan_id,
        DailyPlan.user_id == user.id,
        DailyPlan.driver_id == driver.id,
    ).first()
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Daily plan not found")
    return plan


def _enrich_stops(stops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched = []
    for stop in stops[:10]:
        resolved = daily_plan_tools.resolve_destination(stop["label"])
        coordinates = resolved.get("coordinates")
        enriched.append({
            **stop,
            "status": "resolved" if coordinates else "needs_confirmation",
            "coordinates": coordinates,
            "resolved_location": resolved,
        })
    return enriched


def _confirmed_stops(plan: DailyPlan, overrides: list[ConfirmStop] | None) -> list[dict[str, Any]]:
    existing = list((plan.draft_payload or {}).get("stops") or [])
    if overrides is None:
        return existing
    confirmed = []
    for index, override in enumerate(overrides):
        row = override.model_dump()
        coordinates = row.get("coordinates")
        if coordinates:
            original = existing[index] if index < len(existing) else {}
            original_coordinates = original.get("coordinates")
            preserve_provider = (
                original.get("label") == row["label"]
                and original_coordinates == coordinates
                and original.get("resolved_location")
            )
            resolved = original["resolved_location"] if preserve_provider else {
                "query": row["label"],
                "name": row["label"],
                "formatted_address": None,
                "coordinates": coordinates,
                "source": "user_map_pin",
                "confidence": 1.0,
                "degraded_reason": None,
            }
            confirmed.append({
                **row, "status": "resolved", "resolved_location": resolved,
            })
        else:
            resolved = daily_plan_tools.resolve_destination(row["label"])
            confirmed.append({
                **row,
                "coordinates": resolved.get("coordinates"),
                "status": "resolved" if resolved.get("coordinates") else "needs_confirmation",
                "resolved_location": resolved,
            })
    return confirmed


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
    draft["stops"] = _enrich_stops(draft.get("stops") or [])
    plan = DailyPlan(
        user_id=current_user.id, driver_id=driver.id, vehicle_id=vehicle.id,
        service_date=conversation.plan.service_date, timezone=conversation.plan.timezone,
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


@router.get("/next")
def get_next_daily_plan_leg(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    vehicle = _assigned_vehicle(db, driver)
    plans = db.query(DailyPlan).filter(
        DailyPlan.user_id == current_user.id,
        DailyPlan.driver_id == driver.id,
        DailyPlan.vehicle_id == vehicle.id,
        DailyPlan.status == "confirmed",
    ).all()
    eligible: list[tuple[DailyPlan, DailyPlanLeg]] = []
    for plan in plans:
        try:
            today = datetime.now(ZoneInfo(plan.timezone)).date()
        except ZoneInfoNotFoundError:
            continue
        if plan.service_date != today:
            continue
        for leg in db.query(DailyPlanLeg).filter(
            DailyPlanLeg.plan_id == plan.id,
            DailyPlanLeg.status.in_(("pending", "active")),
        ).all():
            eligible.append((plan, leg))
    if not eligible:
        return ok(None, "No eligible planned leg")
    plan, leg = min(eligible, key=lambda row: (
        row[1].status != "active",
        row[1].planned_departure_at is None,
        row[1].planned_departure_at or datetime.max,
        row[1].leg_index,
    ))
    return ok({
        "plan_id": plan.id,
        "leg_index": leg.leg_index,
        "status": leg.status,
        "destination_text": leg.destination_text,
        "destination_lat": leg.destination_lat,
        "destination_lng": leg.destination_lng,
        "planned_departure_at": utc_iso(leg.planned_departure_at),
        "planned_arrival_at": utc_iso(leg.planned_arrival_at),
        "service_date": plan.service_date.isoformat(),
        "timezone": plan.timezone,
    }, "Next planned leg")


@router.post("/resolve-destination")
def resolve_destination(
    body: DestinationSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_driver(db, current_user)
    resolved = daily_plan_tools.resolve_destination(body.query)
    coordinates = resolved.get("coordinates")
    if not coordinates:
        if resolved.get("degraded_reason"):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Destination search is temporarily unavailable. Try again.",
            )
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No matching destination was found.")
    return ok({
        "query": resolved.get("query") or body.query,
        "place_id": resolved.get("place_id"),
        "name": resolved.get("name") or resolved.get("formatted_address") or body.query,
        "formatted_address": resolved.get("formatted_address"),
        "coordinates": coordinates,
        "source": resolved.get("source"),
        "confidence": resolved.get("confidence"),
    }, "Destination resolved")


@router.get("/recurring")
def list_recurring_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    templates = db.query(RecurringPlanTemplate).filter(
        RecurringPlanTemplate.user_id == current_user.id,
        RecurringPlanTemplate.driver_id == driver.id,
    ).order_by(RecurringPlanTemplate.created_at).all()
    return ok([
        _template_dict(
            template,
            db.query(RecurringPlanStop).filter_by(template_id=template.id).order_by(RecurringPlanStop.stop_index).all(),
        )
        for template in templates
    ])


@router.post("/recurring")
def create_recurring_plan(
    body: RecurringTemplateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    vehicle = _assigned_vehicle(db, driver)
    template = RecurringPlanTemplate(
        user_id=current_user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        name=" ".join(body.name.split()),
        timezone=body.timezone,
        weekdays=body.weekdays,
        starting_soc_pct=body.starting_soc_pct,
        effective_from=body.effective_from,
        effective_until=body.effective_until,
        is_active=True,
    )
    db.add(template); db.flush()
    _replace_template_stops(db, template, body.stops)
    db.commit(); db.refresh(template)
    stops = db.query(RecurringPlanStop).filter_by(template_id=template.id).order_by(RecurringPlanStop.stop_index).all()
    return ok(_template_dict(template, stops), "Recurring plan created")


@router.put("/recurring/{template_id}")
def update_recurring_plan(
    template_id: str,
    body: RecurringTemplateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    template = _owned_template(db, template_id, current_user, driver)
    template.name = " ".join(body.name.split())
    template.timezone = body.timezone
    template.weekdays = body.weekdays
    template.starting_soc_pct = body.starting_soc_pct
    template.effective_from = body.effective_from
    template.effective_until = body.effective_until
    _replace_template_stops(db, template, body.stops)
    db.commit(); db.refresh(template)
    stops = db.query(RecurringPlanStop).filter_by(template_id=template.id).order_by(RecurringPlanStop.stop_index).all()
    return ok(_template_dict(template, stops), "Recurring plan updated")


@router.delete("/recurring/{template_id}")
def disable_recurring_plan(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    template = _owned_template(db, template_id, current_user, driver)
    template.is_active = False
    db.commit(); db.refresh(template)
    stops = db.query(RecurringPlanStop).filter_by(template_id=template.id).order_by(RecurringPlanStop.stop_index).all()
    return ok(_template_dict(template, stops), "Recurring plan disabled")


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
        materialize_plan_legs(db, plan)
        db.commit()
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
    stops = _confirmed_stops(plan, body.stops)
    if body.stops is not None:
        plan.draft_payload = {
            **(plan.draft_payload or {}),
            "stops": stops,
            "warnings": [],
        }
    result = build_plan_result(
        stops=stops,
        service_date=plan.service_date, timezone_name=plan.timezone,
        origin=body.origin.model_dump(), starting_soc_pct=plan.starting_soc_pct,
        usable_kwh=usable_kwh, wh_per_km=wh_per_km,
        energy_rate_source=energy_rate_source, tools=daily_plan_tools,
    )
    plan.result_payload = result
    plan.status = "confirmed"
    plan.confirmation_key = body.confirmation_key
    plan.confirmed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    materialize_plan_legs(db, plan)

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
                "screen": "trip_start", "plan_id": plan.id, "leg_index": leg["index"],
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
