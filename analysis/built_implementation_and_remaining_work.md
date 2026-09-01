# Built implementation and remaining work

Updated: 2026-08-31.

## Built and verified

- Event-time Android telemetry with 1 Hz GPS windows, 50 Hz IMU aggregation,
  honest gap windows, bounded lateness, final flush, and atomic trip sealing.
- Room WAL outbox recovery, storage-pressure handling, backfill ordering,
  contiguous ACK retention, and idempotent backend ingestion/finalization.
- One deterministic energy label per trip with SOC, energy, Wh/km, usable-kWh
  snapshot, source, confidence, eligibility, reason, and capture timestamps.
- Authenticated trip-finalization status and mobile polling with honest measured
  versus predicted result presentation.
- OLA S1 pilot vehicle-spec validation and fail-closed user/vehicle provisioning.
- Signed Play release `com.trickee.gpsdriverapp` version `1.0.3` (`4`), target
  SDK 36. Exact artifact and verification evidence is in
  `docs/evidence/gates-1-to-4-status.md`.
- Backend image `sha256:e5209f9cd892f02eac62b68e78976d1a285a87b5bc368068f66866b69b76c666`
  deployed to all six `trickee-pilot-*` Cloud Run services with 100% traffic;
  the public health endpoint reports `status=ok` and GPS-First v2.0 active.
- Alembic migration job completed, then the approved driver and OLA S1 pilot
  assignment were provisioned by one-shot execution `trickee-pilot-migrate-rxbcw`.
  The job was restored to `python -m app.cli migrate`; the temporary provisioning
  secret and Cloud Shell payload were deleted and verified absent.
- Google Play internal release `4 (1.0.3)` is active and available to internal
  testers. The approved Trickee tester is saved in the two-member tester list;
  the opt-in URL is `https://play.google.com/apps/internaltest/4701400293644513393`.
- The `983617reddy@gmail.com` internal tester is provisioned in the GPS Driver
  backend as an active driver for synthetic fleet `Trickee Synthetic QA 983617`,
  driver `SYN-DRV-983617`, and vehicle `SYN-EV-983617-01`. Provisioning execution
  `trickee-pilot-migrate-g6hc4` and read-only relationship verification execution
  `trickee-pilot-migrate-mfjfd` both completed successfully. The shared migration
  job was restored and the scoped temporary secret was deleted.
- Release lint and packaging declare the vector-icon font-copy dependency, so
  the combined Android unit/lint/APK/AAB CI invocation completes successfully.
- Verified the three public Play Android OAuth clients in project
  `trickee-gps-driver-auth` for package `com.trickee.gpsdriverapp`: legacy,
  classical, and PQC Play-signing SHA-1 certificates are all registered.
- Built and verified corrected signed bundle `1.0.4 (5)` with Web OAuth audience
  `1044486768873-7sq9luvpsmkppgod40p5qdtbkbaq6m7q.apps.googleusercontent.com`;
  its SHA-256 is `1092BB04C9A221557E6817FA35D9F2C3D937EE6F82275C0F652BB1B70E7E00E2`.

## Remaining external work

1. Upload and publish corrected internal release `1.0.4 (5)`. Chrome file-URL
   access is enabled, but browser control still times out before taking over the
   work-account Play tab; no upload is confirmed.
2. Complete a physical-device Google sign-in and full road trip, including
   permission, offline/reconnect, process restart, and battery evidence.
3. Complete the remaining Play app setup/review so testers no longer see the
   temporary `com.trickee.gpsdriverapp (unreviewed)` app name.
4. Upgrade React Native/Metro in a separate tested change to resolve the six
   remaining high toolchain advisories; the available automatic fix is breaking.
5. Deploy the new read-only pilot-monitoring endpoint and configure its Google
   identity audience/caller service-account allowlist after gcloud
   reauthentication. Local application and topology verification is complete.

