from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.models.entities import Device, Driver, Fleet, User, Vehicle
from app.services.auth import create_access_token


TEST_DB_URL = "sqlite:///./test_device_auth.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def seeded_fleets():
    db = TestSession()
    fleet = Fleet(name="Device Fleet", city="Surat")
    other_fleet = Fleet(name="Other Fleet", city="Pune")
    db.add_all([fleet, other_fleet])
    db.flush()

    driver = Driver(
        fleet_id=fleet.id,
        driver_code="DRV-DEVICE",
        full_name="Device Driver",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="device-driver@example.com",
        full_name="Device Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.flush()

    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="DEVICE-EV-1",
        make="Ather",
        model="450X",
        battery_capacity_kwh=2.9,
        max_range_km=105.0,
        battery_chemistry="NMC",
        manufacture_year=2025,
        is_active=True,
    )
    other_vehicle = Vehicle(
        fleet_id=other_fleet.id,
        vehicle_code="OTHER-EV-1",
        make="Bajaj",
        model="Chetak",
        battery_capacity_kwh=3.0,
        max_range_km=100.0,
        battery_chemistry="LFP",
        manufacture_year=2025,
        is_active=True,
    )
    db.add_all([vehicle, other_vehicle])
    db.commit()

    result = {
        "user_id": user.id,
        "fleet_id": fleet.id,
        "vehicle_id": vehicle.id,
        "other_vehicle_id": other_vehicle.id,
        "user_token": create_access_token({"sub": user.id, "typ": "user"}),
    }
    db.close()
    return result


def user_headers(seeded_fleets) -> dict[str, str]:
    return {"Authorization": f"Bearer {seeded_fleets['user_token']}"}


def register_device(seeded_fleets, **overrides):
    body = {
        "installation_id": "android-installation-1",
        "vehicle_id": seeded_fleets["vehicle_id"],
        "platform": "android",
        "device_model": "Pixel 8",
        "app_version": "2.1.0",
    }
    body.update(overrides)
    return client.post(
        "/api/v2/devices/register",
        headers=user_headers(seeded_fleets),
        json=body,
    )


def test_registered_android_device_receives_separate_device_session(seeded_fleets):
    response = register_device(seeded_fleets)

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["device"]["vehicle_id"] == seeded_fleets["vehicle_id"]
    assert payload["device"]["platform"] == "android"
    assert payload["access_token"] != seeded_fleets["user_token"]
    assert payload["refresh_token"]
    token_payload = jwt.decode(
        payload["access_token"],
        get_settings().secret_key,
        algorithms=[get_settings().algorithm],
    )
    assert token_payload["typ"] == "device"
    assert token_payload["sub"] == payload["device"]["id"]


def test_device_registration_rejects_cross_fleet_vehicle(seeded_fleets):
    response = register_device(
        seeded_fleets,
        vehicle_id=seeded_fleets["other_vehicle_id"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Vehicle not found"


def test_device_registration_rejects_non_android_platform(seeded_fleets):
    response = register_device(seeded_fleets, platform="ios")

    assert response.status_code == 422


def test_device_refresh_rotates_and_replay_revokes_family(seeded_fleets):
    registered = register_device(seeded_fleets)
    assert registered.status_code == 200
    session = registered.json()["data"]

    first = client.post(
        "/api/v2/devices/token",
        json={
            "device_id": session["device"]["id"],
            "refresh_token": session["refresh_token"],
        },
    )
    assert first.status_code == 200
    replacement = first.json()["data"]
    assert replacement["refresh_token"] != session["refresh_token"]

    replay = client.post(
        "/api/v2/devices/token",
        json={
            "device_id": session["device"]["id"],
            "refresh_token": session["refresh_token"],
        },
    )
    after_replay = client.post(
        "/api/v2/devices/token",
        json={
            "device_id": session["device"]["id"],
            "refresh_token": replacement["refresh_token"],
        },
    )

    assert replay.status_code == 401
    assert after_replay.status_code == 401


def test_revoked_device_cannot_refresh(seeded_fleets):
    registered = register_device(seeded_fleets)
    assert registered.status_code == 200
    session = registered.json()["data"]

    revoked = client.post(
        f"/api/v2/devices/{session['device']['id']}/revoke",
        headers=user_headers(seeded_fleets),
    )
    refreshed = client.post(
        "/api/v2/devices/token",
        json={
            "device_id": session["device"]["id"],
            "refresh_token": session["refresh_token"],
        },
    )

    assert revoked.status_code == 200
    assert refreshed.status_code == 401


def test_device_token_cannot_authenticate_as_human_user(seeded_fleets):
    registered = register_device(seeded_fleets)
    assert registered.status_code == 200
    device_token = registered.json()["data"]["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {device_token}"},
    )

    assert response.status_code == 401


def test_authenticated_user_registers_and_rotates_device_push_token(seeded_fleets):
    registered = register_device(seeded_fleets).json()["data"]
    device_id = registered["device"]["id"]

    first = client.put(
        f"/api/v2/devices/{device_id}/push-token",
        headers=user_headers(seeded_fleets),
        json={"token": "fcm-token-" + "a" * 64},
    )
    second = client.put(
        f"/api/v2/devices/{device_id}/push-token",
        headers=user_headers(seeded_fleets),
        json={"token": "fcm-token-" + "b" * 64},
    )

    assert first.status_code == second.status_code == 200
    db = TestSession()
    device = db.query(Device).filter(Device.id == device_id).one()
    assert device.fcm_registration_token == "fcm-token-" + "b" * 64
    assert device.fcm_token_updated_at is not None
    db.close()


def test_device_session_can_resync_rotated_push_token(seeded_fleets):
    registered = register_device(seeded_fleets).json()["data"]

    response = client.put(
        "/api/v2/devices/self/push-token",
        headers={"Authorization": f"Bearer {registered['access_token']}"},
        json={"token": "fcm-token-" + "d" * 64},
    )

    assert response.status_code == 200
    db = TestSession()
    device = db.query(Device).filter(Device.id == registered["device"]["id"]).one()
    assert device.fcm_registration_token == "fcm-token-" + "d" * 64
    assert device.fcm_token_updated_at is not None
    db.close()


def test_user_cannot_register_push_token_for_another_fleet_device(seeded_fleets):
    db = TestSession()
    other = Device(
        fleet_id=db.query(Vehicle).filter(Vehicle.id == seeded_fleets["other_vehicle_id"]).one().fleet_id,
        vehicle_id=seeded_fleets["other_vehicle_id"],
        registered_by_user_id=seeded_fleets["user_id"],
        installation_id="other-fleet-installation",
        platform="android",
        device_model="Other",
        app_version="1",
    )
    db.add(other)
    db.commit()
    other_id = other.id
    db.close()

    response = client.put(
        f"/api/v2/devices/{other_id}/push-token",
        headers=user_headers(seeded_fleets),
        json={"token": "fcm-token-" + "c" * 64},
    )

    assert response.status_code == 404
