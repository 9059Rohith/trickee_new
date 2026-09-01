from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import (
    Device,
    DeviceTripUploadCursor,
    Driver,
    Fleet,
    MobileTripSession,
    ServerOutbox,
    TelemetryRejection,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    User,
    Vehicle,
    VehicleLiveStateSnapshot,
)
from app.services.pilot_monitoring import build_pilot_monitoring_snapshot


def _session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pilot-monitoring.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)()


def _seed_identity(db):
    fleet = Fleet(name="Pilot", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="OLA-S1-PILOT-01",
        make="OLA",
        model="S1",
        is_active=True,
    )
    db.add(vehicle)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        assigned_vehicle_id=vehicle.id,
        driver_code="PILOT-DRIVER",
        full_name="Pilot Driver",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="pilot@example.com",
        full_name="Pilot Driver",
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
        installation_id="private-installation-id",
        platform="android",
        device_model="Pixel Test",
        app_version="1.0.4",
    )
    db.add(device)
    db.commit()
    return user, driver, vehicle, device


def _window(db, *, trip, vehicle, device, sequence_no, now, gps_available):
    db.add(
        TelemetryWindow(
            sample_id=f"sample-{trip.id}-{sequence_no}",
            device_id=device.id,
            trip_id=trip.id,
            vehicle_id=vehicle.id,
            sequence_no=sequence_no,
            boot_id="boot-1",
            event_time=now - timedelta(seconds=3 - sequence_no),
            monotonic_time_ns=sequence_no * 1_000_000_000,
            window_duration_ms=1000,
            gps_available=gps_available,
            latitude=21.1702 if gps_available else None,
            longitude=72.8311 if gps_available else None,
            gps_payload={"horizontal_accuracy_m": 8.0} if gps_available else None,
            imu_payload={"accelerometer_sample_count": 50},
            health_payload={
                "battery_pct": 82.0,
                "charging": False,
                "network_type": "wifi",
                "location_permission": "precise_foreground",
                "gps_enabled": True,
                "collector_state": "recording",
                "local_outbox_pending": 2,
                "app_version": "1.0.4",
                "os_version": "15",
                "device_model": "Pixel Test",
            },
            raw_payload={"must_not_be_exposed": "secret"},
            received_at=now - timedelta(seconds=2 - sequence_no),
        )
    )


def test_empty_snapshot_is_healthy_and_bounded(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 8, 31, 10, 0, 0)

    snapshot = build_pilot_monitoring_snapshot(db, now=now)

    assert snapshot == {
        "generated_at": "2026-08-31T10:00:00Z",
        "service_status": "healthy",
        "summary": {
            "active_trips": 0,
            "recent_windows": 0,
            "gps_gaps": 0,
            "gps_availability_pct": None,
            "recent_rejections": 0,
            "pending_outbox": 0,
            "stuck_finalizations": 0,
            "oldest_outbox_age_seconds": None,
        },
        "live_vehicles": [],
        "recent_trips": [],
        "recent_rejections": [],
    }
    db.close()


