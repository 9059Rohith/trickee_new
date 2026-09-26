# Plan-Aware Trip Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship GPS Driver 1.0.22 (code 24) with reliable voice entry, destination-aware trip start, Plan My Day linkage, recurring schedules, truthful nearby chargers, contextual guidance notifications, and a verified internal-testing release.

**Architecture:** Add backward-compatible plan, leg, endpoint, recurrence, and guidance persistence to the existing FastAPI/PostgreSQL backend. Expose narrow APIs that the React Native app uses through pure policy services and a dedicated trip-start screen, while preserving the native Room telemetry pipeline unchanged. Deploy additive migrations and backend workers before releasing the Android client.

**Tech Stack:** React Native 0.80/TypeScript/Jest, Android Kotlin/WorkManager/SpeechRecognizer/JUnit, FastAPI/Pydantic/SQLAlchemy/Alembic/Pytest, PostgreSQL, Google Routes/Places, Firebase Cloud Messaging, Terraform/Cloud Run, Gradle/Play internal testing.

**Spec:** `docs/superpowers/specs/2026-09-26-plan-aware-trip-start-and-guidance-design.md`

## Global Constraints

- Destination is strongly encouraged but `Record without destination` remains available.
- Telemetry starts only after explicit driver confirmation; schedules and notifications never auto-start a trip.
- Existing one-second Room capture, explicit acknowledgement, retry, and finalization semantics must remain unchanged.
- Old Android clients remain compatible with the extended trip APIs.
- Route, charger, SOC, and location facts carry source, observation time, confidence, and stale/unavailable state.
- Google Places existence does not imply live connector availability, price, occupancy, or booking.
- Outside a trip, charger browsing uses a fresh one-shot location or a visibly time-stamped last-known fallback.
- Voice is optional, stores no raw audio, and never logs transcript content.
- New code follows test-driven development: observe RED, implement minimally, observe GREEN, then run the full owning suite.
- Do not store credentials, tokens, signing secrets, private keys, or tester PII in source, logs, plans, or artifacts.
- Release target is `versionName 1.0.22`, `versionCode 24`, package `com.trickee.gpsdriverapp`.

## Review Focus

- A notification referencing a deleted, foreign, stale, or edited plan leg must open a safe manual start screen and never attach the wrong destination; Task 8 tests this.
- A driver double-tapping Start or voice input must create one trip/recognizer session only; Tasks 1 and 7 test this.
- A route/Places outage must not prevent destinationless or destination-aware GPS capture; Tasks 5 and 7 test this.
- A previous-trip coordinate must never be described as the current charger location; Task 9 tests age labelling and one-shot failure.
- Migration and rollback must preserve existing trips and confirmed daily-plan JSON; Task 2 tests upgrade/downgrade and legacy reads.

---

## File Map

### Backend

- `backend/alembic/versions/0008_plan_aware_guidance.py`: additive schema for plan legs, recurring templates, trip plan links/endpoints, and guidance snapshots.
- `backend/app/models/entities.py`: SQLAlchemy entities and trip columns.
- `backend/app/services/plan_leg_service.py`: owned next-leg selection and transactional leg transitions.
- `backend/app/services/recurring_plans.py`: weekly template validation and idempotent day materialization.
- `backend/app/services/route_guidance.py`: refresh policy, reserve evaluation, corridor charger ranking, and nudge decisions.
- `backend/app/routers/daily_plans.py`: next-leg and recurring-template APIs.
- `backend/app/routers/mobile.py`: compatible destination-aware start contract.
- `backend/app/telemetry/trip_routes.py`: actual endpoint and arrival outcome on telemetry completion.
- `backend/app/worker.py`, `backend/app/cli.py`, `infra/gcp/main.tf`, `infra/gcp/variables.tf`: recurring-plan and route-guidance worker roles.

### Mobile

- `mobile/src/services/tripStart.ts`: pure selection, validation, and payload policy.
- `mobile/src/services/planProgress.ts`: next-leg and terminal-state presentation policy.
- `mobile/src/services/locationFreshness.ts`: fresh versus last-known location decision.
- `mobile/src/screens/detail/TripStartScreen.tsx`: destination/SOC confirmation and trip start.
- `mobile/src/components/DestinationPicker.tsx`: planned/manual/map-pin/destinationless selection.
- `mobile/src/components/NextTripCard.tsx`: next scheduled leg on Home.
- Existing voice, daily-plan, navigation, notification, Live Map, API, and type files change only for their owned behavior.

