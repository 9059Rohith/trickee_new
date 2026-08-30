# GPS Driver Live Pilot Release Hardening Design

**Date:** 2026-08-30
**Status:** Approved; implementation pending
**Release target:** Android `1.0.3` (`versionCode 4`) for Google Play internal testing

## 1. Objective

Produce a signed Android App Bundle for a real internal pilot that captures a
continuous, auditable trip record, survives normal Android and network
interruptions, and does not misrepresent estimates as vehicle measurements.

The pilot account is `rhythm@trickee.co.in`, provisioned as a driver rather
than an administrator. The assigned vehicle is a non-PII pilot record for a
standard 2023 OLA S1. Registration number, chassis number, engine number,
owner name, and address are not stored.

No software process can guarantee zero defects or guarantee that Android will
produce a fresh satellite fix at every exact one-second boundary. Release
readiness therefore means that all defined automated gates pass, every GPS fix
provided by Android is handled correctly, missing fixes are represented
honestly, and the Play-installed build passes the physical-device pilot
checklist.

## 2. What Breaks First

The first failure is telemetry integrity, not Play distribution:

1. The current location callback consumes only the last fix in a potentially
   batched callback, which can discard intermediate seconds.
2. Trip stop can return a final sequence before the collector commits its last
   window, creating a stale completion boundary.
3. Pending local telemetry has no enforced storage-pressure lifecycle, so a
   long offline period can exhaust device storage.
4. IMU samples are grouped by callback time instead of sensor event time,
   weakening alignment between motion and GPS.
5. A model trained on `route_energy_wh` would learn from its own prediction,
   not from ground truth.

These failures are fixed before store-listing polish or model expansion.

## 3. Vehicle Profile

The pilot profile uses only model-level specifications supported by the
provided document and historical manufacturer material:

| Field | Value |
| --- | --- |
| Vehicle code | `OLA-S1-PILOT-01` |
| Make | OLA Electric |
| Model | S1 |
| Variant | Standard S1, exact sub-variant unconfirmed |
| Model year | 2023 |
| Category | `2W_passenger` |
| Rated/usable battery snapshot | 2.98 kWh for pilot calculations |
| Battery chemistry | Lithium-ion; cell chemistry not assumed |
| Kerb weight | 121 kg |
| Peak motor power | 8.5 kW |
| Top speed | 95 km/h |
| Certified range | 141 km |
| Regenerative braking | Available |

Unknown electrical fields such as nominal voltage remain null. Vehicle
completeness is evaluated against fields actually required by the physics
model; optional electrical metadata must not falsely block GPS-first
predictions. Prediction provenance records the vehicle-profile version and
the 2.98 kWh capacity snapshot.

## 4. Collection Architecture

```text
Fused location + Android sensors
              |
              v
Event-time native aggregators
  - all LocationResult locations
  - accelerometer and gyroscope events
              |
              v
Monotonic one-second windows with bounded lateness
              |
              v
Atomic Room trip + outbox transaction
              |
       +------+------+
       |             |
       v             v
Immediate upload   Network-constrained WorkManager backfill
       |             |
       +------+------+
              v
Idempotent backend receipt and contiguous ACK cursor
              |
              v
Live projection, finalization, archive, and derived features
```

### 4.1 GPS behavior

- Request high-accuracy location with a one-second desired interval and no
  intentional batching.
- Iterate over every location in `LocationResult.locations`.
- Assign fixes to windows using the provider monotonic timestamp, not callback
  arrival time.
- Hold a bounded two-second event-time grace period so a delayed callback can
  populate its correct window.
- Select the best fix in each second using freshness first and horizontal
  accuracy second. Do not fabricate or interpolate coordinates.
- Emit one window for every elapsed trip second. A second without a valid fix
  has `gps_available=false` and a null GPS payload.
- Preserve provider time, fix age, accuracy, altitude, speed, bearing,
  provider, and mock-location status.
- Flush all buffered windows during a controlled stop before sealing the trip.

This produces a continuous one-second timeline while remaining honest about
Android and satellite availability.

### 4.2 IMU behavior

- Continue collecting accelerometer and gyroscope events at the requested
  50 Hz rate where supported.
- Assign samples to the same monotonic event-time windows as GPS.
- Store per-second counts, completeness, axis statistics, magnitude, jerk,
  sensor presence, and accuracy.
- Do not label device-axis acceleration as vehicle longitudinal acceleration.
- Do not add magnetometer, barometer, raw audio, or inferred BMS fields in this
  release.

### 4.3 Atomic trip stop

Trip stop becomes a native seal operation:

1. Move the local trip from `ACTIVE` to `ENDING`.
2. Stop accepting new sensor callbacks.
3. Flush all complete and final partial windows in one Room transaction.
4. Persist the actual `final_sequence_no` and move to `SYNC_PENDING`.
5. Return that persisted sequence to React Native.
6. Ask the backend to finalize only through that exact sequence.
7. Mark the trip complete only after the backend contiguous ACK reaches the
   final sequence and finalization succeeds.

Repeated stop requests use the same completion idempotency key and return the
same result.

## 5. Database Design

### 5.1 Per-second telemetry fact

`telemetry_windows` remains the canonical server fact table:

- Identity: `sample_id`, `device_id`, `trip_id`, `vehicle_id`, `sequence_no`,
  `boot_id`.
- Time: `event_time`, `monotonic_time_ns`, `window_duration_ms`,
  `received_at`.
- GPS projection: `gps_available`, `latitude`, `longitude`.
- Payloads: `gps_payload`, `imu_payload`, `health_payload`, `raw_payload`.

The typed payload contract remains strict. Unknown fields are rejected rather
than silently accepted. Raw payload is retained for audit and replay; common
location fields stay projected into columns for live and operational queries.

### 5.2 Trip energy labels

A new `trip_energy_labels` table separates measurements from predictions:

| Column | Purpose |
| --- | --- |
| `id` | Stable primary key |
| `trip_id` | Unique trip foreign key |
| `starting_soc_pct` | Start dashboard/OEM/BMS SOC |
| `ending_soc_pct` | End dashboard/OEM/BMS SOC |
| `soc_delta_pct` | Validated non-negative SOC change |
| `usable_kwh_snapshot` | Capacity used when the label was calculated |
| `actual_energy_consumed_wh` | Energy label before distance normalization |
| `actual_wh_per_km` | Primary supervised-learning target |
| `label_source` | `manual_dashboard`, `oem_api`, `bluetooth_bms`, or `fleet_export` |
| `label_confidence` | Numeric confidence in `[0,1]` |
| `is_training_eligible` | Explicit admission to training datasets |
| `eligibility_reason` | Reason for inclusion or exclusion |
| `captured_at` | Time the ending SOC or energy evidence was captured |
| `created_at`, `updated_at` | Database audit timestamps |

`actual_wh_per_km` is the primary target because total trip energy scales with
distance. `route_energy_wh`, `wh_per_km`, and `soc_consumed_pct` in
`trip_predictions` remain outputs and are never used as ground truth.

For this GPS-only pilot, dashboard SOC is a silver-quality label. It becomes
training-eligible only when all conditions hold:

- start and end SOC are present and the end value does not exceed the start;
- SOC decreases by at least five percentage points;
- validated trip distance is at least 10 km;
- no charging event occurs during the trip;
- GPS sequence completeness and quality pass the trip gate;
- calculated values fall within configured physical bounds.

Otherwise the label is retained for analysis with
`is_training_eligible=false`. OEM, Bluetooth BMS, or fleet-export labels can
use a higher confidence policy after their provenance is verified.

### 5.3 Derived features and predictions

`trip_features` remains the curated input layer: distance, duration, average
and maximum speed, stops, dwell, grade, traction-demand proxy, and
regen-opportunity proxy. `trip_predictions` remains the versioned output layer
with confidence, uncertainty, source, estimated flag, and provenance.

## 6. Offline Storage and Upload Recovery

- Room remains write-ahead logged and is the source of truth until server ACK.
- Purge ACKed records first; never purge pending or in-flight trip data merely
  because it is old.
- Reset expired upload leases after process death.
- Immediate upload runs during an active online trip.
- WorkManager uses a connected-network constraint and unique work per trip.
- Backfill is scheduled during collection, at stop, and after app restart.
- Storage-pressure thresholds are based on both database size and available
  filesystem space.
- At warning pressure, purge ACKed rows and surface a health warning.
- At critical pressure, block starting a new trip until space is recovered;
  an active trip continues core GPS/timing capture and records any reduction
  of optional payload explicitly.

## 7. Identity and Provisioning

- Reuse the existing intended pilot fleet when it can be identified safely;
  otherwise create a non-production `Trickee GPS Pilot` fleet.
- Upsert `rhythm@trickee.co.in` idempotently as role `driver` with no local
  password and no administrator privileges.
- Assign exactly one active vehicle, `OLA-S1-PILOT-01`.
- Do not persist registration-document PII.
- Google subject binding occurs only after a successful verified Google login.
- Provisioning input stays private and is never committed.

## 8. Security and Privacy

- Preserve HTTPS-only API and WebSocket origins.
- Keep device refresh credentials encrypted by Android Keystore.
- Do not log tokens, precise coordinates, signing passwords, or registration
  identifiers.
