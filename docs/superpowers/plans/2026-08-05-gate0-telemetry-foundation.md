# Gate 0 Telemetry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated, idempotent FastAPI/PostgreSQL telemetry-ingestion foundation required by the Android collector and real-time processors.

**Architecture:** Extend the existing modular FastAPI application instead of creating a separate service. Google Sign in verifies a Google ID token and creates a Trickee-owned rotating session; device registration creates a separate revocable device session. Telemetry batches commit receipt keys, canonical windows, upload cursors, and a server-outbox event in one SQLAlchemy transaction.

**Tech Stack:** Python 3.11/3.12, FastAPI 0.110, Pydantic 2, SQLAlchemy 2, Alembic, PostgreSQL 16 production, SQLite tests, python-jose, google-auth, pytest.

## Global Constraints

- Work only in `C:\Users\srija\OneDrive\Documents\Trickee\gpsdriver` on `feature/gpsdriver-gate0`.
- Do not modify `trickee_new`.
- Preserve legacy email/password and `/api/v1/mobile/v2/trips/{trip_id}/gps-batch` compatibility.
- Never fabricate GPS, BMS, SOC, SOH, current, voltage, temperature, or energy values.
- Google authenticates people; Trickee authorizes fleets and issues its own user/device sessions.
- Telemetry devices use a separate credential from the human Google ID token.
- Physical delivery is at least once; canonical database delivery is exactly once logically.
- An acknowledgement is returned only after the PostgreSQL transaction commits.
- `highest_contiguous_sequence`, not the highest received sequence, controls acknowledgement progress.
- Use forward-only Alembic migrations; never edit `0001_gps_first`.
- Keep SQLite-compatible models/tests, but run migration generation and production acceptance for PostgreSQL semantics.

---

### Task 1: Google Identity and Rotating Trickee User Sessions

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py`
- Modify: `backend/app/models/entities.py`
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/services/auth.py`
- Create: `backend/app/services/google_identity.py`
- Create: `backend/alembic/versions/0002_live_telemetry_foundation.py`
- Create: `backend/tests/test_google_auth.py`

**Interfaces:**
- Produces: `GoogleIdentity(sub, email, email_verified, hosted_domain, full_name)`.
- Produces: `GoogleIdentityVerifier.verify(token: str, audience: str, nonce: str) -> GoogleIdentity`.
- Produces: `create_user_session(db: Session, user: User) -> SessionTokenPair`.
- Produces: `rotate_user_session(db: Session, refresh_token: str) -> SessionTokenPair`.
- Produces: `POST /api/v2/auth/google` and `POST /api/v2/auth/refresh`.

- [ ] **Step 1: Write failing Google-authentication tests**

```python
def test_google_login_links_preprovisioned_verified_user(client, seeded_user, verifier):
    verifier.identity = GoogleIdentity(
        sub="google-sub-1",
        email=seeded_user.email,
        email_verified=True,
        hosted_domain="company.example",
        full_name=seeded_user.full_name,
    )
    response = client.post("/api/v2/auth/google", json={"id_token": "valid", "nonce": "n-1"})
    assert response.status_code == 200
    assert response.json()["data"]["user"]["id"] == seeded_user.id
    assert response.json()["data"]["refresh_token"]


def test_refresh_token_is_rotated_once(client, google_session):
    first = client.post("/api/v2/auth/refresh", json={"refresh_token": google_session["refresh_token"]})
    replay = client.post("/api/v2/auth/refresh", json={"refresh_token": google_session["refresh_token"]})
    assert first.status_code == 200
    assert replay.status_code == 401
```

- [ ] **Step 2: Run tests and verify missing route/model failures**

Run: `cd backend && py -3.11 -m pytest tests/test_google_auth.py -q`

Expected: FAIL because Google identity/session interfaces and routes do not exist.

- [ ] **Step 3: Implement Google verification and user-session persistence**

```python
@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    hosted_domain: str | None
    full_name: str


def create_user_session(db: Session, user: User) -> SessionTokenPair:
    raw_refresh = secrets.token_urlsafe(48)
    db.add(UserRefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=settings.user_refresh_token_expire_days),
    ))
    return SessionTokenPair(
        access_token=create_access_token({"sub": user.id, "typ": "user"}),
        refresh_token=raw_refresh,
    )
```