def test_snapshot_reconciles_live_trip_gaps_rejections_and_backlog(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 8, 31, 10, 0, 0)
    user, driver, vehicle, device = _seed_identity(db)
    trip = MobileTripSession(
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=now - timedelta(minutes=5),
        status="active",
        finalization_state="collecting",
    )
    db.add(trip)
    db.flush()
    _window(db, trip=trip, vehicle=vehicle, device=device, sequence_no=1, now=now, gps_available=True)
    _window(db, trip=trip, vehicle=vehicle, device=device, sequence_no=2, now=now, gps_available=False)
    db.add(
        DeviceTripUploadCursor(
            device_id=device.id,
            trip_id=trip.id,
            highest_contiguous_sequence=2,
            highest_received_sequence=2,
            updated_at=now,
        )
    )
    db.add(
        VehicleLiveStateSnapshot(
            vehicle_id=vehicle.id,
            trip_id=trip.id,
            state_version=2,
            sequence_no=2,
            event_time=now - timedelta(seconds=3),
            received_at=now - timedelta(seconds=2),
            freshness="LIVE",
            latitude=21.1702,
            longitude=72.8311,
            gps_available=True,
            projection_status="READY",
            health_payload={"collector_state": "recording", "local_outbox_pending": 2},
            updated_at=now - timedelta(seconds=2),
        )
    )
    db.add(
        TelemetryRejection(
            device_id=device.id,
            trip_id=trip.id,
            sample_id="rejected-sample",
            sequence_no=3,
            batch_id="batch-1",
            code="payload_conflict",
            message="Sequence was reused with different telemetry",
            payload_hash="a" * 64,
            received_at=now - timedelta(minutes=1),
        )
    )
    db.add(
        ServerOutbox(
            event_type="telemetry.batch_committed",
            aggregate_type="trip",
            aggregate_id=trip.id,
            payload={"trip_id": trip.id},
            state="pending",
            attempt_count=2,
            created_at=now - timedelta(minutes=6),
        )
    )
    db.commit()

    snapshot = build_pilot_monitoring_snapshot(db, now=now)

    assert snapshot["service_status"] == "degraded"
    assert snapshot["summary"] == {
        "active_trips": 1,
        "recent_windows": 2,
        "gps_gaps": 1,
        "gps_availability_pct": 50.0,
        "recent_rejections": 1,
        "pending_outbox": 1,
        "stuck_finalizations": 0,
        "oldest_outbox_age_seconds": 360,
    }
    assert snapshot["live_vehicles"] == [
        {
            "vehicle_id": vehicle.id,
            "vehicle_code": "OLA-S1-PILOT-01",
            "trip_id": trip.id,
            "freshness": "LIVE",
            "projection_status": "READY",
            "sequence_no": 2,
            "last_packet_at": "2026-08-31T09:59:58Z",
            "last_packet_age_seconds": 2,
            "gps_available": True,
            "latitude": 21.1702,
            "longitude": 72.8311,
            "collector_state": "recording",
            "local_outbox_pending": 2,
        }
    ]
    recent_trip = snapshot["recent_trips"][0]
    assert recent_trip["trip_id"] == trip.id
    assert recent_trip["vehicle_code"] == "OLA-S1-PILOT-01"
    assert recent_trip["stored_windows"] == 2
    assert recent_trip["gps_windows"] == 1
    assert recent_trip["gps_availability_pct"] == 50.0
    assert recent_trip["uploaded_through"] == 2
    assert recent_trip["missing_sequences"] is None
    assert "email" not in recent_trip
    assert "installation_id" not in str(snapshot)
    assert "must_not_be_exposed" not in str(snapshot)
    assert snapshot["recent_rejections"][0]["code"] == "payload_conflict"
    db.close()


