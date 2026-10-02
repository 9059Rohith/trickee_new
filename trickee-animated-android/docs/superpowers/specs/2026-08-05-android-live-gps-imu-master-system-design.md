# Android Live GPS and IMU Master System Design

Date: 2026-08-05

Status: Approved architecture direction; written specification awaiting review

Repository: `9059Rohith/trickee_new`

Initial deployment: two concurrently active Android vehicles for complete trips

Capacity target: 150 concurrently active Android vehicles

## 1. Executive decision

Trickee will evolve its existing React Native, FastAPI, PostgreSQL, and GPS
physics application into an Android-oriented live telemetry platform. The first
production path will use:

- a Kotlin Android foreground service for continuous trip capture;
- Fused Location Provider GPS requested at approximately 1 Hz;
- accelerometer and gyroscope capture at 50 Hz, summarized into one-second
  telemetry windows;
- Room/SQLite as the durable device-side source of unacknowledged data;
- versioned HTTPS batches for both live upload and offline backfill;
- FastAPI as a modular ingestion API inside the existing backend;
- PostgreSQL as the canonical system of record;
- a transactional PostgreSQL server outbox;
- Redis Streams for durable asynchronous processing;
- Redis for the latest vehicle-state projection;
- FastAPI WebSockets for driver and fleet-manager updates;
- Google Credential Manager Sign in with Google for human authentication;
- Google Cloud Run, Cloud SQL for PostgreSQL, Memorystore for Redis, Cloud
  Storage, Secret Manager, and Cloud Observability in the company's Google
  Cloud organization.

MQTT, TimescaleDB, Kafka, and independent microservice deployments are not
required for the two-vehicle release. They are expansion options, not launch
dependencies. This architecture supports the 150-vehicle target without a
big-bang rewrite and preserves a clean extraction boundary if later load tests
justify dedicated ingestion services or MQTT.

## 2. Honest reliability contract

No consumer Android phone can guarantee a valid GPS fix every second without
interruption. Force-stop, revoked permissions, reboot, unavailable satellites,
thermal limits, battery restrictions, hardware variation, and operating-system
rules can interrupt or degrade capture.

The product guarantee is therefore:

> While a driver-started Android trip foreground service is active, Trickee
> requests GPS at approximately 1 Hz, collects IMU events at a requested 50 Hz,
> commits each completed one-second telemetry window to local Room storage before
> attempting network transmission, eventually uploads every locally committed
> window, and exposes all detected gaps or incomplete windows. Trickee never
> manufactures a missing GPS position.

The following are distinct and must never be reported as the same metric:

- requested GPS cadence;
- actual GPS-fix cadence;
- actual IMU event cadence;
- locally persisted telemetry-window cadence;
- server-committed cadence;
- dashboard update cadence.

## 3. Scope

### 3.1 Included

- Android trip capture from explicit driver start through explicit driver end.
- GPS, accelerometer, gyroscope, device-health, and collector-heartbeat data.
- One durable telemetry window per elapsed second of an active trip.
- Offline collection, process recovery, retries, deduplication, gap tracking,
  and application-level acknowledgement.
- Live GPS validation, trip progress, energy estimation, alert processing, and
  dashboard updates.
- An initial two-vehicle concurrent field release.
- Load-tested expansion to 150 concurrently active vehicles.

### 3.2 Excluded from the first release

- iOS background-collection guarantees.
- CAN/BMS fields unless a real, authorized hardware or OEM source supplies them.
- Continuous storage of raw 50 Hz IMU for every vehicle.
- Kafka, multi-region active-active deployment, and long-lived MQTT command
  channels.
- Automatic trip start or end without driver action.

## 4. Existing repository baseline and required changes

The current application has useful foundations, but its capture path is not the
target reliability architecture.

| Area | Current repository | Required target |
|---|---|---|
| Android capture | React Native `watchPosition` in `mobile/src/services/gpsTracking.ts` | Kotlin foreground service independent of the React Native runtime |
| GPS cadence | Requested 1,000 ms interval, 500 ms fastest interval | Retain requested cadence; measure actual delivery and gaps |
| IMU | Not collected | Native accelerometer and gyroscope at requested 50 Hz |
| Local queue | JSON array in `AsyncStorage` | Transactional Room/SQLite tables |
| Queue overflow | Oldest points can be dropped after 5,000 entries | No silent deletion; storage pressure becomes a visible blocking/degraded state |
| Sequence | In-memory counter reset when tracking starts | Durable per-device, per-trip sequence stored transactionally |
| Upload | JSON GPS batches | Versioned one-second telemetry-window batches |
| Acknowledgement | Batch accepted and inserted count | Highest contiguous committed sequence plus explicit duplicate/rejection results |
| Identity | User bearer token | User session plus registered device identity scoped to fleet, vehicle, and trip |
| Database | SQLite development, PostgreSQL deployment | PostgreSQL production with range-partitioned telemetry and separate idempotency receipts |
| Processing | End-trip synchronous GPS calculation | Durable Redis Stream consumers for live projections; deterministic final recomputation |
| Live UI | REST polling | REST snapshot plus authenticated WebSocket deltas |
| Redis | Not present | Streams for durable work and hashes for latest state |
| Human authentication | Email/password plus Trickee JWT | Google ID token verification followed by a Trickee application session |
| Cloud platform | Generic Docker Compose path | Company Google Cloud project with private managed data services and workload identities |

The existing GPS quality gates, physics calculations, prediction provenance,
manual SOC policy, retention service, authentication, vehicle models, trip
models, and fleet-owner views remain foundations. They will be adapted rather
than rewritten without cause.

## 5. Selected architecture

```text
ANDROID DEVICE

 Fused Location Provider (requested 1 Hz) ─┐
                                           ├──> Kotlin TripCollectorService
 SensorManager accel + gyro (50 Hz) ───────┘              │
                                                           ▼
                                               1-second window builder
                                                           │
                                      commit before upload ▼
                                                  Room/SQLite WAL
                                      trips + telemetry_outbox + cursors
                                                           │
                           online every ~2 s / backfill batches of 100
                                                           ▼
                                  HTTPS POST /api/v2/trips/{id}/telemetry-batches

CLOUD

 Load balancer
      │
      ▼
 FastAPI modular ingestion API
 auth -> contract validation -> identity/trip validation -> bounded batch
      │
      ▼ one PostgreSQL transaction
 PostgreSQL
 telemetry_receipts + telemetry_windows + upload_cursors + server_outbox
      │
      ▼ committed application ACK
 Android marks only acknowledged sequences as ACKED

 Server outbox relay
      │
      ▼
 Redis Stream: telemetry:committed
      ├──> live-state consumer ──────> Redis latest vehicle state
      ├──> GPS/energy consumer ──────> live trip projection
      ├──> IMU/rule consumer ────────> events and alerts
      └──> finalizer consumer ───────> authoritative trip result
                                             │
 Redis Pub/Sub fan-out after projection <────┘
      │
      ▼
 FastAPI WebSocket gateway
      │
      ▼
 Driver and fleet-manager React Native screens
```

