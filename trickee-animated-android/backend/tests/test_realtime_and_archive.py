import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.archive.manifest import retirement_authorized, verify_manifest
from app.database import Base, get_db
from app.main import app
from app.models.entities import Fleet, User, Vehicle, VehicleLiveStateSnapshot
from app.observability.metrics import WEBSOCKET_CONNECTIONS, validate_metric_privacy
from app.processors.live_state import advance_live_distance_km, freshness_label
from app.realtime import websocket_gateway
from app.services.auth import create_access_token
from app.worker import outbox_metric_record


def test_freshness_labels_cover_recovery_states():
    now = datetime.now(timezone.utc)
    assert freshness_label(now, now=now) == "LIVE"
    assert freshness_label(now - timedelta(seconds=8), now=now) == "DELAYED"
    assert freshness_label(now - timedelta(seconds=31), now=now) == "OFFLINE"
    assert freshness_label(now, now=now, gps_available=False) == "GPS_LOST"
    assert freshness_label(now, now=now, syncing=True) == "SYNCING"
    assert freshness_label(now, now=now, degraded=True) == "DEGRADED"


def test_live_distance_accumulates_same_trip_and_resets_for_new_trip():
    first = advance_live_distance_km(
        previous_trip_id="trip-1",
        next_trip_id="trip-1",
        previous_latitude=21.1700,
        previous_longitude=72.8300,
        next_latitude=21.1710,
        next_longitude=72.8310,
        previous_distance_km=2.5,
    )
    reset = advance_live_distance_km(
        previous_trip_id="trip-1",
        next_trip_id="trip-2",
        previous_latitude=21.1700,
        previous_longitude=72.8300,
        next_latitude=21.1710,
        next_longitude=72.8310,
        previous_distance_km=2.5,
    )

    assert 2.64 < first < 2.66
    assert reset == 0.0


def test_archive_manifest_refuses_any_mismatch_and_requires_restore():
    content = b'{"sequence_no":1}\n{"sequence_no":2}\n'
    expected = {"row_count": 2, "first_sequence_no": 1, "last_sequence_no": 2,
                "sha256": hashlib.sha256(content).hexdigest(), "object_generation": "7"}
    assert verify_manifest(content, expected, "7").row_count == 2
    with pytest.raises(ValueError, match="sha256"):
        verify_manifest(content, {**expected, "sha256": "0" * 64}, "7")
    assert not retirement_authorized("verified", datetime.now())
    assert retirement_authorized("restored_and_compared", datetime.now())


def test_metrics_have_no_identity_or_coordinate_labels():
    validate_metric_privacy()


def test_application_startup_never_runs_schema_ddl(monkeypatch):
    def reject_startup_ddl(*_args, **_kwargs):
        raise AssertionError("production startup must not create database tables")

    monkeypatch.setattr(Base.metadata, "create_all", reject_startup_ddl)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200


def test_outbox_backlog_structured_log_is_extractable_without_vehicle_identity():
    record = outbox_metric_record(7)

    assert record == {
        "severity": "INFO",
        "metric": "trickee_server_outbox_pending",
        "outbox_pending": 7,
    }
    assert not ({"vehicle_id", "trip_id", "device_id", "latitude", "longitude"} & record.keys())


@pytest.fixture
def realtime_identity(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'realtime.db'}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)

    def override_db():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(websocket_gateway, "SessionLocal", Session)
    with Session() as db:
        own_fleet = Fleet(name="Own", city="Pune")
        foreign_fleet = Fleet(name="Foreign", city="Delhi")
        db.add_all([own_fleet, foreign_fleet])
        db.flush()
        user = User(email="live@example.com", full_name="Live", role="fleet_admin", fleet_id=own_fleet.id)
        own = Vehicle(fleet_id=own_fleet.id, vehicle_code="LIVE-1", make="Test", model="One")
        empty = Vehicle(fleet_id=own_fleet.id, vehicle_code="LIVE-EMPTY", make="Test", model="Empty")
        foreign = Vehicle(fleet_id=foreign_fleet.id, vehicle_code="LIVE-2", make="Test", model="Two")
        db.add_all([user, own, empty, foreign])
        db.flush()
        db.add(VehicleLiveStateSnapshot(
            vehicle_id=own.id, state_version=3, sequence_no=12, received_at=datetime.utcnow(),
            gps_available=True, latitude=11.0, longitude=76.0, freshness="LIVE", projection_status="CURRENT",
        ))
        db.commit()
        value = {"own": own.id, "empty": empty.id, "foreign": foreign.id,
                 "token": create_access_token({"sub": user.id, "typ": "user"})}
    yield value
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(engine)


def test_live_state_and_websocket_are_fleet_isolated_and_gap_safe(realtime_identity):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {realtime_identity['token']}"}
    own = client.get(f"/api/v2/vehicles/{realtime_identity['own']}/live-state", headers=headers)
    foreign = client.get(f"/api/v2/vehicles/{realtime_identity['foreign']}/live-state", headers=headers)
    assert own.status_code == 200 and own.json()["data"]["state_version"] == 3
    assert foreign.status_code == 404

    with client.websocket_connect(
        f"/ws/v2/vehicles/{realtime_identity['own']}?since_version=0",
        subprotocols=["trickee-v2", f"trickee-auth.{realtime_identity['token']}"],
    ) as socket:
        message = socket.receive_json()
        assert message["type"] == "snapshot"
        assert message["data"]["state_version"] == 3


def test_rejected_websocket_does_not_decrement_connection_gauge(realtime_identity):
    client = TestClient(app)
    before = WEBSOCKET_CONNECTIONS._value.get()

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/ws/v2/vehicles/{realtime_identity['own']}?since_version=0",
            subprotocols=["trickee-v2", "trickee-auth.invalid"],
        ):
            pass

    assert WEBSOCKET_CONNECTIONS._value.get() == before


def test_empty_live_state_has_numeric_defaults_and_keeps_socket_open(realtime_identity):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {realtime_identity['token']}"}

    response = client.get(f"/api/v2/vehicles/{realtime_identity['empty']}/live-state", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["state_version"] == 0
    assert response.json()["data"]["sequence_no"] == 0

    with client.websocket_connect(
        f"/ws/v2/vehicles/{realtime_identity['empty']}?since_version=0",
        subprotocols=["trickee-v2", f"trickee-auth.{realtime_identity['token']}"],
    ) as socket:
        socket.send_text("ping")
        assert socket.receive_text() == "pong"
