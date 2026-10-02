# GPS Driver production telemetry analysis playbook

Use this playbook whenever a user asks to interpret GPS Driver CSVs, audit a tester's trip, analyse "today's data", compare test runs, determine training usability, or produce the same level of analysis as the 31 August and 1 September 2026 audits.

This document complements `docs/runbooks/telemetry-operations.md`. The operations runbook explains how the system should behave; this playbook explains how to collect evidence and determine what actually happened.

## Required outcome

An analysis is complete only when it answers all of these questions:

1. How many one-second windows did the phone declare, and how many reached the cloud?
2. Which exact sequences are missing?
3. Are stored rows internally valid, unique, and matched by receipts?
4. Is the problem GPS sampling, the Android Room/upload queue, backend ingestion, processing, or finalization?
5. What app version, backend image digest, and deployed revision produced the data?
6. Were start/end SOC values captured, and is an authoritative energy label persisted?
7. Is each trip usable for route diagnostics, pipeline validation, or model training?
8. What is proven, what is inferred, and what remains unknowable from cloud evidence?

Never reduce the result to a generic "GPS coverage" percentage.

## Production-safety rules

- Treat production PostgreSQL as canonical. Never silently substitute `backend/trickee_gps.db` or seeded/demo data.
- Use read-only transactions for every audit query.
- Establish one immutable UTC cutoff and apply it to telemetry, receipts/batches, events, rejections, and manifest counts.
- Do not start a stopped Cloud SQL instance merely to broaden an audit. Starting it changes state and can incur cost.
- Never print database URLs, OAuth tokens, service-account keys, installation IDs, refresh tokens, or raw credentials.
- Precise GPS coordinates and account email addresses are private. Keep raw CSV/JSON exports in a restricted local or approved private location; use aggregate values in shareable reports.
- If a temporary Cloud Run exporter is required, keep it private, require Cloud Run identity plus a one-time application token, use the existing database secret/VPC path, then delete it and independently verify that the service and token state are absent.
- Do not modify, finalize, repair, or delete trip data during an analysis-only request.

## Scope and time boundary

State the scope before calculating anything:

- one named trip;
- every trip belonging to a named account;
- all GPS Driver production trips;
- or one local calendar day.

For "today", use the user's timezone, currently `Asia/Kolkata`. A local day runs from 00:00 IST to 24:00 IST, which is 18:30 UTC on the preceding date through 18:30 UTC on the named date. Select trips by `started_at` within that interval and disclose any trip that crosses the boundary.

Always record:

- snapshot cutoff in UTC and IST;
- query generation time;
- earliest and latest trip start;
- earliest and latest telemetry event time;
- earliest and latest backend receipt time;
- account and vehicle filters;
- whether a trip was still active at the cutoff.

Do not use a partial active-trip snapshot as its final result. If the trip ends during the audit, take one new fixed-cutoff snapshot and use it consistently.

## Minimum evidence set

Retain these four artifacts for a full multi-trip audit:

1. `gpsdriver_all_telemetry_through_<date>.csv`
2. `gpsdriver_all_batches_through_<date>.csv`
3. `gpsdriver_all_data_manifest_<date>.json`
4. `gpsdriver_trip_audit_<date>.json`

Produce a separate Markdown interpretation report. Record SHA-256 hashes for every raw artifact.

### Telemetry CSV fields

Preserve the canonical sensor fields and add attribution fields so multiple trips remain distinguishable:

- `trip_id`, `user_email`, `vehicle_id`, `vehicle_code`, `trip_started_at`, `trip_status`
- `sequence_no`, `sample_id`, `device_id`, `boot_id`
- `event_time`, `received_at`, `upload_latency_s`, `window_duration_ms`
- latitude, longitude, horizontal accuracy, speed, bearing, altitude, GPS availability, mock-location flag
- accelerometer/gyroscope counts and completeness
- jerk metrics
- battery, charging, network, GPS enabled, permission, collector state, phone outbox pending
- app version, OS version, and device model

### Batch CSV fields

At minimum include:

- trip/account/vehicle/device attribution;
- receipt time;
- batch ID;
- accepted window count;
- first and last sequence.

### Trip audit fields

Join the telemetry files to production records from:

- `mobile_trip_sessions`
- `telemetry_windows`
- `telemetry_receipts`
- `telemetry_rejections`
- `device_trip_upload_cursors`
- `server_outbox`
- `telemetry_events`
- `trip_finalizations`
- `trip_energy_labels`
- `vehicles`
- `users`

Include start/end/status/context, final sequence, cursor values, finalizer state, SOC provenance, persisted/candidate labels, vehicle usable capacity, processor event counts, and server-outbox state.

## Mandatory integrity reconciliation

Before interpreting the data, prove that the export itself is internally consistent.

The following values must agree:

```text
manifest telemetry count
= telemetry CSV data rows
= unique sample_id count
= unique (trip_id, sequence_no) count
= telemetry receipt count
= sum(batch.window_count)
```

