from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import Device, Driver, Fleet, NotificationOutbox, User, Vehicle
from app.services.fcm_notifications import FcmDeliveryError, GoogleFcmSender, dispatch_due_notifications


class FakeSender:
    def __init__(self, error: FcmDeliveryError | None = None):
        self.error = error
        self.messages = []

    def send(self, *, token, title, body, data, channel_id):
        self.messages.append({"token": token, "title": title, "body": body, "data": data, "channel_id": channel_id})
        if self.error:
            raise self.error
        return "projects/test/messages/1"


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    fleet = Fleet(name="FCM Fleet", city="Surat")
    db.add(fleet)
    db.flush()
    vehicle = Vehicle(fleet_id=fleet.id, vehicle_code="FCM-EV", make="Ola", model="S1")
    driver = Driver(fleet_id=fleet.id, driver_code="FCM-DRIVER", full_name="Driver")
    db.add_all([vehicle, driver])
    db.flush()
    user = User(email="fcm@example.com", full_name="Driver", role="driver", fleet_id=fleet.id, driver_id=driver.id)
    db.add(user)
    db.flush()
    device = Device(
        fleet_id=fleet.id, vehicle_id=vehicle.id, registered_by_user_id=user.id,
        installation_id="fcm-installation", platform="android", device_model="Pixel", app_version="1.0.13",
        fcm_registration_token="fcm-token-valid",
    )
    nudge = NotificationOutbox(
        idempotency_key="fcm-test-1", user_id=user.id, driver_id=driver.id, vehicle_id=vehicle.id,
        nudge_type="daily_departure", title="Leave now", body="Traffic has changed.",
        payload={"screen": "route_nudge", "destination_lat": 21.17, "destination_lng": 72.83},
        status="pending", due_at=datetime.utcnow() - timedelta(minutes=1),
    )
    db.add_all([device, nudge])
    db.commit()
    return db, device, nudge


def test_due_nudge_is_sent_and_marked_with_fcm_message_id():
    db, _device, nudge = _db()
    sender = FakeSender()

    result = dispatch_due_notifications(db, sender=sender, now=datetime.utcnow())

    assert result == {"selected": 1, "sent": 1, "pending": 0, "failed": 0}
    assert sender.messages[0]["data"]["nudge_id"] == nudge.id
    assert sender.messages[0]["data"]["destination_lat"] == "21.17"
    db.refresh(nudge)
    assert nudge.status == "sent"
    assert nudge.sent_at is not None
    assert nudge.last_error_detail == "projects/test/messages/1"


@pytest.mark.parametrize("nudge_type", [
    "departure_changed", "low_arrival_soc", "charger_recommendation", "next_stop_ready",
])
def test_plan_aware_guidance_notification_types_use_the_durable_fcm_path(nudge_type):
    db, _device, nudge = _db()
    nudge.nudge_type = nudge_type
    db.commit()
    sender = FakeSender()
    result = dispatch_due_notifications(db, sender=sender, now=datetime.utcnow())
    assert result["sent"] == 1
    assert sender.messages[0]["data"]["nudge_id"] == nudge.id


def test_transient_fcm_failure_stays_pending_for_retry():
    db, _device, nudge = _db()
    sender = FakeSender(FcmDeliveryError("UNAVAILABLE", "temporary", permanent=False))

    result = dispatch_due_notifications(db, sender=sender, now=datetime.utcnow())

    assert result["pending"] == 1
    db.refresh(nudge)
    assert nudge.status == "pending"
    assert nudge.attempts == 1
    assert nudge.last_error_code == "UNAVAILABLE"


def test_unregistered_token_is_disabled_without_losing_nudge():
    db, device, nudge = _db()
    sender = FakeSender(FcmDeliveryError("UNREGISTERED", "gone", permanent=True))

    result = dispatch_due_notifications(db, sender=sender, now=datetime.utcnow())

    assert result["pending"] == 1
    db.refresh(device)
    db.refresh(nudge)
    assert device.fcm_registration_token is None
    assert nudge.status == "pending"


def test_missing_token_waits_for_registration_without_busy_loop():
    db, device, nudge = _db()
    device.fcm_registration_token = None
    db.commit()
    now = datetime.utcnow()

    first = dispatch_due_notifications(db, sender=FakeSender(), now=now)
    immediate = dispatch_due_notifications(db, sender=FakeSender(), now=now + timedelta(seconds=1))

    assert first["pending"] == 1
    assert immediate["selected"] == 0
    db.refresh(nudge)
    assert nudge.status == "pending" and nudge.last_error_code == "NO_ACTIVE_PUSH_TOKEN"


def test_sender_rejects_malformed_project_id_before_using_credentials():
    with pytest.raises(ValueError, match="FCM project ID"):
        GoogleFcmSender(project_id="trickee-jaswanth-pilot OTHER_SETTING=value")


def test_fcm_transport_error_is_retryable(monkeypatch):
    class Credentials:
        valid = True
        token = "test-access-token"

    monkeypatch.setattr("app.services.fcm_notifications.google.auth.default", lambda scopes: (Credentials(), "test"))
    monkeypatch.setattr("app.services.fcm_notifications.httpx.post", lambda *args, **kwargs: (_ for _ in ()).throw(httpx.ConnectError("offline")))
    sender = GoogleFcmSender(project_id="trickee-jaswanth-pilot")

    with pytest.raises(FcmDeliveryError) as error:
        sender.send(token="device-token", title="Route", body="Traffic", data={}, channel_id="route-alerts")

    assert error.value.code == "FCM_TRANSPORT"
    assert error.value.permanent is False


def test_fcm_success_without_message_id_is_not_marked_sent(monkeypatch):
    class Credentials:
        valid = True
        token = "test-access-token"

    class Response:
        is_success = True
        def json(self):
            return {}

    monkeypatch.setattr("app.services.fcm_notifications.google.auth.default", lambda scopes: (Credentials(), "test"))
    monkeypatch.setattr("app.services.fcm_notifications.httpx.post", lambda *args, **kwargs: Response())
    sender = GoogleFcmSender(project_id="trickee-jaswanth-pilot")

    with pytest.raises(FcmDeliveryError, match="FCM_RESPONSE"):
        sender.send(token="device-token", title="Route", body="Traffic", data={}, channel_id="route-alerts")
