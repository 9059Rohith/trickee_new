# Trickee GPS-First EV Intelligence

This `gpsdriver` repository is the isolated Android-oriented telemetry build;
the source repository in `trickee_new` is not modified by this work.

## Live GPS/IMU architecture

The backend foundation for uninterrupted one-second trip telemetry is now in
place for the initial two concurrent vehicles and is designed to scale to 150:

- Google ID tokens link only pre-provisioned Trickee users; Trickee issues its
  own rotating access and refresh sessions.
- Android installations register against one active fleet vehicle and receive
  separate, revocable device credentials.
- `POST /api/v2/trips/{trip_id}/telemetry-batches` accepts strict schema-v1
  GPS/IMU windows, plain JSON or gzip, up to 100 windows and 512 KiB
  uncompressed.
- Receipts, canonical windows, upload cursor, conflict quarantine, and server
  outbox are committed atomically. Exact retries succeed without duplicate
  telemetry; identity conflicts never overwrite the first committed window.
- A missing GPS fix is represented as `gps_available=false` and `gps=null`; it
  is never converted into a fabricated coordinate or BMS value.

The repository-owned implementation for Gates 0–4 now includes the Kotlin
foreground collector, Room WAL outbox, 50 Hz IMU summarizer, gzip uploader,
Google Credential Manager sign-in, Redis Streams processing, live REST/WebSocket
state, Prometheus metrics, verified archive manifests, Google Cloud Terraform,
and capacity/rollout certification tools. The master contract is
`docs/superpowers/specs/2026-08-05-android-live-gps-imu-master-system-design.md`;
actual gate status and external evidence still required are recorded in
`docs/evidence/gates-1-to-4-status.md`.

## Project Structure

```
gpsdriver/
├── DECISIONS.md                          # Open founder decisions
├── backend/                              # FastAPI backend
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py                       # FastAPI app entry point
│   │   ├── config.py                     # Settings
│   │   ├── database.py                   # SQLAlchemy setup
│   │   ├── models/
│   │   │   └── entities.py               # All database models
│   │   ├── routers/
│   │   │   ├── auth.py                   # Login/signup/me
│   │   │   ├── mobile.py                 # Trip lifecycle + GPS batch
│   │   │   ├── gps_intelligence.py       # Predictions API
│   │   │   ├── soc.py                    # SOC readings CRUD
│   │   │   └── vehicles.py              # Vehicle specs management
│   │   ├── services/
│   │   │   ├── auth.py                   # JWT + password hashing
│   │   │   ├── physics_gps.py            # Haversine, speed, grade
│   │   │   ├── physics_energy.py         # Physics baseline engine
│   │   │   ├── gps_feature_pipeline.py   # Quality filter + features
│   │   │   ├── gps_prediction_service.py # Prediction orchestrator
│   │   │   └── gps_retention.py          # Data retention cleanup
│   │   └── schemas/
│   │       └── api.py                    # Response envelope
│   └── tests/
│       ├── test_physics_energy.py         # Physics engine unit tests
│       └── test_gps_prediction.py         # Integration tests
│
└── mobile/                               # React Native app
    ├── App.tsx                            # Entry point
    └── src/
        ├── config/index.ts               # API config + feature flags
        ├── constants/Colors.ts            # Design tokens
        ├── hooks/useInterval.ts           # Polling hook
        ├── context/
        │   ├── AuthContext.tsx            # JWT auth state
        │   └── LiveDataContext.tsx        # Polling + GPS-first data
        ├── services/
        │   ├── api.ts                     # All API methods
        │   ├── types.ts                   # TypeScript types
        │   └── telemetryNative.ts         # Native durable collector bridge
        ├── components/
        │   ├── EstimatedBadge.tsx         # "Estimated" / "Live" badge
        │   ├── ConfidenceIndicator.tsx    # 3-bar confidence visual
        │   ├── SOCEntryModal.tsx          # Manual SOC input modal
        │   ├── TripActiveBanner.tsx       # GPS tracking status
        │   ├── GlassCard.tsx             # Translucent card
        │   ├── StateViews.tsx            # Loading/Error states
        │   └── DriverActionSheet.tsx     # Trip start/stop + SOC
        ├── screens/
        │   ├── auth/LoginScreen.tsx
        │   ├── home/HomeScreen.tsx        # GPS-first dashboard
        │   ├── home/MonitoringScreen.tsx  # Vehicle monitoring
        │   ├── settings/SettingsScreen.tsx
        │   └── VehicleOnboardingScreen.tsx # Spec entry form
        └── navigation/
            └── AppNavigator.tsx           # Navigation tree
```

## Quick Start

Windows local development is one command after the initial Python/npm install:

```powershell
.\scripts\start-local.ps1 -RestartServices
```

It migrates and idempotently seeds SQLite, starts FastAPI on `8001`, starts
Metro on `8081`, installs the debug APK on the connected emulator/device, and
prints log locations and demo accounts. Use `-SkipAndroid` when only the API and
Metro are needed. The complete PostgreSQL/Redis worker topology is exercised
with Docker Compose; the lightweight SQLite launcher intentionally does not
pretend Redis processors are running when Docker Desktop is unavailable.
Android compiler output is automatically placed under
`%LOCALAPPDATA%\Trickee\android-build` for OneDrive checkouts to prevent Files
On-Demand reparse points from corrupting Gradle outputs.

