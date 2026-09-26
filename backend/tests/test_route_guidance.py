from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import (
    Driver, Fleet, MobileTripSession, NotificationOutbox, RouteGuidanceSnapshot,
    User, Vehicle, VehicleLiveStateSnapshot,
)
from app.services.route_guidance import (
    departure_change_is_material,
    evaluate_active_trip_guidance,
    rank_corridor_chargers,
    route_corridor_centers,
)


NOW = datetime(2026, 9, 26, 10, 0)


class Tools:
    def __init__(self, *, distance_m=10_000, evidence_at=None, fail=False):
        self.distance_m = distance_m
        self.evidence_at = evidence_at or NOW.isoformat() + "Z"
        self.fail = fail

    def plan_route_leg(self, origin, destination, departure_at):
        if self.fail:
            raise RuntimeError("route outage")
        return {
            "route_id": "route-1", "distance_m": self.distance_m, "duration_s": 1800,
            "source": "google_routes", "confidence": 0.85, "evidence_at": self.evidence_at,
        }

    def find_route_chargers(self, center, radius_m=5000):
        return [{
            "place_id": f"charger-{center['lat']:.2f}", "name": "Verified charger",
            "coordinates": {"lat": center["lat"] + 0.001, "lng": center["lng"]},
            "source": "google_places", "availability_confirmed": False,
            "evidence_at": self.evidence_at,
        }]


def seed(*, starting_soc=50, received_at=NOW):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    fleet = Fleet(name="Guidance", city="Surat"); db.add(fleet); db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id, vehicle_code="GUIDE-EV", make="Ola", model="S1",
        usable_kwh=4.0, certified_range=100,
    )
    driver = Driver(fleet_id=fleet.id, driver_code="GUIDE-1", full_name="Driver")
    db.add_all([vehicle, driver]); db.flush(); driver.assigned_vehicle_id = vehicle.id
    user = User(email="guide@example.com", full_name="Driver", role="driver", fleet_id=fleet.id, driver_id=driver.id)
    db.add(user); db.flush()
    trip = MobileTripSession(
        user_id=user.id, driver_id=driver.id, vehicle_id=vehicle.id,
        started_at=NOW - timedelta(minutes=5), status="active", finalization_state="collecting",
        destination_text="Office", destination_lat=21.30, destination_lng=72.95,
        destination_source="map_pin", context={"starting_soc": starting_soc},
    )
    db.add(trip); db.flush()
    db.add(VehicleLiveStateSnapshot(
        vehicle_id=vehicle.id, trip_id=trip.id, state_version=1, sequence_no=1,
        received_at=received_at, event_time=received_at, gps_available=True,
        latitude=21.17, longitude=72.83,
    ))
    db.commit()
    return db, trip


def test_departure_change_requires_ten_minute_hysteresis():
    assert departure_change_is_material(NOW, NOW + timedelta(minutes=9, seconds=59)) is False
    assert departure_change_is_material(NOW, NOW + timedelta(minutes=10)) is True


def test_route_corridor_is_bounded_and_chargers_are_ranked_near_it():
    centers = route_corridor_centers({"lat": 21.0, "lng": 72.0}, {"lat": 22.0, "lng": 73.0}, max_points=5)
    assert len(centers) == 5
    ranked = rank_corridor_chargers([
        {"place_id": "far", "coordinates": {"lat": 25.0, "lng": 77.0}, "source": "google_places"},
        {"place_id": "near", "coordinates": {"lat": 21.5, "lng": 72.5}, "source": "google_places"},
    ], centers)
    assert [row["place_id"] for row in ranked] == ["near", "far"]


def test_stale_telemetry_and_stale_provider_evidence_are_rejected():
    stale_db, _ = seed(received_at=NOW - timedelta(minutes=2))
    assert evaluate_active_trip_guidance(stale_db, tools=Tools(), now=NOW).committed == 0
    provider_db, _ = seed()
    decision = evaluate_active_trip_guidance(
        provider_db,
        tools=Tools(evidence_at=(NOW - timedelta(minutes=10)).isoformat() + "Z"),
        now=NOW,
    )
    assert decision.committed == 0
    assert provider_db.query(RouteGuidanceSnapshot).count() == 0


def test_route_outage_is_non_blocking_and_commits_no_claims():
    db, trip = seed()
    decision = evaluate_active_trip_guidance(db, tools=Tools(fail=True), now=NOW)
    db.refresh(trip)
    assert decision.provider_errors == 1
    assert trip.status == "active"
    assert db.query(RouteGuidanceSnapshot).count() == 0


def test_safe_to_unsafe_transition_queues_one_nudge_per_snapshot():
    db, trip = seed(starting_soc=50)
    safe = evaluate_active_trip_guidance(db, tools=Tools(distance_m=10_000), now=NOW)
    assert safe.committed == 1 and safe.queued == 0

    trip.context = {"starting_soc": 18}
    state = db.get(VehicleLiveStateSnapshot, trip.vehicle_id)
    state.received_at = NOW + timedelta(minutes=3)
    state.event_time = state.received_at
    db.commit()
    unsafe = evaluate_active_trip_guidance(db, tools=Tools(distance_m=30_000), now=NOW + timedelta(minutes=3))
    assert unsafe.committed == 1 and unsafe.queued == 1
    assert db.query(NotificationOutbox).one().nudge_type == "low_arrival_soc"
    assert db.query(RouteGuidanceSnapshot).count() == 2

    replay = evaluate_active_trip_guidance(db, tools=Tools(distance_m=30_000), now=NOW + timedelta(minutes=3))
    assert replay.queued == 0
    assert db.query(NotificationOutbox).count() == 1