Internal release `4 (1.0.3)` remains live but has the wrong OAuth audience.
Production/fleet certification is not claimed until corrected release `5` and
the physical-device and operating evidence pass.

## GPS Pilot monitoring addition

- Added `GET /api/v2/internal/pilot-monitoring` with fail-closed Google
  identity-token audience, issuer, verified-email, and caller allowlist checks.
- Added bounded read-only aggregates for active trips, 24-hour GPS
  availability/gaps, rejections, pending outbox age, stuck finalizations, live
  vehicle state, recent trip reconciliation, and training-label readiness.
- The response excludes user emails, installation identifiers, auth tokens,
  raw telemetry payloads, and database configuration.
- Added Terraform environment wiring for monitoring audience and caller
  service-account allowlist.
- Full backend result after the addition: `117 passed`.
- GCP topology static check passed. Terraform CLI is not installed locally, so
  `terraform validate` was not run.
- Cloud rollout is pending the open work-account password verification; no live
  deployment of this monitoring endpoint is claimed.

### Production rollout update — 2026-08-31

- Installed Terraform `1.15.8`; `terraform init`, formatting validation, and
  `terraform validate` now pass against the existing remote state.
- Applied only the reviewed Cloud Run API target with `environment=pilot` and
  current capacity pinned: `0 added, 1 changed, 0 destroyed`.
- Configured `TRICKEE_MONITORING_AUDIENCE` and the explicit
  `trickee-backend@trickee-jaswanth-pilot.iam.gserviceaccount.com` caller
  allowlist through Terraform.
- Deployed image digest
  `sha256:70e703d7041483361212dd92a3b9ce2cca2eae9a64800f107ffb73f5bd9a30cf`
  to ready revision `trickee-pilot-api-00007-vj2` with 100% traffic.
- Live checks passed: `/health` returns `200`; the internal monitoring endpoint
  rejects unauthenticated requests with `401`; a temporary Cloud Run job using
  the main-backend service account fetched a valid monitoring snapshot.
- The temporary verification job was deleted after the successful execution.

Operational warning: an unpinned full Terraform plan inferred
`environment=production` and proposed `65 add, 2 change, 65 destroy`, including
Cloud SQL replacement. It was not applied. Future full plans must explicitly
pin `environment=pilot` and current state-derived capacity/region variables.

### Main-platform Google sign-in follow-up — 2026-08-31

- Restored the main web backend's existing `Trickee` Google OAuth audience on
  Cloud Run revision `trickee-backend-00006-6st`.
- This did not create, replace, or modify any GPS Driver Android/Play OAuth
  client and did not change the GPS API deployment.

## Lossless telemetry delivery repair — 2026-09-01

Status: implemented, tested, and deployed for the pilot backend and admin UI.

- Android now acknowledges every sequence explicitly returned as accepted or
  duplicate, so an early sequence gap no longer blocks cleanup of later rows.
- Room schema v2 preserves queue diagnostics and recovers eligible rows stranded
  by the old whole-batch `HTTP_*` rejection behavior. Retryable authentication,
  network, timeout, and server failures remain queued; irrecoverable payloads are
  isolated individually with status/error evidence instead of deleting a batch.
- The uploader keeps oldest-first ordering and records queue depth, attempts,
  response status, and failure reason. This removes the duplicate-replay capacity
  collapse observed in Rhythm's trip while retaining missing-range repair.
- Backend reconciliation now reports stored rows, actual missing rows,
  completeness, contiguous-through sequence, phone backlog, and final sequence
  separately. A configurable 24-hour reconciler closes stale incomplete trips as
  training-ineligible while permitting safe late-data reconciliation.
- Deployed immutable backend digest
  `sha256:75a040db1fe81c742aeaba55fb512554eb7545965049841512df131dff6e2d1d`
  to all six pilot Cloud Run services. API revision is
  `trickee-pilot-api-00008-q27`; both API health URLs return `200`.
