from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import (
    DailyPlan, Device, Driver, Fleet, LiveNudgeEvaluation, MobileTripSession,
    NotificationOutbox, SOCReading, User, Vehicle, VehicleLiveStateSnapshot,
)
from app.services.fcm_notifications import dispatch_due_notifications
from app.services.live_trip_nudges import evaluate_active_trip_nudges


NOW = datetime(2026, 9, 24, 10, 0, 0)


class FakeTools:
    def __init__(self, *, route_available=True, chargers_available=True):
        self.route_available = route_available
        self.chargers_available = chargers_available
        self.route_calls = 0
        self.charger_calls = 0

    def plan_route_leg(self, origin, destination, departure_at):
        self.route_calls += 1
        assert departure_at.tzinfo is not None
        assert departure_at >= NOW.replace(tzinfo=timezone.utc) + timedelta(seconds=30)
        if not self.route_available:
            return {"distance_m": None, "duration_s": None, "traffic_delay_s": None, "source": "unavailable"}
        return {
            "distance_m": 15_000, "duration_s": 2400, "traffic_delay_s": 800,
            "source": "google_routes", "confidence": 0.85,
            "evidence_at": departure_at.isoformat(), "degraded_reason": None,
        }

    def find_route_chargers(self, center, radius_m=5000):
        self.charger_calls += 1
        if not self.chargers_available:
            return []
        return [{
            "place_id": "places/charger-1", "name": "Central charger",
            "coordinates": {"lat": center["lat"] + 0.005, "lng": center["lng"]},
            "source": "google_places", "availability_confirmed": False,
            "evidence_at": NOW.replace(tzinfo=timezone.utc).isoformat(),
        }]


class FakeSender:
    def __init__(self):
        self.messages = []

    def send(self, *, token, title, body, data, channel_id):
        self.messages.append((title, data, channel_id))
        return f"projects/test/messages/{len(self.messages)}"


def seed(*, soc=22.0, destination=True, fresh=True):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    fleet = Fleet(name="Nudge pilot", city="Bengaluru")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(
        fleet_id=fleet.id, vehicle_code="NUDGE-EV", make="Ola", model="S1",
        usable_kwh=3.0, certified_range=100.0, spec_incomplete=False,
    )
    db.add(vehicle)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id, assigned_vehicle_id=vehicle.id,
        driver_code="NUDGE-DRIVER", full_name="Tester",
    )
    db.add(driver)
    db.flush()
    user = User(
        email="nudge@example.com", full_name="Tester", role="driver",
        fleet_id=fleet.id, driver_id=driver.id, is_active=True,
    )
    db.add(user)
    db.flush()
    trip = MobileTripSession(
        user_id=user.id, driver_id=driver.id, vehicle_id=vehicle.id,
        started_at=NOW - timedelta(minutes=20), status="active",
        destination_text="Work" if destination else None,
        destination_lat=12.99 if destination else None,
        destination_lng=77.61 if destination else None,
        context={"starting_soc": soc},
    )
    db.add(trip)
    db.flush()
    snapshot = VehicleLiveStateSnapshot(
        vehicle_id=vehicle.id, trip_id=trip.id, state_version=20,
        sequence_no=100, event_time=NOW, received_at=NOW if fresh else NOW - timedelta(minutes=5),
        freshness="LIVE", gps_available=True, latitude=12.97, longitude=77.59,
        projection_status="CURRENT", health_payload={"live_distance_km": 2.0},
    )
    device = Device(
        fleet_id=fleet.id, vehicle_id=vehicle.id, registered_by_user_id=user.id,
        installation_id="nudge-installation", platform="android", device_model="Pixel",
        app_version="1.0.19", fcm_registration_token="test-token-registered",
    )
    db.add_all([snapshot, device])
    db.commit()
    return db, trip, snapshot, user, vehicle


