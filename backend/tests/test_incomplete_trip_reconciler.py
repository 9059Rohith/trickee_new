from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import (
    DeviceTripUploadCursor,
    Driver,
    Fleet,
    MobileTripSession,
    ServerOutbox,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    User,
    Vehicle,
)
from app.services.incomplete_trip_reconciler import (
    promote_finalization_if_complete,
    reconcile_incomplete_finalizations,
)


def _session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'incomplete-reconciler.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)()


def _seed_waiting_trip(db, now):
    fleet = Fleet(name="Incomplete Pilot", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="INCOMPLETE-EV",
        make="OLA",
        model="S1",
        usable_kwh=2.98,
    )
    db.add(vehicle)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        assigned_vehicle_id=vehicle.id,
        driver_code="INCOMPLETE-DRIVER",
        full_name="Driver",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="incomplete@example.com",
        full_name="Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.flush()
    trip = MobileTripSession(
        user_id=user.id,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        started_at=now - timedelta(hours=26),
        ended_at=now - timedelta(hours=25),
        status="sync_pending",
        final_sequence_no=3,
        completion_requested_at=now - timedelta(hours=25),
        finalization_state="waiting_for_telemetry",
        context={"starting_soc": 90.0, "ending_soc": 84.0},
    )
    db.add(trip)
    db.flush()
    record = TripFinalization(
        trip_id=trip.id,
        final_sequence_no=3,
        processed_sequence_no=1,
        state="waiting_for_telemetry",
        updated_at=now - timedelta(hours=25),
    )
    db.add(record)
    db.add_all([
        _window(trip, vehicle, 1, now),
        _window(trip, vehicle, 3, now),
    ])
    db.commit()
    return trip, vehicle, record


def _window(trip, vehicle, sequence_no, now):
    return TelemetryWindow(
        sample_id=f"sample-{sequence_no}",
        device_id="device-1",
        trip_id=trip.id,
        vehicle_id=vehicle.id,
        sequence_no=sequence_no,
        boot_id="boot-1",
        event_time=now - timedelta(seconds=4 - sequence_no),
        monotonic_time_ns=sequence_no * 1_000_000_000,
        window_duration_ms=1000,
        gps_available=True,
        latitude=21.17,
        longitude=72.83,
        gps_payload={"horizontal_accuracy_m": 5.0},
        imu_payload={},
        health_payload={},
        raw_payload={},
        received_at=now,
    )


def test_timeout_closes_incomplete_trip_without_creating_a_training_target(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 9, 1, 12, 0, 0)
    trip, vehicle, record = _seed_waiting_trip(db, now)

    reconciled = reconcile_incomplete_finalizations(db, now=now, timeout_hours=24)
    db.flush()

    assert reconciled == [trip.id]
    assert trip.status == "completed_incomplete"
    assert trip.finalization_state == "incomplete"
    assert record.state == "incomplete"
    assert record.completed_at == now
    assert record.summary == {
        "calculation_status": "incomplete_telemetry",
        "final_sequence_no": 3,
        "stored_windows": 2,
        "actual_missing_sequences": 1,
        "missing_ranges": [[2, 2]],
        "training_eligible": False,
    }
    label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).one()
    assert label.starting_soc_pct == 90.0
    assert label.ending_soc_pct == 84.0
    assert label.actual_energy_consumed_wh is None
    assert label.actual_wh_per_km is None
    assert label.usable_kwh_snapshot == vehicle.usable_kwh
    assert label.label_confidence == 0.0
    assert label.is_training_eligible is False
    assert label.eligibility_reason == "incomplete_telemetry"

    assert reconcile_incomplete_finalizations(db, now=now, timeout_hours=24) == []
    assert db.query(TripEnergyLabel).filter_by(trip_id=trip.id).count() == 1
    db.close()


def test_waiting_trip_is_not_closed_before_the_timeout(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 9, 1, 12, 0, 0)
    trip, _, _ = _seed_waiting_trip(db, now)
    trip.completion_requested_at = now - timedelta(hours=23)
    db.commit()

    assert reconcile_incomplete_finalizations(db, now=now, timeout_hours=24) == []
    assert trip.finalization_state == "waiting_for_telemetry"
    db.close()


def test_late_complete_telemetry_reopens_incomplete_trip_for_finalization(tmp_path):
    db = _session(tmp_path)
    now = datetime(2026, 9, 1, 12, 0, 0)
    trip, _, record = _seed_waiting_trip(db, now)
    reconcile_incomplete_finalizations(db, now=now, timeout_hours=24)
    cursor = DeviceTripUploadCursor(
        device_id="device-1",
        trip_id=trip.id,
        highest_contiguous_sequence=3,
        highest_received_sequence=3,
        updated_at=now + timedelta(minutes=5),
    )
    db.add(cursor)

    promoted = promote_finalization_if_complete(
        db,
        trip=trip,
        cursor=cursor,
        observed_at=now + timedelta(minutes=5),
    )
    db.flush()

    assert promoted is True
    assert trip.status == "finalizing"
    assert trip.finalization_state == "eligible"
    assert record.state == "eligible"
    assert record.completed_at is None
    event = db.query(ServerOutbox).filter_by(event_type="trip.finalization_eligible").one()
    assert event.payload["late_reconciliation"] is True
    db.close()