The Google route must reject unverified email, unknown/pre-unprovisioned users, duplicate `sub` links, invalid Workspace domain for non-driver roles, inactive users, and verifier failures. Production verification uses `google.oauth2.id_token.verify_oauth2_token`; tests override the verifier dependency.

- [ ] **Step 4: Run targeted and complete backend tests**

Run: `cd backend && py -3.11 -m pytest tests/test_google_auth.py -q`

Expected: PASS.

Run: `cd backend && py -3.11 -m pytest tests -q`

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/requirements.txt backend/app/config.py backend/app/models/entities.py backend/app/routers/auth.py backend/app/services/auth.py backend/app/services/google_identity.py backend/alembic/versions/0002_live_telemetry_foundation.py backend/tests/test_google_auth.py
git commit -m "feat: add Google identity sessions"
```

### Task 2: Registered Android Device Sessions

**Files:**
- Modify: `backend/app/models/entities.py`
- Modify: `backend/app/main.py`
- Create: `backend/app/routers/devices.py`
- Create: `backend/app/services/device_auth.py`
- Modify: `backend/alembic/versions/0002_live_telemetry_foundation.py`
- Create: `backend/tests/test_device_auth.py`

**Interfaces:**
- Consumes: Trickee user access tokens from Task 1.
- Produces: `Device` and `DeviceRefreshToken` persistence.
- Produces: `create_device_access_token(device_id: str) -> str`.
- Produces: `get_current_device(...) -> Device` FastAPI dependency.
- Produces: `POST /api/v2/devices/register`, `POST /api/v2/devices/token`, and `POST /api/v2/devices/{device_id}/revoke`.

- [ ] **Step 1: Write failing device-registration and token tests**

```python
def test_registered_device_receives_separate_session(client, user_headers, vehicle):
    response = client.post("/api/v2/devices/register", headers=user_headers, json={
        "installation_id": "android-installation-1",
        "vehicle_id": vehicle.id,
        "platform": "android",
        "device_model": "Pixel 8",
        "app_version": "2.1.0",
    })
    assert response.status_code == 200
    assert response.json()["data"]["device"]["vehicle_id"] == vehicle.id
    assert response.json()["data"]["access_token"] != user_headers["Authorization"].split()[1]


def test_revoked_device_cannot_refresh(client, device_session, user_headers):
    client.post(f"/api/v2/devices/{device_session['device']['id']}/revoke", headers=user_headers)
    response = client.post("/api/v2/devices/token", json={
        "device_id": device_session["device"]["id"],
        "refresh_token": device_session["refresh_token"],
    })
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests and verify missing route/model failures**

Run: `cd backend && py -3.11 -m pytest tests/test_device_auth.py -q`

Expected: FAIL because device session routes do not exist.

- [ ] **Step 3: Implement device registration, rotation, and revocation**

```python
def create_device_session(db: Session, device: Device) -> DeviceSessionPair:
    raw_refresh = secrets.token_urlsafe(48)
    db.add(DeviceRefreshToken(
        device_id=device.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=settings.device_refresh_token_expire_days),
    ))
    return DeviceSessionPair(
        access_token=create_device_access_token(device.id),
        refresh_token=raw_refresh,
    )
```

Registration must require Android, an active same-fleet vehicle, and a unique installation ID. Refresh rotates the opaque refresh token. Revocation marks both device and outstanding refresh credentials inactive. `get_current_user` must reject `typ=device`; `get_current_device` accepts only `typ=device`.

- [ ] **Step 4: Run targeted and complete backend tests**

Run: `cd backend && py -3.11 -m pytest tests/test_device_auth.py -q`

Expected: PASS.

Run: `cd backend && py -3.11 -m pytest tests -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/app/models/entities.py backend/app/main.py backend/app/routers/devices.py backend/app/services/device_auth.py backend/alembic/versions/0002_live_telemetry_foundation.py backend/tests/test_device_auth.py
git commit -m "feat: add registered device sessions"
```

### Task 3: Versioned Telemetry Contracts

**Files:**
- Create: `backend/app/telemetry/__init__.py`
- Create: `backend/app/telemetry/contracts.py`
- Create: `backend/tests/test_telemetry_contracts.py`

