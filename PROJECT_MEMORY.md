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

- Local checks: backend full pytest suite 185 passed before the final open-stop completion guard, and the post-guard lifecycle suite passed 15/15. Mobile Jest passed 87/87, TypeScript and ESLint passed, Android `testDebugUnitTest` and `assembleDebug` succeeded after the notification deep link, and `git diff --check` passed.
- This change is **not deployed or published**. The current Android source still reports `1.0.16 (18)`, so a later Play release needs a new version code. Deploy the backend first; only then release the Android client. Test the full wait/charge/resume sequence on a physical handset with an in-place update, both online and offline.
- Do not uninstall or clear the tester's app data while its local telemetry or stop journal may be unsynced. A debug APK is not an installable Play release.
