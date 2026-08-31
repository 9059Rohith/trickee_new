# GPS Driver Lossless Telemetry Delivery Repair Design

**Date:** 2026-09-01

**Status:** Approved in chat; written specification pending final user review

**Release target:** Android `1.0.5` (`versionCode 6`), GPS backend, and GPS Pilot admin page

**Scope:** Android Room outbox and uploader, telemetry ingestion acknowledgement handling, trip reconciliation and finalization, admin monitoring, tests, deployment, and release evidence

## 1. Objective

Repair the GPS Driver phone-to-cloud pipeline so every telemetry window committed
to the Android Room database reaches one of two durable and observable outcomes:

1. the backend explicitly confirms the sequence as accepted or already stored;
2. the phone retains the sequence locally with an actionable diagnostic state.

No request-level failure may silently delete or permanently reject an entire
batch. A gap before later accepted sequences must not prevent those later rows
from being acknowledged locally. Cloud monitoring must distinguish transport
completeness from GPS availability, and incomplete trips must never enter model
training.

The existing HTTPS batch endpoint remains the authoritative ingestion path.
WebSocket remains an ephemeral live-status channel, not a durable upload path.
The focused transport decision is recorded in
`docs/architecture/telemetry-transport-decision.md`.

## 2. Incident Baseline

The repair is grounded in Rhythm's production trip
`3cf056ba-fd7d-4c7c-ba1f-abd7ffc0dc74`:

| Measure | Observed value |
| --- | ---: |
| Final sequence sealed by phone | 1,098 |
| Distinct cloud telemetry windows | 675 |
| Actual missing windows | 423 |
| Cloud upload completeness | 61.48% |
| Stored windows containing GPS | 675 / 675 |
| Highest contiguous sequence | 0 |
| Last reported phone backlog | 359 |
| Backend telemetry rejections | 0 |
| Accepted backend batches | 217 |
| Dispatched server-outbox events | 217 / 217 |
| Upload latency p95 | about 250 seconds |

Sequences 1-6 did not reach the backend, so the contiguous cursor stayed at
zero. Later rows were accepted but the Android client ignored the response's
explicit accepted and duplicate sequence lists. It only acknowledged through
the contiguous cursor, causing accepted rows to re-enter the queue, consume
upload capacity, and delay new rows. The last 204 sequences never reached the
cloud.

The evidence proves that the backend did not discard telemetry after accepting
it. The exact first request-level mobile error is unknown because the installed
client did not persist its HTTP status, sanitized response detail, or retry
decision.

## 3. What Breaks First

The first dangerous failure is loss of durable acknowledgement state between
Room and the backend. It causes head-of-line blocking and retransmission even
when network transport and backend persistence are otherwise healthy.

The next failures are:

1. a recoverable request-level response permanently rejecting a full local
   batch;
2. insufficient mobile diagnostics to identify the initiating failure;
3. monitoring that presents the contiguous cursor as an uploaded count;
4. trips waiting forever when some sequences are irrecoverable;
5. an incomplete trip being mistaken for a valid training example.

Protocol replacement does not fix these application-level durability rules.
They are repaired within the deployed HTTPS and Room architecture.

## 4. Architecture Decision

### 4.1 Authoritative path

```text
Android sensors and location
            |
            v
One-second window committed atomically to Room
            |
            v
Foreground uploader + WorkManager recovery
            |
            v
POST /api/v2/trips/{trip_id}/telemetry-batches
            |
            v
Atomic backend receipt, telemetry, cursor, and server-outbox commit
            |
            v
Accepted ranges + duplicate sequences + explicit rejections
            |
            v
Exact local acknowledgement and remaining-row retry
```

Delivery is at least once. `sample_id` and the unique
`device_id/trip_id/sequence_no` identity make server persistence idempotent.
Duplicates are a normal retry result and count as successful acknowledgement,
not data loss.

### 4.2 Compatibility

The server already returns:

- `accepted_sequences` as compressed inclusive ranges;
- `duplicate_sequences` as explicit sequence numbers;
- `rejections` as explicit permanent per-sequence failures;
- `highest_contiguous_sequence`;
- `missing_ranges` through the highest received sequence.

The repair consumes this existing response correctly. It does not create a new
endpoint or require an atomic mobile/backend rollout. The backend may add
monitoring fields, but telemetry batch response names and semantics remain
backward compatible.

### 4.3 WebSocket and MQTT boundaries

