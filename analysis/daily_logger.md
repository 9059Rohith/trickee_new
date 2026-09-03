# Daily logger

## 2026-08-31

- Completed GPS/IMU event-time capture, atomic sealing, offline recovery,
  storage-pressure controls, energy labels, finalization polling, OLA S1 spec
  validation, and release identity hardening.
- Backend clean-environment result: 109 tests passed.
- Mobile result: 3 suites and 9 tests passed; TypeScript and zero-warning ESLint
  passed.
- Android result: Room instrumentation 7/7; debug unit tests and release lint
  passed; signed release build completed.
- Verified AAB/APK signatures, certificate, package, version, target SDK,
  launcher, required/forbidden permissions, and hosted configuration.
- Installed and cold-launched the release APK on Android 17 with no fatal crash.
- Verified live API/WebSocket health plus privacy, terms, and support pages.
- Staged the private tester/OLA S1 provisioning payload outside the repository;
  it was later applied through the authenticated Cloud Run one-shot job.
- Recorded six high React Native/Metro production-audit advisories; no critical
  advisory remains, and the only automatic remediation is a breaking upgrade.
- Cloud Build `bcfbca68-a1ea-49a1-b2a9-cad52575a527` completed successfully and
  deployed digest `sha256:e5209f9cd892f02eac62b68e78976d1a285a87b5bc368068f66866b69b76c666`
  to all six pilot Cloud Run services with 100% traffic and unchanged URLs.
- Production migration execution `trickee-pilot-migrate-6vnkf` succeeded.
  One-shot OLA S1 provisioning execution `trickee-pilot-migrate-rxbcw` succeeded,
  after which the migration job configuration was restored.
- Deleted and verified absence of temporary Secret Manager secret
  `trickee-gpsdriver-provision-20260831` and the Cloud Shell provisioning file.
- Added the approved Trickee address to the Play `GPS Driver Testers` list and
  published internal release `4 (1.0.3)`; Play reports it available to internal
  testers at `https://play.google.com/apps/internaltest/4701400293644513393`.
- Re-ran release closeout: backend `109 passed`, mobile Jest `9/9`, TypeScript and
  zero-warning ESLint passed, and isolated Android unit, release-lint, APK, and
  AAB tasks all completed successfully with the registered upload key.
- Added the missing Gradle dependency from release lint tasks to the React Native
  vector-icon font-copy task. The combined unit/lint/APK/AAB command now passes
  (`406` actionable tasks), removing the future CI task-ordering failure.
- Provisioned `983617reddy@gmail.com` as an active driver in the isolated
  `Trickee Synthetic QA 983617` fleet through Cloud Run execution
  `trickee-pilot-migrate-g6hc4`, assigned to driver `SYN-DRV-983617` and vehicle
  `SYN-EV-983617-01`.
- Read-only verification execution `trickee-pilot-migrate-mfjfd` asserted the
  live user role, active state, fleet, driver, and vehicle relationship. The
  migration job was restored to `python -m app.cli migrate` with only
  `TRICKEE_DATABASE_URL`, and temporary secret
  `trickee-gpsdriver-provision-983617-20260831` was deleted and verified absent.
- Verified that the three requested public Play OAuth clients already exist in
  `trickee-gps-driver-auth` for the legacy, classical, and PQC Play-signing
  SHA-1 certificates. No duplicate clients were created.
- Root-caused device Google sign-in failure to release `4 (1.0.3)` embedding a
  Web client from project `609995989467` instead of the verified backend audience
  in project `1044486768873`.
- Added release regression checks, advanced the app to `1.0.4 (5)`, and built a
  signed AAB with exact OAuth-audience validation. Package, target SDK 36,
  registered upload certificate, APK/AAB signatures, and SHA-256 passed.
- Play upload remained pending after Chrome's first file-transfer timeout. No
  release-5 publication was claimed.
- Enabled Chrome file-URL access and retried the work-account Play tab with an
  extended timeout. Browser control could list the correct `u/0` tab but still
  timed out before takeover; the AAB upload remains unconfirmed.
- Added a service-to-service protected GPS Pilot monitoring snapshot endpoint.
- Enforced Google identity-token audience, issuer, verified-email, and explicit
  service-account allowlist checks; missing configuration fails closed.
- Added bounded read-only health queries for GPS coverage/gaps, live packet age,
  rejections, upload backlog, trip reconciliation, finalization, and training
  label readiness without exposing raw telemetry or user identity data.
- Added Terraform environment wiring and passed the static GCP topology check.
- Full GPS backend regression result: `117 passed` (`978` deprecation warnings,
  no failures).
