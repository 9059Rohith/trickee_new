from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import DailyPlan, DailyPlanLeg, Driver, Fleet, MobileTripSession, User, Vehicle
from app.services.auth import create_access_token


engine = create_engine("sqlite:///./test_plan_aware_trip_start.db", connect_args={"check_same_thread": False})
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
        fleet = Fleet(name="Plan start", city="Surat")
        db.add(fleet); db.flush()
        driver = Driver(fleet_id=fleet.id, driver_code="PLAN-1", full_name="Driver")
        vehicle = Vehicle(fleet_id=fleet.id, vehicle_code="PLAN-EV", make="Ola", model="S1")
        db.add_all([driver, vehicle]); db.flush()
        driver.assigned_vehicle_id = vehicle.id
        user = User(email="plan-start@example.com", full_name="Driver", role="driver", fleet_id=fleet.id, driver_id=driver.id)
        db.add(user); db.commit()
        return {
            "user_id": user.id,
            "driver_id": driver.id,
            "vehicle_id": vehicle.id,
            "headers": {"Authorization": f"Bearer {create_access_token({'sub': user.id, 'typ': 'user'})}"},
        }


def add_plan(identity, *, status="confirmed", service_date=None, result_matches=True):
    with Session() as db:
        plan = DailyPlan(
            user_id=identity["user_id"], driver_id=identity["driver_id"], vehicle_id=identity["vehicle_id"],
            service_date=service_date or date.today(), timezone="Asia/Kolkata", starting_soc_pct=90,
            source_message="Office at 9", parser_source="test", draft_payload={}, status=status,
            result_payload={"legs": [{
                "index": 0,
                "destination": {"name": "Office", "coordinates": {
                    "lat": 21.170 if result_matches else 22.0,
                    "lng": 72.830,
                }},
            }]},
        )
        db.add(plan); db.flush()
        db.add(DailyPlanLeg(
            plan_id=plan.id, leg_index=0, destination_text="Office",
            destination_lat=21.170, destination_lng=72.830, status="pending",
        ))
        db.commit()
        return plan.id


def start(identity, **overrides):
    payload = {
        "trip_id": "00000000-0000-4000-8000-000000000111",
        "vehicle_id": identity["vehicle_id"],
        "starting_soc": 90,
        "idempotency_key": "plan-start-1",
        **overrides,
    }
    return client.post("/api/v2/trips/start", headers=identity["headers"], json=payload)


def test_confirmed_owned_leg_snapshots_server_destination(identity):
    plan_id = add_plan(identity)
    response = start(
        identity,
        planned_trip_id=plan_id,
        planned_leg_index=0,
        destination_source="planned_stop",
        destination_text="Spoofed",
        destination_lat=1.0,
        destination_lng=2.0,
    )

    assert response.status_code == 200
    assert response.json()["data"]["destination_text"] == "Office"
    assert response.json()["data"]["destination_lat"] == 21.17
    with Session() as db:
        trip = db.query(MobileTripSession).one()
        leg = db.query(DailyPlanLeg).filter_by(plan_id=plan_id, leg_index=0).one()
        assert (trip.planned_trip_id, trip.planned_leg_index) == (plan_id, 0)
        assert (leg.status, leg.trip_id) == ("active", trip.id)


@pytest.mark.parametrize(
    ("plan_kwargs", "expected_status"),
    [
        ({"status": "draft"}, 409),
        ({"service_date": date.today() - timedelta(days=1)}, 409),
        ({"result_matches": False}, 409),
    ],
)
def test_unconfirmed_old_or_edited_plan_leg_is_rejected(identity, plan_kwargs, expected_status):
    plan_id = add_plan(identity, **plan_kwargs)
    response = start(identity, planned_trip_id=plan_id, planned_leg_index=0, destination_source="planned_stop")
    assert response.status_code == expected_status


def test_foreign_plan_is_not_visible(identity):
    plan_id = add_plan(identity)
    with Session() as db:
        plan = db.query(DailyPlan).filter_by(id=plan_id).one()
        plan.user_id = "foreign-user"
        db.commit()
    response = start(identity, planned_trip_id=plan_id, planned_leg_index=0, destination_source="planned_stop")
    assert response.status_code == 404


def test_manual_and_explicit_destinationless_start_are_supported(identity):
    manual = start(
        identity,
        destination_text="Pinned charger",
        destination_lat=21.2,
        destination_lng=72.9,
        destination_source="map_pin",
    )
    assert manual.status_code == 200
    assert manual.json()["data"]["destination_source"] == "map_pin"

    destinationless = start(
        identity,
        trip_id="00000000-0000-4000-8000-000000000112",
        idempotency_key="plan-start-2",
        record_without_destination=True,
        destination_source="destinationless",
    )
    assert destinationless.status_code == 200
    assert destinationless.json()["data"]["destination_lat"] is None


def test_start_replay_is_idempotent_and_old_client_payload_still_works(identity):
    first = start(identity)
    replay = start(identity)
    assert first.status_code == replay.status_code == 200
    assert first.json()["data"]["id"] == replay.json()["data"]["id"]
    with Session() as db:
        assert db.query(MobileTripSession).count() == 1