Also verify:

- batch CSV rows equal unique batch IDs;
- every trip and account in the manifest appears in the CSVs as expected;
- no duplicate sample IDs;
- no duplicate sequence within one trip/device;
- CSV headers match the intended schema;
- files parse without truncated or malformed rows;
- SHA-256 hashes are recorded;
- temporary cloud resources and one-time token files are gone.

If any reconciliation fails, stop and label the export unreliable before diagnosing the application.

## Correct metric definitions

Use these definitions consistently.

### Declared final sequence

`final_sequence_no` is the last one-second sequence sealed by the phone when the driver ends the trip. For a completed trip with one-second windows, sequences 1 through final are expected.

### Stored windows

Count unique `(trip_id, sequence_no)` rows in `telemetry_windows`, not the highest cursor and not batch count.

### Actual missing

```text
actual_missing = final_sequence_no - unique_stored_sequences_within_1_to_final
```

List missing ranges exactly. Do not calculate missing as `final - highest_contiguous_sequence`; that overstates loss when later sequences arrived after an early gap.

### Cloud completeness

```text
cloud_completeness_pct = unique_stored_sequences / final_sequence_no * 100
```

### Stored-row GPS quality

Use the backend quality gate:

- GPS available;
- latitude/longitude present;
- not mock;
- horizontal accuracy absent or between 0 and 50 m.

```text
stored_gps_quality_pct = valid_stored_gps / stored_windows * 100
```

### End-to-end valid-GPS coverage

```text
end_to_end_valid_gps_pct = valid_stored_gps / final_sequence_no * 100
```

This is the meaningful route-completeness measure. A dashboard showing 100% stored-row GPS coverage can still represent a severely incomplete cloud trip.

### Contiguous cursor

Report both:

- computed highest uninterrupted sequence starting at 1;
- stored `highest_contiguous_sequence` cursor.

Also report highest received sequence. A cursor of zero does not mean zero uploaded rows; it means sequence 1 is missing.

## Per-trip analysis checklist

For every trip, report:

- short and full trip ID;
- account, vehicle, device, app version, OS, device model;
- start/end in IST and UTC;
- status and finalization state;
- final sequence, stored windows, actual missing, exact missing ranges;
- cloud completeness, stored GPS quality, end-to-end GPS coverage;
- sequence minimum, maximum, contiguous through, and highest received;
- accepted batches, backend rejections, server-outbox total/pending;
- phone backlog at the last received window and maximum backlog if available;
- cadence median/p95/max;
- upload latency mean/median/p95/max;
- GPS accuracy mean/median/p95/max;
- accelerometer and gyroscope availability/completeness;
- quality-event counts;
- route distance and physics estimate, clearly marked diagnostic when incomplete;
- starting/ending SOC and source;
- persisted label versus candidate label;
- explicit usability decision.

## Upload and queue interpretation

Calculate p50, mean, p95, and maximum upload latency. A low median with a very high p95 indicates fresh batches arrived normally while old queued batches replayed much later.

Inspect missing-range shape:

- missing start plus later received rows: contiguous ACK/head-of-line blocking;
- large missing tail: backlog did not drain before or after trip completion;
- isolated interior gaps: possible batch rejection, local deletion, process interruption, or unrecovered Room rows;
- clean 1-to-final sequence: mobile delivery succeeded for that trip.

Correlate this with:

- last and maximum `local_outbox_pending`;
- app version;
- network type;
- boot ID changes;
- batch sizes and receipt timing;
- backend rejection count;
- receipt/window parity;
- server-outbox dispatch state.

If receipts equal windows, backend rejections are zero, and server outbox is fully dispatched, do not blame Cloud SQL for sequences that never arrived. State that the loss occurred before accepted backend ingestion.

Do not infer duplicate upload attempts from receipt rows alone. Duplicate retries do not create new canonical receipts; use client diagnostics or request logs when available.

## GPS and IMU interpretation

For GPS, calculate:

- stored and end-to-end quality percentages;
- event cadence;
- horizontal accuracy distribution;
- mock-location count;
- maximum event gap;
- route distance only from quality-approved points.

For IMU, report separately:

- accelerometer windows with samples;
- gyroscope windows with samples;
- sample-count and completeness distributions;
- `IMU_LOW_QUALITY` event count;
- device capability versus collection failure when hardware information is available.

Never treat a numeric zero as proof that the vehicle was motionless. A zero gyroscope sample count means the phone supplied no gyroscope samples for that window.

## SOC, energy, and label interpretation

Verify `starting_soc` and `ending_soc` in trip context and state the source. Manual dashboard SOC is not BMS telemetry.

For a valid manual SOC pair:

```text
soc_delta_pct = starting_soc - ending_soc
actual_energy_consumed_wh = usable_kwh_snapshot * 1000 * soc_delta_pct / 100
actual_wh_per_km = actual_energy_consumed_wh / complete_trip_distance_km
```

