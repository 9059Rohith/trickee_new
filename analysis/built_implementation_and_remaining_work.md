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

### Production telemetry analysis playbook — 2026-09-02

- Added `docs/runbooks/production-telemetry-analysis.md` as the reusable standard
  for daily, account, and per-trip production audits.
- The playbook defines fixed-cutoff read-only extraction, India-local day
  boundaries, CSV/manifest reconciliation, correct missing/completeness metrics,
  GPS/IMU and queue analysis, SOC/energy provenance, training usability, and
  source-versus-deployed-version verification.
- Cross-linked the playbook from `docs/runbooks/telemetry-operations.md` so
  future incident analysis does not depend on chat history.
- No production, database, frontend, Android, Play, or cloud configuration was
  changed by this documentation update.

### App 1.0.6 production telemetry validation — 2026-09-02

- Applied the production telemetry analysis playbook to a fixed read-only
  cutoff of 2026-09-02 05:32:34 UTC and generated a private interpretation at
  `.codex-tmp/gpsdriver_today_interpretation_2026-09-02.md`.
- Confirmed one Rhythm trip from app 1.0.6: 1,310 of 1,381 declared windows
  reached production (94.86%), with 71 exact missing sequences.
- Reconciled 1,310 unique rows, receipts, and batch-window totals; production
  recorded zero telemetry rejections and zero pending server-outbox events.
- Live evidence shows the explicit accepted/duplicate ACK repair works despite
  a cursor blocked at zero: p95 latency was 4.243 seconds and maximum phone
  backlog was 10. A separate final-minute drain/retry problem remains.
- Stored GPS quality was 99.92%, but end-to-end valid-GPS coverage was 94.79%.
  Accelerometer collection was complete; gyroscope samples remained absent.
- The trip remains training-ineligible because telemetry is incomplete,
  finalization is waiting, and no authoritative energy label was persisted.
- The private temporary exporter and one-time token state were deleted and
  verified absent. No production data, deployment, Play release, or frontend
  configuration was modified during this analysis.

### Phone-local queue diagnostics — 1.0.7 (8), 2026-09-02

- Added a tester-facing **Telemetry Recovery** card to export a read-only JSON
  snapshot of the latest ended trip before retrying delivery.
- The snapshot exposes the phone-declared final sequence, retained rows by exact
  outbox state, local missing ranges, retry attempts and sanitized HTTP/error
  diagnostics. It never exports telemetry payload JSON, GPS coordinates, sample,
  device or vehicle identifiers, or authentication tokens.
- Added a distinct confirmed retry action that makes only `PENDING` and expired
  `IN_FLIGHT` rows immediately eligible and schedules the existing backfill.
  `ACKED`, unexpired leases and `PERMANENTLY_REJECTED` evidence are untouched.
- The operational workflow is export before retry, then export after retry and
  reconcile both snapshots with Cloud SQL using trip/sequence values. Export
  within the 24-hour acknowledged-row retention window.
- Verification passed: JavaScript 9/9, TypeScript, zero-warning ESLint, Android
  unit tests, debug instrumentation APK compilation, release unit tests, Android
  release lint, bundle/APK assembly, bundletool validation and signature checks.
- Signed AAB `1.0.7 (8)` is at
  `play-store-assets/Trickee-GPS-Driver-public-1.0.7-8.aab`, SHA-256
  `99DF62E448C05BD579030D45E8720392514AA44BE9A7ED973DD32AD46DAAE535`.
- Physical verification still requires the tester to update in place, export the
  affected phone state, retry pending rows, and provide the after-state export.
- Google Play internal publication is complete: the track is `Active`, release
  `8 (1.0.7) - Telemetry Recovery` is `Available to internal testers`, and Play
  records its release time as 2 September 2026 at 15:13 IST.
- The existing selected `GPS Driver Testers` email list remains unchanged with
  two users. Tester opt-in URL:
  `https://play.google.com/apps/internaltest/4701400293644513393`.
- Play reported only a non-blocking missing deobfuscation-file warning; native
  debug symbols are attached and supported-device counts did not change.

### Full-day production audit refresh — 2026-09-02 22:38 IST

- Refreshed production PostgreSQL at a fixed 17:08:19 UTC cutoff and exported
  all three Rhythm trips from the 2 September IST local day into separate
  telemetry, batch and trip-summary CSVs.