## 6. Why HTTPS first

The selected transport is HTTPS batching, not MQTT, for the first production
release.

Reasons:

1. The current mobile and backend already use authenticated HTTPS and Pydantic
   JSON contracts.
2. At 150 windows per second, the target is well within a properly batched and
   load-tested FastAPI/PostgreSQL deployment.
3. One transport handles online delivery and offline backfill.
4. Device provisioning, certificates, broker topic ACLs, retained MQTT sessions,
   and broker operations do not block the two-vehicle field release.
5. Application-level acknowledgement is still required with MQTT QoS 1, so
   MQTT would not remove the durable-outbox work.

Online devices upload approximately every two seconds. Each request normally
contains two telemetry windows. At 150 active devices this is about 75 requests
per second and 150 telemetry rows per second. Backfill uses larger batches
without creating a second protocol.

MQTT v5 QoS 1 becomes a candidate only when measured field evidence shows that
HTTPS cannot satisfy the latency, radio-energy, bandwidth, or bidirectional
command requirements. MQTT adoption must preserve the same identifiers,
sequence rules, Room outbox, server idempotency, and application ACK contract.

## 7. Android capture architecture

### 7.1 Native ownership

Create a Kotlin `TripCollectorService` and a narrow React Native bridge. React
Native can request `startTrip`, `stopTrip`, and current collector status, but it
does not own the sampling timer or persistence lifecycle.

The service must:

- start only from an explicit user action while the app is eligible to start a
  location foreground service;
- declare the Android `location` foreground-service type and required
  permissions;
- display an ongoing notification while a trip is active;
- use `START_STICKY` recovery where Android permits it;
- recover the active trip and next sequence from Room after process recreation;
- hold a bounded partial wake lock only while active if device testing proves
  it is required for stable IMU capture;
- release location callbacks, sensor listeners, wake locks, and notification
  state deterministically at trip end;
- expose permission, GPS-provider, storage, battery, and service state to the
  UI.

A reboot or force-stop is recorded as a capture gap. The application must not
claim it can bypass Android restrictions. When automatic restart is not
permitted, the next user-visible launch or allowed notification prompts the
driver to resume the persisted active trip.

### 7.2 Sampling

GPS:

- request high-accuracy fixes at approximately 1 Hz;
- accept the provider timestamp rather than assigning JavaScript receipt time;
- retain accuracy, altitude, speed, bearing, provider, and mock-location
  metadata when available;
- record actual fix intervals and last-fix age;
- never repeat the previous coordinate as a new fix.

IMU:

- register accelerometer and gyroscope listeners at a requested 50 Hz;
- use hardware monotonic sensor timestamps;
- align events into one-second windows using monotonic time;
- retain actual sample count and completeness because delivery may differ from
  the requested rate;
- calculate summaries off the UI thread.

The initial release stores these one-second IMU features:

- per-axis mean, minimum, maximum, standard deviation, and RMS acceleration;
- acceleration magnitude RMS and maximum;
- jerk RMS and maximum;
- per-axis mean, maximum absolute, and RMS gyroscope rotation;
- estimated orientation only when the available sensors make it valid;
- accelerometer and gyroscope sample counts;
- expected counts and completeness percentages;
- sensor accuracy and sensor-presence flags.

Raw IMU is disabled by default. A server-authorized training mode may store
encrypted compressed raw windows for selected devices for at most 24 hours,
subject to storage, privacy, and upload controls.

### 7.3 One-second window rule

The collector creates one logical `TelemetryWindow` for every elapsed second of
an active trip, even when GPS is absent. A missing GPS second contains:

```json
{
  "gps_available": false,
  "gps": null,
  "last_gps_age_ms": 4200,
  "imu_window_complete_pct": 96.0,
  "collector_state": "ACTIVE"
}
```

This is a health/IMU window, not a fabricated location point.

## 8. Canonical telemetry contract

The first contract is versioned JSON with gzip support because it integrates
directly with the current FastAPI/Pydantic stack. Protobuf is deferred until
measured payload or CPU cost justifies dual-schema operational complexity.

Required envelope:

```json
{
  "schema_version": 1,
  "sample_id": "UUIDv7-or-ULID",
  "trip_id": "client-generated-UUID",
  "device_id": "registered-device-UUID",
  "vehicle_id": "assigned-vehicle-UUID",
  "sequence_no": 10450,
  "boot_id": "UUID-created-per-device-boot",
  "event_time_utc_ms": 1785941720000,
  "monotonic_time_ns": 382004912345678,
  "window_duration_ms": 1000,
  "gps_available": true,
  "gps": {
    "latitude": 11.0168,
    "longitude": 76.9558,
    "altitude_m": 411.2,
    "speed_mps": 12.8,
    "bearing_deg": 145.2,
    "horizontal_accuracy_m": 4.7,
    "vertical_accuracy_m": 8.0,
    "provider": "fused",
    "is_mock_location": false,
    "fix_time_utc_ms": 1785941719980,
    "fix_monotonic_time_ns": 382004892345678,
    "fix_age_ms": 20
  },
  "imu": {
    "accelerometer_sample_count": 49,
    "gyroscope_sample_count": 50,
    "accelerometer_complete_pct": 98.0,
    "gyroscope_complete_pct": 100.0,
    "accel_mean_mps2": [0.04, -0.12, 9.79],
    "accel_std_mps2": [0.13, 0.10, 0.18],
    "accel_rms_mps2": [0.14, 0.16, 9.79],
    "accel_min_mps2": [-0.28, -0.39, 9.21],
    "accel_max_mps2": [0.35, 0.30, 10.31],
    "jerk_rms_mps3": 1.2,
    "jerk_max_mps3": 3.7,
    "gyro_mean_rads": [0.01, 0.02, -0.01],
    "gyro_rms_rads": [0.03, 0.04, 0.03],
    "gyro_max_abs_rads": [0.08, 0.11, 0.09]
  },
  "health": {
    "battery_pct": 72,
    "charging": false,
    "network_type": "CELLULAR",
    "location_permission": "PRECISE_FOREGROUND",
    "gps_enabled": true,
    "collector_state": "ACTIVE",
    "local_outbox_pending": 17,
    "app_version": "2.1.0",
    "os_version": "Android",
    "device_model": "registered-model"
  }
}
```

Contract rules:

- `sample_id` is globally unique and immutable.
- `(device_id, trip_id, sequence_no)` is unique and immutable.
- `sequence_no` increments once per one-second window and is persisted in the
  same Room transaction as the window.
- Wall time is used for reporting; monotonic time and `boot_id` are used for
  ordering and interval measurement.
- `received_at` is assigned only by the backend.
- Unknown fields are rejected for a major contract version and may be accepted
  only under an explicit compatible minor-version policy.
- Units are part of field names or schema documentation.
- GPS-derived and IMU-derived values never use BMS field names.

## 9. Durable device outbox

Room runs in WAL mode and contains at least:

```sql
CREATE TABLE local_trips (
    trip_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    state TEXT NOT NULL,
    next_sequence_no INTEGER NOT NULL,
    final_sequence_no INTEGER,
    started_at_utc_ms INTEGER NOT NULL,
    ended_at_utc_ms INTEGER
);

CREATE TABLE telemetry_outbox (
    sample_id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    event_time_utc_ms INTEGER NOT NULL,
    monotonic_time_ns INTEGER NOT NULL,
    payload BLOB NOT NULL,
    state TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at_utc_ms INTEGER NOT NULL,
    server_committed_at_utc_ms INTEGER,
    created_at_utc_ms INTEGER NOT NULL,
    UNIQUE (trip_id, sequence_no)
);
```

Allowed window states are `PENDING`, `IN_FLIGHT`, `ACKED`, and
`PERMANENTLY_REJECTED`.

Rules:

1. Build a complete window.
2. In one Room transaction, insert the window and increment the trip cursor.
3. Only then make the window eligible for upload.
4. Mark rows `IN_FLIGHT` only as a recoverable lease, not as deletion.
5. Mark rows `ACKED` only after the backend confirms a committed sequence.
6. Retain acknowledged rows for a 24-hour safety window before deletion.
7. Never delete `PENDING` or retryable rejected data to make room silently.

The device reserves at least 500 MB for telemetry and supports a configurable
2 GB maximum. The UI warns at 75%, blocks new nonessential raw-IMU capture at
85%, and shows a critical persistent warning at 95%. Canonical one-second
windows remain higher priority than raw IMU. If canonical storage cannot
continue, the collector emits a fatal local-storage state and the UI must not
claim the trip is fully recorded.

The live uploader is a single coroutine owned by the foreground service.
WorkManager runs unique recovery/backfill work after process recreation or once
the trip is no longer active; it is not used as a one-second scheduler.

## 10. Upload and acknowledgement contract

Endpoint:

```http
POST /api/v2/trips/{trip_id}/telemetry-batches
Authorization: Bearer <device-scoped-token>
Content-Type: application/json
Content-Encoding: gzip
Idempotency-Key: <batch-id>
```

Limits:

- online flush: every two seconds or 20 windows, whichever occurs first;
- backfill batch: up to 100 windows;
- uncompressed request limit: 512 KiB;
- exactly one active uploader per device;
- request timeout: 15 seconds;
- exponential retry with full jitter from 1 second to 5 minutes;
- retry `408`, `425`, `429`, and `5xx` responses;
- do not retry permanent contract, authorization, or identity rejections
  without changing the rejected data or credentials.

Response:

```json
{
  "batch_id": "01K1...",
  "trip_id": "01K1...",
  "committed": true,
  "highest_contiguous_sequence": 10450,
  "accepted_sequences": [[10401, 10450]],
  "duplicate_sequences": [10404],
  "rejections": [],
  "missing_ranges": [],
  "server_received_at": "2026-08-05T14:55:20.512Z"
}
```

A permanent rejection contains the sequence, stable error code, safe message,
and `retryable: false`. A duplicate is success. The client may delete through
the acknowledged contiguous cursor only after confirming that no permanent
rejection or missing range exists inside that span.

An HTTP success means the PostgreSQL transaction is committed. It does not mean
that live projections, alerts, or final calculations have completed.

## 11. Backend integration strategy

The first deployment remains one repository and one application image. It runs
different process roles so responsibilities are isolated without premature
microservices:

```text
backend/app/
├── telemetry/
│   ├── contracts.py          # Versioned Pydantic request/response models
│   ├── batch_routes.py       # Authentication, bounds, transaction orchestration
│   ├── identity.py           # Device, fleet, vehicle, and trip checks
│   ├── persistence.py        # Bulk insert and application ACK cursor
│   ├── quality.py            # Contract-level quality classification
│   └── acknowledgements.py   # Contiguous cursor and gap response
├── streams/
│   ├── outbox_relay.py       # PostgreSQL outbox to Redis Streams
│   └── redis_client.py       # Stream, cache, and fan-out adapters
├── processors/
│   ├── live_state.py         # Latest state and freshness projection
│   ├── gps_energy.py         # Incremental GPS/physics projection
│   ├── imu_rules.py          # IMU quality and driving events
│   └── trip_finalizer.py     # Deterministic authoritative end result
└── realtime/
    └── websocket_gateway.py  # Authenticated snapshot/delta delivery
```

The ingest request may perform only:

1. device authentication and authorization;
2. payload-size and schema-version validation;
3. device, vehicle, fleet, and trip relationship validation;
4. duplicate-safe receipt and telemetry insertion;
5. upload-cursor and gap update;
6. server-outbox insertion;
7. committed application acknowledgement.

It does not run full-trip physics, IMU event classification, alerts, map
matching, or ML inference.

The existing `/api/v1/mobile/v2/trips/{trip_id}/gps-batch` and compatibility
`/api/v2/trips/{trip_id}/gps-batch` routes remain available during one mobile
release transition. New application versions use only the telemetry-window
endpoint. Metrics identify remaining legacy clients before the old route is
removed.

## 12. PostgreSQL design

PostgreSQL remains the system of record. SQLite is allowed only for local
development and unit tests; deployment acceptance must run against PostgreSQL.

Core additions:

```text
devices
device_credentials
telemetry_receipts
telemetry_windows
device_trip_upload_cursors
telemetry_rejections
server_outbox
processor_idempotency
vehicle_live_state_snapshots
```

### 12.1 Idempotency

`telemetry_receipts` is an unpartitioned, narrow deduplication table:

```sql
CREATE TABLE telemetry_receipts (
    sample_id UUID PRIMARY KEY,
    device_id UUID NOT NULL,
    trip_id UUID NOT NULL,
    sequence_no BIGINT NOT NULL,
    first_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, trip_id, sequence_no)
);
```

`telemetry_windows` is range-partitioned by `event_time` using daily partitions.
The separate receipt table preserves global retry idempotency even when a retry
crosses a partition boundary.

### 12.2 Atomic ingest transaction

For each bounded batch:

1. Lock or create the device-trip upload cursor.
2. Insert receipt keys with `ON CONFLICT DO NOTHING`.
3. Bulk-insert canonical windows only for newly inserted receipts.
4. Record stable rejections separately.
5. Advance the contiguous cursor without jumping over gaps.
6. Insert one `telemetry.batch.committed.v1` row in `server_outbox` containing
   the new sample identifiers and sequence range.
7. Commit.
8. Return the application acknowledgement.

There is no database-plus-Redis dual write in the request.

### 12.3 Indexes and retention

Indexes are limited to measured query paths:

- `(trip_id, event_time)` for trip replay and finalization;
- `(vehicle_id, event_time DESC)` for recent vehicle history;
- `(device_id, trip_id, sequence_no)` through the receipt uniqueness contract;
- pending `server_outbox` rows by dispatch state and creation time.

Retention:

- canonical one-second telemetry: 30 days in hot PostgreSQL partitions;
- encrypted precise-GPS archive: days 31 through 90 when retention approval
  requires it, followed by deletion;
- one-minute aggregates without precise route coordinates: 13 months;
- trip features, predictions, and alerts: 13 months;
- security and precise-location access audit records: 24 months without raw
  coordinate payloads;
- selected raw IMU: maximum 24 hours;
- Redis latest state: cache only, never the sole retained copy.

The existing 90-day precise-GPS policy remains the maximum. The 150-vehicle
rollout must validate storage cost and partition maintenance before activation.

PostgreSQL native partitioning is selected initially. TimescaleDB is adopted
only if production measurements show that compression, continuous aggregates,
or time-series query operations justify the extension and the chosen managed
PostgreSQL provider supports it safely.

## 13. Redis Streams and processors

Redis Pub/Sub is not the durable processing backbone. Redis Streams carries
committed work with consumer groups and replay:

```text
telemetry:committed
telemetry:alerts
telemetry:trip-finalization
telemetry:dead-letter
```

Each consumer follows:

1. read through its consumer group;
2. claim a processor idempotency key in PostgreSQL or an output-specific unique
   key;
3. process the event;
4. commit durable output;
5. acknowledge the stream entry;
6. reclaim abandoned pending entries after the visibility timeout;
7. move deterministic poison events to the dead-letter stream after five
   failed attempts, preserving the reason and source identifier.

Redis uses authenticated private networking, a managed high-availability tier,
memory alerts, and an explicit eviction policy. PostgreSQL outbox rows remain
the durability and replay anchor; the design does not assume that Redis alone
can recover committed telemetry after a full service loss. Stream entries may
be trimmed only after PostgreSQL outbox state and consumer lag prove that
required consumers have advanced beyond them.

Processor responsibilities:

- `live-state`: freshness, last valid GPS, collector health, outbox depth, and
  current trip progress;
- `gps-energy`: existing GPS quality gates, validated segments, distance,
  speed, dwell, grade, and provisional physics outputs;
- `imu-rules`: completeness, harsh-motion candidates, orientation changes, and
  sensor-quality events;
- `trip-finalizer`: deterministic final recomputation after all declared trip
  sequences are committed.

Live incremental projections are provisional. Final trip results are computed
again from committed canonical data so retries and out-of-order arrival cannot
change the final answer nondeterministically.

## 14. Trip lifecycle

The mobile and backend share this state machine:

```text
CREATED_LOCAL
    -> START_PENDING
    -> ACTIVE
    -> ENDING
    -> SYNC_PENDING
    -> FINALIZING
    -> COMPLETED

Terminal degraded state: CAPTURE_FAILED
```

### 14.1 Start

1. The driver selects the assigned vehicle and enters starting dashboard SOC.
2. Mobile creates the trip UUID and Room trip record before sensor capture.
3. Mobile sends an idempotent start request when network is available.
4. The native service starts and records windows even if the start request is
   temporarily pending.
5. Backend upserts the client-generated trip ID and validates device/vehicle
   assignment.

Starting SOC remains manually reported dashboard SOC and is never labelled as
BMS telemetry.

### 14.2 End

1. Driver requests end and enters ending dashboard SOC.
2. Native service stops accepting new sensor events.
3. It closes and commits the final partial telemetry window.
4. It records `final_sequence_no` and the end command in Room.
5. It attempts immediate upload, but network loss does not erase the trip.
6. Backend receives an idempotent completion command containing
   `final_sequence_no`.
7. Backend finalizes only when `highest_contiguous_sequence` reaches the final
   sequence and all permanent rejection decisions are known.
8. If data remains local, mobile displays
   `Trip saved - synchronization pending`; it does not report a completed
   calculation.
9. Finalizer runs the existing GPS/physics pipeline and publishes the result.

This replaces the current assumption that the UI must hold an end-trip request
open while repeatedly flushing the entire queue.

## 15. Late, duplicate, missing, and invalid data

Every window is classified independently:

- `LIVE`: recent event time and near the active cursor;
- `LATE`: valid historical data within the trip;
- `BACKFILL`: uploaded from a persisted offline queue;
- `DUPLICATE`: receipt or sequence already committed with identical identity;
- `CONFLICT`: reused identifier or sequence with different immutable content;
- `INVALID`: permanent schema, identity, timestamp, or bounds failure.

Rules:

- duplicates return success;
- conflicts generate a security/data-integrity event and are never overwritten;
- backfill updates historical projections but never replaces a newer live
  vehicle location;
- large time or sequence gaps create visible quality events;
- `highest_contiguous_sequence`, not highest received sequence, controls device
  deletion and trip finalization;
- mock-location status is preserved as evidence and passed through policy; it
  is not silently removed;
- existing GPS gates remain authoritative for physics calculations;
- invalid GPS does not invalidate otherwise useful IMU and collector-health
  fields in the same window.

## 16. Real-time delivery

Clients use a reconnect-safe snapshot-and-delta contract:

```text
GET /api/v2/vehicles/{vehicle_id}/live-state
                 │
                 ▼
WSS /ws/v2/vehicles/{vehicle_id}
```

The snapshot returns `state_version`, source sequence, event time, received
time, freshness, GPS availability, and projection status. Every WebSocket delta
contains the next state version. A version gap or reconnect causes the client to
fetch a fresh snapshot.

Redis Pub/Sub may be used for ephemeral WebSocket fan-out after a consumer has
written the recoverable latest-state hash. Losing a Pub/Sub notification is
acceptable because reconnecting clients recover from the snapshot; losing a
Redis Stream processing event is not acceptable.

UI freshness labels:

| State | Rule |
|---|---|
| `LIVE` | Valid projected state age below 5 seconds |
| `DELAYED` | State age from 5 through 30 seconds |
| `OFFLINE` | State age above 30 seconds and no recent heartbeat |
| `GPS_LOST` | Recent heartbeat exists but no valid GPS fix |
| `SYNCING` | Device reports a non-zero durable outbox backlog |
| `DEGRADED` | Permission, storage, sensor, or collector health prevents full capture |