Do not present `actual_wh_per_km` as authoritative when route windows are missing. The SOC delta covers the complete session while the distance denominator covers only the arrived route.

Keep physics and SOC calculations separate:

- physics output is an estimated baseline from GPS/vehicle assumptions;
- SOC-derived energy is an observed manual-label candidate;
- persisted `trip_energy_labels` are authoritative only after successful finalization;
- candidate labels calculated during an audit are diagnostic, not stored production truth.

Do not add SOC energy across separate trips as a fleet-efficiency measure if charging or battery resets occurred between trips.

## Finalization and deployment provenance

For any stuck trip, compare:

- final sequence;
- cursor contiguous/highest received;
- finalizer processed sequence;
- trip and finalizer states;
- `trip.finalization_eligible` outbox event;
- trip-finalizer processor evidence;
- persisted label and archive manifest.

Then compare current source with live deployment:

- local Git SHA and commit timestamp;
- Cloud Run API/relay/finalizer image digest;
- ready revision name and creation timestamp;
- Cloud Run Job image digest;
- scheduler execution time/status when accessible.

Never say "the backend has the fix" merely because the repository contains it. A source fix is not active until the immutable image digest containing it is deployed and independently verified.

Likewise, never judge a mobile repair until telemetry rows show the expected new `app_version`/version code.

## Training-usability decision

Give each trip one of these explicit results:

- **Reject for training:** incomplete sequences, no persisted label, invalid SOC, insufficient distance, low GPS quality, charging during trip, or other eligibility failure.
- **Diagnostics only:** useful for GPS/queue/backend investigation but not a target label.
- **Route validation usable:** complete route and acceptable GPS, even if label requirements fail.
- **Training candidate:** complete route, persisted label, eligibility true, and all configured quality thresholds pass.

At minimum, reject training when:

- cloud completeness is below 100%;
- finalization is not completed;
- label is absent or only a diagnostic candidate;
- configured minimum distance is not met;
- label confidence or GPS quality is below policy;
- SOC provenance is missing or contradictory.

Do not override the persisted eligibility rule to make a small pilot dataset appear usable.

## Root-cause confidence language

Use confidence explicitly:

- **High:** database, cursor, receipt, deployed revision, and code path agree.
- **Medium:** mechanism is supported, but the initiating HTTP/client error was not retained.
- **Low:** inference depends on missing phone Room/log evidence.

Separate these statements:

1. what the cloud definitively stored;
2. what the phone reported in health payloads;
3. what the current source is designed to do;
4. what the deployed revision actually did;
5. what cannot be recovered or proven.

## Required comparison against prior runs

When earlier audits exist, compare:

- app-version cohort;
- weighted cloud completeness;
- count of complete trips;
- p50/p95 upload latency;
- last/max phone backlog;
- backend rejection rate;
- gyroscope availability;
- automatic finalization rate;
- persisted/training-eligible label rate.

Do not compare an old-app trip to a new-app repair without flagging the version mismatch.

## Report structure

Use this order so future reports remain comparable:

1. Snapshot boundary and scope
2. Executive verdict
3. Day/account-level reconciliation table
4. Trip-by-trip table
5. Exact missing ranges
6. GPS and sensor quality
7. Upload and queue behaviour
8. Backend ingestion and processor evidence
9. Finalization and deployed-version analysis
10. SOC and energy interpretation
11. Training-usability decision
12. Root cause and confidence
13. Next validation run and pass criteria
14. Links to private artifacts and checksums

Lead with the decision, not with raw statistics.

## Pass criteria for a repaired pilot

A post-fix validation trip should meet all of these:

- expected app version/version code confirmed in telemetry;
- sequences 1 through final present exactly once;
- cloud completeness 100%;
- end-to-end valid GPS at or above the configured quality threshold;
- median cadence near one second with no unexplained large gaps;
- phone backlog returns to zero;
- p95 upload latency below 10 seconds under normal connectivity;
- backend receipts equal stored windows;
- zero unexpected backend rejections;
- server outbox fully dispatched;
- automatic finalization completes without manual repair;
- persisted SOC/energy label exists;
- training eligibility is explicit;
- route distance meets the configured minimum when the goal is model training.

One successful trip is a smoke test, not production proof. Compare multiple trips across normal connectivity, offline recovery, process restart, duplicate replay, and delayed final rows.

## Common mistakes to prevent

- Calling stored-row GPS coverage "trip completeness".
- Reporting `final - contiguous` as actual missing.
- Treating `Uploaded 0` as zero stored rows.
- Calling manual SOC a BMS measurement.
- Presenting physics estimates as actual energy.
- Using incomplete-route distance as the denominator for an authoritative SOC Wh/km label.
- Declaring a source-code fix live without checking the deployed image/revision.
- Declaring a mobile fix validated when rows still show the old app version.
- Blaming the backend for data it never accepted.
- Claiming exact client error provenance without retained phone diagnostics.
- Leaving temporary exporters, IAM bindings, token files, or compressed downloads behind.