- Reconciled 3,516 telemetry rows = unique samples = unique trip/sequence pairs
  = receipts = summed batch windows. The phones declared 3,648 windows, leaving
  132 exact sequences absent and 96.38% weighted cloud completeness.
- App 1.0.7 reached 1,700/1,713 windows (99.24%), versus 1,816/1,935 (93.85%)
  for the two 1.0.6 trips. All three remain incomplete and training-ineligible.
- Cloud Run request logs corrected an earlier evidence gap: 200 HTTP 422 batch
  attempts and two recoverable 401 attempts occurred even though the database
  rejection table is zero. Schema-level 422 failures occur before canonical
  rejection persistence and must be monitored separately.
- Tester diagnostics prove the 1.0.7 remainder is two HTTP-422 dead-letter rows
  plus 11 pending tail rows after socket timeout. Manual retry produced no new
  telemetry request, supporting the WorkManager `KEEP`/backoff dispatch bug.
- Stored-row GPS quality was 99.94%; end-to-end valid-GPS coverage was 96.33%.
  Accelerometer samples were present in every stored window and gyroscope
  samples in none. No current-day trip has a persisted energy label.
- Removed and verified absence of the private exporter service, its temporary
  image tag and compressed downloads. Production data remained read-only.
- Detailed report and private outputs are under
  `.codex-tmp/gpsdriver-export-20260902-223819/`.

### Lossless retained-telemetry repair and internal release — 2026-09-03

- Released source commit `651556954a50d4923860c0e50b9b24b45c25ea9a`.
  Android now schedules a forced, trip-specific recovery job instead of letting
  an older global WorkManager `KEEP` job suppress a manual retry or trip-end
  drain.
- Explicitly accepted and duplicate sequences remain independently acknowledged;
  known retained HTTP-422 rows are repaired only when their payload changes
  safely, while unresolved invalid rows remain preserved as dead-letter evidence.
- Android sensor accuracy is normalized from the platform's `-1` unavailable
  value to the backend-compatible unknown value `0` for both newly captured and
  safely recoverable retained windows.
- Backend 422 responses now contain sanitized field-level validation details and
  pre-contract failures are recorded in the existing telemetry-rejection table
  without raw payloads, coordinates, tokens, or other sensitive values.
- Regression coverage proves the historical blocked-cursor pattern: after a
  repaired first sequence arrives, the server cursor advances across the already
  stored tail. Backend tests passed `132/132`; mobile JavaScript tests passed
  `9/9`; Android release tests passed `48`, release lint passed, and Terraform
  format/validate/topology checks passed.
- Cloud Build `9201c7b9-72d2-454b-bc1d-ebce53511d4d` produced backend digest
  `sha256:e65af8cc9559cf0695c256960310ad1208de8d6cc4c65767ecd8c9e1b388aaf7`.
  All six GPS Cloud Run services and all four jobs use that exact digest. API and
  WebSocket health checks return `200`, and the new revisions had no error-level
  logs at verification time. No database migration was required.
- The existing Vercel frontend was not changed for this patch. Both
  `trickee.co.in` and `www.trickee.co.in` return `200` and resolve to the existing
  live frontend.
- Signed AAB `1.0.8 (9)` is at
  `play-store-assets/Trickee-GPS-Driver-public-1.0.8-9.aab`, SHA-256
  `D3170BF1CFCF679F86D820468C5665814338A38229FCFB5F6EC6AAE480785B25`.
  Package, target SDK 36, bundle signature, APK signature, and registered upload
  certificate SHA-1 were independently verified.
- Google Play reports the internal track as `Active` and release `9 (1.0.8)` as
  `Available to internal testers`, released 3 September 2026 at 00:15 IST. The
  tester opt-in URL remains
  `https://play.google.com/apps/internaltest/4701400293644513393`.
- Remaining physical gate: the tester must update in place without uninstalling
  or clearing app data, open Telemetry Recovery on a stable network, retry the
  retained trip, and export the after-state diagnostic. If the historic 422s were
  caused by a different field, the rows will remain safely retained and the new
  backend/client diagnostics will identify the exact field rather than deleting
  the evidence.

### No-GPS contract and HTTP-422 request-storm repair — 2026-09-03

- Production evidence for trip `2e16d038-4331-4fbd-af43-9870a1dd7dea`
  showed 102 contract-validation log events in roughly two minutes. All 51
  unique rejected sequences omitted `gps` while reporting no available GPS
  fix. The prior backend type was nullable but still required the key under
  Pydantic v2.