---

### Task 1: Repair Android voice entry

**Files:**
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/voice/VoiceRecognitionPolicy.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/voice/VoiceRecognitionModule.kt`
- Modify: `mobile/src/services/voiceInput.ts`
- Modify: `mobile/src/services/voiceInputPolicy.ts`
- Modify: `mobile/src/components/VoiceInputButton.tsx`
- Test: `mobile/android/app/src/test/java/com/trickee/gpsdriver/voice/VoiceRecognitionPolicyTest.kt`
- Test: `mobile/src/services/__tests__/voiceInput.test.ts`

**Interfaces:**
- Produces: `VoiceSessionState`, `selectRecognizerMode(apiLevel, requestedLocaleSupported, onDeviceAvailable)`, and stable diagnostic codes consumed only by `VoiceInputButton`.

- [ ] **Step 1: Write failing Kotlin policy tests** for unsupported `en-IN` choosing the platform recognizer, one fallback after locale failure, start timeout, and rejection of a concurrent start.
- [ ] **Step 2: Run `mobile/android/gradlew.bat -p mobile/android testReleaseUnitTest --tests "*VoiceRecognitionPolicyTest"`** and verify failures name the missing policy behavior.
- [ ] **Step 3: Implement the minimal recognizer-selection/session policy** and update the native module to expose `starting/listening/processing/completed/failed`, a bounded ready timeout, single fallback, and non-sensitive diagnostic codes.
- [ ] **Step 4: Write failing Jest tests** proving subscription failure is visible, typed text survives fallback, partial/final text is appended once, and repeated press while starting does not invoke native start twice.
- [ ] **Step 5: Run `npm test -- --runInBand src/services/__tests__/voiceInput.test.ts` from `mobile`**, implement the TypeScript policy/component changes, then rerun until green.
- [ ] **Step 6: Run the complete Jest suite and Android release unit tests**, confirm no transcript/audio appears in logs, then commit `fix(android): make voice entry observable and locale safe`.

### Task 2: Add backward-compatible persistence

**Files:**
- Create: `backend/alembic/versions/0009_plan_aware_guidance.py`
- Modify: `backend/app/models/entities.py`
- Modify: `backend/tests/test_alembic_roundtrip.py`
- Create: `backend/tests/test_plan_guidance_models.py`

**Interfaces:**
- Produces: `DailyPlanLeg`, `RecurringPlanTemplate`, `RecurringPlanStop`, `RouteGuidanceSnapshot`; nullable trip fields `planned_trip_id`, `planned_leg_index`, `destination_source`, `ended_lat`, and `ended_lng`.

- [ ] **Step 1: Write failing model and migration tests** asserting new-table constraints, unique `(plan_id, leg_index)` and `(template_id, service_date)` boundaries, nullable legacy trip fields, distinct planned destination/actual endpoint, and preservation of existing `DailyPlan.result_payload`.
- [ ] **Step 2: Run `python -m pytest tests/test_plan_guidance_models.py tests/test_alembic_roundtrip.py -q` from `backend`** and verify schema/model failures.
- [ ] **Step 3: Implement SQLAlchemy entities and additive Alembic 0009 upgrade/downgrade** without rewriting historical trip destination columns.
- [ ] **Step 4: Rerun targeted tests and the full backend suite**, inspect generated SQL for destructive statements, then commit `feat(backend): add plan-aware guidance schema`.

### Task 3: Link a verified plan leg to trip lifecycle

**Files:**
- Create: `backend/app/services/plan_leg_service.py`
- Modify: `backend/app/routers/daily_plans.py`
- Modify: `backend/app/routers/mobile.py`
- Modify: `backend/app/telemetry/contracts.py`
- Modify: `backend/app/telemetry/trip_routes.py`
- Modify: `backend/tests/test_daily_plans_api.py`
- Modify: `backend/tests/test_telemetry_trip_lifecycle.py`
- Create: `backend/tests/test_plan_aware_trip_start.py`

**Interfaces:**
- Produces: `resolve_owned_plan_leg(db, user, driver, vehicle, plan_id, leg_index) -> DailyPlanLeg`, `transition_leg_for_trip(..., outcome)`, extended `TripStartRequest`, and completion `arrival_outcome: arrived|skipped|ended_elsewhere`.

- [ ] **Step 1: Write failing API tests** for confirmed plans creating durable leg rows, a valid confirmed next leg, foreign/edited/unconfirmed/old-date leg rejection, manual destination, explicit destinationless start, idempotent double start, and old-client payload compatibility.
- [ ] **Step 2: Run `python -m pytest tests/test_plan_aware_trip_start.py -q`** and verify the missing contract failures.
- [ ] **Step 3: Implement owned-leg validation and destination snapshotting** in the mobile start route; never trust mobile coordinates when a plan reference is present.
- [ ] **Step 4: Write failing completion tests** proving actual endpoint does not overwrite planned destination and each arrival outcome creates the correct leg state exactly once.
- [ ] **Step 5: Implement completion transitions in the telemetry route**, rerun the targeted lifecycle suites and full backend suite, then commit `feat(backend): connect plan legs to captured trips`.

### Task 4: Add recurring weekly schedules and next-leg API

**Files:**
- Create: `backend/app/services/recurring_plans.py`
- Modify: `backend/app/routers/daily_plans.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/cli.py`
- Modify: `infra/gcp/main.tf`
- Modify: `infra/gcp/variables.tf`
- Modify: `backend/tests/test_infra_topology.py`
- Create: `backend/tests/test_recurring_plans.py`
- Modify: `backend/tests/test_daily_plans_api.py`

**Interfaces:**
- Produces: `materialize_due_plans(db, local_date) -> MaterializationStats`, `GET /daily-plans/next`, and CRUD routes under `/daily-plans/recurring`.

- [ ] **Step 1: Write failing service/API tests** for weekday validation, timezone-local service date, idempotent retries, disabled templates, single-day edits not mutating templates, plan materialization, and next-leg ordering.
- [ ] **Step 2: Run `python -m pytest tests/test_recurring_plans.py tests/test_daily_plans_api.py -q`** and verify missing-service failures.
- [ ] **Step 3: Implement template CRUD, deterministic materialization, next-leg lookup, and bounded `recurring-plans` worker loop** using template ID plus service date as the idempotency boundary.
- [ ] **Step 4: Add the `recurring-plans` Cloud Run worker to Terraform**, write the topology assertion first, and make the infrastructure validation pass.
- [ ] **Step 5: Run targeted and full backend suites**, then commit `feat(backend): materialize recurring driver plans`.

### Task 5: Produce route, SOC, and charging guidance safely

**Files:**
- Create: `backend/app/services/route_guidance.py`
- Modify: `backend/app/services/daily_plan_tools.py`
- Modify: `backend/app/routers/experience.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/cli.py`
- Modify: `infra/gcp/main.tf`
- Modify: `infra/gcp/variables.tf`
- Create: `backend/tests/test_route_guidance.py`
- Modify: `backend/tests/test_experience_live_services.py`
- Modify: `backend/tests/test_fcm_notifications.py`
- Modify: `backend/tests/test_infra_topology.py`

**Interfaces:**
- Produces: `evaluate_active_trip_guidance(...) -> GuidanceDecision`, `route_corridor_centers(origin, destination, max_points=5)`, notification types `departure_changed`, `low_arrival_soc`, `charger_recommendation`, and `next_stop_ready`.

- [ ] **Step 1: Write failing guidance tests** for ten-minute departure hysteresis, safe-to-unsafe SOC transition, stale telemetry/provider rejection, route outage non-blocking behavior, corridor charger ranking, and one nudge per committed decision.
- [ ] **Step 2: Run `python -m pytest tests/test_route_guidance.py tests/test_experience_live_services.py tests/test_fcm_notifications.py -q`** and verify missing-guidance failures.
- [ ] **Step 3: Implement immutable guidance snapshots, bounded route refresh, reserve evaluation, and corridor candidate ranking** with explicit provider/source fields.
- [ ] **Step 4: Add the `route-guidance` worker role and Terraform service**, write/update topology assertions first, then make them pass.
- [ ] **Step 5: Run backend and infrastructure validation suites**, then commit `feat(backend): add destination-aware route guidance`.

### Task 6: Define mobile plan-start policies and API contracts

**Files:**
- Create: `mobile/src/services/tripStart.ts`
- Create: `mobile/src/services/planProgress.ts`
- Modify: `mobile/src/services/types.ts`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/services/dailyPlans.ts`
- Create: `mobile/src/services/__tests__/tripStart.test.ts`
- Create: `mobile/src/services/__tests__/planProgress.test.ts`