An open WebSocket alone never makes a vehicle `LIVE`.

## 17. Capacity model

One telemetry window per active vehicle per second produces:

| Concurrent active vehicles | Rows/second | Rows/hour | Rows/day at 24-hour activity |
|---:|---:|---:|---:|
| 2 | 2 | 7,200 | 172,800 |
| 150 | 150 | 540,000 | 12,960,000 |

At the selected two-second live batch interval:

| Concurrent active vehicles | Approximate requests/second | Windows/request |
|---:|---:|---:|
| 2 | 1 | 2 |
| 150 | 75 | 2 |

The 150-vehicle architecture must also tolerate a two-times burst of 300
windows per second and reconnecting backfill without starving live ingestion.
Backfill requests use the same endpoint but separate rate-limit and worker
budgets. Live batches receive scheduling priority; neither path bypasses
idempotency or storage durability.

Raw six-axis IMU at 50 Hz is intentionally excluded from the canonical row
model because its storage and index overhead is far larger than one-second
features. Selected raw windows are compressed and archived as blocks, not
stored as one SQL row per sensor event.

## 18. Security and privacy

- TLS is mandatory for API, WebSocket, PostgreSQL, and Redis connections.
- A registered device has a unique identifier and revocable credential.
- Device credentials are stored in Android Keystore and are not exposed to
  React Native JavaScript storage.
- Device tokens are short-lived and refresh through a bound device identity.
- Claims scope publishing to one fleet and authorized device; the backend also
  verifies current vehicle and trip assignment.
- Cross-fleet identifiers return a non-enumerating response.
- Batch and WebSocket endpoints have per-device and per-user rate limits.
- Sequence and immutable-payload conflict checks provide replay detection.
- Precise location access is role-scoped and audited.
- Logs contain identifiers and sequence numbers but no access tokens or precise
  coordinates.
- Backups are encrypted, restorable, and covered by the same retention policy.
- Device revocation prevents new uploads without deleting already committed
  audit evidence.
- Mock-location and integrity signals are metadata; enforcement is an explicit
  fleet policy rather than a hidden data mutation.

### 18.1 Google OAuth and Trickee sessions

Google authenticates human users; Google OAuth tokens do not directly authorize
telemetry publishing and do not grant access to company Cloud Storage.

Android sign-in uses Credential Manager's Sign in with Google experience. The
mobile app sends the resulting Google ID token over HTTPS to:

```http
POST /api/v2/auth/google
```

The FastAPI backend verifies the token with the maintained Google authentication
library and the configured OAuth web client ID. It must validate signature,
`aud`, `iss`, `exp`, and `nonce`. It stores Google's immutable `sub` claim as the
external identity key; email is profile data and is not the primary key.

Authentication alone never creates fleet access. A verified Google identity
must match an active, pre-provisioned Trickee user and fleet membership. Company
staff roles additionally require an approved Google Workspace `hd` claim.
Driver accounts outside that Workspace can sign in only when their Google `sub`
has been explicitly linked by an authorized fleet administrator. Public
self-signup is disabled for the fleet deployment.

After verification, Trickee issues its own short-lived application access token
and rotating refresh token. Trickee authorization remains responsible for user
role, fleet, vehicle, and location-history permissions. Google ID tokens are not
reused as long-lived API bearer tokens. Mobile stores the Trickee refresh token
using Android Keystore-backed encrypted storage and keeps the access token
short-lived.

Device enrollment is a separate authenticated operation:

1. A signed-in authorized user registers the Android installation.
2. Backend creates a revocable `device_id` bound to the fleet and approved
   vehicle assignment.
3. Android stores the resulting device credential in Android Keystore.
4. Telemetry batches use the device credential, not the human Google ID token.
5. User suspension, device revocation, or vehicle reassignment is enforced on
   every upload.

If the backend later needs to call a Google user-data API, that authorization
uses a separate least-privilege OAuth consent flow. The telemetry design does
not request Google Drive or Cloud Storage user scopes.

### 18.2 Google Cloud workload identity

Cloud Run API, worker, migration, archive, and WebSocket roles each receive a
dedicated Google Cloud service account with only the IAM permissions required
for that role. No static service-account JSON key is stored in Git, a container
image, or mobile configuration.

- API roles can connect to Cloud SQL and read only their required secrets.
- Worker roles can consume Redis work and write derived PostgreSQL state.
- Archive roles can write only the designated Cloud Storage bucket prefixes.
- Migration roles can apply Alembic migrations but do not serve application
  traffic.
- Android clients never receive Google Cloud service-account credentials.

OAuth client secrets, Trickee signing keys, database configuration, and Redis
credentials are stored in Secret Manager and exposed only to the corresponding
runtime identities.

## 19. Failure behavior

| Failure | Required behavior |
|---|---|
| No network | Continue committing canonical windows to Room |
| API unavailable | Retry with jitter; retain all unacknowledged rows |
| Android process killed | Recover active-trip state and Room cursor when Android permits restart |
| Phone rebooted | Preserve trip/outbox, record a gap, and request resume when automatic restart is restricted |
| User force-stops app | Preserve Room data; report the interruption after relaunch |
| GPS unavailable | Continue IMU/health windows with `gps_available=false` |
| IMU sensor absent | Continue GPS/health and mark sensor unavailable |
| Local database full | Stop optional raw IMU first, warn visibly, then enter `CAPTURE_FAILED` rather than silently dropping canonical windows |
| Duplicate upload | Return committed success without duplicate canonical rows |
| Sequence conflict | Quarantine conflict and create integrity alert |
| PostgreSQL unavailable | Reject/backpressure upload; device retains data |
| Redis unavailable | PostgreSQL ingestion continues; server outbox accumulates until relay recovery |
| Google OAuth unavailable | Existing valid Trickee sessions continue until expiry; new sign-ins retry without bypass |
| Google Cloud Storage unavailable | Hot PostgreSQL data remains canonical; archive jobs retry idempotently |
| Consumer crash | Stream entry remains pending and is reclaimed |
| Poison processing event | Move to dead-letter stream after five deterministic failures |
| WebSocket disconnect | Client reconnects and fetches a versioned snapshot |
| Old backlog arrives | Store historically; never overwrite newer live state |
| End requested offline | Persist end command and final sequence; show synchronization pending |

## 20. Observability and service objectives

### 20.1 Metrics

Mobile-reported:

```text
gps_fix_interval_ms
gps_fix_age_ms
imu_events_per_window
telemetry_windows_committed_local_total
telemetry_outbox_pending
telemetry_outbox_oldest_age_seconds
telemetry_upload_attempts_total
telemetry_upload_ack_latency_ms
collector_restart_total
capture_gap_seconds_total
battery_pct_per_tracked_hour
local_storage_bytes
```

