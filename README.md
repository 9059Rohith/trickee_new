# Trickee GPS-First EV Intelligence

## Project Structure

```
trickee_new/
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

The container runs Alembic migrations before starting two API workers and exposes
`GET /health` for platform health checks. Raw GPS retention runs at startup and
every 24 hours; the conservative default is 90 days.

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
