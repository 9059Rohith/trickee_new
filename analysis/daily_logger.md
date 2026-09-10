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
- Published version `10 (1.0.9)` to the existing Play internal-testing track.
  Play independently reports the track as `Active` and the release as
  `Available to internal testers`, released 3 September 2026 at 10:22 IST.
- Physical validation remains required because the confirmed network/request
  storm has no matching Play Console Android stack trace yet. The tester must
  update in place and must not uninstall or clear app data before recovery.

## 2026-09-03 - Physical telemetry and training-readiness audit

- Reconciled the Rhythm tester's 1.0.8 and 1.0.9 phone diagnostics with a
  production Cloud SQL read-only audit, then removed and independently verified
  deletion of the temporary Cloud Run audit job.
- Confirmed 2,093/2,093 and 889/889 end-to-end sequences, full receipt parity,
  contiguous cursors at final sequence, zero missing cloud windows, zero
  rejections, completed finalizers, p95 upload latency below 4.4 seconds, and a
  maximum reported phone backlog of five.
- Verified 97.229% and 99.438% valid GPS quality, one-second cadence, 100%
  accelerometer completeness, and 0% gyroscope completeness on both trips.
- Confirmed the 1.0.8 trip is individually training-eligible with a persisted
  manual-SOC label; the 1.0.9 trip is correctly ineligible because its 7.865 km
  distance is below the 10 km threshold.
- Overall dataset verdict is not ready for training because only one eligible
  trip exists in this comparison, gyroscope data is absent, labels are manual
  SOC rather than BMS energy, and the sample lacks meaningful diversity.
- Identified a non-transport follow-up: phone diagnostics remain `SYNC_PENDING`
  even after the backend finalizer records `completed` through the final
  sequence.

## 2026-09-04 - GPS-only synthetic dataset v1

- Created 500 deterministic synthetic OLA S1 trips with 1,265,829 one-second
  GPS telemetry windows, calibrated against verified physical telemetry through
  the 1.0.8/1.0.9 audit cutoff.
- Produced disjoint train/validation/test cohorts of 350/75/75 trips and
  890,800/191,223/183,806 windows. No simulated driver or route family appears
  in more than one split.
- Kept the `actual_wh_per_km` target in a separate trip-label file and verified
  it does not appear in telemetry. All rows and labels carry explicit synthetic
  provenance and contain no real account identifiers or copied real routes.
- Verified all 1,265,829 compressed telemetry rows independently: exact counts,
  one-second cadence, contiguous sequences, GPS outage null handling, no
  charging, synthetic markers, manifest hashes, and split isolation all pass.
- Synthetic distributions: distance 10.200-27.411 km (mean 15.904), GPS
  completeness 95.364-100% (mean 98.280%), and target consumption
  29.2144-37.9952 Wh/km (mean 33.2639).
- Recorded the evidence boundary: this dataset supports development and
  pretraining only; final model readiness and accuracy still require a
  sufficiently large untouched real-trip evaluation set.

## 2026-09-05 - GPS-only energy-model baseline

- Added a tested offline training package that extracts 31 leakage-safe,
  trip-level GPS features and leaves the production physics baseline unchanged.
- Trained a mean baseline, ElasticNet and CatBoost on the fixed 350/75/75
  route-family/driver-isolated split. Six modeling tests pass.
- ElasticNet selected by validation MAE and scored test MAE `1.1704 Wh/km`,
  RMSE `1.4773 Wh/km`, MAPE `3.5261%`, and R2 `0.1049`; CatBoost test MAE was
  `1.2010 Wh/km`, and the mean baseline was `1.2286 Wh/km`.
- Recorded a strict no-promotion verdict because the synthetic-only R2 is low,
  the gain over the mean is small, and the SOC-derived target is quantized.
  Generated artifacts include both models, test predictions, feature
  importance, metrics, the trip feature table and a model card.