WebSocket may carry live map deltas and queue-status hints. Every client must
recover from a WebSocket disconnect by fetching an authoritative snapshot.
Socket connectivity is never proof that a sequence was stored.

MQTT is deferred until measured fleet scale, bidirectional command latency,
battery cost, or HTTPS overhead justifies a broker. MQTT adoption would retain
Room, sequence identity, idempotency, reconciliation, and application-level
acknowledgement.

## 5. Android Durable Outbox Repair

### 5.1 Room schema version 2

Upgrade `TelemetryDatabase` from version 1 to version 2 with an exported Room
schema and an explicit, instrumented migration. Do not use destructive fallback.

Add nullable diagnostic columns to `telemetry_outbox`:

| Column | Purpose |
| --- | --- |
| `last_http_status` | Last request-level HTTP response status |
| `last_error_code` | Stable mobile upload decision code |
| `last_error_detail` | Sanitized, bounded diagnostic text without tokens or coordinates |
| `last_failure_at_utc_ms` | Time of the most recent failed attempt |
| `permanently_rejected_at_utc_ms` | Time an explicit row-level failure entered dead letter |

Existing `attempt_count`, `next_attempt_at_utc_ms`, `rejection_code`, lease,
and server-commit fields remain authoritative for their current purposes.

The migration must preserve every trip and outbox payload. Rows created by the
old request-level behavior with state `PERMANENTLY_REJECTED` and
`rejection_code` matching `HTTP_*` are requeued once as `PENDING`, with the old
code copied to diagnostic history and the next-attempt time made immediately
eligible. Explicit backend per-sequence rejection codes are not automatically
requeued.

This recovery can only operate while the old Room database is still installed.
Uninstalled or cleared application data is unrecoverable.

### 5.2 Exact acknowledgement

The uploader parses and validates the complete successful response. For the
leased request rows:

- expand `accepted_sequences` ranges into exact sequence numbers;
- include every `duplicate_sequences` value;
- include all rows at or below `highest_contiguous_sequence` for compatibility;
- permanently reject only sequences explicitly present in `rejections`;
- mark the union of accepted, duplicate, and compatible-contiguous rows ACKED;
- release every remaining leased row to PENDING with a diagnostic code rather
  than leaving it IN_FLIGHT.

The client rejects an internally inconsistent acknowledgement before mutating
Room. Examples include invalid ranges, a sequence outside the request without
compatible historical context, overlap between ACK and rejection, a mismatched
trip or batch identifier, or `committed=false` in a successful response.
Inconsistent responses are recorded and the leased rows are retried.

ACK operations are transactional. A crash cannot acknowledge only part of a
response and leave the repository in an ambiguous state.

### 5.3 Request-level failure policy

Request-level outcomes are handled as follows:

| Outcome | Required behavior |
| --- | --- |
| Network exception or timeout | Release leased rows with exponential backoff and full jitter |
| `401` | Refresh once, save rotated credentials, and retry without rejecting telemetry |
| Failed token refresh | Preserve and retry the batch; surface an authentication diagnostic |
| `403` or `404` | Preserve and retry slowly; treat as authorization or deployment configuration, never payload loss |
| `408`, `425`, `429`, `5xx` | Retry with jitter and honor bounded `Retry-After` when present |
| `413` | Reduce batch size deterministically; never reject telemetry because the request was too large |
| `400`, `409`, `415`, `422` with multiple rows | Bisect the batch to isolate a row-level contract failure |
| Same contract failure with one row | Preserve the row as a dead-letter record with sanitized detail |
| Malformed successful ACK | Retry all unacknowledged leased rows and record `ACK_CONTRACT_INVALID` |

A dead-letter row remains stored and visible. It is excluded from automatic
upload until a repair release or explicit operator action requeues it. Purge
logic deletes only ACKED rows after retention; it never deletes PENDING,
IN_FLIGHT, or PERMANENTLY_REJECTED rows.

Sanitized detail is capped at 255 characters. Authorization headers, refresh
tokens, access tokens, payload JSON, precise coordinates, and raw response
bodies are never logged or persisted as diagnostics.

### 5.4 Queue ordering and recovery

The DAO continues leasing eligible rows in ascending sequence order. Once exact
ACKs clear already accepted later rows, the oldest true gaps become the first
eligible work automatically. Server `missing_ranges` may be recorded for
diagnostics but do not override Room truth.

Only one uploader lease runs at a time. Online upload remains active during the
foreground trip service. Unique connected-network WorkManager jobs run after
app restart, reboot recovery, trip stop, and any remaining backlog. Expired
leases return to PENDING.