**Interfaces:**
- Produces: `TripStartDraft`, `TripDestination`, `selectNextPlanLeg(plans, now)`, `validateTripStart(draft)`, `buildTripStartPayload(draft)`, and `nextLegPresentation(plan)`.

- [ ] **Step 1: Write failing Jest tests** for next planned stop selection, exact destination provenance, unresolved-text rejection, manual map pin, destinationless warning acknowledgement, stale/foreign deep-link fallback, and idempotency-key stability per submit attempt.
- [ ] **Step 2: Run the two new Jest files** and verify missing-module failures.
- [ ] **Step 3: Implement pure policies and compatible typed API methods** for next leg, recurring templates, plan-aware start, and arrival outcome.
- [ ] **Step 4: Run targeted and full Jest suites**, then commit `feat(mobile): add plan-aware trip start policies`.

### Task 7: Build the destination-aware Start Trip experience

**Files:**
- Create: `mobile/src/components/DestinationPicker.tsx`
- Create: `mobile/src/screens/detail/TripStartScreen.tsx`
- Create: `mobile/src/components/NextTripCard.tsx`
- Modify: `mobile/src/screens/home/HomeScreen.tsx`
- Modify: `mobile/src/components/DriverActionSheet.tsx`
- Modify: `mobile/src/navigation/AppNavigator.tsx`
- Create: `mobile/src/services/__tests__/tripStartFlow.test.ts`

