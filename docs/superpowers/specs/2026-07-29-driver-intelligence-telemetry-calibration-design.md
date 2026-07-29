# Driver Intelligence and Telemetry Calibration Design

Date: 2026-07-29

Status: Awaiting written-spec review

Repository: `9059Rohith/trickee_new`

## 1. Purpose

This design adds four connected capabilities to Trickee without weakening its
GPS-first safety rules:

1. Driver-editable vehicle specification lookup with source evidence and
   explicit confirmation.
2. Live idle detection that understands confirmed restaurant and
   order-collection waiting.
3. Route, range, and end-trip performance reporting with defensible baselines.
4. Reproducible validation of the GPS physics model against Evify telemetry.

The work is divided into four independently releasable phases. Each phase must
remain useful and testable if later phases are delayed.

## 2. Existing baseline

The current repository already provides:

- React Native foreground GPS collection at a requested 1,000 ms interval and
  500 ms fastest interval.
- Durable GPS queuing and a complete final flush before end-trip calculation.
- FastAPI endpoints for vehicle creation and specification updates.
- A vehicle specification form with manual add/edit behavior.
- GPS quality filtering, distance, speed, acceleration, dwell, grade proxies,
  physics energy, Wh/km, SOC consumption, and range estimates.
- Manual starting and ending dashboard SOC.
- A result overlay and fleet-owner summary.

The current vehicle endpoints are insufficiently scoped: an authenticated user
can list or update vehicles outside their fleet. Phase 1 must correct this
before expanding driver editing.

## 3. Non-negotiable constraints

1. Never fabricate BMS, SOC, SOH, current, voltage, temperature, or energy.
2. Keep source, confidence, estimated status, units, and provenance with every
   derived value.
3. Never accept internet vehicle specifications without driver confirmation.
4. The driver can edit the selected vehicle, variant, and destination purpose.
5. The application may recommend ending a trip but must never end it
   automatically.
6. Remaining range requires recent SOC, usable battery capacity, and valid
   Wh/km.
7. Energy or money savings require a qualifying historical baseline.
8. "Saved using Trickee" additionally requires a recorded, accepted Trickee
   intervention; otherwise the copy must say "versus historical baseline."
9. Synthetic one-second GPS is evaluation data, not reconstructed ground
   truth.
10. Raw telemetry datasets and precise coordinates remain outside Git.
11. Foreground-only GPS remains the product policy for this implementation.

## 4. Delivery phases

### Phase 1: Vehicle specification resolution and authorization

Deliver trusted vehicle lookup, driver confirmation, permanent edit access,
source provenance, and fleet/assignment authorization.

### Phase 2: Destination and idle intelligence

Deliver dual destination classification, a five-minute idle state machine,
expected-wait suppression, and driver-controlled trip continuation or ending.

### Phase 3: Route and performance intelligence

Deliver route energy and arrival-SOC predictions plus end-trip moving, waiting,
energy, range, baseline, money, and charge-time comparisons.

### Phase 4: Telemetry evaluation and calibration

Deliver reproducible dataset adapters, direct-versus-synthetic comparisons,
per-vehicle validation, and guarded calibration promotion.

## 5. Phase 1 design: vehicle specification resolution

### 5.1 Driver flow

1. The driver opens the assigned vehicle and always sees `Edit vehicle`.
2. The driver enters make/model text such as `Ather 450X`.
3. The mobile app requests server-side suggestions after at least three
   characters and 400 ms without further typing.
4. The server returns zero or more exact candidates containing make, model,
   variant, category, required physics fields, source URLs, retrieval time, and
   confidence.
5. The driver selects a candidate and reviews every populated field.
6. The driver may edit any suggested value. Edited values are marked
   `driver_edited` rather than attributed to the source.
7. The driver explicitly confirms before the vehicle is updated.
8. An uncertain or empty match leaves the form editable and does not save
   inferred specifications.

### 5.2 Source policy

The backend owns a `VehicleSpecProvider` interface. Its first implementation
uses a curated catalog whose entries are derived from official manufacturer
specification pages. Each entry requires:

- canonical make, model, and variant;
- vehicle category;
- usable battery kWh or an explicit distinction from nominal battery kWh;
- motor kW, kerb weight, top speed, certified range, and regen availability;
- source URL and retrieval timestamp;
- field-level source notes when multiple official pages are required.

Official manufacturer sources are preferred. A secondary source may be shown
only when the official source omits a field, and the candidate confidence must
be reduced. General search snippets are never silently converted into saved
specifications.

### 5.3 Persistence

Create `vehicle_spec_evidence` with:

- `id`, `vehicle_id`, `provider`, `query_text`;
- `matched_make`, `matched_model`, `matched_variant`;
- `candidate_payload` containing normalized values and units;
- `source_urls`, `retrieved_at`, `confidence`;
- `confirmed_by_user_id`, `confirmed_at`;
- `driver_edits` containing old/new values;
- `created_at`.

The current `vehicles` columns remain the active specification values. Evidence
is append-only so a specification update never erases its provenance.

### 5.4 Authorization

- Owners and fleet administrators can manage active vehicles in their fleet.
- Drivers can view all vehicles in their fleet but can update only their
  assigned active vehicle.
- Every vehicle read/update query includes fleet scope.
- A cross-fleet identifier returns `404`, not a revealing authorization error.

### 5.5 API contracts

- `GET /api/v1/vehicles/spec-suggestions?q=<text>` returns candidates and
  evidence without changing state.
- `POST /api/v1/vehicles/{vehicle_id}/spec-confirmations` accepts a selected
  candidate, explicit edits, and a confirmation flag.
- `PATCH /api/v1/vehicles/{vehicle_id}/specs` remains available for manual
  edits but records `driver_edited` evidence.

## 6. Phase 2 design: destination and idle intelligence

### 6.1 Dual destination classification

At trip start the driver supplies:

- destination text and coordinates;
- one purpose: `delivery`, `restaurant`, `order_collection`, `charging`,
  `personal`, or `other`;
- explicit confirmation.

The backend independently classifies the coordinates through a
`PlaceClassificationProvider`. The initial provider uses OpenStreetMap
Nominatim through the backend with a descriptive User-Agent, response caching,
rate limiting, and no direct mobile calls.

The trip stores:

- `driver_destination_purpose`;
- `app_destination_purpose` and raw place types;
- `confirmed_destination_purpose`;
- `destination_confirmed_by_driver`;
- provider, source response timestamp, and confidence.

When classifications disagree, the app explains the mismatch and suggests a
purpose. The driver selects the final value and may edit it during the trip.

### 6.2 Idle state machine

Idle detection runs on-device so it does not depend on batch upload timing.
It consumes only accepted foreground GPS points.

States:

- `moving`;
- `candidate_idle`;
- `expected_wait`;
- `prompted`;
- `continued`.

Thresholds:

- Candidate idle begins when selected speed is below 0.5 m/s and displacement
  remains within 30 metres.
- An idle episode becomes actionable after five continuous minutes.
- The driver is at the destination when Haversine distance is at most 100
  metres.
- `restaurant` and `order_collection` are expected waits only when the driver
  is at the confirmed destination.
- An expected wait shows a quiet `Expected destination wait - trip continues`
  status and no end-trip prompt.
- All other actionable idle episodes show `Continue trip`, `End trip`, and
  `Edit destination`.
- Selecting `Continue trip` suppresses repeated prompts for the same episode.
- An episode resets after speed exceeds 1.0 m/s or displacement exceeds 50
  metres continuously for 30 seconds.

GPS accuracy worse than 50 metres cannot start or extend an idle episode.
Without a confirmed destination, the normal five-minute prompt applies.

### 6.3 Idle persistence

Create `trip_idle_events` containing:

- trip and vehicle identifiers;
- start/end timestamps and coordinates;
- duration and maximum displacement;
- destination distance and confirmed purpose;
- classification: `expected_wait`, `unplanned_idle`, or `unknown`;
- prompt time and driver response;
- source and confidence.

Offline responses are queued and uploaded idempotently. The trip continues if
upload fails.

## 7. GPS cadence policy

- Keep requested collection at `interval: 1000` and `fastestInterval: 500`.
- Keep `distanceFilter: 0` while a trip is active.
- Collection cadence and network synchronization cadence remain separate.
- Capture observed timestamp deltas because Android may deliver less often than
  requested.
- Measure device battery drain, accepted-point rate, rejected-point rate, and
  upload volume during real road tests.
- Do not request sub-500 ms GPS until testing shows a material accuracy benefit
  and less than 5% device battery consumption per tracked hour.

## 8. Phase 3 design: route and range prediction

### 8.1 Route provider

Create a backend `RouteProvider` interface. The initial implementation uses a
configurable OSRM-compatible endpoint and returns route geometry, distance,
and expected duration. Provider failure leaves route prediction unavailable;
it never falls back to straight-line distance while labelling it a route.

### 8.2 Efficiency selection

Select Wh/km in this order:

1. Median of the latest 20 valid trips for the confirmed vehicle when at least
   five exist.
2. The vehicle-specific calibrated physics model when its release gate passes.
3. The uncalibrated vehicle-spec physics baseline.

