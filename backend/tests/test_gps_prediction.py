"""
Integration tests for the GPS prediction pipeline and API endpoints.
"""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import (
    Driver, Fleet, GPSRawSample, MobileTripSession, SOCReading, User, Vehicle,
)
from app.services.auth import hash_password, create_access_token

# In-memory test database
TEST_DB_URL = "sqlite:///./test_gps.db"
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
    fleet = Fleet(name="Test Fleet", city="Surat")
    db.add(fleet)
    db.flush()

    driver = Driver(fleet_id=fleet.id, driver_code="DRV-TEST", full_name="Test Driver")
    db.add(driver)
    db.flush()

    user = User(
        email="test@trickee.in",
        password_hash=hash_password("Test@2026"),
        full_name="Test Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.flush()

    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="EV-TEST-01",
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
    return {"db": db, "fleet": fleet, "driver": driver, "user": user, "vehicle": vehicle, "token": token}


class TestHealthEndpoint:
    def test_health(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["model_type"] == "physics_baseline"
        assert data["gps_model_active"] is True
        assert data["bms_model_active"] is False


class TestOwnerSummary:
    def test_owner_sees_only_fleet_gps_results(self, seed_data):
        seed_data["user"].role = "fleet_admin"
        seed_data["db"].commit()
        token = create_access_token({"sub": seed_data["user"].id})
        response = client.get(
            "/api/v1/owner/summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["totals"]["vehicles"] == 1
        assert data["vehicles"][0]["vehicle_code"] == "EV-TEST-01"
        assert data["vehicles"][0]["range_available"] is False
        assert data["vehicles"][0]["estimated_range_km"] is None
        assert data["calculation_basis"] == "GPS + vehicle specifications"

    def test_driver_cannot_open_owner_summary(self, seed_data):
        response = client.get(
            "/api/v1/owner/summary",
            headers={"Authorization": f"Bearer {seed_data['token']}"},
        )
        assert response.status_code == 403


class TestAuthFlow:
    def test_signup_and_login(self):
        r = client.post("/api/v1/auth/signup", json={
            "email": "new@trickee.in", "password": "Secure@2026", "full_name": "New User",
        })
        assert r.status_code == 200
        data = r.json()["data"]
        assert "access_token" in data

        r2 = client.post("/api/v1/auth/login", json={
            "email": "new@trickee.in", "password": "Secure@2026",
        })
        assert r2.status_code == 200


class TestMobileFlow:
    def test_me_endpoint(self, seed_data):
        r = client.get("/api/v1/mobile/me", headers={"Authorization": f"Bearer {seed_data['token']}"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["user"]["email"] == "test@trickee.in"
        assert data["vehicle"]["vehicle_code"] == "EV-TEST-01"

    def test_trip_lifecycle(self, seed_data):
        token = seed_data["token"]
        headers = {"Authorization": f"Bearer {token}"}
        vehicle = seed_data["vehicle"]

        # Start trip with SOC
        r = client.post("/api/v1/mobile/trips/start", headers=headers, json={
            "vehicle_id": vehicle.id, "starting_soc": 85.0,
            "destination_text": "Test destination",
        })
        assert r.status_code == 200
        trip = r.json()["data"]
        assert trip["status"] == "active"
        trip_id = trip["id"]

        # Upload GPS batch
        now = datetime.utcnow()
        points = []
        for i in range(30):
            points.append({
                "lat": 21.17 + i * 0.000055,
                "lng": 72.83 + i * 0.000055,
                "timestamp": (now + timedelta(seconds=i)).isoformat(),
                "altitude": 10.0 + i * 0.1,
                "accuracy": 5.0,
                "speed": 8.33,  # ~30 km/h
                "heading": 90.0,
                "app_version": "2.0.0",
                "device_model": "Pixel 7",
            })
        r2 = client.post(f"/api/v1/mobile/v2/trips/{trip_id}/gps-batch", headers=headers, json={
            "batch_id": f"{trip_id}-batch-1", "points": points,
        })
        assert r2.status_code == 200
        assert r2.json()["data"]["inserted"] == 30

        # Idempotency — same batch again
        r3 = client.post(f"/api/v1/mobile/v2/trips/{trip_id}/gps-batch", headers=headers, json={
            "batch_id": f"{trip_id}-batch-1", "points": points,
        })
        assert r3.json()["data"]["inserted"] == 0  # Already processed

        # End trip with SOC → triggers prediction
        r4 = client.post("/api/v1/mobile/trips/end", headers=headers, json={
            "ending_soc": 78.0,
        })
        assert r4.status_code == 200
        result = r4.json()["data"]
        assert result["status"] == "completed"
        assert result["calculation_status"] == "complete"
        calculation = result["calculation"]
        assert calculation["gps_sample_count"] == 30
        assert calculation["distance_km"] > 0
        assert calculation["starting_soc"] == 85.0
        assert calculation["ending_soc"] == 78.0
        assert calculation["measured_soc_used_pct"] == 7.0
        assert calculation["measured_energy_wh"] == pytest.approx(203.0)
        assert calculation["measured_wh_per_km"] > 0

        # Check prediction was created
        if "prediction" in result:
            pred = result["prediction"]
            assert pred["source"] == "physics_baseline"
            assert pred["estimated"] is True
            assert pred["wh_per_km"] is not None

    def test_end_trip_requires_soc(self, seed_data):
        headers = {"Authorization": f"Bearer {seed_data['token']}"}
        client.post("/api/v1/mobile/trips/start", headers=headers, json={
            "vehicle_id": seed_data["vehicle"].id,
            "starting_soc": 80.0,
        })

        response = client.post("/api/v1/mobile/trips/end", headers=headers, json={})

        assert response.status_code == 422

    def test_insufficient_gps_is_not_reported_as_complete(self, seed_data):
        headers = {"Authorization": f"Bearer {seed_data['token']}"}
        started = client.post("/api/v1/mobile/trips/start", headers=headers, json={
            "vehicle_id": seed_data["vehicle"].id,
            "starting_soc": 80.0,
        }).json()["data"]
        now = datetime.utcnow().isoformat()
        client.post(
            f"/api/v1/mobile/v2/trips/{started['id']}/gps-batch",
            headers=headers,
            json={
                "batch_id": "single-point",
                "points": [{"lat": 21.17, "lng": 72.83, "timestamp": now}],
            },
        )

        response = client.post(
            "/api/v1/mobile/trips/end",
            headers=headers,
            json={"ending_soc": 79.0},
        )
        result = response.json()["data"]

        assert response.status_code == 200
        assert result["calculation_status"] == "insufficient_gps"
        assert "prediction" not in result
        assert result["calculation"]["gps_sample_count"] == 1


class TestSOCReadings:
    def test_record_and_retrieve(self, seed_data):
        token = seed_data["token"]
        headers = {"Authorization": f"Bearer {token}"}
        vehicle = seed_data["vehicle"]

        # Record SOC
        r = client.post("/api/v1/soc/readings", headers=headers, json={
            "vehicle_id": vehicle.id, "value": 72.5, "source": "manual",
        })
        assert r.status_code == 200

        # Get latest
        r2 = client.get(f"/api/v1/soc/vehicles/{vehicle.id}/latest", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["data"]["value"] == 72.5
        assert r2.json()["data"]["source"] == "manual"


class TestVehicleSpecs:
    def test_create_and_update(self, seed_data):
        token = seed_data["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create vehicle with incomplete specs
        r = client.post("/api/v1/vehicles/", headers=headers, json={
            "vehicle_code": "EV-NEW-01", "make": "Bajaj", "model": "Chetak",
        })
        assert r.status_code == 200
        v = r.json()["data"]
        assert v["spec_incomplete"] is True

        # Update specs to complete
        r2 = client.patch(f"/api/v1/vehicles/{v['id']}/specs", headers=headers, json={
            "category": "2W_passenger", "usable_kwh": 3.0,
            "battery_chemistry": "NMC", "nominal_voltage": 48.0,
            "motor_kw": 4.0, "kerb_weight": 120.0, "top_speed": 63.0,
        })
        assert r2.status_code == 200
        assert r2.json()["data"]["spec_incomplete"] is False
