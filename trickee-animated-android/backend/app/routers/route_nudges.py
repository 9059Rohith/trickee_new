from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import DailyPlan, Driver, NotificationOutbox, NudgeOutcome, User
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user


router = APIRouter(prefix="/route-nudges", tags=["route nudges"])
_EVENT_FIELDS = {
    "delivered": "delivered_at",
    "opened": "opened_at",
    "accepted": "accepted_at",
    "dismissed": "dismissed_at",
    "followed": "followed_at",
}
_EVENT_RANK = {"delivered": 1, "opened": 2, "accepted": 3, "dismissed": 3, "followed": 4}


class NudgeOutcomeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["delivered", "opened", "accepted", "dismissed", "followed"]
    occurred_at: datetime
    selected_route_id: str | None = Field(default=None, max_length=160)
    selected_charger_id: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] | None = None

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at must include a timezone")
        return value


def _require_driver(db: Session, user: User) -> Driver:
    if user.role != "driver" or not user.driver_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver account required")
    driver = db.query(Driver).filter(Driver.id == user.driver_id).first()
    if not driver:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Driver record not found")
    return driver


def _outcome_dict(row: NudgeOutcome | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.id,
        "notification_outbox_id": row.notification_outbox_id,
        "driver_id": row.driver_id,
        "latest_event": row.latest_event,
        "delivered_at": utc_iso(row.delivered_at),
        "opened_at": utc_iso(row.opened_at),
        "accepted_at": utc_iso(row.accepted_at),
        "dismissed_at": utc_iso(row.dismissed_at),
        "followed_at": utc_iso(row.followed_at),
        "selected_route_id": row.selected_route_id,
        "selected_charger_id": row.selected_charger_id,
        "metadata": row.outcome_metadata,
    }


def _enriched_payload(row: NotificationOutbox, plan: DailyPlan | None) -> dict[str, Any]:
    payload = {
        key: value for key, value in (row.payload or {}).items()
        if not str(key).startswith("_")
    }
    payload.setdefault("screen", "route_nudge")
    if row.planned_trip_id is not None and payload.get("leg_index") is not None:
        payload.setdefault("occurrence_id", f"{row.planned_trip_id}-leg-{payload['leg_index']}")
    if not plan or not plan.result_payload:
        return payload
    leg_index = payload.get("leg_index")
    leg = next(
        (
            item for item in (plan.result_payload.get("legs") or [])
            if item.get("index") == leg_index
        ),
        None,
    )
    if not leg:
        return payload
    destination = leg.get("destination") or {}
    coordinates = destination.get("coordinates") or {}
    derived = {
        "destination_lat": coordinates.get("lat"),
        "destination_lng": coordinates.get("lng"),
        "route_name": destination.get("name") or destination.get("query"),
        "leave_at": leg.get("planned_departure_at"),
        "arrival_soc_pct": leg.get("arrival_soc_pct"),
        "provider_source": leg.get("route_source"),
        "degraded_reason": leg.get("degraded_reason"),
    }
    for key, value in derived.items():
        if key not in payload or payload[key] is None:
            payload[key] = value
    return payload


def _nudge_dict(
    row: NotificationOutbox,
    outcome: NudgeOutcome | None,
    plan: DailyPlan | None = None,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "driver_id": row.driver_id,
        "vehicle_id": row.vehicle_id,
        "planned_trip_id": row.planned_trip_id,
        "route_decision_id": row.route_decision_id,
        "nudge_type": row.nudge_type,
        "title": row.title,
        "body": row.body,
        "payload": _enriched_payload(row, plan),
        "delivery_status": row.status,
        "attempts": row.attempts,
        "due_at": utc_iso(row.due_at),
        "sent_at": utc_iso(row.sent_at),
        "failed_at": utc_iso(row.failed_at),
        "provider_error_code": row.last_error_code,
        "outcome": _outcome_dict(outcome),
    }


@router.get("/inbox")
def nudge_inbox(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    rows = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.user_id == current_user.id,
            NotificationOutbox.driver_id == driver.id,
        )
        .order_by(desc(NotificationOutbox.due_at))
        .limit(max(1, min(limit, 100)))
        .all()
    )
    outcomes = {
        row.notification_outbox_id: row
        for row in db.query(NudgeOutcome)
        .filter(NudgeOutcome.notification_outbox_id.in_([item.id for item in rows]))
        .all()
    } if rows else {}
    plan_ids = {row.planned_trip_id for row in rows if row.planned_trip_id}
    plans = {
        plan.id: plan
        for plan in db.query(DailyPlan).filter(DailyPlan.id.in_(plan_ids)).all()
    } if plan_ids else {}
    return ok([
        _nudge_dict(row, outcomes.get(row.id), plans.get(row.planned_trip_id))
        for row in rows
    ])


@router.post("/{nudge_id}/outcome")
def record_nudge_outcome(
    nudge_id: str,
    payload: NudgeOutcomeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = _require_driver(db, current_user)
    nudge = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.id == nudge_id,
            NotificationOutbox.user_id == current_user.id,
            NotificationOutbox.driver_id == driver.id,
        )
        .first()
    )
    if not nudge:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nudge not found")

    row = db.query(NudgeOutcome).filter(
        NudgeOutcome.notification_outbox_id == nudge.id
    ).first()
    if not row:
        row = NudgeOutcome(
            notification_outbox_id=nudge.id,
            driver_id=driver.id,
            latest_event=payload.event,
        )
        db.add(row)
    elif _EVENT_RANK[payload.event] >= _EVENT_RANK[row.latest_event]:
        row.latest_event = payload.event

    timestamp_field = _EVENT_FIELDS[payload.event]
    if getattr(row, timestamp_field) is None:
        setattr(
            row,
            timestamp_field,
            payload.occurred_at.astimezone(timezone.utc).replace(tzinfo=None),
        )
    if payload.selected_route_id:
        row.selected_route_id = payload.selected_route_id
    if payload.selected_charger_id:
        row.selected_charger_id = payload.selected_charger_id
    if payload.metadata is not None:
        row.outcome_metadata = payload.metadata
    db.commit()
    db.refresh(row)
    return ok(_outcome_dict(row), "Nudge outcome recorded")
