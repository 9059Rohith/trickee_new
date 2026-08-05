# Gates 1–4 evidence status

Updated: 2026-08-05. Every repository-owned implementation gate is complete.
This file deliberately distinguishes that result from evidence that can only be
produced on physical phones, company Google Cloud, or multi-day fleet operation.

| Gate | Repository-owned deliverable | Local status | External evidence required before gate closure |
|---|---|---|---|
| 0 Foundation | v1 contract, device auth, Google backend auth, batch idempotency, migrations | Implemented and tested | Company OAuth consent/client configuration review |
| 1 Two vehicles | Native 1 Hz GPS/50 Hz IMU collector, Room WAL outbox, Keystore credentials, uploader/backfill, React Native bridge | Implemented; unit tests, instrumentation-test compilation, Kotlin compilation and debug APK assembly passed | Two distinct Android phones/vehicles, complete concurrent trips, interruption/reboot/network-loss traces, cadence/completeness and battery evidence |
| 2 Realtime pipeline | Trip final-sequence barrier, PostgreSQL outbox, Redis relay/consumers, idempotent projections/events/finalizer, REST/WebSocket/metrics | Implemented; deterministic backend suite passed | Company-GCP canary, real reconnect/version-gap exercise, Redis failover observation |
| 3 Capacity/recovery | HA/PITR/private Terraform topology, role packaging, load harness, archive verification and recovery runbook | Implemented; HCL parsing, static safety validation, Compose validation and synthetic harness passed | Applied/validated GCP plan, 150 live identities for 60 min, 300 window/s burst, 30-device backlog, Cloud SQL restore/PITR and archive restore-and-compare |
| 4 Rollout | Cohort evaluator and objective thresholds for 10/25/50/100/150 | Implemented; deterministic threshold and hold tests passed | Three consecutive operating days per cohort; no cohort has yet earned promotion evidence |

## Local evidence ledger

- Android: `app:testDebugUnitTest app:compileDebugAndroidTestKotlin app:assembleDebug`
  passed (`313` actionable tasks, `BUILD SUCCESSFUL in 14m 4s`). Room
  instrumentation tests compiled; execution on the supported physical-device
  matrix remains external evidence.
- Mobile: Prettier check, `npx tsc --noEmit`, and ESLint over every changed/new
  TypeScript file passed with zero errors and zero warnings. Repository-wide
  ESLint remains unsuitable because the inherited configuration scans generated
  Android reports and contains pre-existing CRLF violations.
- Backend: full pytest passed (`76 passed`, seven upstream `httpx` deprecation
  warnings, 72.85 seconds).
- Database: an empty disposable SQLite database upgraded through
  `0003_realtime_processing (head)` and was removed after verification.
- Local deployment: `docker compose config --quiet` passed with non-production
  placeholder values.
- Google Cloud topology: all five `.tf` files parsed as HCL and
  `validate_architecture.py` passed. Terraform CLI is not installed on this
  workstation, so `terraform fmt -check`, provider-schema `terraform validate`,
  plan/apply and cloud runtime evidence remain pending.
- Capacity harness: the two-identity dry-run scheduled live traffic, two
  100-window backlogs and a 300-window/second burst; all `520` synthetic windows
  were accepted with zero duplicates, rejections or failures. Dry-run latency
  values are intentionally zero and are not production performance evidence.
- Dependency audit: `npm audit --omit=dev` reports 16 inherited production-tree
  advisories (9 moderate, 6 high, 1 critical) in the React Native CLI and voice
  build dependency chains. Available remediations require disruptive React
  Native/voice upgrades and must be resolved and re-certified before a release.

No company credentials, Terraform state, service-account keys, physical
telemetry traces, or unsupported production claims are stored here. The
repository implementation is complete; Gates 1–4 are not certified for fleet
promotion until every external-evidence column above is satisfied.