**Interfaces:**
- Produces: `TelemetryWindowV1`, `TelemetryBatchRequestV1`, `TelemetryBatchAckV1`, `TelemetryRejectionV1`.
- Produces: `compress_sequence_ranges(sequences: Iterable[int]) -> list[tuple[int, int]]`.
- Produces: `missing_sequence_ranges(highest_contiguous: int, received: Iterable[int]) -> list[tuple[int, int]]`.

- [ ] **Step 1: Write failing contract tests**

```python
def test_missing_gps_window_is_valid():
    window = TelemetryWindowV1.model_validate(valid_window(gps_available=False, gps=None))
    assert window.gps is None
    assert window.gps_available is False


def test_claiming_gps_without_payload_is_rejected():
    with pytest.raises(ValidationError):
        TelemetryWindowV1.model_validate(valid_window(gps_available=True, gps=None))


def test_sequence_ranges_are_deterministic():
    assert compress_sequence_ranges([4, 2, 3, 7, 7]) == [(2, 4), (7, 7)]
```

- [ ] **Step 2: Run tests and verify the missing module failure**

Run: `cd backend && py -3.11 -m pytest tests/test_telemetry_contracts.py -q`

Expected: FAIL because `app.telemetry.contracts` does not exist.

- [ ] **Step 3: Implement strict Pydantic contracts and range helpers**

The models use `ConfigDict(extra="forbid")`, `schema_version: Literal[1]`, `sequence_no >= 1`, latitude/longitude bounds, non-negative monotonic timestamps, three-axis tuples, IMU completeness from 0 through 100, and a maximum of 100 windows per batch. `gps_available` and `gps` must agree.

```python
def compress_sequence_ranges(sequences: Iterable[int]) -> list[tuple[int, int]]:
    ordered = sorted(set(sequences))
    ranges: list[tuple[int, int]] = []
    for value in ordered:
        if not ranges or value > ranges[-1][1] + 1:
            ranges.append((value, value))
        else:
            ranges[-1] = (ranges[-1][0], value)
    return ranges
```

- [ ] **Step 4: Run targeted and complete backend tests**

Run: `cd backend && py -3.11 -m pytest tests/test_telemetry_contracts.py -q`

Expected: PASS.

Run: `cd backend && py -3.11 -m pytest tests -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add backend/app/telemetry/__init__.py backend/app/telemetry/contracts.py backend/tests/test_telemetry_contracts.py
git commit -m "feat: define telemetry v1 contracts"
```

### Task 4: Atomic Idempotent Telemetry Ingestion

**Files:**
- Modify: `backend/app/models/entities.py`
- Modify: `backend/app/main.py`
- Create: `backend/app/telemetry/persistence.py`
- Create: `backend/app/telemetry/batch_routes.py`
- Modify: `backend/alembic/versions/0002_live_telemetry_foundation.py`
- Create: `backend/tests/test_telemetry_ingestion.py`

**Interfaces:**
- Consumes: `TelemetryBatchRequestV1` and device authentication from Tasks 2-3.
- Produces: `persist_telemetry_batch(db, device, trip, batch) -> TelemetryBatchAckV1`.
- Produces: `POST /api/v2/trips/{trip_id}/telemetry-batches`.
- Produces: `TelemetryReceipt`, `TelemetryWindow`, `DeviceTripUploadCursor`, `TelemetryRejection`, and `ServerOutbox` rows.

- [ ] **Step 1: Write failing ingestion behavior tests**

```python
def test_batch_commit_returns_contiguous_ack(client, device_headers, trip):
    response = upload(client, device_headers, trip.id, sequences=[1, 2])
    assert response.status_code == 200
    assert response.json()["data"]["highest_contiguous_sequence"] == 2
    assert response.json()["data"]["accepted_sequences"] == [[1, 2]]


def test_out_of_order_batch_does_not_jump_gap(client, device_headers, trip):
    response = upload(client, device_headers, trip.id, sequences=[1, 3])
    assert response.json()["data"]["highest_contiguous_sequence"] == 1
    assert response.json()["data"]["missing_ranges"] == [[2, 2]]


def test_duplicate_retry_is_logically_exactly_once(client, device_headers, trip, db):
    first = upload(client, device_headers, trip.id, sequences=[1, 2])
    second = upload(client, device_headers, trip.id, sequences=[1, 2])
    assert first.status_code == second.status_code == 200
    assert db.query(TelemetryWindow).count() == 2
    assert second.json()["data"]["duplicate_sequences"] == [1, 2]


def test_wrong_vehicle_device_is_not_authorized(client, other_device_headers, trip):
    assert upload(client, other_device_headers, trip.id, sequences=[1]).status_code == 404
```

