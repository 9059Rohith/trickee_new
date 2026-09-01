"""End-to-end persistence coverage for the lossless telemetry recovery path."""
from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import (
    Device,
    DeviceTripUploadCursor,
    Driver,
    Fleet,
    MobileTripSession,
    ServerOutbox,
    TelemetryReceipt,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    User,
    Vehicle,
)
from app.processors.trip_finalizer import finalize_trip
from app.services.auth import create_access_token
from app.services.device_auth import create_device_access_token


def _window(identity: dict[str, str], sequence_no: int) -> dict:
    """Build a valid, distinct one-second telemetry window without real data."""
    return {
        "schema_version": 1,
        "sample_id": f"00000000-0000-7000-8000-{sequence_no:012d}",
        "trip_id": identity["trip_id"],
        "device_id": identity["device_id"],
        "vehicle_id": identity["vehicle_id"],
        "sequence_no": sequence_no,
        "boot_id": "00000000-0000-7000-8000-000000000099",
        "event_time_utc_ms": 1_785_941_720_000 + (sequence_no * 1_000),
        "monotonic_time_ns": 382_004_912_345_678 + (sequence_no * 1_000_000_000),
        "window_duration_ms": 1_000,
        "gps_available": True,
        "gps": {
            "latitude": 11.0168 + (sequence_no * 0.00005),
            "longitude": 76.9558 + (sequence_no * 0.00005),
            "altitude_m": 411.2,
            "speed_mps": 8.0,
            "bearing_deg": 145.2,
            "horizontal_accuracy_m": 4.7,
            "vertical_accuracy_m": 8.0,
            "provider": "synthetic-test",
            "is_mock_location": False,
            "fix_time_utc_ms": 1_785_941_719_980 + (sequence_no * 1_000),
            "fix_monotonic_time_ns": 382_004_892_345_678 + (sequence_no * 1_000_000_000),
            "fix_age_ms": 20,
        },
        "imu": {
            "accelerometer_sample_count": 50,
            "gyroscope_sample_count": 50,
            "accelerometer_complete_pct": 100.0,
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
            "local_outbox_pending": max(0, 20 - sequence_no),
            "app_version": "1.0.5",
            "os_version": "Android 16",
            "device_model": "Synthetic Pixel",
        },
    }


def _upload(client: TestClient, identity: dict[str, str], sequences: range, batch_id: str):
    return client.post(
        f"/api/v2/trips/{identity['trip_id']}/telemetry-batches",
        headers={"Authorization": f"Bearer {identity['device_token']}"},
        json={
            "schema_version": 1,
            "batch_id": batch_id,
            "trip_id": identity["trip_id"],
            "device_id": identity["device_id"],
            "windows": [_window(identity, sequence_no) for sequence_no in sequences],
        },
    )