- Backend schema v1 now normalizes an omitted `gps` field to `null`; the
  existing invariant still rejects a missing GPS sample when
  `gps_available=true`.
- Android repairs retained schema-v1 rows by adding explicit `gps:null` only
  when `gps_available=false`. It does not invent a fix or coordinates.
- A detailed field-level HTTP 422 response now dead-letters only the explicitly
  rejected sequence and immediately requeues unaffected peers. This removes
  recursive batch bisection and its upload/request storm while preserving the
  conservative fallback for older or non-specific 422 responses.
- Regression tests covered omitted-no-fix compatibility, retained-row repair,
  no invention when GPS is declared available, and a two-row detailed 422 that
  completes in one HTTP request. Full gates passed: backend `133/133`, mobile
  JavaScript `9/9`, TypeScript, ESLint, Android release unit tests `51/51`, and
  Android release lint.
- Cloud Build `c2d31c62-ab62-486c-b0fa-681f04e86c2e` produced immutable image
  `sha256:e4852485a89efdd9526f7a83594017d247c25a394ae8ad7c8bf2ad0976958654`.
  All six GPS Cloud Run services and all four jobs use that digest; API and
  WebSocket health return `200`, all service revisions are Ready, and no
  error-level logs were present after rollout. No database migration was
  required.
- Signed release candidate `1.0.9 (10)` is at
  `play-store-assets/Trickee-GPS-Driver-public-1.0.9-10.aab`, SHA-256
  `34C71C7F90D9803CCC9A6223183553CA05164D55EBCF015CBAB760E67128EC87`.
  Package `com.trickee.gpsdriverapp`, target SDK 36, bundle/APK signatures, and
  registered upload certificate SHA-1 were independently verified.
- Google Play reports the internal track as `Active` and release `10 (1.0.9)` as
  `Available to internal testers`, released 3 September 2026 at 10:22 IST. The
  tester opt-in URL remains
  `https://play.google.com/apps/internaltest/4701400293644513393`.
- Physical-device confirmation remains pending. The confirmed request storm is
  crash-adjacent, but Play has not supplied an Android stack trace for the
  tester warning, so an in-place update and real trip remain required before
  claiming the OS crash is eliminated.

### Physical 1.0.8/1.0.9 delivery and training audit — 2026-09-03

- Reconciled tester diagnostics for trips `f53249a5...` (1.0.8) and
  `fa4febce...` (1.0.9) against production Cloud SQL in a read-only
  transaction. Both trips achieved exact phone/cloud/receipt parity: 2,093 of
  2,093 and 889 of 889 sequences, cursors at their final sequences, no missing
  ranges, no backend rejections, and finalization completed.
- The repaired upload path sustained one-second cadence, p95 upload latency
  below 4.4 seconds, and a maximum observed phone backlog of five rows on both
  cellular trips. This is positive physical evidence for the lossless-delivery
  and no-GPS 422 repairs, although it does not prove absence of every possible
  Android crash.
- GPS quality was 97.229% and 99.438%, accelerometer completeness was 100%, and
  gyroscope completeness remained 0%; the backend consequently emitted an
  `IMU_LOW_QUALITY` warning for every window.
- The 1.0.8 trip persisted an eligible manual-SOC label (20.262 km, 75% to 49%,
  38.239 Wh/km). The 1.0.9 trip was correctly rejected for training because
  7.865 km is below the 10 km threshold despite complete transport.
- Dataset verdict remains **not ready for model training**: there is only one
  eligible trip, no gyroscope signal, manual rather than BMS energy labels, and
  no driver/route/device diversity. The phone diagnostics also remain marked
  `SYNC_PENDING` after the authoritative cloud state is completed; client
  finalization-state propagation remains a UI/diagnostic follow-up.

### GPS-only synthetic development dataset — 2026-09-04

- Generated a deterministic, privacy-separated OLA S1 synthetic dataset from
  the verified telemetry distributions available through the 1.0.8/1.0.9
  physical-trip audit cutoff (`2026-09-03T11:48:12Z`). A 2026-09-04 live
  calibration refresh was not used because `gcloud` required reauthentication.
- The dataset contains 500 synthetic trips and 1,265,829 one-second GPS windows:
  350/890,800 train, 75/191,223 validation, and 75/183,806 test. Simulated
  drivers and route families are disjoint across the three splits.