- Cloud deployment remains pending because gcloud requires fresh work-account
  password verification; no monitoring rollout is claimed yet.

## 2026-08-31 - GPS Pilot Monitoring Production Rollout

- Completed Google ADC authorization and installed Terraform `1.15.8`.
- Initialized the existing remote Terraform state and passed `fmt -check` plus
  `validate`.
- Rejected an unsafe default full plan (`65 add, 2 change, 65 destroy`) before
  apply because it defaulted to the wrong environment and proposed Cloud SQL
  replacement.
- Replanned with `environment=pilot` and current capacity pinned, then applied
  the single reviewed Cloud Run environment update (`0/1/0`).
- Cloud Build `f579b706-a884-49ff-a401-147120b87987` completed successfully.
- GPS API revision `trickee-pilot-api-00007-vj2` is ready with 100% traffic;
  health returns `200` and unauthenticated internal monitoring returns `401`.
- Verified the Google identity bridge end-to-end from the main-backend service
  account using successful Cloud Run job execution
  `trickee-backend-monitoring-smoke-rhthh`, then deleted the temporary job.
- Restored the separate main web backend's missing `Trickee` Google OAuth
  audience on revision `trickee-backend-00006-6st`; GPS Driver OAuth clients
  and the GPS API were unchanged.

## 2026-09-01 - Lossless Telemetry Repair And Pilot Rollout

- Reproduced and fixed the contiguous-cursor head-of-line acknowledgement bug:
  accepted and duplicate sequences are now acknowledged explicitly.
- Added Room v2 recovery/diagnostics, retry-safe batch isolation, oldest-first
  queue behavior, stale-incomplete reconciliation, and late-data safety.
- Replaced misleading monitoring values with stored, actual missing,
  completeness, contiguous-through, final sequence, and phone backlog fields.
- Backend tests passed `121/121`; Android unit tests passed; focused Android
  instrumentation passed 11 tests; Terraform formatting/validation and topology
  checks passed.
- Cloud Build `f48995ca-14db-4f2a-9523-4e40661b25b9` produced digest
  `sha256:75a040db1fe81c742aeaba55fb512554eb7545965049841512df131dff6e2d1d`.
- Rolled that immutable digest to all six pilot Cloud Run services with 100%
  traffic. API revision `trickee-pilot-api-00008-q27` is healthy.
- Provisioned the hourly finalization-reconciler job and scheduler through a
  reviewed targeted Terraform apply. Manual execution
  `trickee-pilot-finalization-reconciler-pl5ms` completed successfully.
- Built and bundletool-validated signed AAB `1.0.5 (6)` with SHA-256
  `21A5320BB8801152844BEB0A8A4056D52B6404C02F5EFCF37D06B16C1845BC5A`.
- Removed six temporary Terraform plan/log files because they could contain
  sensitive rendered configuration; committed Terraform source and remote state
  were retained.
- Physical-device loss/recovery evidence remains an external pilot gate. Play
  internal-track publication was completed later on 2026-09-01.

## 2026-09-01 - Lossless Telemetry Reproducibility Fix Round

- Committed `ff99be5` to include Android namespace/runtime inputs, backend
  label migration/finalizer dependencies, bounded reconciliation, and tests.
- Detached clean checkout: backend import passed and lossless pipeline plus
  Alembic roundtrip passed (`2 passed`). Android focused uploader tests passed.
- Scheduler source changed to `*/15 * * * *`; apply is pending gcloud reauth.
  No cloud or Play mutation occurred in this fix round.
- Follow-up commit `3b05b96` bounds finalizer missing-gap diagnostics and passed
  its focused suite (`5 passed`); reconciler/monitoring/CLI/topology tests also
  passed (`11 passed`).
- Frontend commit `90bcfda` remains the verified GPS Pilot UI deployment with
  fresh Node contract, TypeScript, lint, and 32-route build evidence. Play
  version 6 publication is complete; physical-device acceptance is pending.

## 2026-09-01 - Immediate Dashboard And Map Fix

- Removed the global floating Live SOC card and its unused right-side spacing.
- Replaced visible `Evify` branding with `xyz` throughout frontend page source.
- Switched the Live Map and route map picker from CARTO to keyless OpenStreetMap
  tiles and tightened CSP to the remaining tile host.
- Added red/green contract coverage; final frontend results were `8/8` tests,
  zero lint warnings/errors, and a successful 32-route production build.