def test_gap_recovery_replay_and_finalization_are_lossless(tmp_path):
    """Accepted later rows survive a gap, then recover into one finalization."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'lossless-pipeline.db'}",
        connect_args={"check_same_thread": False},
    )
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)

    def override_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    try:
        with session_factory() as db:
            fleet = Fleet(name="Lossless Pipeline", city="Surat")
            db.add(fleet)
            db.flush()
            vehicle = Vehicle(
                fleet_id=fleet.id,
                vehicle_code="LOSSLESS-EV",
                make="Test",
                model="EV",
                category="2W_passenger",
                usable_kwh=2.98,
                kerb_weight=110.0,
                regen_available=True,
                spec_incomplete=False,
            )
            driver = Driver(fleet_id=fleet.id, driver_code="LOSSLESS-DRIVER", full_name="Driver")
            db.add_all([vehicle, driver])
            db.flush()
            driver.assigned_vehicle_id = vehicle.id
            user = User(
                email="lossless-pipeline@example.test",
                full_name="Driver",
                role="driver",
                fleet_id=fleet.id,
                driver_id=driver.id,
            )
            db.add(user)
            db.flush()
            device = Device(
                fleet_id=fleet.id,
                vehicle_id=vehicle.id,
                registered_by_user_id=user.id,
                installation_id="lossless-pipeline-device",
                platform="android",
                device_model="Synthetic Pixel",
                app_version="1.0.5",
            )
            db.add(device)
            db.commit()
            identity = {
                "trip_id": "00000000-0000-4000-8000-000000000020",
                "user_token": create_access_token({"sub": user.id, "typ": "user"}),
                "device_token": create_device_access_token(device.id),
                "device_id": device.id,
                "vehicle_id": vehicle.id,
            }

        client = TestClient(app)
        start = client.post(
            "/api/v2/trips/start",
            headers={"Authorization": f"Bearer {identity['user_token']}"},
            json={
                "trip_id": identity["trip_id"],
                "vehicle_id": identity["vehicle_id"],
                "starting_soc": 90,
                "idempotency_key": "lossless-start-20",
                "started_at": datetime(2026, 9, 1, 12, 0, 0).isoformat(),
            },
        )
        assert start.status_code == 200

        later_rows = _upload(client, identity, range(7, 21), "lossless-later-7-20")
        assert later_rows.status_code == 200
        assert later_rows.json()["data"]["accepted_sequences"] == [[7, 20]]
        assert later_rows.json()["data"]["highest_contiguous_sequence"] == 0

        sealed = client.post(
            f"/api/v2/trips/{identity['trip_id']}/complete",
            headers={"Authorization": f"Bearer {identity['user_token']}"},
            json={"ending_soc": 80, "final_sequence_no": 20, "idempotency_key": "lossless-end-20"},
        )
        assert sealed.status_code == 200
        assert sealed.json()["data"]["finalization_state"] == "waiting_for_telemetry"

        recovered_gap = _upload(client, identity, range(1, 7), "lossless-recovery-1-6")
        assert recovered_gap.status_code == 200
        assert recovered_gap.json()["data"]["accepted_sequences"] == [[1, 6]]
        assert recovered_gap.json()["data"]["highest_contiguous_sequence"] == 20

        replay = _upload(client, identity, range(7, 21), "lossless-replay-7-20")
        assert replay.status_code == 200
        assert replay.json()["data"]["duplicate_sequences"] == list(range(7, 21))

        with session_factory() as db:
            trip = db.query(MobileTripSession).filter_by(id=identity["trip_id"]).one()
            cursor = db.query(DeviceTripUploadCursor).filter_by(
                device_id=identity["device_id"], trip_id=identity["trip_id"]
            ).one()
            finalization = db.query(TripFinalization).filter_by(trip_id=identity["trip_id"]).one()
            assert trip.finalization_state == finalization.state == "eligible"
            event = db.query(ServerOutbox).filter_by(
                aggregate_id=identity["trip_id"], event_type="trip.finalization_eligible"
            ).one()
            stored_receipts = db.query(TelemetryReceipt).filter_by(trip_id=identity["trip_id"]).count()
            stored_windows = db.query(TelemetryWindow).filter_by(trip_id=identity["trip_id"]).count()
            assert stored_receipts == stored_windows == 20
            assert 20 - stored_windows == 0
            assert cursor.highest_contiguous_sequence == 20

            finalize_trip(db, {"event_type": event.event_type, "payload": event.payload})
            db.commit()
            finalize_trip(db, {"event_type": event.event_type, "payload": event.payload})
            db.commit()

            db.refresh(trip)
            db.refresh(finalization)
            assert trip.finalization_state == finalization.state == "completed"
            assert finalization.processed_sequence_no == 20
            assert finalization.summary["window_count"] == 20
            assert finalization.summary["missing_sequences"] == []
            assert db.query(TripEnergyLabel).filter_by(trip_id=identity["trip_id"]).count() == 1
            assert db.query(ServerOutbox).filter_by(
                aggregate_id=identity["trip_id"], event_type="trip.finalization_eligible"
            ).count() == 1
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        Base.metadata.drop_all(engine)
        engine.dispose()
