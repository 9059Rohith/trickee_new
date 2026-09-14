# GPS Driver project context

Updated: 2026-09-14. Repository: `gpsdriver`, branch `feature/daily-planner-v1.0.12`.

## Current change: waiting and vehicle charging within one trip

- The old stationary action only acknowledged a seven-minute reminder. It did not create a persistent wait or distinguish vehicle charging from phone charging.
- The new Home flow offers an immediate "I'm waiting or charging" action and asks whether the driver is charging the vehicle. The seven-minute stationary notification also deep-links to that prompt. A waiting/charging stop retains the original active trip ID and keeps the native GPS collector running. After a charging stop, resuming that trip requires a new vehicle-dashboard SOC; an uncharged wait resumes without one.
- Stop start/resume actions and the post-charge SOC are journaled on the phone before network sync. They replay in order with stable wait IDs and device-reported times, without making the rider wait for a stalled HTTP request. Trip completion is blocked while a stop is open or an action remains unsynced, on both client and server, so an offline charging declaration cannot silently become a clean training label.
- Authenticated `POST /api/v2/trips/{trip_id}/wait` and `/resume` persist idempotent wait events in `MobileTripSession.context`; `/mobile/me` exposes the active wait. Post-charge SOC is a `dashboard_confirmed` `SOCReading`. No database migration is needed for this JSON-backed pilot event ledger.
- The finalizer now uses the explicit vehicle-charge flag, **not** the phone's `health.charging` field. A charged trip keeps its GPS route and estimates, but its start-to-end measured energy/Wh-per-km target is null and training-ineligible. Past-trip SOC-used copy is also suppressed after charging.
- The stationary notification's waiting action deep-links to the Home prompt.

## Verification and release boundary

- Source commit `606f9c9d954c507a43adfcd88acce5aba8c88812` is pushed to the existing feature branch. Backend full pytest passed 185/185; mobile Jest 87/87, TypeScript, ESLint, Android JVM tests, full `lintRelease`, and signed release build passed. The registered upload certificate, package `com.trickee.gpsdriverapp`, target SDK 36, and version `1.0.17 (19)` were verified. AAB SHA-256: `02B1CAB13E595AFEF6FD6403DD65BDAA1729F0C632364130C20E5315DBBD6ECB`. Remote FCM remains unconfigured; do not claim remote push delivery.
- Cloud Build `e9a5bc7e-7860-477b-9c17-241c16b03772` built immutable digest `sha256:9b973660fca1ed04f178fb7320436ff092d681bc0e00090ff8f7cc1da2cad118` from the pinned source commit. Cloud Run API revision `trickee-pilot-api-00017-joz` and trip-finalizer revision `trickee-pilot-trip-finalizer-00009-nih` each serve 100% traffic. Public `/health` is `ok`; `/wait` and `/resume` are present in public OpenAPI; no revision error logs were found in the verification window. No database migration was required.
- **Play publication is pending** the Google Play Console owner's sign-in. The signed AAB is built but must not be given to testers until the internal-testing track confirms it is available. Then perform an in-place physical-handset wait/charge/resume test, including offline reconciliation. The two direct Cloud Run image updates should be incorporated into the next reviewed Terraform plan so an old pinned image cannot roll them back.
- Do not uninstall or clear the tester's app data while its local telemetry or stop journal may be unsynced. A debug APK is not an installable Play release.