- Pushed `c72d21b` to Ajey95 `main`; both Vercel production deployments completed.
- Live asset inspection confirmed `xyz`, no Live SOC component, no CARTO URL,
  and the OpenStreetMap tile endpoint; a direct sample tile returned `200` PNG.

## 2026-09-01 - Play Internal Release 1.0.5

- Uploaded and published signed AAB version `6 (1.0.5)` for package
  `com.trickee.gpsdriverapp` to the existing internal-testing track.
- Play Console reports the track as active and the new release as available to
  internal testers; publication time is 11:04 IST.
- Confirmed the selected `GPS Driver Testers` list contains two users.
- Verified tester opt-in URL:
  `https://play.google.com/apps/internaltest/4701400293644513393`.
- Next gate is a physical-device trip proving offline/reconnect, process restart,
  missing-range repair, and honest finalization behavior.

## 2026-09-02 - Production Telemetry Analysis Playbook

- Stored the reusable same-level-or-better GPS Driver analysis procedure in
  `docs/runbooks/production-telemetry-analysis.md`.
- Captured production-safety rules, fixed snapshot/timezone handling, required
  raw artifacts, integrity equations, per-trip metrics, queue and finalization
  diagnosis, SOC/energy-label interpretation, training decisions, confidence
  language, version/deployment provenance, report structure, and pass criteria.
- Linked it from the live telemetry operations runbook for durable discovery.
- This was documentation only; no live services or production data were changed.

## 2026-09-02 - App 1.0.6 Physical Trip Audit

- Took a fixed read-only production snapshot at 05:32:34 UTC and analysed the
  sole 2 September IST trip for `rhythm@trickee.co.in`.
- Confirmed app 1.0.6 in all 1,310 received rows. The phone declared 1,381
  sequences, leaving 71 absent and 94.86% cloud completeness.
- Proved export and ingestion parity: unique samples = unique trip/sequence
  pairs = receipts = summed batch windows = 1,310; backend rejections and
  pending server-outbox events were both zero.
- The old contiguous-ACK failure is repaired in live behavior: a missing first
  sequence left the cursor at zero without causing replay collapse; p95 upload
  latency was 4.243 seconds and maximum phone backlog was 10.
- A new remaining gate is isolated to the Android final-minute queue/drain path:
  only 9 of sequences 1,308-1,381 reached ingestion. Exact local Room/error
  state cannot be proven from cloud evidence.
- Stored-row GPS quality was 99.92%, end-to-end valid GPS was 94.79%, all rows
  contained accelerometer samples, and no row contained gyroscope samples.
- Manual SOC 83% to 65% produced a diagnostic 536.4 Wh candidate, but the trip
  was rejected for training because it is incomplete and has no persisted label.
- Deleted and independently verified absence of the private temporary Cloud Run
  exporter and one-time token state. No production write or deployment occurred.

## 2026-09-02 - Phone Queue Diagnostics Release 1.0.7

- Added an in-app **Telemetry Recovery** card for the latest ended trip with a
  privacy-safe JSON export and a separate, confirmed pending-upload retry.
- The export records final sequence, retained sequence rows, queue states,
  attempts, local missing ranges and sanitized transport errors. It excludes
  telemetry payloads/GPS, sample, device and vehicle identifiers, and tokens.
- The retry resets only `PENDING` and expired `IN_FLIGHT` rows to immediate
  eligibility, preserves `ACKED` and `PERMANENTLY_REJECTED` rows, and schedules
  the existing constrained WorkManager backfill.
- Added unit coverage for exact state/gap reporting and token redaction plus
  Android Room coverage proving rejected rows cannot be revived by diagnostics.
- JavaScript tests passed 9/9; TypeScript and zero-warning ESLint passed; Android
  unit tests and debug instrumentation APK compilation passed; release unit
  tests, Android release lint, signed APK and AAB assembly passed.
- Built bundle `1.0.7 (8)` for `com.trickee.gpsdriverapp`, target SDK 36, with
  registered upload SHA-1
  `1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A`.
- Bundletool and signature verification passed. AAB SHA-256:
  `99DF62E448C05BD579030D45E8720392514AA44BE9A7ED973DD32AD46DAAE535`.
- Play Console draft/upload/publication status is recorded separately after the
  external release action completes.
- Published the accepted bundle to the existing Google Play internal-testing
  track on 2 September 2026 at 15:13 IST. Play independently reports the track
  as `Active`, release `8 (1.0.7) - Telemetry Recovery` as `Available to
  internal testers`, and the selected `GPS Driver Testers` list as two users.