## 2026-09-08 - Trip completion, stationary nudge and session hotfix

- Reproduced the code path behind the tester's `Trip capture did not finish
  sealing within 15 seconds` failure. A poll-driven native `START` could race an
  end request and reopen the same Room trip from `ENDING` to `ACTIVE`.
- Added state-guarded activation, ENDING-before-stop ordering, process-restart
  recovery and final-window serialization so a retained active trip can seal
  without losing queued telemetry.
- Added the requested seven-minute stationary decision in the native foreground
  collector and React UI: `I'm waiting` suppresses prompts until movement;
  `End trip` opens the existing SOC-aware end flow.
- Replaced immediate poll-time logout with serialized access/refresh-token
  recovery, including one safe retry for start and end requests.
- Built `com.trickee.gpsdriverapp` `1.0.10 (11)` with the registered upload key.
  AAB SHA-256:
  `EE50FB6CA455662D79D644A110F863F4E180D32C6717E078755B89AF60CC97B1`.
  Mobile tests are `15/15`; Android release tests are `55/55`; TypeScript,
  ESLint, release lint, release build and signature verification pass.
- Google Play Console verified that `11 (1.0.10)` is active and `Available to
  internal testers` on the Internal testing track, released on 8 Sept 2026 at
  15:25. Cloud incident correlation is still pending because gcloud requires
  interactive login. The tester must update in place and must not uninstall or
  clear app data before ending/recovering the retained trip.

## 2026-09-08 - Sealed-active trip recovery and production force-close

- Reconciled the tester's pre-1.0.10 diagnostic with the post-update failure.
  Trip `153c02bb...` was locally `ACTIVE` despite already containing final
  sequence 1,345 and an end timestamp, so the old early-return path could not
  advance it to `SYNC_PENDING`.
- Added Room migration 2-to-3 and a transactional End Trip normalization for
  this exact legacy state. Post-seal pending/in-flight rows are preserved as
  `CAPTURED_AFTER_FINAL_SEQUENCE` instead of being uploaded or deleted.
- Authenticated to production and ran an exact-trip read-only preflight inside
  the private VPC. It confirmed the intended 1-to-1,345 range was fully stored;
  the cloud trip itself was still `active / collecting` and lacked ending SOC.
- Force-closed only that trip at `2026-09-08T02:12:48.750Z`, preserving 1,961
  later rows for audit. Independent Cloud SQL verification reports no active
  trip for the driver, 1,345 authoritative rows, zero missing sequences, and a
  training-ineligible label because ending SOC is unavailable.
- Published Android `1.0.11 (12)`. Current gates pass JVM unit tests, React
  Native `15/15`, TypeScript, ESLint and instrumentation APK compilation.
  The signed AAB SHA-256 is
  `7DA05AB1C69BC61B3FA8BAF07CD85A52718238007E992C61CA8E0536ED3C269D`.
  Play Console now shows `12 (1.0.11)` active and `Available to internal
  testers`, released on 8 Sept 2026 at 16:56. The remaining gate is physical
  in-place migration and end/start verification on the tester's handset.

## 2026-09-08 - Daily planner chat and pre-trip SOC pilot

- Added `Plan My Day` to `com.trickee.gpsdriverapp`: the tester can enter a
  complete day in conversational text, review the deterministic stop/time
  extraction, confirm it, and see sequential ETA, route evidence and estimated
  arrival SOC for every leg.
- The conversational layer uses an allowlisted LLM tool call and cannot override
  coordinates, traffic, energy, SOC, charger evidence, notification priority or
  send decisions. Google Places/Routes/charger calls are backend-only and fail
  closed to explicit unavailable states.
- Future-leg SOC uses the latest stored GPS prediction rate for the assigned
  vehicle when available. The unpromoted synthetic ElasticNet artifact was not
  relabeled as a live pre-trip model; vehicle-spec energy is an explicit fallback.