def test_live_trip_enqueues_route_charger_and_low_soc_with_evidence():
    db, trip, _snapshot, user, _vehicle = seed()
    tools = FakeTools()

    stats = evaluate_active_trip_nudges(db, tools=tools, now=NOW)

    rows = db.query(NotificationOutbox).order_by(NotificationOutbox.nudge_type).all()
    assert {row.nudge_type for row in rows} == {"live_route", "live_charger", "live_soc"}
    assert all(row.user_id == user.id and row.driver_id == trip.driver_id for row in rows)
    assert all(row.payload["trip_id"] == trip.id for row in rows)
    assert all(row.payload["screen"] == "route_nudge" for row in rows)
    assert all(row.payload["expires_at"] for row in rows)
    assert stats["queued"] == 3
    assert tools.route_calls == 1
    assert tools.charger_calls == 1
    assert next(row for row in rows if row.nudge_type == "live_charger").payload["availability_confirmed"] is False
    assert next(row for row in rows if row.nudge_type == "live_charger").payload["place_confirmed"] is True
    assert next(row for row in rows if row.nudge_type == "live_soc").payload["soc_source"] == "conservative_vehicle_spec"

    sender = FakeSender()
    dispatch = dispatch_due_notifications(db, sender=sender, now=NOW)
    assert dispatch["sent"] == 3
    assert all(message[2] == "trickee_route_alerts_high" for message in sender.messages)


def test_stale_gps_or_finished_trip_never_queues_live_nudge():
    db, trip, snapshot, _user, _vehicle = seed(fresh=False)
    tools = FakeTools()
    assert evaluate_active_trip_nudges(db, tools=tools, now=NOW)["queued"] == 0
    assert tools.route_calls == 0
    snapshot.received_at = NOW
    trip.status = "completed"
    db.commit()
    assert evaluate_active_trip_nudges(db, tools=tools, now=NOW)["queued"] == 0


def test_missing_google_evidence_keeps_soc_alert_but_suppresses_route_and_charger():
    db, _trip, _snapshot, _user, _vehicle = seed()
    tools = FakeTools(route_available=False, chargers_available=False)
    evaluate_active_trip_nudges(db, tools=tools, now=NOW)
    assert {row.nudge_type for row in db.query(NotificationOutbox).all()} == {"live_soc"}


def test_invalid_route_and_place_facts_do_not_create_false_guidance():
    db, _trip, _snapshot, _user, _vehicle = seed()

    class InvalidTools(FakeTools):
        def plan_route_leg(self, origin, destination, departure_at):
            return {"source": "google_routes", "distance_m": float("nan"), "duration_s": -1,
                    "traffic_delay_s": 900}

        def find_route_chargers(self, center, radius_m=5000):
            return [None, {"source": "google_places", "coordinates": {"lat": True, "lng": 77.59}}]

    evaluate_active_trip_nudges(db, tools=InvalidTools(), now=NOW)
    assert {row.nudge_type for row in db.query(NotificationOutbox).all()} == {"live_soc"}


def test_small_traffic_delay_and_unreachable_charger_do_not_nudge():
    db, _trip, _snapshot, _user, _vehicle = seed(soc=8)

    class PoorOptions(FakeTools):
        def plan_route_leg(self, origin, destination, departure_at):
            return {"source": "google_routes", "distance_m": 15000, "duration_s": 1200,
                    "traffic_delay_s": 180}

        def find_route_chargers(self, center, radius_m=5000):
            return [{"source": "google_places", "name": "Too far",
                     "coordinates": {"lat": center["lat"] + 0.04, "lng": center["lng"]}}]

    evaluate_active_trip_nudges(db, tools=PoorOptions(), now=NOW)
    assert {row.nudge_type for row in db.query(NotificationOutbox).all()} == {"live_soc"}


def test_checkpoint_and_cooldown_prevent_repeat_provider_calls_and_alerts():
    db, trip, snapshot, _user, _vehicle = seed()
    tools = FakeTools()
    evaluate_active_trip_nudges(db, tools=tools, now=NOW)
    assert evaluate_active_trip_nudges(db, tools=tools, now=NOW + timedelta(minutes=1))["queued"] == 0
    assert tools.route_calls == 1
    snapshot.received_at = NOW + timedelta(minutes=6)
    snapshot.event_time = snapshot.received_at
    db.commit()
    assert evaluate_active_trip_nudges(db, tools=tools, now=NOW + timedelta(minutes=6))["queued"] == 0
    assert tools.route_calls == 2
    assert db.query(NotificationOutbox).count() == 3
    assert db.get(LiveNudgeEvaluation, trip.id).last_evaluated_at == NOW + timedelta(minutes=6)