### Backend
```bash
cd backend
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Run Tests
```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/ -v
```

### Local demo

```bash
cd backend
python -m scripts.seed_demo
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

In another terminal, run `cd mobile && npm install && npm run android`.

Demo accounts:

- Driver: `driver1@evify.in` / `Driver@2026`
- Driver: `driver2@evify.in` / `Driver@2026`
- Fleet manager: `owner@evify.in` / `Manager@2026`

For the complete driver demo, tap **Start Trip**, enter starting dashboard SOC,
drive with foreground location enabled, then tap **End Trip** and enter ending
SOC. The app flushes every queued GPS point before the backend calculates and
displays GPS distance, SOC-calibrated energy, Wh/km, and the physics estimate.

### API Docs
Once running, visit: http://localhost:8000/docs

## Production deployment

The backend is packaged for PostgreSQL and Docker:

```bash
copy backend/.env.example .env
# Set POSTGRES_PASSWORD, TRICKEE_SECRET_KEY, and TRICKEE_ALLOWED_ORIGINS.
docker compose up --build -d
```

Run Alembic once as a release job before starting or shifting traffic to API
replicas. The API container intentionally does not migrate on startup. Docker
Compose models this with a one-shot `migrate` service. `GET /health` is the
platform health check. Raw GPS retention runs at startup and every 24 hours;
the conservative default is 90 days.

### Google Cloud target

The reviewed topology is in `infra/gcp`: private regional Cloud SQL HA/PITR,
private TLS Memorystore HA, separate Cloud Run API/WebSocket/relay/processor
roles, one-shot jobs, private versioned Cloud Storage archive, Secret Manager,
Artifact Registry, alerts, bounded instance counts/pools, and distinct service
accounts. Execute the migration job once per release; never migrate from API
replicas. Applying this topology and producing restore/load evidence requires
company GCP access and is intentionally not claimed by repository tests.

Set `TRICKEE_GOOGLE_OAUTH_CLIENT_ID` to the server/web OAuth client ID whose
audience the Android Google Sign-In flow requests. Set
`TRICKEE_GOOGLE_WORKSPACE_DOMAIN` to the company Workspace domain. Drivers may
use explicitly pre-provisioned external Google accounts; privileged staff must
match the configured hosted domain.

Relevant v2 endpoints are:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v2/auth/google` | Verify Google identity and issue Trickee user session |
| `POST` | `/api/v2/auth/refresh` | Rotate a user refresh token |
| `POST` | `/api/v2/auth/logout` | Revoke the user refresh-token family |
| `POST` | `/api/v2/devices/register` | Bind an Android installation to a vehicle |
| `POST` | `/api/v2/devices/token` | Rotate device credentials |
| `POST` | `/api/v2/devices/{device_id}/revoke` | Revoke an installation and token family |
| `POST` | `/api/v2/trips/start` | Idempotently create an offline-first trip |
| `POST` | `/api/v2/trips/{trip_id}/complete` | Declare the final sequence and wait for gaps |
| `POST` | `/api/v2/trips/{trip_id}/telemetry-batches` | Commit versioned GPS/IMU windows |
| `GET` | `/api/v2/vehicles/{vehicle_id}/live-state` | Fetch the recoverable current snapshot |
| `WS` | `/ws/v2/vehicles/{vehicle_id}` | Receive versioned live snapshots/updates |

Android debug builds use the emulator-local API. Use Node.js `20.19.4` or newer.
Release builds require explicit REST and WebSocket origins; an unconfigured release resolves to a deliberate
non-routable `.invalid` address and disables cleartext traffic. To produce a
store-signed release, provide these Gradle properties in a private user-level
`gradle.properties` file (never commit the keystore or secrets):

```properties
TRICKEE_RELEASE_STORE_FILE=C:/secure/trickee-release.keystore
TRICKEE_RELEASE_STORE_PASSWORD=...
TRICKEE_RELEASE_KEY_ALIAS=...
TRICKEE_RELEASE_KEY_PASSWORD=...
TRICKEE_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
TRICKEE_API_ORIGIN=https://your-company-cloud-run-api.example.com
TRICKEE_WEBSOCKET_ORIGIN=https://your-company-cloud-run-websocket.example.com
```

Production users are provisioned without passwords before their first Google
sign-in:

```powershell
cd backend
.\.venv\Scripts\python.exe -m scripts.provision_fleet .\private-company-fleet.json
```

Copy `backend/examples/fleet-provision.example.json` outside the repository,
fill it with approved company identities/vehicle specifications, and keep the
real file in the company secret-controlled deployment workspace.

Then run the fail-closed public release builder from the repository root:

```powershell
.\scripts\build-public-release.ps1
```

It verifies package `com.trickee.gpsdriverapp`, version `1.0.4 (5)`, target SDK
36, HTTPS endpoints, OAuth configuration, permissions, signature, and the
registered upload-certificate SHA-1. It writes the verified AAB under
`%LOCALAPPDATA%\Trickee\gpsdriver-public-android-build\release`. The build stops
if the registered upload keystore or any required signing property is missing.

## Non-Negotiable Rules
1. GPS + specs CAN estimate: route energy, Wh/km, demand score, SOC consumed
2. GPS + specs CANNOT estimate remaining range without recent SOC
3. Every prediction carries: value, confidence, source, estimated
4. Never rename GPS-derived proxies to BMS field names
5. No fabricated BMS data anywhere
