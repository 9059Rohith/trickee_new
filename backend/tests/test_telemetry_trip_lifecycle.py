from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import DeviceTripUploadCursor, Driver, Fleet, MobileTripSession, TripFinalization, User, Vehicle
from app.services.auth import create_access_token

engine = create_engine("sqlite:///./test_trip_lifecycle.db", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


def override_db():
    with Session() as db: yield db


@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(engine); app.dependency_overrides[get_db] = override_db
    yield
    Base.metadata.drop_all(engine); app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def identity():
    with Session() as db:
        fleet = Fleet(name="Lifecycle", city="Chennai"); db.add(fleet); db.flush()
        driver = Driver(fleet_id=fleet.id, driver_code="LIFE-1", full_name="Driver"); db.add(driver); db.flush()
        user = User(email="life@example.com", full_name="Driver", role="driver", fleet_id=fleet.id, driver_id=driver.id)
        vehicle = Vehicle(fleet_id=fleet.id, vehicle_code="LIFE-EV", make="Test", model="EV")
        db.add_all([user, vehicle]); db.flush()
        driver.assigned_vehicle_id = vehicle.id
        db.commit()
        return {"user": user.id, "vehicle": vehicle.id, "headers": {"Authorization": f"Bearer {create_access_token({'sub': user.id, 'typ': 'user'})}"}}


def start(identity, trip_id="00000000-0000-4000-8000-000000000001", key="start-1"):
    return client.post("/api/v2/trips/start", headers=identity["headers"], json={
        "trip_id": trip_id, "vehicle_id": identity["vehicle"], "starting_soc": 90, "idempotency_key": key,
    })


def test_start_replay_preserves_client_trip_identity(identity):
    first = start(identity); second = start(identity)
    assert first.status_code == second.status_code == 200
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    with Session() as db: assert db.query(MobileTripSession).count() == 1


def test_completion_waits_for_gap_and_replay_is_idempotent(identity):
    trip_id = start(identity).json()["data"]["id"]
    body = {"ending_soc": 80, "final_sequence_no": 10, "idempotency_key": "end-1"}
    first = client.post(f"/api/v2/trips/{trip_id}/complete", headers=identity["headers"], json=body)
    replay = client.post(f"/api/v2/trips/{trip_id}/complete", headers=identity["headers"], json=body)
    assert first.json()["data"]["finalization_state"] == "waiting_for_telemetry"
    assert replay.status_code == 200
    with Session() as db: assert db.query(TripFinalization).count() == 1


def test_completion_rejects_an_unbounded_final_sequence(identity):
    trip_id = start(identity).json()["data"]["id"]
    response = client.post(f"/api/v2/trips/{trip_id}/complete", headers=identity["headers"], json={
        "ending_soc": 80, "final_sequence_no": 172_801, "idempotency_key": "too-large"})
    assert response.status_code == 422


def test_completion_is_eligible_at_declared_cursor(identity):
    trip_id = start(identity).json()["data"]["id"]
    with Session() as db:
        db.add(DeviceTripUploadCursor(device_id="device-1", trip_id=trip_id,
                                      highest_contiguous_sequence=5, highest_received_sequence=5)); db.commit()
    response = client.post(f"/api/v2/trips/{trip_id}/complete", headers=identity["headers"], json={
        "ending_soc": 85, "final_sequence_no": 5, "idempotency_key": "end-eligible"})
    assert response.json()["data"]["finalization_state"] == "eligible"


def test_trip_status_returns_waiting_state_without_a_summary(identity):
    trip_id = start(identity).json()["data"]["id"]
    client.post(f"/api/v2/trips/{trip_id}/complete", headers=identity["headers"], json={
        "ending_soc": 80, "final_sequence_no": 10, "idempotency_key": "end-status-waiting"})

    response = client.get(f"/api/v2/trips/{trip_id}", headers=identity["headers"])

    assert response.status_code == 200
    assert response.json()["data"]["finalization_state"] == "waiting_for_telemetry"
    assert response.json()["data"]["summary"] is None


def test_trip_status_returns_completed_finalization_summary(identity):
    trip_id = start(identity).json()["data"]["id"]
    with Session() as db:
        trip = db.query(MobileTripSession).filter_by(id=trip_id).one()
        trip.status = "completed"
        trip.finalization_state = "completed"
        db.add(TripFinalization(
            trip_id=trip_id,
            final_sequence_no=0,
            processed_sequence_no=0,
            state="completed",
            summary={"energy_label": {"label_source": "manual_dashboard"}},
        ))
        db.commit()

    response = client.get(f"/api/v2/trips/{trip_id}", headers=identity["headers"])

    assert response.status_code == 200
    assert response.json()["data"]["finalization_state"] == "completed"
    assert response.json()["data"]["summary"]["energy_label"]["label_source"] == "manual_dashboard"


def test_trip_status_never_returns_another_users_trip(identity):
    trip_id = start(identity).json()["data"]["id"]
    with Session() as db:
        foreign = User(email="foreign@example.com", full_name="Foreign", role="driver")
        db.add(foreign)
        db.commit()
        foreign_id = foreign.id

    response = client.get(
        f"/api/v2/trips/{trip_id}",
        headers={"Authorization": f"Bearer {create_access_token({'sub': foreign_id, 'typ': 'user'})}"},
    )

    assert response.status_code == 404


def test_user_cannot_complete_another_users_trip(identity):
    trip_id = start(identity).json()["data"]["id"]
    foreign = create_access_token({"sub": "not-the-owner", "typ": "user"})
    response = client.post(f"/api/v2/trips/{trip_id}/complete", headers={"Authorization": f"Bearer {foreign}"}, json={
        "ending_soc": 80, "final_sequence_no": 0, "idempotency_key": "foreign"})
    assert response.status_code == 401


def test_v2_start_rejects_vehicle_not_assigned_to_driver(identity):
    with Session() as db:
        vehicle = db.query(Vehicle).filter(Vehicle.id == identity["vehicle"]).one()
        other = Vehicle(fleet_id=vehicle.fleet_id, vehicle_code="LIFE-EV-OTHER", make="Test", model="Other")
        db.add(other)
        db.commit()
        other_id = other.id

    response = client.post("/api/v2/trips/start", headers=identity["headers"], json={
        "trip_id": "00000000-0000-4000-8000-000000000002",
        "vehicle_id": other_id,
        "starting_soc": 90,
        "idempotency_key": "wrong-assignment",
    })

    assert response.status_code == 403