def test_completed_trip_reports_finalization_and_energy_label(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 8, 31, 10, 0, 0)
    user, driver, vehicle, device = _seed_identity(db)
    trip = MobileTripSession(
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=now - timedelta(minutes=20),
        ended_at=now - timedelta(minutes=10),
        status="completed",
        final_sequence_no=3,
        completion_requested_at=now - timedelta(minutes=10),
        finalization_state="completed",
    )
    db.add(trip)
    db.flush()
    for sequence_no in (1, 2, 3):
        _window(
            db,
            trip=trip,
            vehicle=vehicle,
            device=device,
            sequence_no=sequence_no,
            now=now,
            gps_available=True,
        )
    db.add(
        DeviceTripUploadCursor(
            device_id=device.id,
            trip_id=trip.id,
            highest_contiguous_sequence=3,
            highest_received_sequence=3,
            updated_at=now,
        )
    )
    db.add(
        TripFinalization(
            trip_id=trip.id,
            final_sequence_no=3,
            processed_sequence_no=3,
            state="completed",
            completed_at=now - timedelta(minutes=9),
            updated_at=now - timedelta(minutes=9),
        )
    )
    db.add(
        TripEnergyLabel(
            trip_id=trip.id,
            starting_soc_pct=80.0,
            ending_soc_pct=75.0,
            soc_delta_pct=5.0,
            actual_energy_consumed_wh=149.0,
            actual_wh_per_km=29.8,
            usable_kwh_snapshot=2.98,
            label_source="manual_dashboard_soc",
            label_confidence=0.9,
            is_training_eligible=True,
            eligibility_reason="eligible",
            captured_at=now - timedelta(minutes=10),
        )
    )
    db.commit()

    snapshot = build_pilot_monitoring_snapshot(db, now=now)
    recent_trip = snapshot["recent_trips"][0]

    assert recent_trip["final_sequence_no"] == 3
    assert recent_trip["uploaded_through"] == 3
    assert recent_trip["processed_through"] == 3
    assert recent_trip["missing_sequences"] == 0
    assert recent_trip["finalizer_state"] == "completed"
    assert recent_trip["training_eligible"] is True
    assert recent_trip["label_confidence"] == 0.9
    db.close()


def test_reconciliation_reports_actual_loss_when_the_contiguous_cursor_is_blocked(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 8, 31, 10, 0, 0)
    user, driver, vehicle, device = _seed_identity(db)
    trip = MobileTripSession(
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=now - timedelta(minutes=30),
        ended_at=now - timedelta(minutes=10),
        status="sync_pending",
        final_sequence_no=1098,
        completion_requested_at=now - timedelta(minutes=10),
        finalization_state="waiting_for_telemetry",
    )
    db.add(trip)
    db.flush()
    missing_ranges = [
        (1, 6), (18, 19), (45, 88), (275, 352), (375, 385),
        (451, 454), (496, 497), (500, 540), (552, 554), (586, 587),
        (686, 694), (696, 704), (717, 724), (895, 1098),
    ]
    missing = {
        sequence
        for start, end in missing_ranges
        for sequence in range(start, end + 1)
    }
    for sequence_no in range(1, 1099):
        if sequence_no in missing:
            continue
        _window(
            db,
            trip=trip,
            vehicle=vehicle,
            device=device,
            sequence_no=sequence_no,
            now=now,
            gps_available=True,
        )
    db.flush()
    latest = (
        db.query(TelemetryWindow)
        .filter(TelemetryWindow.trip_id == trip.id)
        .order_by(TelemetryWindow.sequence_no.desc())
        .first()
    )
    latest.health_payload = {**latest.health_payload, "local_outbox_pending": 359}
    db.add(
        DeviceTripUploadCursor(
            device_id=device.id,
            trip_id=trip.id,
            highest_contiguous_sequence=0,
            highest_received_sequence=894,
            updated_at=now - timedelta(minutes=5),
        )
    )
    db.add(
        TripFinalization(
            trip_id=trip.id,
            final_sequence_no=1098,
            processed_sequence_no=0,
            state="waiting_for_telemetry",
            updated_at=now - timedelta(minutes=5),
        )
    )
    db.commit()

    recent_trip = build_pilot_monitoring_snapshot(db, now=now)["recent_trips"][0]

    assert recent_trip["stored_windows"] == 675
    assert recent_trip["actual_missing_sequences"] == 423
    assert recent_trip["upload_completeness_pct"] == 61.5
    assert recent_trip["highest_contiguous_sequence"] == 0
    assert recent_trip["highest_received_sequence"] == 894
    assert recent_trip["missing_ranges"] == [[start, end] for start, end in missing_ranges]
    assert recent_trip["stored_gps_pct"] == 100.0
    assert recent_trip["end_to_end_gps_pct"] == 61.5
    assert recent_trip["phone_backlog"] == 359
    assert recent_trip["missing_sequences"] == 423
    db.close()