- Added high-priority local Android WorkManager reminders and durable backend
  notification occurrences. The new notification channel is isolated from the
  foreground telemetry service.
- Verification passed: backend 148 tests, focused daily-plan 10 tests, mobile 22
  tests, TypeScript, ESLint, Android JVM/Kotlin build, and migration 0006
  roundtrip. Created successful pre-deployment Cloud SQL backup 1788891590710.
- Next release identity is `1.0.12 (13)`. Production deployment, artifact
  signature/hash, Play acceptance and physical background notification receipt
  are recorded only after their respective live gates complete.

## 2026-09-09 - Daily planner deployed and Play bundle accepted

- Ran the dedicated migration after Cloud SQL backup `1788891590710`, then
  deployed API revision `trickee-pilot-api-00012-zb8` at 100% traffic.
- Live canaries passed for health, Google Places, traffic-aware Routes and Groq
  `parse_day_schedule`; selected verified model `openai/gpt-oss-20b`.
- Hardened reminder permissions, retry UX and expired-alert filtering.
- Full verification: backend `149/149`, mobile `24/24`, Android `57/57`,
  TypeScript, ESLint, signed release compilation and identity checks.
- Play validated `1.0.12 (13)`. AAB SHA-256:
  `14591D08AD3A29575755D040A5C7BB332CC7C6FE0E4EE824E3603E0BD32EAA69`.
  Its only warning is missing optional deobfuscation data; final internal
  publish and physical-device proof remain pending.

## 2026-09-09 - Daily planner published to internal testing

- Confirmed the final Play publication dialog for `13 (1.0.12)`.
- The Internal testing track now reports `Active`, `Latest release: 13
  (1.0.12)`, and `Available to internal testers` with release time `9 Sept
  00:55`.
- No automated or console gate is outstanding. Physical-device verification
  remains required; remote FCM delivery is still not claimed.

## 2026-09-09 - Real map, route actions and FCM implementation

- Removed mock map/charger behavior from the standalone GPS Driver and wired
  live GPS, real OSM tiles, Google Places/Routes evidence, SOC-based range and
  charging guidance, functional directions, and persisted nudge actions.
- Separated live telemetry from stored model results in Monitoring and bounded
  the LLM assistant behind an authoritative GPS/vehicle-summary tool.
- Added durable Firebase HTTP v1 dispatch plus Android high-priority receipt,
  deep links, deterministic de-duplication and native token rotation resync.
- Deployed API revision `trickee-pilot-api-00014-bf9` at 100%; health and the
  three required OpenAPI paths verify successfully. Full local gates pass:
  backend 161, mobile 30, Android 59, TypeScript, ESLint and Terraform.
- Did not build or publish `1.0.13 (14)`: Firebase project creation is denied
  to the active Editor account. Owner `rhythm@trickee.co.in` must enable
  Firebase on `trickee-jaswanth-pilot` and register
  `com.trickee.gpsdriverapp`; then the notification worker, signed bundle and
  physical high-priority background-delivery canary can be completed.

## 2026-09-09 - Signed interim release artifact

- Added an explicit non-FCM release override while keeping the default Firebase
  release gate fail-closed.
- Signed and verified `1.0.13 (14)` with the registered upload certificate.
  AAB SHA-256:
  `87431335B777E5FADA0A23B3FA22FC1E59B2AEF5D344284AEDED6D20A562060F`.
  APK SHA-256:
  `F1FF3E1CBEC1EFD1E2E7607BBA3CA76EF2FB6DA4178F879872A68F764016FAF8`.
- Play release preparation reached the upload form. Browser debugging detached
  during the file chooser, so version 14 is not yet uploaded or published.

## 2026-09-09 - Plan My Day past-route incident repaired

- Reproduced the tester's evening failure from screenshots: the message said
  `tomorrow`, but the submitted and persisted service date remained
  `2026-09-09`; Google Routes consequently received expired departure times.
