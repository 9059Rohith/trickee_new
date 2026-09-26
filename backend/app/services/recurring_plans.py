from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.entities import DailyPlan, RecurringPlanStop, RecurringPlanTemplate
from app.services.plan_leg_service import materialize_plan_legs


@dataclass(frozen=True)
class MaterializationStats:
    scanned: int = 0
    created: int = 0
    existing: int = 0
    skipped: int = 0


def _arrival_iso(service_date: date, local_time: str, timezone_name: str) -> str:
    hour, minute = (int(part) for part in local_time.split(":"))
    local = datetime.combine(service_date, time(hour, minute), ZoneInfo(timezone_name))
    return local.isoformat()


def materialize_due_plans(
    db: Session,
    local_date: date | None = None,
    *,
    now: datetime | None = None,
) -> MaterializationStats:
    templates = db.query(RecurringPlanTemplate).filter(
        RecurringPlanTemplate.is_active.is_(True)
    ).all()
    current = now or datetime.now(timezone.utc)
    created = existing = skipped = 0
    for template in templates:
        service_date = local_date or current.astimezone(ZoneInfo(template.timezone)).date()
        if (
            service_date.weekday() not in set(template.weekdays or [])
            or (template.effective_from and service_date < template.effective_from)
            or (template.effective_until and service_date > template.effective_until)
        ):
            skipped += 1
            continue
        found = db.query(DailyPlan).filter(
            DailyPlan.recurring_template_id == template.id,
            DailyPlan.service_date == service_date,
        ).first()
        if found is not None:
            existing += 1
            continue
        stops = db.query(RecurringPlanStop).filter(
            RecurringPlanStop.template_id == template.id
        ).order_by(RecurringPlanStop.stop_index).all()
        if not stops:
            skipped += 1
            continue
        legs = [{
            "index": stop.stop_index,
            "destination": {
                "name": stop.destination_text,
                "query": stop.destination_text,
                "coordinates": {"lat": stop.destination_lat, "lng": stop.destination_lng},
                "source": "recurring_template",
            },
            "requested_arrival_local": stop.arrival_local_time,
            "planned_departure_at": None,
            "estimated_arrival_at": _arrival_iso(service_date, stop.arrival_local_time, template.timezone),
            "route_source": "unavailable_until_trip_start",
            "confidence": 1.0,
            "degraded_reason": "origin_required",
        } for stop in stops]
        draft_stops = [{
            "label": stop.destination_text,
            "requested_arrival_local": stop.arrival_local_time,
            "coordinates": {"lat": stop.destination_lat, "lng": stop.destination_lng},
            "status": "resolved",
        } for stop in stops]
        plan = DailyPlan(
            user_id=template.user_id,
            driver_id=template.driver_id,
            vehicle_id=template.vehicle_id,
            recurring_template_id=template.id,
            service_date=service_date,
            timezone=template.timezone,
            starting_soc_pct=template.starting_soc_pct,
            source_message=f"Recurring schedule: {template.name}",
            parser_source="recurring_template",
            draft_payload={"stops": draft_stops, "warnings": []},
            result_payload={
                "legs": legs,
                "source": "recurring_template",
                "route_guidance_state": "awaiting_trip_origin",
            },
            status="confirmed",
            confirmation_key=f"recurring:{template.id}:{service_date.isoformat()}",
            confirmed_at=current.astimezone(timezone.utc).replace(tzinfo=None),
        )
        db.add(plan)
        db.flush()
        materialize_plan_legs(db, plan)
        created += 1
    db.commit()
    return MaterializationStats(
        scanned=len(templates), created=created, existing=existing, skipped=skipped
    )
