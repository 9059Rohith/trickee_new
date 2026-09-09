from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import (
    Driver,
    Fleet,
    MobileTripSession,
    TelemetryEvent,
    TelemetryWindow,
    TripEnergyLabel,
    TripFeature,
    TripFinalization,
    TripPrediction,
    User,
    Vehicle,
)
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
    def answer(self, *, message, summary, location_context=None, nearby_chargers=None):
        assert message == "Should I charge now?"
        assert summary["vehicle_code"] == "LIVE-EV"
        tools = ["gps_vehicle_summary"]
        if location_context:
            tools.append("current_location_context")
        if nearby_chargers:
            tools.append("nearby_chargers")
        return {
            "answer": "Charge before the next long leg because the verified SOC is low.",
            "tools_called": tools,
            "llm_used": True,
            "model_name": "test-model",
            "error_code": None,
            "location_used": location_context is not None,
            "charger_context_used": bool(nearby_chargers),
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


def test_assistant_uses_phone_location_and_verified_chargers_for_location_question():
    (driver_id, vehicle_id), headers = seed_driver()

    response = client.post(
        "/api/v1/assistant/message",
        headers=headers,
        json={
            "driver_id": driver_id,
            "vehicle_id": vehicle_id,
            "message": "Should I charge now?",
            "location": {"lat": 21.17, "lng": 72.83},
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["location_used"] is True
    assert data["charger_context_used"] is True
    assert data["tools_called"] == [
        "gps_vehicle_summary", "current_location_context", "nearby_chargers"
    ]


def test_trip_day_returns_recorded_route_and_separates_actual_from_estimated_evidence():
    (driver_id, vehicle_id), headers = seed_driver()
    db = TestSession()
    user = db.query(User).filter(User.driver_id == driver_id).one()
    trip = MobileTripSession(
        id="trip-day-evidence",
        user_id=user.id,
        driver_id=driver_id,
        vehicle_id=vehicle_id,
        started_at=datetime(2026, 9, 10, 3, 0),
        ended_at=datetime(2026, 9, 10, 3, 20),
        status="completed",
        finalization_state="completed",
        final_sequence_no=4,
        context={"starting_soc": 80, "ending_soc": 72},
    )
    db.add(trip)
    db.flush()
    for sequence_no, latitude in [(1, 21.17), (2, 21.18), (4, 21.20)]:
        db.add(TelemetryWindow(
            sample_id=f"trip-day-{sequence_no}", device_id="device-evidence",
            trip_id=trip.id, vehicle_id=vehicle_id, sequence_no=sequence_no,
            boot_id="boot", event_time=datetime(2026, 9, 10, 3, 0, sequence_no),
            monotonic_time_ns=sequence_no, window_duration_ms=1000,
            gps_available=True, latitude=latitude, longitude=72.83,
            gps_payload={}, imu_payload={}, health_payload={}, raw_payload={},
        ))
    db.add(TripFeature(
        trip_id=trip.id, distance_km=8.5, duration_minutes=20,
        avg_speed_kmh=25.5, max_speed_kmh=48.0, stops_count=2,
        total_dwell_minutes=3.5,
    ))
    db.add(TripFinalization(
        trip_id=trip.id, final_sequence_no=4, processed_sequence_no=4,
        state="completed", summary={"gps_completeness_pct": 75.0},
        completed_at=datetime(2026, 9, 10, 3, 21),
    ))
    db.add(TripEnergyLabel(
        trip_id=trip.id, starting_soc_pct=80, ending_soc_pct=72,
        soc_delta_pct=8, actual_energy_consumed_wh=240,
        actual_wh_per_km=28.24, usable_kwh_snapshot=3.0,
        label_source="dashboard_soc", label_confidence=0.9,
        is_training_eligible=True, eligibility_reason="eligible",
        captured_at=datetime(2026, 9, 10, 3, 21),
    ))
    db.add(TripPrediction(
        trip_id=trip.id, vehicle_id=vehicle_id, route_energy_wh=260,
        wh_per_km=30.59, source="gps_model", estimated=True,
        confidence="medium",
    ))
    for event_no in range(25):
        db.add(TelemetryEvent(
            vehicle_id=vehicle_id, trip_id=trip.id,
            source_sample_id=f"trip-day-event-{event_no}",
            processor_name="quality", event_type="gps_accuracy_low",
            severity="warning", confidence=0.8, payload={"accuracy_m": 42},
            created_at=datetime(2026, 9, 10, 3, 1, event_no),
        ))
    db.commit()
    db.close()

    response = client.get(
        f"/api/v1/drivers/{driver_id}/trip-days/2026-09-10?timezone=Asia%2FKolkata",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["service_date"] == "2026-09-10"
    assert len(data["trips"]) == 1
    detail = data["trips"][0]
    assert [point["sequence_no"] for point in detail["route_points"]] == [1, 2, 4]
    assert detail["telemetry_quality"] == {
        "stored_windows": 3,
        "final_windows": 4,
        "actual_missing_windows": 1,
        "completeness_pct": 75.0,
    }
    assert detail["energy_label"]["actual_energy_consumed_wh"] == 240
    assert detail["prediction"]["route_energy_wh"] == 260
    assert detail["events"]["by_severity"] == {"warning": 25}
    assert detail["events"]["by_type"] == {"gps_accuracy_low": 25}
    assert len(detail["events"]["latest"]) == 20
    assert detail["events"]["latest"][0]["type"] == "gps_accuracy_low"


def test_trip_day_rejects_invalid_timezone_and_another_driver():
    (driver_id, _), headers = seed_driver()
    assert client.get(
        f"/api/v1/drivers/{driver_id}/trip-days/2026-09-10?timezone=Nope%2FNowhere",
        headers=headers,
    ).status_code == 422

    db = TestSession()
    fleet = db.query(Fleet).one()
    other = Driver(fleet_id=fleet.id, driver_code="OTHER-LIVE", full_name="Other")
    db.add(other)
    db.flush()
    user = User(
        email="other-live@example.com", full_name="Other", role="driver",
        fleet_id=fleet.id, driver_id=other.id,
    )
    db.add(user)
    db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token({'sub': user.id, 'typ': 'user'})}"}
    db.close()

    assert client.get(
        f"/api/v1/drivers/{driver_id}/trip-days/2026-09-10?timezone=Asia%2FKolkata",
        headers=other_headers,
    ).status_code == 403