Server:

```text
telemetry_batches_received_total
telemetry_windows_received_total
telemetry_windows_committed_total
telemetry_duplicate_total
telemetry_conflict_total
telemetry_rejected_total
telemetry_sequence_gap_total
telemetry_ingest_latency_ms
server_outbox_pending
server_outbox_oldest_age_seconds
redis_stream_consumer_lag
processor_failures_total
vehicle_state_age_seconds
websocket_connections
trip_finalization_latency_seconds
```

Every log and trace carries `fleet_id`, `device_id`, `vehicle_id`, `trip_id`,
`batch_id`, and sequence range when applicable. Logs exclude coordinates and
credentials.

### 20.2 SLOs after the two-vehicle gate

| Objective | Target |
|---|---:|
| Locally committed windows during an active, healthy collector | At least 99.5% of elapsed seconds |
| Data loss after application ACK | Zero by contract |
| Duplicate logical telemetry | Zero |
| Online capture-to-dashboard latency | p95 under 3 seconds; p99 under 5 seconds |
| Ingest availability | At least 99.9% |
| Backfill completion after stable reconnection | Under 5 minutes for a 60-minute backlog |
| Gap visibility | 100% of detected sequence gaps exposed |
| Trip finalization after final sequence commit | p95 under 10 seconds |
| Battery consumption | Below 5% per tracked hour on approved pilot devices |

These objectives apply only while permissions, sensors, storage, and the
foreground collector are healthy. Degraded periods remain visible rather than
being removed from the denominator without explanation.

## 21. Deployment topology

The production environment resides in a dedicated project inside the company's
Google Cloud organization. Development, staging, and production use separate
projects or equally strong organization-enforced isolation. Production data
does not share buckets, databases, service accounts, OAuth credentials, or
secrets with development.

```text
Android devices
      │ HTTPS / WSS
      ▼
Google Cloud external HTTPS load balancing and managed TLS
      │
      ├──> Cloud Run: trickee-api
      └──> Cloud Run: trickee-websocket
                    │
             private Google Cloud networking
          ┌─────────┼──────────────────────┐
          ▼         ▼                      ▼
 Cloud SQL       Memorystore         Secret Manager
 PostgreSQL      for Redis
          │         │
          └────┬────┘
               ▼
 Cloud Run worker services / worker pools
 outbox relay + telemetry processors + archive worker
               │
               ▼
       Cloud Storage private buckets
       telemetry archive + selected raw IMU

Artifact Registry -> versioned container images
Cloud Build or company CI -> tests, migration job, staged deployment
Cloud Logging + Monitoring + Trace + Error Reporting -> observability
```

### 21.1 Selected Google Cloud services

| Requirement | Google Cloud selection | Rules |
|---|---|---|
| API and ingestion | Cloud Run service | Private runtime identity, minimum warm instances for production, bounded concurrency, Direct VPC egress |
| WebSockets | Separate Cloud Run service | Client reconnect is mandatory because Cloud Run WebSockets remain request-timeout-bound |
| Continuous workers | Cloud Run worker service/worker pool with continuous CPU allocation | Never rely on request-only CPU for the outbox relay or stream consumers |
| Scheduled jobs | Cloud Scheduler invoking authenticated Cloud Run jobs | Retention, archive verification, and maintenance only |
| PostgreSQL | Cloud SQL for PostgreSQL in the same region | Private IP, high availability for production, automated backups, point-in-time recovery, connection pooling |
| Redis | Memorystore for Redis | Private networking, high-availability tier, memory/failover alerts; PostgreSQL outbox remains the replay source |
| Archive | Cloud Storage | Uniform bucket-level access, public access prevention, lifecycle rules, versioning only where required |
| Secrets | Secret Manager | Runtime service-account access; no committed or image-baked secrets |
| Images | Artifact Registry | Immutable digest promotion from staging to production |
| Encryption | Google-managed encryption initially; CMEK if company policy requires it | Cloud KMS permissions separated from runtime administration |
| Observability | Cloud Logging, Monitoring, Trace, and Error Reporting | Coordinate-safe structured logs and SLO dashboards |
| User identity | Google Auth Platform OAuth client | Separate Android and backend/web client configuration with production package/signature registration |

Cloud SQL, Memorystore, Cloud Run, and Cloud Storage are placed in the same
approved Google Cloud region unless company residency policy requires a
different layout. Private services are not assigned public application access.

### 21.2 Cloud Storage layout

Cloud Storage is for archives and compressed objects, not the live canonical
one-second database query path.

```text
gs://trickee-prod-telemetry-logical-name/
├── canonical-archive/date=YYYY-MM-DD/fleet=<opaque-id>/part-*.parquet
├── raw-imu/date=YYYY-MM-DD/device=<opaque-id>/trip=<opaque-id>/part-*.pb.zst
├── rejected-quarantine/date=YYYY-MM-DD/reason=<code>/part-*.jsonl.gz
└── restore-manifests/date=YYYY-MM-DD/manifest.json
```

`trickee-prod-telemetry-logical-name` is the architecture name; the globally
unique deployed bucket name comes from reviewed infrastructure configuration,
not application source code.
Object paths use opaque identifiers and never driver email addresses. Bucket
rules include:

- public access prevention and uniform bucket-level access;
- least-privilege prefix-scoped writer roles;
- same-region placement with Cloud SQL where practical;
- retention and lifecycle deletion matching Section 12.3;
- object checksums and a PostgreSQL archive manifest;
- idempotent object names derived from partition/date and content hash;
- archive completion only after object verification and manifest commit;
- restore drills that load archived telemetry into an isolated database;
- no direct public URLs.

Canonical archive jobs read closed PostgreSQL partitions, write compressed
Parquet, verify row count/minimum and maximum sequence/checksum, commit a
manifest, and only then allow hot-partition retirement. Selected raw IMU uses
compressed Protobuf blocks. Android direct-to-bucket upload is disabled for the
two-vehicle release; the backend remains the policy and identity boundary.

### 21.3 Database migrations

The current container starts by running Alembic in every API replica. That is
not retained for Google Cloud production because concurrent application starts
must not race schema changes.

The release pipeline runs one authenticated Cloud Run migration job using the
same immutable image digest before shifting API traffic. A failed migration
halts rollout. API and worker revisions start only after migration success and
must remain backward-compatible with the immediately previous mobile contract.

### 21.4 Two-vehicle field deployment

- Cloud SQL for PostgreSQL with automated backups and point-in-time recovery;
- Memorystore for Redis on private networking;
- `trickee-api` Cloud Run service with two minimum production instances;
- `trickee-websocket` Cloud Run service configured for long requests and client
  reconnection;