Backfill work is bounded per invocation and returns retry while eligible rows
remain. It must not spin continuously on a dead-letter row or an authorization
configuration error.

### 5.5 Mobile observability

Structured mobile logs and the local health payload expose non-sensitive:

- trip identifier or a bounded opaque suffix;
- batch identifier or suffix;
- first and last leased sequences;
- leased row count;
- attempt number;
- HTTP status and stable decision code;
- accepted, duplicate, rejected, pending, and dead-letter counts;
- queue depth and oldest eligible-row age;
- WorkManager outcome and next retry time.

The backend health payload continues receiving local outbox depth so the admin
page can show the last phone-reported backlog. Metrics and logs must not use
coordinates, email addresses, or tokens as labels.

## 6. Backend Reconciliation Repair

### 6.1 Authoritative trip measures

For a sealed trip with final sequence `N`, the monitoring service calculates:

- `stored_windows`: distinct stored sequences within `1..N`;
- `actual_missing_sequences`: `N - stored_windows`;
- `upload_completeness_pct`: `stored_windows / N * 100`;
- `highest_contiguous_sequence`: cursor value;
- `highest_received_sequence`: highest received cursor value;
- `missing_ranges`: exact absent inclusive ranges within `1..N`, represented in
  bounded form suitable for an admin response;
- `gps_windows`: stored windows whose telemetry reports GPS available;
- `gps_availability_pct`: `gps_windows / stored_windows * 100`;
- `end_to_end_gps_pct`: `gps_windows / N * 100`;
- `phone_backlog`: latest phone-reported local outbox count, with observation
  time so stale values are visible.

For an active, unsealed trip, final-count, actual-missing, upload-completeness,
and end-to-end GPS values are null rather than speculative.

Queries must count distinct valid sequences and remain bounded for the most
recent 20 trips. The endpoint does not return coordinates in reconciliation
rows. Existing legacy response fields may remain for one compatible backend
release, but the frontend stops presenting them as uploaded or processed counts.

### 6.2 Distinguishing transport and GPS quality

`upload_completeness_pct` answers whether phone-created windows reached the
cloud. `gps_availability_pct` answers whether stored windows contain GPS.
`end_to_end_gps_pct` answers what fraction of the sealed one-second timeline
reached the cloud with GPS.

For Rhythm's trip these must display approximately 61.48%, 100%, and 61.48%
respectively, rather than presenting 100% GPS availability as full trip
delivery.

## 7. Controlled Incomplete Finalization

### 7.1 Timeout policy

Add `trip_incomplete_finalize_after_hours`, defaulting to 24 hours and validated
as a positive bounded configuration value. A scheduled finalization reconciler
runs every 15 minutes and examines trips in `waiting_for_telemetry` whose
`completion_requested_at` is older than the configured deadline.

The reconciler uses row locking and idempotent state transitions. It writes an
incomplete summary containing stored count, final sequence, actual missing
count, bounded missing ranges, transport completeness, GPS counts, and timeout
provenance. It then sets:

- trip status to `incomplete`;
- trip finalization state to `incomplete`;
- finalization record state to `incomplete`;
- completion time to the reconciliation time.

No route energy, physics result, authoritative distance-normalized target, or
archive is created from an incomplete timeline.

An explicit `TripEnergyLabel` may preserve the start/end SOC evidence, but its
calculated energy fields remain null, confidence is zero,
`is_training_eligible=false`, and `eligibility_reason=incomplete_telemetry`.
There must remain at most one label per trip.

### 7.2 Late telemetry recovery

Incomplete is a safe operational closure, not permanent data destruction. The
backend continues accepting idempotent telemetry within retention. When the
contiguous cursor later reaches the sealed final sequence:

1. atomically transition the trip and finalization record back to `eligible`;
2. emit the existing idempotent `trip.finalization_eligible` event;
3. run the normal complete finalizer;
4. replace the incomplete label fields with fully derived eligibility results;
5. set state to `completed` only after every sequence is present.

Repeated late batches or finalization events must not create duplicate labels,
archives, predictions, or processor effects.

### 7.3 Scheduled execution

Implement reconciliation as a dedicated backend command suitable for a Cloud
Run Job invoked by Cloud Scheduler. The job is independently deployable and
observable; read-only monitoring requests must never mutate trip state. A
failed run leaves trips eligible for the next run and emits a structured error
and metric.

## 8. GPS Pilot Admin Page

Replace misleading trip columns with operationally precise fields:

| Display | Meaning |
| --- | --- |
| Stored | Distinct cloud sequences within the sealed trip |
| Upload completeness | Stored divided by final sequence |
| Actual missing | Final sequence minus stored |
| Contiguous through | Highest uninterrupted sequence starting at 1 |
| Highest received | Highest sequence seen by the backend |
| Final sequence | Phone-sealed last sequence |
| Phone backlog | Last locally reported pending/in-flight count and age |
| Stored GPS availability | GPS-bearing stored rows divided by stored rows |
| End-to-end GPS | GPS-bearing stored rows divided by final sequence |
| Finalizer | Waiting, eligible, incomplete, completed, or failed |
| Training label | Pending, excluded with reason, or eligible with confidence |

Do not label the contiguous cursor `Uploaded` or the finalizer checkpoint
`Processed`. Do not calculate missing as `final - contiguous`.

Loading, empty, stale, and API-error states remain explicit. On narrow screens,
each trip becomes a labelled stacked record without hiding actual missing or
finalizer status. Exact missing ranges are shown in an accessible detail row or
popover and truncated with a clear total when the list is large.

The frontend consumes additive typed backend fields. It does not reproduce
reconciliation arithmetic client-side except presentation rounding.

## 9. Security and Data Integrity

- Preserve device authentication and server-side trip/device ownership checks.
- Keep batch persistence atomic and idempotent.
- Never accept client-reported counts as authoritative cloud counts.
- Never expose coordinates in reconciliation lists or diagnostic logs.
- Never persist or log tokens, authorization headers, signing secrets, or raw
  error bodies.
- Validate every acknowledgement range before expanding it, with an explicit
  maximum bounded by the leased batch.
- Use parameterized ORM or Room queries and explicit migrations.
- Retain dead-letter payloads under the same device data protections as pending
  telemetry.
- Restrict the GPS Pilot page and endpoint to the existing admin role.

## 10. Test Strategy

Implementation follows red-green-refactor. Each behavior first receives a test
that fails for the expected reason.

### 10.1 Android JVM tests

- Rhythm pattern: sequences 1-6 remain pending while accepted 7-20 become ACKED.
- Duplicate sequences become ACKED even when contiguous remains zero.
- Compatible contiguous acknowledgement still ACKs earlier rows.
- Explicit server rejections affect only the listed sequence.
- Unmentioned leased rows return to PENDING.
- Malformed or contradictory ACK mutates no row and schedules retry.
- Failed token refresh retains every row.
- Network, timeout, `403`, `404`, `408`, `425`, `429`, and `5xx` preserve rows.
- `413` reduces the next batch without dead-lettering rows.
- Contract errors bisect multiple rows and preserve a failing single row as
  dead letter.
- Backoff is bounded and deterministic under an injected random source.
- Ascending leases prioritize the true oldest gaps after exact ACK.

### 10.2 Android migration and repository tests

- Room v1-to-v2 migration preserves trip and payload counts.
- Legacy `HTTP_*` permanent rejects become pending exactly once.
- Explicit per-sequence rejection codes remain dead letter.
- ACK updates and remaining-row release are transactional.
- Process death recovers expired leases.
- Purge removes old ACKED rows only.
- WorkManager remains unique, network constrained, and retry-safe.

### 10.3 Backend tests

- Monitoring reports Rhythm's `675 stored`, `423 actual missing`, `61.48%`
  upload completeness, `0 contiguous`, and separate 100% stored GPS.
- Missing ranges include beginning, interior, and trailing gaps through final.
- Active unsealed trips return null final reconciliation measures.
- Reconciliation query remains bounded and fleet/admin authorization holds.
- Timeout transitions only expired waiting trips to incomplete.
- Incomplete summary and non-training label contain no calculated energy target.
- Repeated timeout job execution is idempotent.
- Late complete telemetry reopens incomplete finalization and completes once.
- Replayed batches and finalizer events do not duplicate downstream records.
- Existing telemetry ingestion contract and old Android clients remain valid.

### 10.4 Frontend tests

- Contract includes stored, completeness, actual missing, both cursor values,
  phone backlog and age, GPS measures, finalizer, and label reason.
- UI does not contain misleading `Uploaded` or `Processed` trip labels.
- Rhythm fixture renders 423 actual missing rather than 1,098.
- Loading, empty, stale, error, complete, waiting, and incomplete states render.
- Table/detail behavior remains keyboard accessible and responsive.

### 10.5 End-to-end synthetic tests

Run a deterministic local or staging scenario that:

1. creates sequences 1-20;
2. initially withholds 1-6;
3. uploads and acknowledges 7-20;
4. simulates token refresh failure and recovery;
5. restarts the uploader;
6. uploads 1-6;
7. replays a prior batch as duplicates;
8. seals at 20;
9. verifies 20 distinct rows, zero actual missing, contiguous 20, empty phone
   backlog, completed finalization, and idempotent downstream records.

Also exercise the 24-hour path using an injected clock rather than real time.

## 11. Verification and Release Gates

Before deployment:

- backend pytest passes;
- Android JVM and migration tests pass;
- Android lint and release bundle build pass;
- React Native Jest, type checking, and lint pass;
- admin frontend contract, type, lint, and production build checks pass;
- database migrations upgrade and downgrade in an isolated database;
- no secret, token, coordinate, or signing material appears in logs or diffs.

Deployment order:

1. deploy the backward-compatible backend and migration;
2. verify health, ingestion compatibility, reconciliation, and scheduled-job dry
   run without mutating non-expired trips;
3. deploy the admin frontend and verify the authenticated GPS Pilot page;
4. build and verify signed Android `1.0.5` / `versionCode 6`;
5. upload only to Play internal testing;
6. install through Play and execute the physical-device acceptance trip.

Physical acceptance must include screen-off foreground capture, temporary
network loss, restored connectivity, app process restart, authentication
refresh, trip stop, and backlog drain. The pass evidence is:

- each locally committed sequence is ACKED or visibly retained with an
  actionable state;
- after recovery, phone backlog returns to zero;
- stored count equals final sequence for the test trip;
- actual missing is zero and contiguous equals final;
- duplicate replay does not increase distinct server rows;
- finalizer completes exactly once;
- GPS absence, if Android supplies no fix, appears as a quality gap rather than
  transport loss;
- no incomplete trip is training eligible.

The build is not described as universally bug-free. Automated and synthetic
evidence can establish protocol correctness; the Play-installed physical trip
is required to establish pilot readiness on the tester's Android device.

## 12. Rollout and Rollback

- Keep the current Play internal release available for rollback.
- The Room v2 migration is forward-safe; application rollback must not rely on
  destructive downgrade. Retain the new client or ship a compatible hotfix.
- Backend monitoring fields are additive for at least one release.
- The incomplete reconciler is controlled by configuration and scheduler; it
  can be disabled without disabling ingestion.
- Roll back frontend presentation independently if necessary while keeping
  backend reconciliation fields.
- Stop rollout if migration count checks, ACK reconciliation, authentication,
  foreground capture, backlog recovery, or complete finalization fails.
- Preserve old telemetry and labels throughout rollback; never repair by
  truncating production data.

## 13. Operational Alerts

Alert when any of these conditions persist beyond their configured window:

- phone backlog exceeds the pilot threshold or continues growing after network
  recovery;
- oldest unacknowledged row age exceeds five minutes during an active trip;
- upload completeness remains below 100% after trip stop and connectivity;
- request-level authorization or contract errors repeat;
- dead-letter count is non-zero;
- finalization remains waiting past the normal recovery window;
- scheduled reconciler fails or stops running;
- duplicate rate or p95 upload latency rises materially from the repaired
  baseline.

Alerts must link operators to trip-safe diagnostics without coordinates or
tokens. Email-only notification is insufficient for a live pilot; route alerts
to an actively monitored operations channel.

## 14. Non-Goals

- Replacing HTTPS ingestion with WebSocket or MQTT in this repair.
- Guaranteeing that Android or satellites provide a valid GPS fix every second.
- Recovering data after application uninstall, storage clear, filesystem loss,
  or Room corruption without a surviving backup.
- Creating energy targets from incomplete telemetry.
- Adding OLA BMS integration, new sensors, or model-training changes.
- Refactoring unrelated mobile, backend, infrastructure, or admin features.

## 15. Success Definition

The repair succeeds when the Rhythm failure mechanism is no longer possible:
later accepted or duplicate rows leave the phone queue even while an earlier
gap remains, recoverable failures cannot discard a batch, legacy eligible rows
are requeued where the installed database survives, the backend and dashboard
show mathematically correct completeness, and an incomplete trip is explicitly
closed without becoming training data.

Final confidence depends on two evidence layers:

1. high-confidence automated and synthetic proof of acknowledgement,
   idempotency, migration, retry, reconciliation, and finalization behavior;
2. a Play-installed physical-device trip proving Android lifecycle and real
   network recovery on the tester's phone.
