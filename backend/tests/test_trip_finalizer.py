from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import (
    Driver,
    Fleet,
    MobileTripSession,
    TelemetryWindow,
    TripEnergyLabel,
    TripFinalization,
    User,
    Vehicle,
)
from app.processors.trip_finalizer import finalize_trip
from app.services.reconciliation import MAX_FINAL_SEQUENCE_NO


def _session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'finalizer.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)()


def _seed_trip(db, *, final_sequence_no=3):
    fleet = Fleet(name="Finalizer", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id,
        vehicle_code="FINAL-EV",
        make="Test",
        model="EV",
        category="2W_passenger",
        usable_kwh=2.98,
        kerb_weight=110.0,
        regen_available=True,
        spec_incomplete=False,
    )
    db.add(vehicle)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        assigned_vehicle_id=vehicle.id,
        driver_code="FINAL-DRIVER",
        full_name="Driver",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="final@example.com",
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
        started_at=datetime.utcnow(),
        ended_at=datetime.utcnow() + timedelta(seconds=final_sequence_no),
        status="finalizing",
        final_sequence_no=final_sequence_no,
        finalization_state="eligible",
        context={
            "starting_soc": 90.0,
            "ending_soc": 85.0,
            "soc_source": "manual_dashboard",
            "ending_soc_source": "manual_dashboard",
        },
    )
    db.add(trip)
    db.flush()
    record = TripFinalization(
        trip_id=trip.id,
        final_sequence_no=final_sequence_no,
        processed_sequence_no=final_sequence_no,
        state="eligible",
    )
    db.add(record)
    db.commit()
    return trip, vehicle, record


def _window(trip, vehicle, sequence_no, *, gps_available=True):
    event_time = trip.started_at + timedelta(seconds=sequence_no * 180)
    latitude = 21.17 + sequence_no * 0.05 if gps_available else None
    longitude = 72.83 + sequence_no * 0.05 if gps_available else None
    gps = {
        "latitude": latitude,
        "longitude": longitude,
        "altitude_m": 10.0 + sequence_no,
        "speed_mps": 7.0,
        "horizontal_accuracy_m": 5.0,
        "is_mock_location": False,
    } if gps_available else None
    return TelemetryWindow(
        sample_id=f"sample-{sequence_no}",
        device_id="device-final",
        trip_id=trip.id,
        vehicle_id=vehicle.id,
        sequence_no=sequence_no,
        boot_id="boot-final",
        event_time=event_time,
        monotonic_time_ns=sequence_no * 1_000_000_000,
        window_duration_ms=1000,
        gps_available=gps_available,
        latitude=latitude,
        longitude=longitude,
        gps_payload=gps,
        imu_payload={"jerk_rms_mps3": 0.2, "jerk_max_mps3": 0.5},
        health_payload={"battery_pct": 80.0},
        raw_payload={},
        received_at=event_time,
    )


def _event(trip):
    return {"event_type": "trip.finalization_eligible", "payload": {"trip_id": trip.id}}


def test_finalizer_builds_physics_summary_from_contiguous_windows(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, record = _seed_trip(db)
    db.add_all([_window(trip, vehicle, sequence) for sequence in (1, 2, 3)])
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    assert record.state == "completed"
    assert trip.status == "completed"
    assert record.summary["calculation_status"] == "complete"
    assert record.summary["gps_completeness_pct"] == 100.0
    assert record.summary["distance_km"] > 0
    assert record.summary["energy"]["route_energy_wh"] > 0
    assert record.summary["energy"]["source"] == "physics_baseline"
    assert record.summary["soc"]["source"] == "manual_dashboard"
    assert record.summary["range"]["estimated_remaining_km"] is not None
    label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).one()
    assert label.usable_kwh_snapshot == 2.98
    assert label.actual_energy_consumed_wh == 149.0
    assert label.actual_wh_per_km == record.summary["energy_label"]["actual_wh_per_km"]
    assert label.label_source == "manual_dashboard"
    assert label.captured_at == record.completed_at
    assert label.eligibility_reason == "eligible_manual_dashboard"


def test_phone_charging_does_not_mark_vehicle_charging(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, _ = _seed_trip(db)
    windows = [_window(trip, vehicle, sequence) for sequence in (1, 2, 3)]
    for window in windows:
        window.health_payload = {"charging": True}
    db.add_all(windows)
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).one()
    assert label.is_training_eligible is True
    assert label.actual_energy_consumed_wh == 149.0


def test_recorded_vehicle_charge_keeps_route_but_removes_energy_target(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, record = _seed_trip(db)
    trip.context = {**trip.context, "vehicle_charging_observed": True}
    db.add_all([_window(trip, vehicle, sequence) for sequence in (1, 2, 3)])
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    label = db.query(TripEnergyLabel).filter_by(trip_id=trip.id).one()
    assert record.summary["distance_km"] > 0
    assert label.is_training_eligible is False
    assert label.eligibility_reason == "charging_observed"
    assert label.actual_energy_consumed_wh is None
    assert label.actual_wh_per_km is None
    assert record.summary["soc"]["measured_delta_pct"] is None


def test_finalizer_creates_only_one_energy_label_when_event_is_replayed(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, _ = _seed_trip(db)
    db.add_all([_window(trip, vehicle, sequence) for sequence in (1, 2, 3)])
    db.commit()

    finalize_trip(db, _event(trip))
    finalize_trip(db, _event(trip))
    db.flush()

    assert db.query(TripEnergyLabel).filter_by(trip_id=trip.id).count() == 1


def test_finalizer_waits_for_an_actual_sequence_gap(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, record = _seed_trip(db)
    db.add_all([_window(trip, vehicle, sequence) for sequence in (1, 3)])
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    assert record.state == "waiting_for_telemetry"
    assert record.summary["missing_sequences"] == [2]


def test_finalizer_bounds_missing_diagnostics_for_the_largest_supported_trip(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, record = _seed_trip(db, final_sequence_no=MAX_FINAL_SEQUENCE_NO)
    db.add(_window(trip, vehicle, 1))
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    assert record.state == "waiting_for_telemetry"
    assert record.summary["actual_missing_sequences"] == MAX_FINAL_SEQUENCE_NO - 1
    assert record.summary["missing_ranges"] == [[2, MAX_FINAL_SEQUENCE_NO]]
    assert record.summary["missing_sequences"] == list(range(2, 102))


def test_finalizer_reports_gps_loss_instead_of_zero_distance_success(tmp_path):
    db = _session(tmp_path)
    trip, vehicle, record = _seed_trip(db, final_sequence_no=2)
    db.add_all([_window(trip, vehicle, sequence, gps_available=False) for sequence in (1, 2)])
    db.commit()

    finalize_trip(db, _event(trip))
    db.flush()

    assert record.state == "completed"
    assert record.summary["calculation_status"] == "insufficient_gps"
    assert record.summary["distance_km"] is None
    assert record.summary["energy"] is None
    assert record.summary["gps_completeness_pct"] == 0.0