- Play displayed one non-blocking warning about a missing R8/ProGuard
  deobfuscation file. Device support remained unchanged and native debug
  symbols are attached to the bundle.

## 2026-09-02 - Full-day telemetry CSV export and interpretation

- Captured a fixed production cutoff at 22:38:19 IST and exported three Rhythm
  trips into day-specific telemetry, batch and trip-summary CSVs.
- Verified 3,516 stored rows, unique samples, unique trip/sequence pairs,
  receipts and summed batch windows; 3,648 were declared, so 132 are missing
  and weighted cloud completeness is 96.38%.
- Confirmed app-cohort improvement from 93.85% on two 1.0.6 trips to 99.24% on
  the 1.0.7 trip, while retaining the strict incomplete/training-reject result.
- Correlated Cloud Run logs: 1,571 successful batch requests, 200 pre-persistence
  HTTP 422 attempts and two recovered 401 attempts. Database rejection rows
  remain zero because contract parse failures are not persisted there.
- Reconciled the tester's 1.0.7 diagnostic: 1,700 ACKed, 11 pending, two HTTP
  422 permanently rejected, no local sequence gaps and no post-retry request.
- Confirmed 99.94% stored-row GPS quality, zero gyroscope availability, zero
  persisted current-day labels and zero pending server-outbox events.
- Deleted the temporary private exporter service and image tag and verified
  their absence; no production rows or application deployments were changed.

## 2026-09-03 - Lossless telemetry repair release 1.0.8

- Committed the approved retained-telemetry repair as `6515569`.
- Replaced the suppressible global manual retry with forced per-trip WorkManager
  recovery, added final-tail drain/resume behavior, safe `-1` sensor-accuracy
  normalization, selective retained-422 revival, and richer local diagnostics.
- Added sanitized field-level backend 422 responses and durable pre-contract
  rejection evidence. Verified cursor convergence when a repaired missing first
  sequence joins an already stored tail.
- Final gates passed: backend `132/132`, mobile JavaScript `9/9`, Android release
  unit tests `48`, Android release lint, signed APK/AAB checks, Terraform checks,
  and the existing admin frontend's tests, TypeScript, lint, and 32-route build.
- Deployed Cloud Build image
  `sha256:e65af8cc9559cf0695c256960310ad1208de8d6cc4c65767ecd8c9e1b388aaf7`
  to all six GPS services and all four jobs. API/WebSocket health checks returned
  `200`; no new revision error logs were present. No schema migration was needed.
- Built `com.trickee.gpsdriverapp` version `1.0.8 (9)` with target SDK 36 and the
  registered upload certificate. AAB SHA-256 is
  `D3170BF1CFCF679F86D820468C5665814338A38229FCFB5F6EC6AAE480785B25`.
- Published version `9 (1.0.8)` to the existing Play internal-testing track.
  Play confirms it is `Available to internal testers` as of 00:15 IST.
- Existing Vercel frontend remained unchanged and healthy at the canonical
  `https://www.trickee.co.in/` endpoint.
- Physical recovery proof remains pending an in-place tester update and after-
  retry diagnostic export; uninstalling or clearing app data would destroy the
  retained Room rows and must be avoided.

## 2026-09-03 - No-GPS 422 storm repair release candidate 1.0.9

- Correlated the tester's repeated-crash report with 102 backend contract
  validation events over about two minutes for trip `2e16d038...`. The 51
  unique affected sequences all omitted `gps` when no fix was available.
- Made omitted `gps` backward-compatible only for `gps_available=false`, added
  an Android retained-payload repair to emit explicit `gps:null`, and replaced
  recursive detailed-422 bisection with a single-response selective
  dead-letter/requeue path.
- Added regression tests first and confirmed they failed for the old behavior;
  the completed gates pass backend `133/133`, mobile JavaScript `9/9`, Android
  release tests `51/51`, TypeScript, ESLint, and Android release lint.
- Deployed Cloud Build image
  `sha256:e4852485a89efdd9526f7a83594017d247c25a394ae8ad7c8bf2ad0976958654`
  across all six GPS services and all four jobs. API/WebSocket health is `200`,
  each service is Ready, and post-rollout error-level logs are empty.
- Built and verified `com.trickee.gpsdriverapp` version `1.0.9 (10)`, target SDK
  36, signed by the registered upload certificate. AAB SHA-256 is
  `34C71C7F90D9803CCC9A6223183553CA05164D55EBCF015CBAB760E67128EC87`.
- Play internal-track publication is pending browser reconnection. Physical
  validation also remains required because the confirmed network/request storm
  has no matching Play Console Android stack trace yet.
