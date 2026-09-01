# GPS Driver release and Gates 0-4 evidence

Updated: 2026-08-31.

The signed Android release is active on the Google Play internal-test track.
Repository, emulator, deployment, migration, provisioning, and Play publication
verification are complete. Fleet certification
is not complete: a real driver sign-in, road trip, interruption/recovery test,
and the larger operating cohorts still require physical evidence.

## Internal-test release

| Item | Verified value |
|---|---|
| Application ID | `com.trickee.gpsdriverapp` |
| Version | `1.0.3` (`versionCode 4`) |
| Target SDK | 36 |
| AAB | `C:\Users\AJEYA\AppData\Local\Trickee\gpsdriver-public-android-build\release\Trickee-GPS-Driver-public-1.0.3-4.aab` |
| AAB SHA-256 | `D32380448C0A042D2986E61927C2BBDB630470E4186F7AC82A89D984631440F5` |
| APK | `C:\Users\AJEYA\AppData\Local\Trickee\gpsdriver-public-android-build\release\Trickee-GPS-Driver-public-1.0.3-4.apk` |
| APK SHA-256 | `0C931C2F914246F173CC2AFF94D7D2A03987F3F57A369FC149205B76DBFFD11C` |
| Signing certificate SHA-1 | `1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A` |
| Play status | `Available to internal testers`; release `4 (1.0.3)` published 2026-08-31 08:32 IST |
| Tester opt-in | `https://play.google.com/apps/internaltest/4701400293644513393` |

The fail-closed release script built and independently checked both artifacts.
It verified the AAB signature and certificate, the APK v2 signature, package,
version, launcher, target SDK, hosted API/WebSocket configuration, all required
permissions, and the absence of background-location, microphone, and advertising
ID permissions. The release APK installed and cold-launched on an Android 17
emulator; its process remained alive and the fatal-crash scan was clear.

## Verification completed

- Backend: `109 passed` in a clean virtual environment.
- Mobile: Jest `9/9`, TypeScript, and repository mobile ESLint passed.
- Android: combined `testDebugUnitTest`, `lintRelease`, `assembleRelease`, and
  `bundleRelease` passed (`406` actionable tasks).
- Room instrumentation: `7/7` storage/recovery tests passed on the emulator.
- Alembic: upgrade/downgrade/upgrade through `0005_trip_energy_labels` passed
  against a clean SQLite database.
- API health: HTTP 200 and reports `GPS-First v2.0`,
  `gps_model_active=true`, and `bms_model_active=false`.
- WebSocket health: HTTP 200.
- Public pages: `/gpsdriver/privacy`, `/gpsdriver/terms`, and
  `/gpsdriver/support` each return HTTP 200.
- Cloud Build: execution `bcfbca68-a1ea-49a1-b2a9-cad52575a527` succeeded and
  image digest `sha256:e5209f9cd892f02eac62b68e78976d1a285a87b5bc368068f66866b69b76c666`
  is deployed across the six pilot Cloud Run services with 100% traffic.
- Production migration execution `trickee-pilot-migrate-6vnkf` succeeded.
- One-shot provisioning execution `trickee-pilot-migrate-rxbcw` created the
  approved pilot assignment (`GPS-PILOT-01` / `OLA-S1-PILOT-01`). The job was
  restored to `python -m app.cli migrate`; its temporary Secret Manager secret
  and Cloud Shell payload were deleted and verified absent.
- Play Console reports release `4 (1.0.3)` available to internal testers, and
  the selected `GPS Driver Testers` list contains two saved users.

`npm audit --omit=dev` reports six high advisories in the React Native/Metro
toolchain. The available automatic remediation replaces React Native with a
new breaking major version, so that upgrade is intentionally deferred to a
separate tested change. There are no critical production dependency advisories.

## Gate status

| Gate | Current status | Evidence present | Evidence still required |
|---|---|---|---|
| 0 Foundation | Internal-test release live | Standalone identity, release certificate, hosted endpoints, OAuth audience, production migration, approved driver/OLA S1 provisioning, Play publication, emulator install/launch | Complete real Google sign-in and a physical-device road trip; finish Play app setup/review to replace the temporary unreviewed name |
| 1 Two vehicles | Implementation complete, not certified | Event-time 1 Hz GPS/50 Hz IMU collection, honest gap windows, Room WAL outbox, atomic sealing, foreground service, live/backfill upload | Supported physical phones and vehicles, concurrent full trips, interruption/reboot/network-loss traces, completeness and battery evidence |
| 2 Realtime pipeline | Deployed endpoint health verified | API and WebSocket health pass; idempotent ingestion, contiguous ACKs, retry and recovery tests pass | Real-device reconnect/version-gap test and observed Redis failover exercise |
| 3 Capacity/recovery | Architecture implemented, not certified | Storage-pressure policy, bounded retention, PostgreSQL/Redis/archive topology and tooling | 150 identities for 60 minutes, 300-window/s burst, 30-device backlog, Cloud SQL PITR and archive restore-and-compare |
| 4 Rollout | Evaluator implemented, no cohort promoted | Objective threshold evaluator and fail-closed missing-evidence behavior | Three consecutive passing operating days for each 10/25/50/100/150 cohort |

## Operational boundary

The cloud and Play operations are complete. The internal tester must open the
opt-in URL while signed into an address in the saved tester list; Play propagation
can take time. The app still carries Play's temporary unreviewed package name.
A real-device Google sign-in, full road trip, interruption/recovery exercise,
and battery evidence remain external requirements and are not implied by the
successful emulator, backend, or Play checks.