- Every synthetic trip is at least 10 km, has 100% stored-sequence continuity,
  at least 95.364% valid GPS, at least 5% SOC delta, no charging, and a target
  between 29.2144 and 37.9952 Wh/km. The primary target is
  `actual_wh_per_km`; it is stored only in the trip-label file and is absent
  from telemetry shards.
- The generator uses GPS-derived kinematics, generated coordinates, realistic
  GPS outages/accuracy and upload latency, dashboard-style SOC quantization,
  and explicit `is_synthetic=true` / `label_source=synthetic_simulation_v1`
  provenance. It excludes gyroscope from the GPS-only feature contract.
- A full independent decompression scan verified all 1,265,829 rows, contiguous
  one-second sequences, trip/window parity, hashes, synthetic markers, target
  isolation, and zero driver/route-family leakage. The workbook's 12 quality
  gates pass and its formula-error scan is empty.
- Synthetic data is approved only for feature engineering, pipeline testing,
  and pretraining. It does not make the production model training-ready and
  must not replace untouched eligible real trips for final evaluation or
  published accuracy claims.

### GPS-only energy-model training baseline — 2026-09-05

- Added an isolated offline modeling package under `modeling/`; it does not
  replace or modify the backend's live physics prediction path.
- The extractor aggregates the 1,265,829 one-second windows into 500 trip rows
  with 31 GPS-derived quality, distance, speed, stop, acceleration, turn,
  altitude and time features. SOC, measured energy, target values, raw
  coordinates, trip IDs and simulated route/driver IDs are excluded from model
  input.
- Preserved the existing route-family/driver-isolated 350/75/75
  train/validation/test split and compared a train-mean baseline, ElasticNet and
  CatBoost. Model selection uses validation MAE only.
- ElasticNet narrowly selected on validation MAE (`1.2021 Wh/km`) and scored
  test MAE `1.1704 Wh/km`, RMSE `1.4773 Wh/km`, MAPE `3.5261%`, and R2 `0.1049`.
  CatBoost scored test MAE `1.2010 Wh/km`; the mean baseline scored `1.2286
  Wh/km`.
- The low test R2 and small improvement over the mean baseline are an explicit
  non-promotion result. The synthetic SOC-derived label is quantized and much
  of its variance is not explained by GPS alone. No learned artifact is enabled
  in production.
- Reproducible models, predictions, feature importance, metrics and a model card
  are in `outputs/01a066ed-bf5d-71d0-9c75-2454ccf6e3e6/gps_energy_model_v1_robust/`.
  Production promotion still requires a sufficiently large untouched physical
  test cohort with authoritative energy labels.

### Trip lifecycle, stationary nudge and session repair — 2026-09-08

- Root cause of the tester's 15-second trip-seal timeout was a native lifecycle
  race: the recurring `/mobile/me` refresh could replay `ACTION_START` while an
  end request was moving the same Room trip to `ENDING`, and the collector used
  to write that trip back to `ACTIVE`. The timer therefore continued and the
  backend correctly refused a second active trip.
- Trip activation is now conditional and atomic. `ENDING` or sealed trips cannot
  be reopened; the bridge persists `ENDING` before dispatching the stop command;
  the service cancels capture work before committing the final partial window;
  and it can recover an `ACTIVE`/`ENDING` trip from Room when process memory has
  been lost.
- Added a native seven-minute stationary tracker in the foreground service. It
  produces a high-priority notification and in-app choice between `I'm waiting`
  and `End trip`; waiting suppresses repeats until genuine movement resumes.
- Session recovery now rotates refresh tokens once even when several requests
  receive 401 concurrently. Polling no longer logs the driver out immediately,
  and protected start/end operations retry once with the renewed access token.
- Release candidate `1.0.10 (11)` is signed by the registered upload certificate
  (`1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A`). AAB:
  `play-store-assets/Trickee-GPS-Driver-public-1.0.10-11.aab`, SHA-256
  `EE50FB6CA455662D79D644A110F863F4E180D32C6717E078755B89AF60CC97B1`.
- Verification: mobile Jest `15/15`, Android release tests `55/55`, TypeScript,
  ESLint, release build, release lint, package/version/SDK checks and bundle
  signature checks pass. Google Play Console shows `11 (1.0.10)` active and
  `Available to internal testers` on the Internal testing track, released on
  8 Sept 2026 at 15:25. Physical-device recovery and live cloud incident
  correlation remain pending; the current gcloud account still requires
  interactive reauthentication.