- [ ] **Step 2: Run tests and verify missing route/model failures**

Run: `cd backend && py -3.11 -m pytest tests/test_telemetry_ingestion.py -q`

Expected: FAIL because telemetry persistence and routes do not exist.

- [ ] **Step 3: Implement the single-transaction persistence algorithm**

```python
with db.begin_nested():
    cursor = get_or_create_upload_cursor(db, device.id, trip.id)
    outcomes = [persist_window(db, device, trip, window) for window in batch.windows]
    cursor.highest_contiguous_sequence = calculate_contiguous_cursor(
        db, device.id, trip.id, cursor.highest_contiguous_sequence
    )
    db.add(build_server_outbox_event(device, trip, batch, outcomes))
db.commit()
```

The route must authenticate a device token, require path/body trip identity, enforce the device's active vehicle/fleet assignment, cap batches at 100 windows/512 KiB uncompressed, and return only after commit. A duplicate is success. A conflicting reuse is quarantined in `telemetry_rejections`, never overwritten, and returned as a permanent rejection.

- [ ] **Step 4: Verify rollback and complete backend behavior**

Add a forced SQLAlchemy failure test proving receipt/window/cursor/outbox rows all roll back together.

Run: `cd backend && py -3.11 -m pytest tests/test_telemetry_ingestion.py -q`

Expected: PASS.

Run: `cd backend && py -3.11 -m pytest tests -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add backend/app/models/entities.py backend/app/main.py backend/app/telemetry/persistence.py backend/app/telemetry/batch_routes.py backend/alembic/versions/0002_live_telemetry_foundation.py backend/tests/test_telemetry_ingestion.py
git commit -m "feat: add idempotent telemetry ingestion"
```

### Task 5: Gate 0 Migration and Documentation Verification

**Files:**
- Modify: `backend/.env.example`
- Modify: `DEVELOPER_HANDOFF.md`
- Modify: `README.md`
- Test: `backend/tests/test_google_auth.py`
- Test: `backend/tests/test_device_auth.py`
- Test: `backend/tests/test_telemetry_contracts.py`
- Test: `backend/tests/test_telemetry_ingestion.py`

**Interfaces:**
- Consumes: all Task 1-4 interfaces.
- Produces: documented configuration, migration commands, compatibility behavior, and Gate 0 evidence.

- [ ] **Step 1: Run clean SQLite migration verification**

Run from a temporary directory with `TRICKEE_DATABASE_URL=sqlite:///...`:

```powershell
py -3.11 -m alembic -c backend/alembic.ini upgrade head
py -3.11 -m alembic -c backend/alembic.ini current
```

Expected: current revision `0002_live_telemetry_foundation`.

- [ ] **Step 2: Document exact configuration and compatibility paths**

Document `TRICKEE_GOOGLE_OAUTH_CLIENT_ID`, `TRICKEE_GOOGLE_WORKSPACE_DOMAIN`, access/refresh expiry settings, device enrollment, telemetry endpoint, legacy route transition, and the rule that production migrations run as one release job rather than every API replica.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```powershell
cd backend
py -3.11 -m pytest tests -q
py -3.11 -m alembic heads
```

Expected: all tests PASS and one head named `0002_live_telemetry_foundation`.

- [ ] **Step 4: Check repository hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: only intended source, migration, test, and documentation changes; no `.env`, database, logs, virtual environments, dependencies, keys, or build output.

- [ ] **Step 5: Commit Task 5**

```bash
git add backend/.env.example README.md DEVELOPER_HANDOFF.md docs/superpowers/plans/2026-08-05-gate0-telemetry-foundation.md
git commit -m "docs: record telemetry gate zero contract"
```