**Interfaces:**
- Consumes: Task 6 trip-start policies and API contracts.
- Produces: stack route `TripStart` with optional bounded `{planId, legIndex}` params; end-trip behavior remains in `DriverActionSheet`.

- [ ] **Step 1: Write failing renderer/policy integration tests** for Home next-trip card, planned prefill, manual destination/map pin, explicit destinationless confirmation, SOC validation, double-submit lock, route-provider failure, arrival/skipped/ended-elsewhere completion selection, and successful native collector start only after backend trip creation.
- [ ] **Step 2: Run `npm test -- --runInBand src/services/__tests__/tripStartFlow.test.ts`** and verify expected failures.
- [ ] **Step 3: Implement `DestinationPicker`, `TripStartScreen`, Home navigation, and slim `DriverActionSheet`** without changing Room collector semantics.
- [ ] **Step 4: Run targeted and complete Jest suites plus TypeScript/ESLint**, then commit `feat(mobile): ask for destination when starting trips`.

### Task 8: Connect plans, recurring UI, and notification deep links

**Files:**
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`
- Modify: `mobile/src/components/DailyPlanLegCard.tsx`
- Modify: `mobile/src/services/dailyPlanNotifications.ts`
- Modify: `mobile/src/services/nudgeInbox.ts`
- Modify: `mobile/src/navigation/navigationLinking.ts`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/notifications/DailyPlanReminderWorker.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/telemetry/notifications/TrickeeNotificationPresenter.kt`
- Modify: `mobile/src/services/__tests__/dailyPlanNotifications.test.ts`
- Modify: `mobile/src/services/__tests__/navigationLinking.test.ts`
- Modify: `mobile/src/services/__tests__/nudgeInbox.test.ts`

**Interfaces:**
- Consumes: Task 4 recurring endpoints and Task 7 `TripStart` route.
- Produces: stable occurrence deep link `trickeegps://start-trip/<planId>/<legIndex>` and weekday-template controls.

- [ ] **Step 1: Write failing tests** for stable local/FCM occurrence IDs, prefilled deep links, deleted/foreign/stale plan fallback, no arbitrary URL handling, and recurring weekday form serialization.
- [ ] **Step 2: Run the targeted Jest and Android notification tests** and verify missing behavior.
- [ ] **Step 3: Implement plan progression display, recurring controls, and bounded notification routing**; accepting a nudge records the outcome but opening navigation remains a separate driver action.
- [ ] **Step 4: Run full mobile and Android unit suites**, then commit `feat(mobile): connect schedules to trip reminders`.