- one continuously allocated outbox/processor worker role;
- one archive worker with access only to the telemetry bucket;
- company Google OAuth configuration and pre-provisioned user identities;
- two registered Android devices assigned to two vehicles;
- Cloud Monitoring alerts and a field-release dashboard.

All backend roles use the same versioned image but distinct commands and service
accounts. This keeps deployment simple while preserving later extraction
boundaries.

### 21.5 150-vehicle target deployment

- at least two independently schedulable ingestion instances kept warm;
- at least two WebSocket instances with reconnect-safe cross-instance fan-out;
- consumer-group workers scaled by observed stream lag;
- Cloud SQL high availability, pooling, tested restore, partition automation,
  disk alerts, and measured write headroom;
- Memorystore replication/failover, memory alarms, and measured stream retention;
- Cloud Storage lifecycle and archive verification dashboards;
- autoscaling based on ingest latency, instance concurrency, PostgreSQL pool
  pressure, server-outbox age, Redis lag, and WebSocket freshness;
- rolling revision deployment with backward-compatible contract versions.

Replica counts beyond the minimum are determined by the 150-device load test,
not guessed from CPU count. Cloud Run maximum-instance settings must also cap
aggregate PostgreSQL connections below the configured Cloud SQL pool budget.

## 22. Delivery gates

### Gate 0: Contract and persistence foundation

- Add Google ID-token verification, pre-provisioned identity linking, and
  Trickee session issuance.
- Add registered-device identity and assignment checks.
- Add versioned telemetry schemas and server tables.
- Implement transactional receipt, canonical insert, cursor, and server outbox.
- Implement application ACK and retry classification.
- Preserve the existing GPS endpoint during transition.
- Provision staging Cloud SQL, Memorystore, private Cloud Storage, Secret
  Manager, and dedicated workload service accounts through reviewed
  infrastructure-as-code.

Exit evidence: PostgreSQL integration tests prove duplicate, gap, conflict,
rollback, authorization, and ACK behavior.

### Gate 1: Two concurrent vehicles for complete trips

- Ship Kotlin foreground capture, Room outbox, one-second window builder, and
  HTTPS uploader to two registered Android devices.
- Enable the outbox relay, live-state, GPS/energy, IMU/rule, trip-finalizer, and
  WebSocket process roles needed for the complete real-time path.
- Run both vehicles concurrently from explicit trip start through explicit end.
- Include screen-off operation, temporary network loss, API restart, app process
  recreation, GPS loss, and backlog recovery.
- Verify final sequence acknowledgement before authoritative trip finalization.
- Compare Room sequence counts, PostgreSQL receipts, canonical windows, gaps,
  and final trip results.
- Measure battery, storage, data usage, actual GPS cadence, IMU completeness,
  and capture-to-dashboard latency.
- Verify Google sign-in, session refresh, device enrollment, user suspension,
  and device revocation on both pilot devices.

Exit evidence: both trips meet the SLOs, every discrepancy is explained by a
recorded gap/rejection, and no acknowledged window is lost.

### Gate 2: Real-time processors and operator recovery

- Harden every Redis consumer with independent scaling and idempotency evidence.
- Add pending-entry reclaim, dead-letter inspection/replay, and runbook-driven
  operator recovery.
- Prove Redis outage recovery, Cloud Run revision replacement, pending-entry
  reclaim, dead-letter handling, and dashboard snapshot recovery.

Exit evidence: processor restarts and Redis interruption do not lose committed
telemetry or produce duplicate durable outputs.

### Gate 3: 150-vehicle capacity certification

- Replay realistic one-second windows from 150 device identities for at least
  60 minutes.
- Add a 15-minute burst at 300 windows per second.
- Reconnect 30 simulated devices with 60-minute backlogs while 120 devices
  remain live.
- Measure API latency, PostgreSQL write latency, connection-pool saturation,
  outbox age, stream lag, WebSocket freshness, CPU, memory, disk, and Redis
  memory.
- Run database backup/restore and one-instance rolling failure during load.

Exit evidence: all SLOs hold, no committed data is lost, no live device starves
behind backfill, and measured capacity retains at least 50% headroom at 150
live devices.

### Gate 4: Controlled fleet rollout

- Expand in cohorts of 10, 25, 50, 100, and 150 active vehicles.
- Hold each cohort until capture completeness, backlog age, battery drain,
  rejection rate, and support incidents remain within thresholds for three
  consecutive operating days.
- Roll back the cohort without changing the server contract if thresholds fail.

## 23. Testing strategy

### Android

- Credential Manager success, cancellation, missing-account, and reauthentication
  tests.
- Window-boundary tests using deterministic monotonic timestamps.
- Room transaction tests proving cursor and payload are atomic.
- Process-death and service-recreation tests.
- Concurrent capture/upload tests proving one uploader and ordered sequences.
- Network-off, network-flap, token-expiry, and server-rejection tests.
- Storage-pressure and acknowledged-row cleanup tests.
- Missing GPS, stale fix, absent IMU, sensor-rate variation, and reboot tests.
- Physical screen-off trips on every approved pilot phone model.

### Backend

- Google ID-token tests for invalid signature, audience, issuer, expiry, nonce,
  hosted domain, unlinked subject, suspended user, and role/fleet mapping.
- Pydantic contract and payload-boundary tests.
- Device, fleet, vehicle, and trip authorization tests.
- PostgreSQL transaction tests with forced failures at each insert step.
- Duplicate and immutable-conflict tests.
- Out-of-order and contiguous-cursor property tests.
- Daily-partition boundary and retention tests.
- Outbox relay crash/restart and `SKIP LOCKED` concurrency tests.
- Redis pending-entry reclaim, idempotent consumer, and dead-letter tests.
- Finalizer tests proving live and final projections use the same committed
  inputs and provenance rules.

### End to end

- Google sign-in, Trickee session refresh, device enrollment, revocation, and
  re-enrollment.
- Two real devices and two vehicles active simultaneously for complete trips.
- Network loss for 15 minutes followed by recovery.
- API and worker restart during active capture.
- GPS loss with continued IMU windows.
- WebSocket disconnect and snapshot recovery.
- Offline trip end followed by later synchronization and finalization.
- Cloud Storage archive checksum/manifest verification and isolated restore.
- IAM negative tests proving API, worker, archive, and migration service accounts
  cannot perform one another's privileged operations.
- 150-device and 300-window-per-second synthetic load tests.

## 24. Battle-tested architecture decisions

