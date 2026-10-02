from __future__ import annotations

import gzip
import importlib
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import Device, Driver, Fleet, MobileTripSession, User, Vehicle
from app.services.device_auth import create_device_access_token


TEST_DB_URL = "sqlite:///./test_telemetry_ingestion.db"
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
def telemetry_identity():
    db = TestSession()
    fleet = Fleet(name="Telemetry Fleet", city="Coimbatore")
    db.add(fleet)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        driver_code="DRV-TELEMETRY",
        full_name="Telemetry Driver",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="telemetry-driver@example.com",
        full_name="Telemetry Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="TELEMETRY-EV-1",
        make="Ather",
        model="450X",
        battery_capacity_kwh=2.9,
        max_range_km=105,
        battery_chemistry="NMC",
        manufacture_year=2025,
    )
    other_vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="TELEMETRY-EV-2",
        make="Bajaj",
        model="Chetak",
        battery_capacity_kwh=3.0,
        max_range_km=100,
        battery_chemistry="LFP",
        manufacture_year=2025,
    )
    db.add_all([vehicle, other_vehicle])
    db.flush()
    device = Device(
        fleet_id=fleet.id,
        vehicle_id=vehicle.id,
        registered_by_user_id=user.id,
        installation_id="telemetry-installation-1",
        platform="android",
        device_model="Pixel 8",
        app_version="2.1.0",
    )
    other_device = Device(
        fleet_id=fleet.id,
        vehicle_id=other_vehicle.id,
        registered_by_user_id=user.id,
        installation_id="telemetry-installation-2",
        platform="android",
        device_model="Pixel 9",
        app_version="2.1.0",
    )
    db.add_all([device, other_device])
    db.flush()
    trip = MobileTripSession(
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=datetime.utcnow(),
        status="active",
        source="android_foreground_service",
    )
    db.add(trip)
    db.commit()
    identity = {
        "trip_id": trip.id,
        "device_id": device.id,
        "vehicle_id": vehicle.id,
        "headers": {
            "Authorization": f"Bearer {create_device_access_token(device.id)}"
        },
        "other_headers": {
            "Authorization": f"Bearer {create_device_access_token(other_device.id)}"
        },
    }
    db.close()
    return identity


def window(identity, sequence: int, *, sample_id: str | None = None) -> dict:
    return {
        "schema_version": 1,
        "sample_id": sample_id or f"00000000-0000-7000-8000-{sequence:012d}",
        "trip_id": identity["trip_id"],
        "device_id": identity["device_id"],
        "vehicle_id": identity["vehicle_id"],
        "sequence_no": sequence,
        "boot_id": "00000000-0000-7000-8000-000000000099",
        "event_time_utc_ms": 1_785_941_720_000 + (sequence * 1_000),
        "monotonic_time_ns": 382_004_912_345_678 + (sequence * 1_000_000_000),
        "window_duration_ms": 1_000,
        "gps_available": True,
        "gps": {
            "latitude": 11.0168,
            "longitude": 76.9558,
            "altitude_m": 411.2,
            "speed_mps": 12.8,
            "bearing_deg": 145.2,
            "horizontal_accuracy_m": 4.7,
            "vertical_accuracy_m": 8.0,
            "provider": "fused",
            "is_mock_location": False,
            "fix_time_utc_ms": 1_785_941_719_980 + (sequence * 1_000),
            "fix_monotonic_time_ns": 382_004_892_345_678 + (sequence * 1_000_000_000),
            "fix_age_ms": 20,
        },
        "imu": {
            "accelerometer_sample_count": 49,
            "gyroscope_sample_count": 50,
            "accelerometer_complete_pct": 98.0,
            "gyroscope_complete_pct": 100.0,
            "accel_mean_mps2": [0.04, -0.12, 9.79],
            "accel_std_mps2": [0.13, 0.10, 0.18],
            "accel_rms_mps2": [0.14, 0.16, 9.79],
            "accel_min_mps2": [-0.28, -0.39, 9.21],
            "accel_max_mps2": [0.35, 0.30, 10.31],
            "jerk_rms_mps3": 1.2,
            "jerk_max_mps3": 3.7,
            "gyro_mean_rads": [0.01, 0.02, -0.01],
            "gyro_rms_rads": [0.03, 0.04, 0.03],
            "gyro_max_abs_rads": [0.08, 0.11, 0.09],
        },
        "health": {
            "battery_pct": 72,
            "charging": False,
            "network_type": "CELLULAR",
            "location_permission": "PRECISE_FOREGROUND",
            "gps_enabled": True,
            "collector_state": "ACTIVE",
            "local_outbox_pending": 17,
            "app_version": "2.1.0",
            "os_version": "Android 16",
            "device_model": "Pixel 8",
        },
    }


def upload(identity, sequences, *, headers=None, windows=None, batch_id="batch-1"):
    payload_windows = windows or [window(identity, sequence) for sequence in sequences]
    return client.post(
        f"/api/v2/trips/{identity['trip_id']}/telemetry-batches",
        headers=headers or identity["headers"],
        json={
            "schema_version": 1,
            "batch_id": batch_id,
            "trip_id": identity["trip_id"],
            "device_id": identity["device_id"],
            "windows": payload_windows,
        },
    )


def telemetry_models():
    entities = importlib.import_module("app.models.entities")
    return (
        getattr(entities, "TelemetryReceipt"),
        getattr(entities, "TelemetryWindow"),
        getattr(entities, "DeviceTripUploadCursor"),
        getattr(entities, "TelemetryRejection"),
        getattr(entities, "ServerOutbox"),
    )