def test_new_confirmed_soc_after_charging_resets_distance_anchor():
    db, trip, snapshot, _user, vehicle = seed()
    tools = FakeTools()
    evaluate_active_trip_nudges(db, tools=tools, now=NOW)
    db.add(SOCReading(
        vehicle_id=vehicle.id, driver_id=trip.driver_id, value=80,
        source="dashboard_confirmed", confidence=1.0,
        recorded_at=NOW + timedelta(minutes=1),
    ))
    snapshot.received_at = NOW + timedelta(minutes=6)
    snapshot.event_time = snapshot.received_at
    snapshot.health_payload = {"live_distance_km": 3.0}
    db.commit()
    evaluate_active_trip_nudges(db, tools=tools, now=NOW + timedelta(minutes=6))
    checkpoint = db.get(LiveNudgeEvaluation, trip.id)
    assert checkpoint.soc_anchor_pct == 80
    assert checkpoint.soc_anchor_distance_km == 3.0
    assert db.query(NotificationOutbox).filter(NotificationOutbox.nudge_type == "live_soc").count() == 1


def test_confirmed_day_plan_supplies_destination_when_trip_has_none():
    db, trip, _snapshot, user, vehicle = seed(soc=80, destination=False)
    plan = DailyPlan(
        user_id=user.id, driver_id=trip.driver_id, vehicle_id=vehicle.id,
        service_date=NOW.date(), timezone="UTC", starting_soc_pct=80,
        source_message="Work at noon", parser_source="test", draft_payload={},
        status="confirmed", result_payload={"legs": [{
            "index": 0, "planned_departure_at": "2026-09-24T09:45:00+00:00",
            "estimated_arrival_at": "2026-09-24T11:00:00+00:00",
            "destination": {"name": "Work", "coordinates": {"lat": 12.99, "lng": 77.61}},
        }]},
    )
    db.add(plan)
    db.commit()
    evaluate_active_trip_nudges(db, tools=FakeTools(), now=NOW)
    route = db.query(NotificationOutbox).filter(NotificationOutbox.nudge_type == "live_route").one()
    assert route.payload["destination_lat"] == 12.99
    assert route.payload["route_name"] == "Work"


def test_no_destination_suppresses_route_claim_but_can_show_soc_and_charger():
    db, _trip, _snapshot, _user, _vehicle = seed(destination=False)
    tools = FakeTools()
    evaluate_active_trip_nudges(db, tools=tools, now=NOW)
    assert tools.route_calls == 0
    assert {row.nudge_type for row in db.query(NotificationOutbox).all()} == {"live_soc", "live_charger"}


def test_trip_completed_during_provider_call_does_not_queue_late_alert():
    db, trip, _snapshot, _user, _vehicle = seed()

    class CompletingTools(FakeTools):
        def plan_route_leg(self, origin, destination, departure_at):
            trip.status = "completed"
            db.commit()
            return super().plan_route_leg(origin, destination, departure_at)

    assert evaluate_active_trip_nudges(db, tools=CompletingTools(), now=NOW)["queued"] == 0
    assert db.query(NotificationOutbox).count() == 0


def test_evaluation_provider_crash_does_not_stop_due_fcm_delivery(monkeypatch):
    from app.worker import run_notification_cycle

    db, trip, _snapshot, user, vehicle = seed()
    db.add(NotificationOutbox(
        idempotency_key="planned-test", user_id=user.id, driver_id=trip.driver_id,
        vehicle_id=vehicle.id, nudge_type="daily_departure", title="Leave soon",
        body="Open map", payload={"screen": "route_nudge"}, status="pending",
        due_at=NOW - timedelta(minutes=1),
    ))
    db.commit()
    monkeypatch.setattr("app.services.live_trip_nudges.evaluate_active_trip_nudges", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("provider failed")))
    sender = FakeSender()

    summary = run_notification_cycle(db, sender=sender, tools=FakeTools(), now=NOW)

    assert summary["evaluation_error"] == "RuntimeError"
    assert summary["delivery"]["sent"] == 1
    assert len(sender.messages) == 1
