# Live telemetry operations runbook

For production CSV/trip interpretation, fixed-cutoff reconciliation, training-usability decisions, and deployed-version comparison, use [`production-telemetry-analysis.md`](production-telemetry-analysis.md).

## Non-negotiable invariants

- PostgreSQL is canonical. A Redis outage must increase the PostgreSQL outbox backlog, never reject a committed telemetry batch.
- A client ACK is returned only after receipts, windows, cursor, and server outbox commit.
- Device credentials are independent, revocable, and encrypted by Android Keystore. Google tokens authenticate humans only.
- Never invent a GPS fix. `gps_available=false` and `gps=null` is valid telemetry.
- Manual dashboard SOC has source `manual`; it is never described as BMS data.
- Never delete hot telemetry until an object generation, checksum, row/sequence counts, and restore-and-compare evidence all agree.

## Deploy order

1. Build one image, scan it, and deploy by immutable Artifact Registry digest.
2. Run the dedicated `migrate` Cloud Run Job. Do not run Alembic in API startup or every replica.
3. Deploy relay and processor services with traffic disabled, then API and WebSocket services.
4. Verify `/health`, `/metrics`, a user-authenticated live-state request, and a device-authenticated duplicate batch.
5. Enable workers, confirm outbox decreases, then shift API/WebSocket traffic gradually.
6. Roll back traffic to the prior image on elevated rejection, data conflict, p95 latency, or backlog age. Forward-only database changes must remain compatible with the prior image.

## Android/company OAuth configuration

- Backend Secret Manager: web OAuth client ID in `TRICKEE_GOOGLE_OAUTH_CLIENT_ID`.
- Android build: set `TRICKEE_GOOGLE_WEB_CLIENT_ID` in an untracked user/CI Gradle property.
- Provision allowed user emails and roles before first login. Non-driver company roles additionally require the configured Workspace hosted domain.
- Revoke a lost phone through the device API; do not revoke the user's Google identity merely to stop telemetry upload.

## Alerts and first response

| Signal | Warning | Critical | First response |
|---|---:|---:|---|
| Oldest PostgreSQL outbox row | 2 min | 5 min | Check Redis TLS/connectivity, then relay errors |
| Ingestion rejection | 0.05% | 0.1% | Group by rejection code; do not retry permanent contract conflicts |
| Live p95 latency | 3 s | 5 s | Preserve live priority, throttle backfill workers |
| Device pending age | 5 min | 30 min | Check device network/storage and refresh-token rotation |
| Dead-letter additions | 1 | 10/5 min | Stop affected processor, inspect payload and code version |
| Cloud SQL connections | 70% | 85% | Reduce Cloud Run max instances/concurrency or pool size |

## Redis outage

1. Confirm ingestion remains successful and `server_outbox` rows remain `pending`.
2. Stop/reduce consumers if Redis is flapping; never mark rows dispatched without successful `XADD`.
3. Restore Memorystore connectivity/TLS and restart relay.
4. Watch oldest backlog age and use live-priority processing before backfill.
5. Confirm repeated outbox delivery is suppressed independently by each processor's PostgreSQL idempotency key.

## Dead-letter recovery

1. Record stream ID, stable outbox ID, processor, delivery count, sanitized error class, and image digest.
2. Reproduce against a restored database snapshot or test fixture. Do not edit canonical windows.
3. Deploy the compatible processor fix.
4. Replay the original event with the same outbox ID into the original stream. PostgreSQL idempotency makes successful prior processors no-ops.
5. ACK/remove the dead-letter copy only after the target processor commits and its side effect is verified.

## Trip stuck in `waiting_for_telemetry`

1. Compare `final_sequence_no` with `device_trip_upload_cursors.highest_contiguous_sequence`.
2. Inspect missing ranges in device ACK/status and the phone Room outbox; do not lower the declared final sequence.
3. Trigger the unique WorkManager backfill and keep the device charging/on-network where possible.
4. If a permanently rejected window caused the gap, retain it as evidence and use an operator-reviewed exception workflow; never manufacture a replacement fix.

### Export the phone's local queue evidence

For app version 1.0.7 or later, ask the tester to open **Fleet Controls >
Telemetry Recovery** immediately after the affected trip:

1. Tap **Export diagnostics** before tapping retry and share the generated JSON
   only with the pilot support team.
2. Preserve the JSON as the before-state. It contains the phone's declared final
   sequence, retained sequence rows, queue states, attempt counts, local missing
   ranges, HTTP status and sanitized error details.
3. The export intentionally excludes GPS coordinates, payload JSON, sample,
   device and vehicle identifiers, and authentication tokens.
4. If support confirms retry is appropriate, tap **Retry pending telemetry**.
   This makes `PENDING` and expired `IN_FLIGHT` rows eligible and schedules the
   existing WorkManager backfill. It does not revive `ACKED` or
   `PERMANENTLY_REJECTED` rows.
5. Export again after the retry and compare the phone snapshot with the cloud
   trip audit using `trip_id` and sequence numbers.

Export within 24 hours. Acknowledged rows are retained locally for 24 hours and
then purged, so older local gaps can mean either a never-created row or a
previously acknowledged row that has already been cleaned up.

## Archive and restore drill

1. Export trip windows ordered by sequence as canonical NDJSON to the private versioned bucket.
2. Record bucket URI, object generation, SHA-256, row count, and first/last sequence in `archive_manifests`.
3. Download that exact generation, validate checksum/count/bounds/contiguity, and restore into an empty validation database.
4. Compare restored row hashes to PostgreSQL and set `restore_status=restored_and_compared` with `verified_at`.
5. Only then may a separately approved retention job retire hot rows. Keep manifests longer than the underlying archive.

For Cloud SQL disaster recovery, restore the latest backup plus PITR into a **new** instance, run integrity and cursor checks, repoint a canary service, then document RPO/RTO. Never test recovery by overwriting production.

## Capacity certification

Use provisioned device/trip identities; never use synthetic tokens against production.

```powershell
py -3.11 backend\scripts\telemetry_load.py --identity-file .\private-identities.json --duration-seconds 3600 --backfill-devices 30 --backfill-windows 3600 --output .\evidence.json
```

Run 2 identities first, then 150 live identities. Add a 300-window/s controlled burst and 30-device, 60-minute backlog replay. Required evidence includes accepted/lost/duplicate/rejected windows, p50/p95/p99, oldest backlog age, Cloud SQL connections/CPU, Redis memory/pending, WebSocket lag, and at least 50% measured capacity headroom.

## Controlled rollout

Each cohort (10, 25, 50, 100, 150) must hold for three consecutive operating days. Evaluate daily JSON with `backend/scripts/rollout_gate.py`. Promotion requires completeness, latency, rejection, backlog, battery, incident, and 50% headroom checks. Any failed day restarts the three-day hold; a Sev-1 rolls back the cohort.
