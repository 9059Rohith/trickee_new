# Trickee GPS-First EV Intelligence

This `gpsdriver` repository is the isolated Android-oriented telemetry build;
the source repository in `trickee_new` is not modified by this work.

## Live GPS/IMU Gate 0

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

Gate 0 is the server contract. The Kotlin foreground service, Room outbox,
50 Hz IMU summarizer, uploader, Redis live projector, and fleet WebSocket layer
remain subsequent gates in the approved master design:
`docs/superpowers/specs/2026-08-05-android-live-gps-imu-master-system-design.md`.

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
        │   └── gpsTracking.ts            # 1Hz GPS capture service
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

### Backend
```bash
cd backend
pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Run Tests
```bash
cd backend
python -m pytest tests/ -v
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

Use Cloud Run for the API process, Cloud SQL for PostgreSQL, Memorystore for
Redis in the live-projection gate, and Secret Manager for the database URL,
JWT secret, and OAuth configuration. Execute `alembic upgrade head` from one
Cloud Run Job per release, then deploy API revisions; never run migrations in
every autoscaled API instance.

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
| `POST` | `/api/v2/devices/register` | Bind an Android installation to a vehicle |
| `POST` | `/api/v2/devices/token` | Rotate device credentials |
| `POST` | `/api/v2/devices/{device_id}/revoke` | Revoke an installation and token family |
| `POST` | `/api/v2/trips/{trip_id}/telemetry-batches` | Commit versioned GPS/IMU windows |

Android debug builds use the emulator-local API. Release builds use
`https://trickee-gps-first.onrender.com` and disable cleartext traffic. To produce
a store-signed release, provide these Gradle properties in a private user-level
`gradle.properties` file (never commit the keystore or secrets):

```properties
TRICKEE_RELEASE_STORE_FILE=C:/secure/trickee-release.keystore
TRICKEE_RELEASE_STORE_PASSWORD=...
TRICKEE_RELEASE_KEY_ALIAS=...
TRICKEE_RELEASE_KEY_PASSWORD=...
```

Then run `mobile/android/gradlew.bat bundleRelease`. Confirm the production API
hostname before store submission if it differs from the configured Render URL.

## Non-Negotiable Rules
1. GPS + specs CAN estimate: route energy, Wh/km, demand score, SOC consumed
2. GPS + specs CANNOT estimate remaining range without recent SOC
3. Every prediction carries: value, confidence, source, estimated
4. Never rename GPS-derived proxies to BMS field names
5. No fabricated BMS data anywhere
