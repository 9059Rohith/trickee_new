from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.entities import Driver, Fleet, NotificationOutbox, NudgeOutcome, User
from app.services.auth import create_access_token


TEST_DB_URL = "sqlite:///./test_route_nudges.db"
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


def seed_driver(email: str, code: str):
    db = TestSession()
    fleet = Fleet(name=f"{code} Fleet", city="Surat")
    db.add(fleet)
    db.flush()
    driver = Driver(fleet_id=fleet.id, driver_code=code, full_name=code)
    db.add(driver)
    db.flush()
    user = User(
        email=email,
        full_name=code,
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.commit()
    result = (user.id, driver.id, create_access_token({"sub": user.id, "typ": "user"}))
    db.close()
    return result


def insert_nudge(user_id: str, driver_id: str, nudge_id: str):
    db = TestSession()
    db.add(
        NotificationOutbox(
            id=nudge_id,
            idempotency_key=f"departure:{nudge_id}",
            user_id=user_id,
            driver_id=driver_id,
            nudge_type="departure",
            title="Leave in 10 minutes",
            body="Ring Road is currently the quickest feasible route.",
            payload={"screen": "route_nudge", "selected_route_id": "ring-road"},
            status="sent",
            due_at=datetime(2026, 9, 8, 2, 30, 0),
        )
    )
    db.commit()
    db.close()


def test_driver_inbox_is_scoped_to_authenticated_driver():
    user_id, driver_id, token = seed_driver("driver@example.com", "DRIVER-1")
    other_user_id, other_driver_id, _ = seed_driver("other@example.com", "DRIVER-2")
    insert_nudge(user_id, driver_id, "nudge-own")
    insert_nudge(other_user_id, other_driver_id, "nudge-other")

    response = client.get(
        "/api/v1/route-nudges/inbox",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["data"]] == ["nudge-own"]


def test_outcomes_are_idempotent_and_do_not_regress_lifecycle():
    user_id, driver_id, token = seed_driver("driver@example.com", "DRIVER-1")
    insert_nudge(user_id, driver_id, "nudge-1")
    headers = {"Authorization": f"Bearer {token}"}

    accepted = client.post(
        "/api/v1/route-nudges/nudge-1/outcome",
        headers=headers,
        json={
            "event": "accepted",
            "occurred_at": "2026-09-08T08:05:00+05:30",
            "selected_route_id": "ring-road",
        },
    )
    replay = client.post(
        "/api/v1/route-nudges/nudge-1/outcome",
        headers=headers,
        json={
            "event": "accepted",
            "occurred_at": "2026-09-08T08:05:00+05:30",
            "selected_route_id": "ring-road",
        },
    )
    late_delivered = client.post(
        "/api/v1/route-nudges/nudge-1/outcome",
        headers=headers,
        json={
            "event": "delivered",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    assert accepted.status_code == replay.status_code == late_delivered.status_code == 200
    assert late_delivered.json()["data"]["latest_event"] == "accepted"
    db = TestSession()
    assert db.query(NudgeOutcome).count() == 1
    db.close()
