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
