from sqlalchemy import UniqueConstraint, create_engine, inspect

from app.database import Base
from app.models.entities import (
    DailyPlan,
    DailyPlanLeg,
    MobileTripSession,
    RecurringPlanStop,
    RecurringPlanTemplate,
    RouteGuidanceSnapshot,
)


def _unique_columns(model) -> set[tuple[str, ...]]:
    return {
        tuple(constraint.columns.keys())
        for constraint in model.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def test_plan_leg_and_materialization_boundaries_are_unique():
    assert ("plan_id", "leg_index") in _unique_columns(DailyPlanLeg)
    assert ("recurring_template_id", "service_date") in _unique_columns(DailyPlan)
    assert ("template_id", "stop_index") in _unique_columns(RecurringPlanStop)


def test_legacy_trips_keep_nullable_plan_and_actual_endpoint_fields():
    trip = MobileTripSession(
        user_id="user",
        driver_id="driver",
        started_at=__import__("datetime").datetime(2026, 9, 26, 8, 0),
    )

    assert trip.planned_trip_id is None
    assert trip.planned_leg_index is None
    assert trip.destination_source is None
    assert trip.ended_lat is None
    assert trip.ended_lng is None


def test_planned_destination_and_actual_endpoint_are_distinct_columns():
    assert MobileTripSession.destination_lat.property.columns[0].name == "destination_lat"
    assert MobileTripSession.ended_lat.property.columns[0].name == "ended_lat"
    assert MobileTripSession.destination_lng.property.columns[0].name == "destination_lng"
    assert MobileTripSession.ended_lng.property.columns[0].name == "ended_lng"


def test_new_guidance_tables_are_created_without_replacing_result_payload():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    tables = set(inspect(engine).get_table_names())

    assert {
        "daily_plan_legs",
        "recurring_plan_templates",
        "recurring_plan_stops",
        "route_guidance_snapshots",
    } <= tables
    assert DailyPlan.result_payload.property.columns[0].nullable is True
    assert RouteGuidanceSnapshot.payload.property.columns[0].nullable is True
    assert RecurringPlanTemplate.weekdays.property.columns[0].nullable is False