def test_batch_commit_returns_contiguous_ack(telemetry_identity):
    response = upload(telemetry_identity, [1, 2])

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["committed"] is True
    assert data["highest_contiguous_sequence"] == 2
    assert data["accepted_sequences"] == [[1, 2]]
    Receipt, Window, Cursor, _, Outbox = telemetry_models()
    db = TestSession()
    assert db.query(Receipt).count() == 2
    assert db.query(Window).count() == 2
    assert db.query(Cursor).one().highest_contiguous_sequence == 2
    assert db.query(Outbox).count() == 1
    db.close()


def test_out_of_order_batch_does_not_jump_gap(telemetry_identity):
    response = upload(telemetry_identity, [1, 3])

    assert response.status_code == 200
    assert response.json()["data"]["highest_contiguous_sequence"] == 1
    assert response.json()["data"]["missing_ranges"] == [[2, 2]]


def test_late_first_sequence_recomputes_cursor_through_stored_tail(telemetry_identity):
    assert upload(telemetry_identity, [2, 3]).json()["data"]["highest_contiguous_sequence"] == 0

    repaired = upload(telemetry_identity, [1], batch_id="repair-batch")

    assert repaired.status_code == 200
    assert repaired.json()["data"]["highest_contiguous_sequence"] == 3
    _, Window, Cursor, _, _ = telemetry_models()
    db = TestSession()
    assert db.query(Window).count() == 3
    assert db.query(Cursor).one().highest_contiguous_sequence == 3
    db.close()


def test_contract_422_is_persisted_with_safe_field_level_detail(telemetry_identity):
    invalid = window(telemetry_identity, 1)
    invalid["imu"]["gyroscope_accuracy"] = -1

    response = upload(telemetry_identity, [1], windows=[invalid], batch_id="invalid-accuracy")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "INVALID_TELEMETRY_CONTRACT"
    assert detail["errors"][0]["sequence_no"] == 1
    assert detail["errors"][0]["field"] == "imu.gyroscope_accuracy"
    _, Window, _, Rejection, _ = telemetry_models()
    db = TestSession()
    assert db.query(Window).count() == 0
    rejection = db.query(Rejection).one()
    assert rejection.sequence_no == 1
    assert rejection.code == "CONTRACT_VALIDATION"
    assert "imu.gyroscope_accuracy" in rejection.message
    assert "11.0168" not in rejection.message
    db.close()


def test_duplicate_retry_is_logically_exactly_once(telemetry_identity):
    first = upload(telemetry_identity, [1, 2])
    second = upload(telemetry_identity, [1, 2], batch_id="batch-2")

    assert first.status_code == second.status_code == 200
    assert second.json()["data"]["duplicate_sequences"] == [1, 2]
    _, Window, _, _, _ = telemetry_models()
    db = TestSession()
    assert db.query(Window).count() == 2
    db.close()


def test_wrong_vehicle_device_is_not_authorized(telemetry_identity):
    response = upload(
        telemetry_identity,
        [1],
        headers=telemetry_identity["other_headers"],
    )

    assert response.status_code == 404


def test_conflicting_reuse_is_quarantined_without_overwrite(telemetry_identity):
    first_window = window(telemetry_identity, 1)
    assert upload(telemetry_identity, [1], windows=[first_window]).status_code == 200
    conflicting = window(telemetry_identity, 1)
    conflicting["gps"]["latitude"] = 12.0

    response = upload(
        telemetry_identity,
        [1],
        windows=[conflicting],
        batch_id="batch-conflict",
    )

    assert response.status_code == 200
    rejection = response.json()["data"]["rejections"][0]
    assert rejection["code"] == "IDENTITY_CONFLICT"
    assert rejection["retryable"] is False
    _, Window, _, Rejection, _ = telemetry_models()
    db = TestSession()
    assert db.query(Window).count() == 1
    assert db.query(Window).one().latitude == pytest.approx(11.0168)
    assert db.query(Rejection).count() == 1
    db.close()


def test_database_failure_rolls_back_every_ingestion_row(telemetry_identity):
    failing_session = TestSession()

    def failing_db():
        try:
            yield failing_session
        finally:
            failing_session.close()

    def fail_commit():
        raise SQLAlchemyError("forced commit failure")

    failing_session.commit = fail_commit
    app.dependency_overrides[get_db] = failing_db

    with pytest.raises(SQLAlchemyError, match="forced commit failure"):
        upload(telemetry_identity, [1, 2])

    Receipt, Window, Cursor, Rejection, Outbox = telemetry_models()
    db = TestSession()
    assert db.query(Receipt).count() == 0
    assert db.query(Window).count() == 0
    assert db.query(Cursor).count() == 0
    assert db.query(Rejection).count() == 0
    assert db.query(Outbox).count() == 0
    db.close()


def test_gzip_batch_is_validated_and_committed(telemetry_identity):
    payload = {
        "schema_version": 1,
        "batch_id": "gzip-batch",
        "trip_id": telemetry_identity["trip_id"],
        "device_id": telemetry_identity["device_id"],
        "windows": [window(telemetry_identity, 1)],
    }
    headers = {
        **telemetry_identity["headers"],
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
    }

    response = client.post(
        f"/api/v2/trips/{telemetry_identity['trip_id']}/telemetry-batches",
        headers=headers,
        content=gzip.compress(json.dumps(payload).encode()),
    )

    assert response.status_code == 200
    assert response.json()["data"]["accepted_sequences"] == [[1, 1]]


def test_uncompressed_batch_over_512_kib_is_rejected(telemetry_identity):
    response = client.post(
        f"/api/v2/trips/{telemetry_identity['trip_id']}/telemetry-batches",
        headers={
            **telemetry_identity["headers"],
            "Content-Type": "application/json",
        },
        content=b"x" * ((512 * 1024) + 1),
    )

    assert response.status_code == 413
