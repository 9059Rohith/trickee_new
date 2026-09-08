from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import DailyPlan, Driver, Fleet, NotificationOutbox, TripPrediction, User, Vehicle
from app.routers import daily_plans
from app.services.auth import create_access_token


engine = create_engine("sqlite:///./test_daily_plans.db", connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


class FakeTools:
    def resolve_destination(self, query):
        return {"query": query, "name": query, "coordinates": {"lat": 21.17, "lng": 72.83}, "source": "test_places", "evidence_at": "2026-09-08T00:00:00Z", "confidence": 1.0, "degraded_reason": None}

    def plan_route_leg(self, origin, destination, departure_at):
        return {"distance_m": 5_000, "duration_s": 900, "traffic_delay_s": 120, "source": "test_routes", "evidence_at": "2026-09-08T00:00:00Z", "confidence": 1.0, "degraded_reason": None}

    def find_route_chargers(self, center, radius_m=5000):
        return []


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(daily_plans, "daily_plan_tools", FakeTools())
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


def seed_driver():
    db = TestSession()
    fleet = Fleet(name="Planner Fleet", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(fleet_id=fleet.id, vehicle_code="PLAN-EV", make="OLA", model="S1", usable_kwh=3.0, certified_range=100)
    db.add(vehicle)
    db.flush()
    driver = Driver(fleet_id=fleet.id, driver_code="PLAN-DRV", full_name="Planner", assigned_vehicle_id=vehicle.id)
    db.add(driver)
    db.flush()
    user = User(email="planner@example.com", full_name="Planner", role="driver", fleet_id=fleet.id, driver_id=driver.id)
    db.add(user)
    db.add(TripPrediction(
        trip_id="historical-route-profile", vehicle_id=vehicle.id,
        wh_per_km=44.0, source="physics_baseline", estimated=True,
    ))
    db.commit()
    token = create_access_token({"sub": user.id, "typ": "user"})
    ids = user.id, driver.id, vehicle.id
    db.close()
    return ids, {"Authorization": f"Bearer {token}"}


def test_chat_persists_driver_scoped_draft_and_confirm_schedules_high_priority_once():
    (user_id, driver_id, vehicle_id), headers = seed_driver()
    chat = client.post("/api/v1/daily-plans/chat", headers=headers, json={
        "message": "Office at 9 am, home at 7 pm",
        "service_date": "2026-09-09", "timezone": "Asia/Kolkata", "starting_soc_pct": 80,
    })
    assert chat.status_code == 200
    plan_id = chat.json()["data"]["plan"]["id"]
    assert chat.json()["data"]["conversation"]["tool_calls"] == ["parse_day_schedule"]

    body = {"confirmation_key": "phone-once-1", "origin": {"lat": 21.15, "lng": 72.80}}
    first = client.post(f"/api/v1/daily-plans/{plan_id}/confirm", headers=headers, json=body)
    replay = client.post(f"/api/v1/daily-plans/{plan_id}/confirm", headers=headers, json=body)

    assert first.status_code == replay.status_code == 200
    assert first.json()["data"]["result"]["legs"][1]["starting_soc_pct"] == first.json()["data"]["result"]["legs"][0]["arrival_soc_pct"]
    assert first.json()["data"]["result"]["legs"][0]["energy_source"] == "gps_prediction:physics_baseline"
    db = TestSession()
    plan = db.query(DailyPlan).one()
    notices = db.query(NotificationOutbox).all()
    assert (plan.user_id, plan.driver_id, plan.vehicle_id) == (user_id, driver_id, vehicle_id)
    assert len(notices) == 2
    assert all(n.payload["delivery_priority"] == "high" for n in notices)
    assert all(n.payload["android_channel_id"] == "trickee_route_alerts_high" for n in notices)
    db.close()


def test_other_driver_cannot_read_or_confirm_plan():
    _, owner_headers = seed_driver()
    chat = client.post("/api/v1/daily-plans/chat", headers=owner_headers, json={
        "message": "Office at 9 am", "service_date": "2026-09-09",
        "timezone": "Asia/Kolkata", "starting_soc_pct": 80,
    })
    plan_id = chat.json()["data"]["plan"]["id"]
    # Use a second isolated driver/user in the same test database.
    db = TestSession()
    fleet = db.query(Fleet).first()
    driver = Driver(fleet_id=fleet.id, driver_code="OTHER", full_name="Other")
    db.add(driver); db.flush()
    user = User(email="other-plan@example.com", full_name="Other", role="driver", fleet_id=fleet.id, driver_id=driver.id)
    db.add(user); db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token({'sub': user.id, 'typ': 'user'})}"}
    db.close()

    assert client.get(f"/api/v1/daily-plans/{plan_id}", headers=other_headers).status_code == 404
    assert client.post(f"/api/v1/daily-plans/{plan_id}/confirm", headers=other_headers, json={"confirmation_key": "other-key", "origin": {"lat": 21.15, "lng": 72.80}}).status_code == 404


def test_confirmation_does_not_enqueue_expired_departure_notifications():
    _, headers = seed_driver()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    chat = client.post("/api/v1/daily-plans/chat", headers=headers, json={
        "message": "Office at 9 am", "service_date": yesterday,
        "timezone": "Asia/Kolkata", "starting_soc_pct": 80,
    })
    plan_id = chat.json()["data"]["plan"]["id"]

    response = client.post(
        f"/api/v1/daily-plans/{plan_id}/confirm", headers=headers,
        json={"confirmation_key": "expired-alert", "origin": {"lat": 21.15, "lng": 72.80}},
    )

    assert response.status_code == 200
    db = TestSession()
    assert db.query(NotificationOutbox).count() == 0
    db.close()