Every selection records source trips, formula version, parameters, confidence,
and whether assumptions were used.

### 8.3 Prediction formulas

```text
route_energy_wh = route_distance_km * selected_wh_per_km

arrival_soc_pct = current_soc_pct
                  - route_energy_wh / (usable_kwh * 1000) * 100

remaining_energy_wh = usable_kwh * 1000 * current_soc_pct / 100

remaining_range_km = remaining_energy_wh / selected_wh_per_km
```

Arrival SOC and remaining range are unavailable without recent SOC. Range
retains the existing SOC-adjusted certified-range cap. Negative arrival SOC is
displayed as an insufficient-range warning, not as a valid negative battery
percentage.

The response includes route distance, route duration, energy, arrival SOC,
remaining range, confidence, source, assumptions, and calculation timestamp.

## 9. Phase 3 design: end-trip performance

### 9.1 Direct trip metrics

The result screen includes:

- total trip duration from start/end timestamps;
- moving time from validated segments at or above 0.5 m/s;
- planned waiting time from `expected_wait` events;
- unplanned idle time from other validated dwell;
- validated GPS distance and sample/rejection counts;
- route energy, Wh/km, SOC delta, and range;
- confidence, estimated status, source, and provenance.

### 9.2 Historical route baseline

A comparable historical trip must use the same confirmed vehicle, have origin
and destination within 250 metres of the current trip, have distance within
20%, and pass GPS quality gates. At least five comparable completed trips are
required.

The baseline is the median of their energy, duration, Wh/km, and arrival SOC.
The response includes the number and identifiers of baseline trips.

```text
energy_delta_wh = baseline_energy_wh - current_energy_wh
duration_delta_min = baseline_duration_min - current_duration_min
```

A positive energy delta is labelled `energy saved versus historical baseline`.
A negative value is labelled `additional energy used`. The value is not
attributed to Trickee unless the trip records an accepted Trickee route or
driving recommendation before the relevant behavior changed.

### 9.3 Money comparison

```text
money_delta = energy_delta_wh / 1000 * electricity_rate_per_kwh
```

Money comparison requires a fleet-configured electricity rate with currency,
effective date, and source. Missing price makes money comparison unavailable.
Negative savings are displayed as additional estimated cost.

### 9.4 Charging-time comparison

```text
required_charge_kwh = max(0, target_soc_pct - arrival_soc_pct)
                      / 100 * usable_kwh

charge_time_hours = required_charge_kwh
                    / (charger_power_kw * charger_efficiency)
```

The calculation requires target SOC, charger power, charger efficiency, usable
battery capacity, and estimated arrival SOC. `Before` uses the historical
baseline arrival SOC; `after` uses the current predicted arrival SOC. Missing
inputs make the comparison unavailable rather than triggering defaults.

## 10. Phase 4 design: telemetry evaluation

### 10.1 Dataset snapshot

Use Hugging Face dataset `Ajeya95/EV-Telemetry` pinned to revision
`b22ff79a2c5dbb4bf6210e37a468e3a724d540dd`.

The local snapshot remains outside the repository. Evaluation reports store
only aggregate results, dataset revision, configuration, and non-sensitive
vehicle aliases.

The dataset currently contains 12 GPS/CAN vehicle pairs, 197,326 GPS rows, and
869,513 CAN rows. It does not contain make/model/category mapping, trip IDs,
altitude, GPS accuracy, or a field dictionary. These limitations are explicit
in every report.

### 10.2 Adapter rules

- Preserve raw fields and units.
- Convert speed only through an explicit adapter configuration. The current
  hypothesis is km/h to m/s; it must remain labelled until confirmed.
- Never map `carbattery` to SOC; its observed values resemble voltage.
- Never call `power` instantaneous power or measured energy until its semantic
  definition is supplied.
- Sessionization splits GPS after gaps over 30 minutes and records that the
  boundary is inferred.
- A comparison session requires at least four GPS points, duration from 20
  minutes to 12 hours, and CAN observations within 10 minutes of both ends.

### 10.3 Three evaluation feeds

1. `published_sparse`: values as published, used to detect contract mismatch.
2. `unit_corrected_sparse`: explicit confirmed conversions, unchanged cadence.
3. `synthetic_1s`: linear timestamp, coordinate, and speed interpolation at one
   second while preserving observed endpoints.

Synthetic rows carry `synthetic: true`, source interval identifiers, and an
interpolation method. Altitude, accuracy, traffic, stops, and BMS values are
never invented.

### 10.4 Metrics

Report per session and per held-out vehicle:

- MAE in Wh;
- absolute percentage error;
- signed percentage bias;
- correlation as a secondary diagnostic;
- accepted/rejected GPS counts;
- distance, duration, and energy distributions.

Median absolute percentage error is the primary aggregate because sparse-data
outliers make the mean unstable. Results also report the mean and percentile
distribution so the median cannot hide severe failures.

### 10.5 Calibration protocol

- Category sweeps are sensitivity tests and cannot establish vehicle type.
- Obtain the make/model/spec mapping for every vehicle alias before final
  calibration.
- Split by vehicle for generalization tests and by time within vehicle for
  rolling deployment tests.
- Fit calibration only on training vehicles/time ranges.
- Evaluate once on untouched validation and test partitions.
- Persist formula version, dataset revision, features, parameters, and metrics.

A calibration cannot enter production until:

- dataset units and CAN comparison target are documented;
- every evaluated vehicle has confirmed specifications;
- at least 20 valid trips exist per validation vehicle;
- held-out median absolute percentage error is at most 20%;
- absolute held-out median bias is at most 10%;
- no vehicle has median absolute percentage error above 35%.

The preliminary 0.78-0.81 scale factors are experimental and must not be
shipped.

## 11. Error handling and degraded behavior

- Vehicle lookup unavailable: show manual editable fields and do not infer.
- Ambiguous vehicle match: show candidates and require explicit selection.
- Places provider unavailable: retain driver classification and mark app check
  unavailable.
- Route provider unavailable: show existing trip/range information but no
  route-specific prediction.
- Location permission denied: do not claim live idle detection.
- Poor GPS accuracy: pause idle timing and explain reduced confidence.
- Offline idle response: queue idempotently and keep the trip active.
- Missing baseline: show direct trip metrics and explain what history is
  required.
- Missing electricity or charging inputs: omit money or charge-time comparison.
- Unknown dataset units: fail evaluation configuration validation.

## 12. Security, privacy, and retention

- All provider credentials live in backend deployment configuration.
- Mobile clients never receive provider secrets.
- Vehicle, route, trip, idle, and evidence endpoints enforce fleet scope.
- Precise GPS follows the existing 90-day retention policy.
- Vehicle-source URLs and normalized specifications are retained; unnecessary
  full web responses are not.
- Evaluation datasets remain outside Git and are not redistributed without a
  license and privacy review.
- Logs exclude precise coordinates, tokens, and raw provider payloads.

## 13. Testing strategy

### Backend

- Authorization tests for owner, fleet admin, assigned driver, unassigned
  driver, and cross-fleet identifiers.
- Provider contract tests for exact, ambiguous, empty, timeout, and malformed
  vehicle/place/route responses.
- Unit tests for idle transitions, geofence boundaries, cooldown, and GPS
  accuracy pauses.
- Formula tests for route energy, arrival SOC, baselines, money, and charge
  time.
- Integration tests from trip start through destination edit, idle response,
  final GPS flush, prediction, and performance response.

### Mobile

- Component tests for candidate review, driver edits, mismatch resolution, idle
  actions, degraded provider states, and performance labels.
- GPS service tests with controlled timestamps, coordinates, accuracy, and
  offline queues.
- TypeScript and ESLint validation.
- Android debug and signed-release builds.

### Evaluation

- Schema and unit-contract tests for every Parquet pair.
- Deterministic sessionization tests.
- Direct, corrected, and synthetic feed reproducibility tests.
- Leakage tests proving a held-out vehicle never participates in calibration.
- Per-vehicle regression reports and threshold gates.

### Real-device acceptance

- A real road trip with one-second requested foreground GPS.
- A five-minute non-destination idle that prompts once.
- A confirmed restaurant/order-collection wait within 100 metres that does not
  prompt.
- Destination classification mismatch resolved by driver edit.
- Offline recovery and final GPS queue flush.
- Device battery consumption below 5% per tracked hour.

## 14. Acceptance criteria

The complete feature set is accepted when:

1. Drivers can confirm and later edit sourced vehicle specifications.
2. Every saved sourced field has evidence; every manual change is labelled.
3. Cross-fleet and unassigned-driver vehicle access is blocked.
4. Idle prompts follow the five-minute/100-metre policy and never auto-end.
5. Expected restaurant/order-collection waits do not prompt.
6. Route predictions expose source, confidence, and missing-input behavior.
7. End-trip metrics distinguish moving, planned wait, and unplanned idle time.
8. Savings and charge comparisons appear only with qualifying inputs.
9. Dataset evaluations are revision-pinned and reproducible.
10. No unverified category, unit, or calibration factor reaches production.
11. Backend tests, TypeScript, ESLint, Android builds, and real-device acceptance
    all pass with fresh evidence.