- Terraform provisioned the hourly Cloud Run reconciliation job and Cloud
  Scheduler trigger at `15 * * * *` UTC. Manual execution
  `trickee-pilot-finalization-reconciler-pl5ms` completed successfully in 6.39s.
- Backend regression suite passed `121/121`; Android unit suite completed with
  `BUILD SUCCESSFUL`; the focused Android instrumentation suite passed 11 tests.
- Built signed Play bundle `1.0.5 (6)` for `com.trickee.gpsdriverapp` and
  validated it with bundletool. SHA-256:
  `21A5320BB8801152844BEB0A8A4056D52B6404C02F5EFCF37D06B16C1845BC5A`.

Remaining pilot evidence:

1. Completed on 2026-09-01: release `1.0.5 (6)` was published to the Play
   internal track and is available to the configured internal testers.
2. Run a physical-device trip covering offline/reconnect, process restart, and
   delayed gap repair, then confirm `Stored = Final sequence` or an honestly
   reported incomplete result.
3. Android and the GPS chipset cannot guarantee a valid fix every second. The
   software guarantee is durable retention/retry for every locally committed
   telemetry window until explicit server acknowledgement.
4. A future full Terraform plan must keep `environment=pilot` and live capacity
   variables pinned; unrelated SQL/Redis/OAuth drift was intentionally not
   applied.

### Reproducibility and reconciliation fix round — 2026-09-01

- Commit `ff99be5` includes the runtime Android namespace move, backend model,
  migrations, finalizer dependencies, and verification tests needed for a clean
  source checkout to import the backend and exercise the lossless pipeline.
- Clean detached-checkout evidence: `import app.main` passed; deterministic
  lossless pipeline and isolated Alembic roundtrip passed (`2 passed`).
- The reconciler now caps work at 100 expired trips, bounds sealed sequences
  and missing ranges, reports two-decimal transport/GPS measures, and keeps
  single-row `413` telemetry queued with an actionable diagnostic.
- Follow-up commit `3b05b96` also removes the finalizer's former
  `set(range(...))` expansion: it bounds finalizer gap diagnostics to one range
  plus a 100-sequence preview. Its focused finalizer suite passed `5 passed`.
- Scheduler source is corrected to `*/15 * * * *`; Cloud application remains
  pending fresh gcloud reauthentication. No deployment was performed here.
- Frontend evidence belongs to deployed commit `90bcfda`: Node contract, TypeScript,
  lint, and production build of 32 routes are green. Play internal publication
  of version `6 (1.0.5)` remains complete. Physical-device acceptance is pending.

### Immediate frontend cleanup — 2026-09-01

- Hid the floating Live SOC card from the shared dashboard layout for every
  role and route, and removed its reserved desktop gutter.
- Replaced the user-facing `Evify` brand with `xyz` across frontend page source.
- Replaced both key-dependent CARTO map sources with keyless OpenStreetMap tiles;
  the live map and route picker no longer render the `API KEY REQUIRED` overlay.
- Frontend tests passed `8/8`, lint passed with zero warnings/errors, and the
  production build generated all 32 pages.
- Commit `c72d21b` deployed successfully through both Vercel production projects.
  Live `trickee.co.in` assets contain `xyz` and the OpenStreetMap tile URL, with
  no old brand, Live SOC label, or CARTO URL.

### Play internal release 1.0.5 (6) — 2026-09-01

- Uploaded the bundletool-validated signed AAB for
  `com.trickee.gpsdriverapp` to the existing GPS Driver internal-testing track.
- Google Play accepted version `6 (1.0.5)` for API level 24+, target SDK 36,
  and published it at 11:04 IST.
- Play Console reports the track as active and the release as `Available to
  internal testers`.
- The selected `GPS Driver Testers` email list contains two users.
- Tester opt-in URL:
  `https://play.google.com/apps/internaltest/4701400293644513393`
- Physical-device offline/reconnect and missing-range recovery evidence remains
  the final pilot validation gate; Play publication itself is complete.
