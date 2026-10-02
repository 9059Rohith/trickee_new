from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import Device, Driver, Fleet, NotificationOutbox, User, Vehicle
from app.services.fcm_notifications import FcmDeliveryError, dispatch_due_notifications


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
