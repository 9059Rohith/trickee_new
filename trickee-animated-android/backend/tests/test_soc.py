"""
SOC reading endpoint and range-boundary tests.

SOC is required for remaining range (§1 rule 2).
Never fabricates BMS fields.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import Driver, Fleet, SOCReading, User, Vehicle
from app.services.auth import create_access_token, hash_password

TEST_DB_URL = "sqlite:///./test_soc.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def seed_data():
    db = TestSession()
    fleet = Fleet(name="SOC Fleet", city="Surat")
    db.add(fleet)
    db.flush()

    driver = Driver(fleet_id=fleet.id, driver_code="DRV-SOC", full_name="SOC Driver")
    db.add(driver)
    db.flush()

    user = User(
        email="soc@trickee.in",
        password_hash=hash_password("Test@2026"),
        full_name="SOC Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.flush()

    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="EV-SOC-01",
        make="Ather",
        model="450X",
        category="2W_passenger",
        usable_kwh=2.9,
        battery_chemistry="NMC",
        nominal_voltage=51.8,
        motor_kw=6.0,
        kerb_weight=108.0,
        top_speed=80.0,
        regen_available=True,
        certified_range=105.0,
        max_range_km=105.0,
        battery_capacity_kwh=2.9,
        spec_incomplete=False,
    )
    db.add(vehicle)
    db.commit()

    token = create_access_token({"sub": user.id})
    return {
        "db": db,
        "fleet": fleet,
        "driver": driver,
        "user": user,
        "vehicle": vehicle,
        "token": token,
    }


class TestSOCEndpoints:
    def test_record_manual_soc(self, seed_data):
        r = client.post(
            "/api/v1/soc/readings",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
            json={
                "vehicle_id": seed_data["vehicle"].id,
                "value": 72.5,
                "source": "manual",
                "confidence": 0.9,
            },
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["value"] == 72.5
        assert data["source"] == "manual"
        assert data["vehicle_id"] == seed_data["vehicle"].id

    def test_reject_invalid_soc_value(self, seed_data):
        r = client.post(
            "/api/v1/soc/readings",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
            json={
                "vehicle_id": seed_data["vehicle"].id,
                "value": 150,
                "source": "manual",
            },
        )
        assert r.status_code == 422

    def test_reject_invalid_source(self, seed_data):
        r = client.post(
            "/api/v1/soc/readings",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
            json={
                "vehicle_id": seed_data["vehicle"].id,
                "value": 50,
                "source": "fabricated_bms",
            },
        )
        assert r.status_code == 422

    def test_latest_and_history(self, seed_data):
        db = seed_data["db"]
        vid = seed_data["vehicle"].id
        older = SOCReading(
            vehicle_id=vid,
            value=60.0,
            source="manual",
            confidence=1.0,
            recorded_at=datetime.utcnow() - timedelta(hours=2),
        )
        newer = SOCReading(
            vehicle_id=vid,
            value=55.0,
            source="dashboard_confirmed",
            confidence=1.0,
            recorded_at=datetime.utcnow() - timedelta(minutes=5),
        )
        db.add_all([older, newer])
        db.commit()

        latest = client.get(
            f"/api/v1/soc/vehicles/{vid}/latest",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
        )
        assert latest.status_code == 200
        assert latest.json()["data"]["value"] == 55.0
        assert latest.json()["data"]["source"] == "dashboard_confirmed"

        history = client.get(
            f"/api/v1/soc/vehicles/{vid}/history",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
        )
        assert history.status_code == 200
        rows = history.json()["data"]
        assert len(rows) >= 2
        assert rows[0]["value"] == 55.0

    def test_vehicle_not_found(self, seed_data):
        r = client.post(
            "/api/v1/soc/readings",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
            json={
                "vehicle_id": "00000000-0000-0000-0000-000000000000",
                "value": 40,
                "source": "manual",
            },
        )
        assert r.status_code == 404

    def test_latest_empty(self, seed_data):
        vid = seed_data["vehicle"].id
        r = client.get(
            f"/api/v1/soc/vehicles/{vid}/latest",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
        )
        assert r.status_code == 200
        assert r.json()["data"] is None