### Legacy sealed-active recovery and exact production force-close — 2026-09-08

- The tester diagnostic for trip `153c02bb-720e-4f19-b13f-d5d3864918c0`
  proved a second lifecycle defect not covered by 1.0.10: Room stored the trip
  as `ACTIVE` even though `final_sequence_no=1345` and `ended_at` were already
  present. `beginEnding()` returned early for an existing final sequence, so
  the state could never reach `SYNC_PENDING` and every UI retry timed out.
- Android database version 3 now normalizes any pre-end state with an existing
  final sequence to `SYNC_PENDING`. The same normalization is performed
  transactionally on an End Trip retry, so the repair does not depend only on
  app-start migration timing.
- Pending or in-flight rows captured after the sealed boundary are preserved
  locally with `CAPTURED_AFTER_FINAL_SEQUENCE`; they are excluded from upload
  without being silently deleted. Previously acknowledged rows remain intact
  as audit evidence.
- Production Cloud SQL was preflighted through an exact-trip, read-only Cloud
  Run job. Before recovery the backend still reported `active / collecting`,
  no final sequence, no ending SOC and no finalization record. Cloud held all
  1,345 authoritative sequences plus later post-seal rows.
- The exact trip was force-closed at the phone's sealed timestamp
  `2026-09-08T02:12:48.750Z` and sequence 1,345. An independent post-check
  confirmed status/finalization `incomplete`, 1,345/1,345 authoritative rows,
  zero missing sequences, zero active trips for the driver, and 1,961 later
  rows preserved for audit. The label is explicitly training-ineligible with
  reason `missing_ending_soc_manual_recovery`; no SOC was invented.
- Version `1.0.11 (12)` is the published repair. JVM unit tests, React Native
  tests `15/15`, TypeScript, ESLint and Android instrumentation APK compilation
  pass. The signed AAB SHA-256 is
  `7DA05AB1C69BC61B3FA8BAF07CD85A52718238007E992C61CA8E0536ED3C269D`.
  Google Play Console shows `12 (1.0.11)` active and `Available to internal
  testers`, released on 8 Sept 2026 at 16:56. Physical in-place migration on
  the tester's handset remains required before claiming device recovery is
  complete.

### Daily planner chat, pre-trip SOC and high-priority reminders — 2026-09-08

- Added a driver-scoped `Plan My Day` chat flow to the Play application. The
  LLM is limited to an allowlisted `parse_day_schedule` tool; the original
  bounded request and deterministic parser remain authoritative when the LLM is
  absent, unavailable, malformed, or requests an unknown tool.
- Added bounded Google Places, Routes and nearby EV-charger adapters with
  timeouts, short-lived caching, normalized evidence timestamps and explicit
  degraded reasons. Missing provider evidence remains null; a charger place
  listing never claims live connector availability or known charging power.
- Confirmed plans are computed leg by leg. Each leg prefers the latest stored
  GPS prediction's Wh/km for the assigned vehicle and carries its projected SOC
  into the next leg. When no prior prediction exists, the output explicitly
  identifies the lower-confidence vehicle-spec range baseline. The synthetic
  offline ElasticNet artifact remains unpromoted because it requires completed
  telemetry features and has not cleared the real-label validation gate.
- Added durable daily-plan, notification-outbox and nudge-outcome records with
  driver scoping and confirmation/notification idempotency. The Android app
  caches the latest plan separately from telemetry Room data.
- Added local Android reminders backed by WorkManager and a dedicated
  `trickee_route_alerts_high` high-importance channel. Reminder IDs cannot use
  telemetry notification IDs 2101/2102. Cloud outbox payloads also request high
  delivery priority and carry expiry metadata.
- Fresh local evidence: backend `148 passed`; daily-plan focused `10 passed`;
  mobile Jest `22 passed` across 8 suites; TypeScript and ESLint pass; Android
  `testDebugUnitTest` succeeds; migration 0006 passed an
  upgrade/downgrade/upgrade roundtrip.
- A fresh Cloud SQL backup (`1788891590710`) completed before any production
  migration. Live Google/Groq secrets exist in the project but must be mounted
  on the GPS pilot service without exposing their values. Remote FCM delivery
  remains separate from the locally verified high-priority reminder path until
  the GPS Android Firebase identity and a physical background-delivery trace are
  verified.