- Keep release signing material outside the GPS Driver repository and inject
  it through external Gradle properties.
- Preserve least-privilege driver authorization and fleet/vehicle ownership
  checks on every backend operation.
- Retain precise telemetry according to the deployed 90-day policy and archive
  controls; do not widen retention silently.
- The manifest must not request microphone, advertising ID, or background
  location permission.

## 9. Release and Signing

- Preserve package `com.trickee.gpsdriverapp` and the deployed public API and
  WebSocket URLs.
- Build `1.0.3` with `versionCode 4` and target SDK 36.
- Sign with the company replacement upload key whose SHA-1 is
  `1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A`.
- Fail the release build when signing inputs are missing or the observed
  fingerprint differs.
- Do not copy the keystore or signing properties into this repository.
- Produce the AAB, SHA-256 checksum, signing report, manifest/permission report,
  and test evidence in a private release-artifact directory.
- The user has confirmed that Play Console has accepted the replacement key
  and is ready for this bundle.

## 10. Error Handling and Observability

- A rejected window records a stable rejection code and cannot advance the
  contiguous ACK cursor.
- Duplicate `sample_id` or device/trip/sequence tuples are idempotent when the
  payload hash matches and are rejected on hash conflict.
- Missing ranges remain visible until backfilled.
- Permanent validation errors are shown as capture/upload health failures;
  they are not retried forever.
- Transient network and server errors use bounded exponential backoff with
  jitter.
- Metrics never use user, vehicle, trip, device, or coordinate labels.
- Release evidence includes counts for expected seconds, stored windows,
  explicit GPS gaps, uploaded windows, duplicate windows, rejected windows,
  and the final contiguous sequence.

## 11. Test Strategy

Implementation follows red-green-refactor for each behavior.

### Native Android

- Batched locations populate their correct one-second event-time windows.
- Out-of-order and delayed locations respect the bounded lateness policy.
- Missing seconds produce explicit GPS-unavailable windows.
- IMU events use sensor timestamps and report completeness accurately.
- Stop flushes the final window and returns the persisted final sequence.
- Repeated stop and restart recovery are idempotent.
- ACKed rows purge before pending rows; storage pressure cannot silently delete
  unsent core telemetry.
- WorkManager requires network and recovers pending uploads.

### Backend

- Migration upgrade and downgrade preserve existing trip data.
- Energy labels enforce one row per trip and valid percentages.
- Predictions cannot be written as labels.
- Manual dashboard labels meet or fail training eligibility deterministically.
- Telemetry duplicate, conflict, gap, finalization, authorization, and
  provisioning tests pass.

### Mobile and release

- Jest, TypeScript, ESLint, backend pytest, Android JVM tests, Android lint, and
  `bundleRelease` pass from a clean invocation.
- A release APK derived from the same source installs and launches on Android
  14 or later for smoke verification.
- The AAB reports the expected package, version, target SDK, signer, and
  permissions.
- Live endpoints and public privacy, terms, and support URLs return success.

## 12. Pilot Acceptance Gates

The bundle is eligible for Play internal testing only when:

1. All automated test and static-analysis commands exit successfully with no
   unresolved errors.
2. The signed AAB passes package, version, SDK, signature, certificate, and
   permission checks.
3. The pilot user and vehicle are confirmed in the intended live database.
4. A Play-installed physical-device test proves Google Sign-In, trip start,
   persistent foreground notification, screen-off capture, temporary network
   loss, upload recovery, trip stop, and finalization.
5. Telemetry evidence reconciles elapsed trip seconds with stored windows and
   explicit GPS gaps; no missing second is silently hidden.
6. The physical-device test records phone model, Android version, battery
   impact, GPS completeness, and any OEM battery-optimization setting required.

The AAB can be produced after automated gates pass. Final physical-road-test
certification necessarily occurs after the Play-processed build is installed
on the tester's phone.

## 13. Rollout and Rollback

- Release only to the Play internal-testing track.
- Keep the current active internal release available for rollback.
- Use a new version code rather than replacing an artifact.
- Stop rollout if authentication, foreground-service continuity, telemetry
  reconciliation, or finalization fails.
- Server changes remain backward compatible with schema-version 1 telemetry
  during the pilot.
- Database migration rollback removes only the new label table and never
  alters existing telemetry rows.

## 14. Non-Goals

- Direct OLA BMS integration or reverse engineering.
- Guaranteed satellite fixes when Android or the environment supplies none.
- Raw 50 Hz IMU retention on the server.
- Automatic production rollout.
- Training or deploying a learned model from a single vehicle's pilot data.
- Adding new sensors or unrelated UI features.
