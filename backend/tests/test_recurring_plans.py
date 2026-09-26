from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import DailyPlan, DailyPlanLeg, Driver, Fleet, RecurringPlanStop, RecurringPlanTemplate, User, Vehicle
from app.services.auth import create_access_token
from app.services.recurring_plans import materialize_due_plans


engine = create_engine("sqlite:///./test_recurring_plans.db", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


def override_db():
    with Session() as db:
        yield db


@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_db] = override_db
    yield
    Base.metadata.drop_all(engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def identity():
    with Session() as db:
        fleet = Fleet(name="Recurring", city="Surat"); db.add(fleet); db.flush()
        driver = Driver(fleet_id=fleet.id, driver_code="REC-1", full_name="Driver")
        vehicle = Vehicle(fleet_id=fleet.id, vehicle_code="REC-EV", make="Ola", model="S1")
        db.add_all([driver, vehicle]); db.flush(); driver.assigned_vehicle_id = vehicle.id
        user = User(email="recurring@example.com", full_name="Driver", role="driver", fleet_id=fleet.id, driver_id=driver.id)
        db.add(user); db.commit()
        return {
            "user": user.id, "driver": driver.id, "vehicle": vehicle.id,
            "headers": {"Authorization": f"Bearer {create_access_token({'sub': user.id, 'typ': 'user'})}"},
        }


def template_payload(**overrides):
    return {
        "name": "Weekday route",
        "timezone": "Asia/Kolkata",
        "weekdays": [0, 1, 2, 3, 4],
        "starting_soc_pct": 90,
        "effective_from": "2026-09-01",
        "stops": [
            {"label": "Office", "arrival_local_time": "09:00", "lat": 21.17, "lng": 72.83},
            {"label": "Warehouse", "arrival_local_time": "11:00", "lat": 21.20, "lng": 72.90},
        ],
        **overrides,
    }


def test_recurring_crud_validates_weekdays_and_disables_without_deleting(identity):
    invalid = client.post("/api/v1/daily-plans/recurring", headers=identity["headers"], json=template_payload(weekdays=[7]))
    assert invalid.status_code == 422

    created = client.post("/api/v1/daily-plans/recurring", headers=identity["headers"], json=template_payload())
    assert created.status_code == 200
    template_id = created.json()["data"]["id"]
    listed = client.get("/api/v1/daily-plans/recurring", headers=identity["headers"])
    assert [row["id"] for row in listed.json()["data"]] == [template_id]
    updated = client.put(
        f"/api/v1/daily-plans/recurring/{template_id}",
        headers=identity["headers"],
        json=template_payload(name="Updated route", weekdays=[0, 2, 4]),
    )
    assert updated.json()["data"]["name"] == "Updated route"
    disabled = client.delete(f"/api/v1/daily-plans/recurring/{template_id}", headers=identity["headers"])
    assert disabled.status_code == 200
    with Session() as db:
        assert db.query(RecurringPlanTemplate).filter_by(id=template_id).one().is_active is False


def test_materialization_is_timezone_dated_idempotent_and_template_safe(identity):
    with Session() as db:
        template = RecurringPlanTemplate(
            user_id=identity["user"], driver_id=identity["driver"], vehicle_id=identity["vehicle"],
            name="Monday", timezone="Asia/Kolkata", weekdays=[0], starting_soc_pct=88,
            effective_from=date(2026, 9, 1), is_active=True,
        )
        db.add(template); db.flush()
        db.add_all([
            RecurringPlanStop(template_id=template.id, stop_index=0, destination_text="Office", destination_lat=21.17, destination_lng=72.83, arrival_local_time="09:00"),
            RecurringPlanStop(template_id=template.id, stop_index=1, destination_text="Depot", destination_lat=21.20, destination_lng=72.90, arrival_local_time="11:00"),
        ])
        db.commit()

        first = materialize_due_plans(db, date(2026, 9, 28))
        second = materialize_due_plans(db, date(2026, 9, 28))
        assert (first.created, first.existing) == (1, 0)
        assert (second.created, second.existing) == (0, 1)
        plan = db.query(DailyPlan).one()
        assert plan.service_date == date(2026, 9, 28)
        assert plan.status == "confirmed"
        assert [leg.destination_text for leg in db.query(DailyPlanLeg).order_by(DailyPlanLeg.leg_index)] == ["Office", "Depot"]

        plan.result_payload["legs"][0]["destination"]["name"] = "Single-day edit"
        db.commit(); db.refresh(template)
        assert db.query(RecurringPlanStop).filter_by(template_id=template.id, stop_index=0).one().destination_text == "Office"


def test_disabled_or_wrong_weekday_templates_are_skipped(identity):
    with Session() as db:
        db.add(RecurringPlanTemplate(
            user_id=identity["user"], driver_id=identity["driver"], vehicle_id=identity["vehicle"],
            name="Disabled", timezone="Asia/Kolkata", weekdays=[0], starting_soc_pct=90,
            is_active=False,
        ))
        db.add(RecurringPlanTemplate(
            user_id=identity["user"], driver_id=identity["driver"], vehicle_id=identity["vehicle"],
            name="Tuesday", timezone="Asia/Kolkata", weekdays=[1], starting_soc_pct=90,
            is_active=True,
        ))
        db.commit()
        stats = materialize_due_plans(db, date(2026, 9, 28))
        assert stats.created == 0
        assert db.query(DailyPlan).count() == 0


def test_next_leg_is_the_earliest_pending_leg_for_today(identity):
    with Session() as db:
        plan = DailyPlan(
            user_id=identity["user"], driver_id=identity["driver"], vehicle_id=identity["vehicle"],
            service_date=date.today(), timezone="Asia/Kolkata", starting_soc_pct=90,
            source_message="test", parser_source="test", draft_payload={}, result_payload={"legs": []}, status="confirmed",
        )
        db.add(plan); db.flush()
        db.add_all([
            DailyPlanLeg(plan_id=plan.id, leg_index=1, destination_text="Later", destination_lat=21.2, destination_lng=72.9, planned_departure_at=datetime(2099, 1, 1, 11), status="pending"),
            DailyPlanLeg(plan_id=plan.id, leg_index=0, destination_text="First", destination_lat=21.1, destination_lng=72.8, planned_departure_at=datetime(2099, 1, 1, 9), status="pending"),
        ])
        db.commit()
    response = client.get("/api/v1/daily-plans/next", headers=identity["headers"])
    assert response.status_code == 200
    assert response.json()["data"]["destination_text"] == "First"