- Added deterministic relative-day resolution, persisted the resolved date,
  rejected genuinely expired schedules before provider calls, and prevented
  imminent routes from sending a past departure timestamp.
- Red-green coverage added for all three behaviors. Full backend result:
  `165 passed`.
- Built the exact Git commit `c8d6625ef001ce9121eb13812249aca0ae13f086`
  through Cloud Build `1ea6063a-cda7-486b-a4d6-307ec2be9f8f` and deployed
  immutable digest
  `sha256:8cea97072b0114f2dc9d0576b89b5c51a244c39e88a9fd7ce8e925df00ed26a8`.
- Cloud Run revision `trickee-pilot-api-00015-n9s` is healthy and serves 100%
  of API traffic.

## 2026-09-10 - Planner map form and recorded trip history

- Added calendar-based service-date entry and editable stop cards with
  add/remove/reorder controls and exact OSM center-pin location selection.
- Added provider-enriched daily-plan stops and a strict confirmation override
  contract; map coordinates take precedence and client route/energy facts are
  rejected.
- Grounded AI Intelligence in optional phone GPS plus verified nearby charger
  listings, with explicit evidence/degraded labels.
- Added an authorized trip-day endpoint and clickable Past Trips details with
  bounded recorded polylines and provenance-separated trip summaries.
- TDD and regression result: backend `175 passed`; mobile Jest `15 suites / 40
  tests`; TypeScript, ESLint and Android JVM tests pass. Prepared Android
  `1.0.14 (15)` release checks; signing, Cloud Run and Play remain separate
  verification steps.

## 2026-09-10 - GPS Driver 1.0.14 deployed and published

- Signed and verified `com.trickee.gpsdriverapp` `1.0.14 (15)`, target SDK 36.
  AAB SHA-256:
  `5CFCB1CC1182CEF179644CD474A1164EFE7BE4672DA545D65ED63F1FB5FA894A`.
  APK SHA-256:
  `854CDF63021BBF4858D050EC6C67A914742495B564B10EF0A707FFC822F46456`.
- Cloud Build `00513c06-4b2b-4bca-8757-b93a4a666665` built commit `f76a7af`.
  Cloud Run revision `trickee-pilot-api-00016-vzp` serves 100% traffic from
  immutable digest
  `sha256:4114853256ab3172fa616d0d63a1f8e0613d20f922ed3d1f5443ddd8392673b2`;
  health and required OpenAPI paths pass with no revision error logs.
- Play Internal testing is `Active`; release `15 (1.0.14)` is `Available to
  internal testers`, released 10 Sept at 09:30. Only the non-blocking optional
  deobfuscation warning was shown.
- Final local gates: backend `175 passed`, mobile Jest `40 passed`, TypeScript,
  ESLint, Android JVM tests and signed release build pass. Metadata explicitly
  records `RemoteFcmConfigured=false`; physical handset UX/reminder checks and
  any remote FCM claim remain outstanding.

## 2026-09-10 - Google sign-in-after-logout repair

- Production request logs proved that Google token exchange, backend audience
  validation, session refresh, trip start and telemetry upload were healthy.
  The failing retry produced no `/api/v2/auth/google` request after an explicit
  logout, locating the incident inside Android Credential Manager.
- The Android logout implementation had cleared Trickee's encrypted session
  but not the credential provider's active state. It now calls
  `clearCredentialState()` as required by the Android Sign in with Google
  contract.
- The visible Google button now uses `GetSignInWithGoogleOption`. A recoverable
  provider failure clears stale state and retries once; cancellation,
  unsupported-device and provider-configuration failures remain distinct.
- Native failure codes and bounded messages are now visible on the login screen
  instead of being collapsed into `Unable to sign in with Google`.
- Patch identity is `1.0.15 (16)`. Source tests and signed artifacts are tracked
  separately below; Play publication and physical handset proof remain pending.