| Decision | Selected choice | Reason |
|---|---|---|
| Cloud platform | Company's Google Cloud organization | Centralizes IAM, managed data services, audit, and billing policy |
| Human sign-in | Credential Manager Sign in with Google | Current Android-native Google identity flow |
| Application authorization | Trickee access/refresh session after Google ID-token verification | Google identity does not encode fleet, vehicle, or product permissions |
| Telemetry authentication | Separate revocable device credential | Continuous ingestion must not depend on an interactive human OAuth token |
| Production mobile platform | Android first | Strongest practical foreground-trip capture controls |
| Capture owner | Kotlin foreground service | React Native JavaScript lifecycle is not a reliable continuous collector |
| GPS model | Requested 1 Hz, measured actual cadence | A request interval is not a delivery guarantee |
| IMU model | 50 Hz native events summarized every second | Preserves driving signal without a row-per-event explosion |
| Missing GPS | Explicit unavailable window | Prevents fabricated stationary points and corrupt routes |
| Mobile persistence | Room/SQLite WAL | Transactional durability across network and process failures |
| Mobile deletion rule | Application ACK plus 24-hour safety window | Transport success alone does not prove durable server storage |
| Delivery semantics | At least once physically, exactly once logically | Achievable through durable retry and deterministic idempotency |
| Initial transport | Versioned HTTPS batches | Fits current FastAPI stack and handles live plus backfill |
| Wire format | Versioned JSON with gzip | Lowest migration risk; Protobuf requires measured justification |
| Canonical store | PostgreSQL | Existing relational system of record and sufficient target write rate |
| Time-series layout | Native daily range partitions | Avoids an extension dependency before production evidence |
| Server consistency | Transactional outbox | Removes database/stream dual-write loss |
| Durable work queue | Redis Streams | Consumer groups, replay, and pending recovery fit 150 vehicles |
| WebSocket fan-out | Redis Pub/Sub after recoverable projection | Ephemeral delivery is safe when clients can refetch snapshots |
| Processing | Independent idempotent consumers | Isolates slow or failing calculations from ingestion |
| Final results | Recompute from committed canonical windows | Produces deterministic results despite retries and late data |
| Latest state | Redis hash plus versioned snapshot | Fast reads with a recoverable client contract |
| Raw IMU | Selected, compressed, 24-hour maximum | Controls cost and privacy while supporting targeted ML collection |
| Cloud archive | Private Cloud Storage with verified manifests | Durable lifecycle-managed storage without burdening the live query database |
| Google Cloud access | Dedicated service accounts and Secret Manager | Prevents user tokens and static keys from becoming infrastructure credentials |
| MQTT | Deferred behind evidence gate | Does not remove outbox, idempotency, or ACK requirements |
| Kafka | Not selected | Unnecessary operational weight at 150 windows per second |
| TimescaleDB | Deferred behind query/storage evidence | PostgreSQL partitions are adequate for the initial target |
| Deployment shape | Modular monolith, separate process roles | Preserves current codebase and future extraction boundaries |

## 25. Acceptance criteria

The design is implemented successfully when:

1. Two Android devices can capture two complete concurrent vehicle trips with
   the screen off where Android permits the active foreground service.
2. Every elapsed active-trip second produces a locally committed canonical
   window or a visible collector/storage failure.
3. Missing GPS periods never create duplicated or synthetic coordinates.
4. Actual IMU counts and completeness are stored for every window.
5. Process death and temporary network loss do not remove unacknowledged data.
6. The backend acknowledges only committed PostgreSQL transactions.
7. Duplicate retries produce one logical canonical record.
8. Sequence gaps remain visible and prevent premature trip finalization.
9. Redis or worker failure does not prevent durable PostgreSQL ingestion.
10. Live dashboards recover through a versioned snapshot after WebSocket loss.
11. Final trip calculations use only committed, quality-gated telemetry and
    retain confidence, source, estimated status, uncertainty, and provenance.
12. Manual dashboard SOC remains clearly distinct from BMS telemetry.
13. The two-vehicle field gate meets the stated latency, durability, battery,
    storage, and recovery objectives.
14. The 150-device certification sustains 150 windows per second plus the
    specified burst and reconnect tests with at least 50% measured headroom.
15. Authentication, fleet isolation, location-access audit, retention,
    backup/restore, and device revocation tests pass with fresh evidence.
16. Google ID tokens are verified server-side and only pre-provisioned Trickee
    users receive application sessions.
17. Google OAuth user tokens are never used as Cloud Storage or telemetry-device
    credentials.
18. Cloud Storage archive manifests prove counts, sequence bounds, checksum,
    retention, and restore behavior before PostgreSQL partitions are retired.

## 26. Repository impact map

Expected implementation areas:

```text
mobile/android/app/src/main/java/com/trickeeandroid/telemetry/
mobile/android/app/src/main/java/com/trickeeandroid/auth/
mobile/android/app/src/main/AndroidManifest.xml
mobile/android/app/build.gradle
mobile/src/services/googleAuthNative.ts
mobile/src/services/telemetryNative.ts
mobile/src/context/LiveDataContext.tsx
mobile/src/services/api.ts
mobile/src/services/types.ts

backend/app/config.py
backend/app/main.py
backend/app/models/entities.py
backend/app/routers/auth.py
backend/app/services/google_identity.py
backend/app/telemetry/
backend/app/streams/
backend/app/processors/
backend/app/realtime/
backend/alembic/versions/
backend/tests/

docker-compose.yml
infra/gcp/
DEVELOPER_HANDOFF.md
```

The implementation must use forward-only Alembic migrations. It must not edit
the existing `0001_gps_first` migration after it has been applied.

## 27. Primary platform references

- Android foreground-service types:
  <https://developer.android.com/develop/background-work/services/fgs/service-types#location>
- Android sensor timestamps and event delivery:
  <https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview>
- Android Room persistence library:
  <https://developer.android.com/training/data-storage/room>
- PostgreSQL table partitioning:
  <https://www.postgresql.org/docs/current/ddl-partitioning.html>
- Redis Streams:
  <https://redis.io/docs/latest/develop/data-types/streams/>
- FastAPI WebSockets:
  <https://fastapi.tiangolo.com/advanced/websockets/>
- Credential Manager Sign in with Google:
  <https://developer.android.com/identity/sign-in/credential-manager-siwg>
- Google ID-token backend verification:
  <https://developers.google.com/identity/sign-in/android/backend-auth>
- Cloud Run WebSockets:
  <https://cloud.google.com/run/docs/triggering/websockets>
- Connecting Cloud Run to Cloud SQL for PostgreSQL:
  <https://cloud.google.com/sql/docs/postgres/connect-run>
- Memorystore for Redis:
  <https://cloud.google.com/memorystore/docs/redis/memorystore-for-redis-overview>
- Cloud Storage:
  <https://cloud.google.com/storage/docs>
- Secret Manager:
  <https://cloud.google.com/secret-manager/docs/overview>