### Task 9: Make nearby chargers location-truthful

**Files:**
- Create: `mobile/src/services/locationFreshness.ts`
- Modify: `mobile/src/services/telemetryNative.ts`
- Modify: `mobile/src/screens/home/LiveMapScreen.tsx`
- Modify: `mobile/src/screens/detail/RouteIntelScreen.tsx`
- Create: `mobile/src/services/__tests__/locationFreshness.test.ts`
- Modify: `mobile/src/services/__tests__/routeRefreshPolicy.test.ts`

**Interfaces:**
- Produces: `resolveChargerLocation({activeTrip, oneShot, lastTelemetry, now}) -> FreshLocation|LastKnownLocation|Unavailable` with a five-minute freshness threshold for one-shot/current labels.

- [ ] **Step 1: Write failing tests** proving non-trip lookup requests one fresh location, five-minute-old data is labelled last-known with timestamp, no destination omits destination-range advice, and active trips use live location/destination.
- [ ] **Step 2: Run the new/changed Jest tests** and verify missing-policy failures.
- [ ] **Step 3: Implement one-shot lookup and truthful labels**, remove the synthetic 10 km destination assumption, and keep current-location station browsing available without a trip.
- [ ] **Step 4: Run complete Jest suite and lint**, then commit `fix(mobile): make charger location freshness explicit`.

### Task 10: Integrate, migrate, and build version 1.0.22

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Create: `play-store-assets/release-notes-1.0.22.txt`
- Modify: `PROJECT_MEMORY.md`
- Modify: `analysis/daily_logger.md`
- Test: all backend, mobile, Android, migration, and infrastructure suites.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: signed `Trickee-GPS-Driver-public-1.0.22-24.aab`, matching APK and metadata.

- [ ] **Step 1: Run baseline-to-head migration against a disposable PostgreSQL database** and verify existing trips/plans survive, new constraints hold, and rollback behavior matches the spec.
- [ ] **Step 2: Run `python -m pytest tests -q` from `backend`, `npm test -- --runInBand` and `npm run lint` from `mobile`, Android `testReleaseUnitTest lintRelease`, and `python infra/gcp/validate_architecture.py`**; record every count and failure.
- [ ] **Step 3: Fix only failures attributable to this work through new failing regression tests**, rerunning the owning suite after each repair.
- [ ] **Step 4: Increment to version 1.0.22/code 24, write tester-facing release notes, and run `scripts/verify-public-release-config.ps1`**.
- [ ] **Step 5: Run `scripts/build-public-release.ps1`**, verify AAB/APK hashes, package, version, min/target SDK, signing certificate identity, and absence of cleartext/debuggable flags.
- [ ] **Step 6: Install the APK on a physical Android device and execute planned/manual/destinationless, voice, notification, offline, reboot, charging, and trip-finalization checks**; do not promote with any failed scenario.
- [ ] **Step 7: Update the durable project log with exact evidence and commit `chore(release): prepare GPS Driver 1.0.20`**.

### Task 11: Deploy backend, canary, and Play internal release

**Files:**
- Deployment state only; no unreviewed source edits.

**Interfaces:**
- Produces: exact backend revision/digest, migration execution record, worker health evidence, Play release identifier, and canary reconciliation evidence.

- [ ] **Step 1: Capture current GCP project/account, Cloud Run revisions, database migration revision, Terraform plan, and rollback targets** without mutating production.
- [ ] **Step 2: Apply the reviewed additive Terraform/backend release, run the migrate job once, and verify API, recurring-plan, notification, and route-guidance worker health** before shifting full traffic.
- [ ] **Step 3: Run authenticated production smoke tests** for legacy trip start, plan-aware start validation, next-leg lookup, notification outbox, and route-provider degradation.
- [ ] **Step 4: Upload the verified AAB to the existing Play internal-testing track with the 1.0.22 notes**, confirm tester availability, package/version/signing identity, and retain the previous release for rollback.
- [ ] **Step 5: Perform one controlled tester canary**, reconciling device Room state, Cloud SQL telemetry, plan-leg status, destination/endpoint separation, notification outcome, and absence of crash loops.
- [ ] **Step 6: Report the exact production revision/digest, Play release state, automated/physical test evidence, known limitations, and rollback commands; do not claim completion if Cloud SQL, device, or Play evidence is missing.**
