from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import Driver, Fleet, User, Vehicle
from app.routers import experience
from app.services.auth import create_access_token


engine = create_engine(
    "sqlite:///./test_experience_live_services.db",
    connect_args={"check_same_thread": False},
)
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


class FakeMobilityTools:
    def find_route_chargers(self, center, radius_m=5000):
        assert center == {"lat": 21.17, "lng": 72.83}
        assert radius_m == 5000
        return [
            {
                "place_id": "charger-near",
                "name": "Verified EV Point",
                "formatted_address": "Ring Road, Surat",
                "coordinates": {"lat": 21.171, "lng": 72.831},
                "google_maps_uri": "https://maps.google.com/?cid=123",
                "availability_confirmed": False,
                "source": "google_places",
                "degraded_reason": None,
            }
        ]


class FakeAssistant:
    def answer(self, *, message, summary):
        assert message == "Should I charge now?"
        assert summary["vehicle_code"] == "LIVE-EV"
        return {
            "answer": "Charge before the next long leg because the verified SOC is low.",
            "tools_called": ["gps_vehicle_summary"],
            "llm_used": True,
            "model_name": "test-model",
            "error_code": None,
        }


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(experience, "daily_plan_tools", FakeMobilityTools(), raising=False)
    monkeypatch.setattr(experience, "vehicle_assistant", FakeAssistant(), raising=False)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


def seed_driver():
    db = TestSession()
    fleet = Fleet(name="Live Fleet", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="LIVE-EV",
        make="OLA",
        model="S1",
        usable_kwh=3.0,
        certified_range=100,
    )
    db.add(vehicle)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        driver_code="LIVE-DRIVER",
        full_name="Live Driver",
        assigned_vehicle_id=vehicle.id,
    )
    db.add(driver)
    db.flush()
    user = User(
        email="live@example.com",
        full_name="Live Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.commit()
    ids = driver.id, vehicle.id
    token = create_access_token({"sub": user.id, "typ": "user"})
    db.close()
    return ids, {"Authorization": f"Bearer {token}"}


def test_charger_recommendations_use_provider_and_low_soc_decision():
    (driver_id, vehicle_id), headers = seed_driver()
    response = client.post(
        "/api/v1/chargers/recommend",
        headers=headers,
        json={
            "driver_id": driver_id,
            "vehicle_id": vehicle_id,
            "lat": 21.17,
            "lng": 72.83,
            "soc": 18,
            "destination_km": 35,
            "available_time_min": 30,
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["charge_advice"] == "charge_now"
    assert data["recommended_charger"]["name"] == "Verified EV Point"
    assert data["recommended_charger"]["lat"] == 21.171
    assert data["recommended_charger"]["availability_confirmed"] is False
    assert data["provider_source"] == "google_places"


def test_assistant_uses_llm_boundary_with_authoritative_vehicle_summary():
    (driver_id, vehicle_id), headers = seed_driver()
    response = client.post(
        "/api/v1/assistant/message",
        headers=headers,
        json={
            "driver_id": driver_id,
            "vehicle_id": vehicle_id,
            "message": "Should I charge now?",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["llm_used"] is True
    assert data["tools_called"] == ["gps_vehicle_summary"]
    assert "Charge before" in data["answer"]
