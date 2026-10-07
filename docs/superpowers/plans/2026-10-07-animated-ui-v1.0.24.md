# GPS Driver Animated UI 1.0.24 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the linked animated Trickee presentation onto the production GPS Driver client without changing its backend, telemetry, authentication, trip, plan, notification, or destination contracts, then deliver a measured and signed Android `1.0.24 (26)` AAB.

**Architecture:** Work from production commit `47bf810`, treating `gpsdriver-latest` commit `9184ae8` as a visual/motion reference only. Add a small motion/intro layer, apply the visual system to the current navigation and screens, retain all production service and native telemetry logic, and fail the release if parity, performance, identity, Firebase, or signing gates regress.

**Tech Stack:** React Native 0.80.3, React 19.1, TypeScript, Jest, React Navigation 6, React Native Animated, Reanimated 3.19.4, react-native-svg 15.15.5, Kotlin/Android Gradle, Room, WorkManager, Firebase Messaging.

**Spec:** `docs/superpowers/specs/2026-10-07-animated-ui-v1.0.24-design.md`

## Global Constraints

- Base all product behavior on `feature/plan-aware-trip-guidance-v1.0.22` at `47bf810`; never replace `mobile/` with the linked folder.
- Do not import or modify the animated folder's backend, database, telemetry queue, upload, finalization, auth, or notification business logic.
- Preserve package `com.trickee.gpsdriverapp`, target SDK 36, production HTTPS origins, OAuth audience, Firebase registration, and registered upload-certificate SHA-1 `1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A`.
- Release version is `1.0.24 (26)`.
- Full intro runs once per installed application version; repeat launches do not replay it; reduced-motion intro is at most 500 ms; fallback dismissal is 5,750 ms.
- Navigation, map interaction, trip lifecycle, and permission handling never wait for decorative animation.
- Animate transform/opacity or SVG progress on the native/UI thread; do not animate WebView layout, blur, width, height, or off-screen loops.
- Candidate AAB must be at most 35 MB.
- Do not commit signing properties, Firebase values, access tokens, transcripts, or private telemetry.
- Google Play publication is outside this plan; deliver locally verified AAB/APK/metadata only.

## Review Focus

- **Interrupted first launch:** a killed app before the intro finishes must replay safely next launch without corrupting auth or storage; Task 2 tests this.
- **Version upgrade with retained Room data:** `1.0.23` to `1.0.24` must show the new-version intro once while leaving telemetry and credentials untouched; Tasks 2 and 8 test this.
- **Backgrounded animation:** intro and decorative loops must stop or resolve when `AppState` becomes inactive and recover without duplicate callbacks; Tasks 2 and 3 test this.
- **Active GPS plus map interaction:** UI motion must not wrap/re-layout the WebView or interrupt the foreground collector; Tasks 5 and 7 test this.
- **Missing fonts/reduced-motion support:** Android must retain readable system fallbacks and complete navigation when fonts fail or motion is reduced; Tasks 1, 2, and 3 test this.

## File Structure

- `mobile/src/motion/*`: motion tokens, easing, timeline, and lifecycle policy only.
- `mobile/src/theme/typography.ts`: font family names and safe Android fallbacks.
- `mobile/src/services/introPresentation.ts`: pure version/reduced-motion decision logic and the storage key.
- `mobile/src/components/logo/*`: logo renderer and intro presentation only.
- `mobile/src/components/AnimatedScreen.tsx`: reusable non-blocking screen entrance surface.
- Existing screens retain data fetching, callbacks, payload construction, and navigation; their edits are presentation-focused.
- Native resource edits provide the immediate branded launch surface; native telemetry packages are not touched.
- `scripts/measure-android-ui-performance.ps1`: reproducible launch/frame/memory capture.
- `docs/PERF_REPORT_1.0.24.md`: baseline-versus-candidate evidence and limitations.

---

### Task 1: Motion foundation, fonts, and lifecycle policy

**Files:**
- Create: `mobile/src/motion/tokens.ts`
- Create: `mobile/src/motion/easing.ts`
- Create: `mobile/src/motion/logoTimeline.ts`
- Create: `mobile/src/motion/motionPolicy.ts`
- Create: `mobile/src/motion/__tests__/logoTimeline.test.ts`
- Create: `mobile/src/motion/__tests__/webEasing.test.ts`
- Create: `mobile/src/motion/__tests__/motionPolicy.test.ts`
- Create: `mobile/src/theme/typography.ts`
- Create: `mobile/assets/fonts/*` and `mobile/android/app/src/main/assets/fonts/*` from reference commit `9184ae8`, retaining OFL licences
- Create: `mobile/assets/logo/trickee_logo.png`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

**Interfaces:**
- Produces: `motionColors`, `motionDuration`, `logoTimeline`, `webEase(name)`, `motionState({ reducedMotion, appActive, focused }): "full" | "reduced" | "paused"`, and `fontFamily`.
- Consumes: no product-layer interfaces.

- [ ] **Step 1: Write the failing motion tests**

Assert exact full/reduced intro durations, sampled easing parity, paused behavior when inactive/unfocused, reduced mode when the system requests it, and safe typography family exports.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- --runInBand --watch=false src/motion/__tests__/logoTimeline.test.ts src/motion/__tests__/webEasing.test.ts src/motion/__tests__/motionPolicy.test.ts` from `mobile`.

Expected: FAIL because the motion and typography modules do not exist.

- [ ] **Step 3: Add the minimal motion modules, licensed assets, and `react-native-svg@15.15.5`**

Port only the reference timing/easing/assets needed by the shipped UI. Keep the 513-entry inventory and developer gallery out of the production bundle unless a later test requires them.

- [ ] **Step 4: Run focused and full mobile verification**

Run the focused command from Step 2, then `npm test -- --runInBand --watch=false`, `npx tsc --noEmit`, and `npm run lint`.

Expected: focused tests PASS; existing production suite remains green.

- [ ] **Step 5: Commit**

Commit message: `feat: add performance-aware motion foundation`.

### Task 2: Version-gated non-blank intro

**Files:**
- Create: `mobile/src/services/introPresentation.ts`
- Create: `mobile/src/services/__tests__/introPresentation.test.ts`
- Create: `mobile/src/components/logo/TrickeeLogoAnimated.tsx`
- Create: `mobile/src/components/logo/LogoIntroOverlay.tsx`
- Create: `mobile/src/components/logo/__tests__/LogoIntroOverlay.test.tsx`
- Modify: `mobile/App.tsx`
- Modify: `mobile/src/navigation/AppNavigator.tsx`

**Interfaces:**
- Consumes: Task 1 `logoTimeline`, `webEase`, `motionState`, `motionColors`, and `fontFamily`.
- Produces: `INTRO_SEEN_KEY = "@trickee/intro-seen-version"`, `INTRO_RELEASE_VERSION = "1.0.24"`, `selectIntroMode({ seenVersion, currentVersion, reducedMotion }): "full" | "reduced" | "hidden"`, and `<LogoIntroOverlay mode onComplete fallbackMs={5750} />`.

- [ ] **Step 1: Write failing decision and component tests**

Test first launch/full, same-version/hidden, old-version/full, reduced-motion/reduced, missing storage/full, skip-once, fallback-once, completion-once after background/foreground, and non-empty visible copy during every mounted state.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand --watch=false src/services/__tests__/introPresentation.test.ts src/components/logo/__tests__/LogoIntroOverlay.test.tsx`.

Expected: FAIL because the intro modules and App integration do not exist.

- [ ] **Step 3: Implement the pure selector and overlay**

Use AsyncStorage only in the App-level orchestrator. Mark the version seen only after skip or completion; an interrupted sequence remains eligible next launch. Full mode shows route/energy/journey copy and immediate Skip. Reduced mode uses a static mark and <=500 ms fade.

- [ ] **Step 4: Integrate without exposing unresolved auth state**

Keep `AuthProvider`, `AppErrorBoundary`, and `LiveDataProvider` order. The intro may cover auth restoration but cannot bypass or change it. Replace the stock loading spinner with branded, meaningful loading copy that remains accessible.

- [ ] **Step 5: Run focused and full verification**

Run the focused tests, full Jest suite, TypeScript, and ESLint.

- [ ] **Step 6: Commit**

Commit message: `feat: add version-gated animated intro`.

### Task 3: Animated navigation and shared visual shell

**Files:**
- Create: `mobile/src/components/AnimatedScreen.tsx`
- Create: `mobile/src/components/__tests__/AnimatedScreen.test.tsx`
- Create: `mobile/src/services/__tests__/navigationPresentation.test.ts`
- Modify: `mobile/src/constants/Colors.ts`
- Modify: `mobile/src/components/AnimatedOrbs.tsx`
- Modify: `mobile/src/components/GlassCard.tsx`
- Modify: `mobile/src/components/AppHeader.tsx`
- Modify: `mobile/src/components/DetailHeader.tsx`
- Modify: `mobile/src/components/LiquidGlassTabBar.tsx`
- Modify: `mobile/src/components/SideDrawer.tsx`
- Modify: `mobile/src/components/StateViews.tsx`
- Modify: `mobile/src/navigation/AppNavigator.tsx`

**Interfaces:**
- Consumes: Task 1 motion/typography exports and Task 2 intro orchestration.
- Produces: `<AnimatedScreen focused reducedMotion testID>` and a four-tab presentation for `Home`, `Live Map`, `Monitoring`, and `More` that preserves immediate navigation callbacks.

- [ ] **Step 1: Write failing shell tests**

Assert all current root/detail routes remain registered, tab press invokes navigation synchronously, reduced motion sets final values without spring/timing, unfocused/background surfaces become paused, and fallback fonts leave labels present.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand --watch=false src/components/__tests__/AnimatedScreen.test.tsx src/services/__tests__/navigationPresentation.test.ts src/services/__tests__/navigationPolicy.test.ts src/services/__tests__/navigationLinking.test.ts`.

- [ ] **Step 3: Implement the shared shell**

Replace the current multi-loop tab implementation with one bounded indicator/icon transition per selection. Limit drifting orbs to intro/login, stop loops when inactive, retain accessibility roles/states, and avoid blur/layout animation.

- [ ] **Step 4: Run focused and full verification**

Run focused tests, full Jest, TypeScript, and ESLint.

- [ ] **Step 5: Commit**

Commit message: `feat: apply animated navigation shell`.

### Task 4: Core trip, destination, and daily-plan presentation

**Files:**
- Create: `mobile/src/components/__tests__/AnimatedCoreFlows.test.tsx`
- Modify: `mobile/src/screens/home/HomeScreen.tsx`
- Modify: `mobile/src/components/NextTripCard.tsx`
- Modify: `mobile/src/screens/detail/TripStartScreen.tsx`
- Modify: `mobile/src/components/DestinationPicker.tsx`
- Modify: `mobile/src/components/LocationPickerModal.tsx`
- Modify: `mobile/src/components/DriverActionSheet.tsx`
- Modify: `mobile/src/components/SOCEntryModal.tsx`
- Modify: `mobile/src/components/VoiceInputButton.tsx`
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`
- Modify: `mobile/src/components/DailyPlanLegCard.tsx`
- Modify: `mobile/src/components/DailyPlanStopEditor.tsx`
- Modify: `mobile/src/components/PlanConfirmationProgress.tsx`

**Interfaces:**
- Consumes: current `tripStart`, `dailyPlans`, `voiceInput`, `telemetryNative`, and API signatures unchanged; Task 3 visual shell.
- Produces: the same callbacks/payloads and test IDs as `1.0.23`, with the animated visual treatment.

- [ ] **Step 1: Write failing presentation-parity tests**

Render planned, manual search, voice, map-pin, destinationless, invalid-SOC, busy, offline, and provider-error states. Assert the existing control labels, submit gating, provenance, callbacks, and payload inputs are unchanged while the new shared visual shell is present.

- [ ] **Step 2: Run and verify RED**

Run the new test plus `tripStart`, `tripStartFlow`, `plannerForm`, `dailyPlans`, `planProgress`, and `voiceInput` tests. Expected new assertions FAIL before styling integration; all legacy behavior tests remain green.

- [ ] **Step 3: Apply presentation changes without editing service contracts**

Keep backend-trip-before-native-collector ordering, destination provenance, stale-search protection, voice error handling, and destinationless confirmation exactly as implemented in `1.0.23`.

- [ ] **Step 4: Run focused and full verification**

Run all tests named in Step 2, then the full Jest suite, TypeScript, and ESLint.

- [ ] **Step 5: Commit**

Commit message: `feat: restyle trip and daily plan flows`.

### Task 5: Live map, monitoring, and active-trip performance safety

**Files:**
- Create: `mobile/src/services/__tests__/mapMotionSafety.test.ts`
- Modify: `mobile/src/screens/home/LiveMapScreen.tsx`
- Modify: `mobile/src/screens/home/MonitoringScreen.tsx`
- Modify: `mobile/src/components/OpenStreetMap.tsx`
- Modify: `mobile/src/components/TripActiveBanner.tsx`
- Modify: `mobile/src/components/BatteryVisualizer.tsx`
- Modify: `mobile/src/components/CalculationOverlay.tsx`

**Interfaces:**
- Consumes: current `locationFreshness`, `liveSocket`, `liveSoc`, `routeRefreshPolicy`, `openStreetMapHtml`, and native collector interfaces unchanged.
- Produces: visually updated map/monitoring surfaces; WebView remains outside layout-driven animated containers.

- [ ] **Step 1: Write failing safety tests**

Assert idle fresh-location lookup, labelled last-known fallback, active-trip telemetry preference, no fabricated coordinates, unchanged map HTML/bridge contract, no animation props applied to WebView layout, and readable stale/offline/queue states.

- [ ] **Step 2: Run and verify RED**

Run the new test with `locationFreshness`, `openStreetMapHtml`, `liveSocket`, `liveSoc`, and `routeRefreshPolicy` tests.

- [ ] **Step 3: Apply bounded visual transitions**

Animate small badges/cards only. Do not animate the map container or telemetry list layout. Memoize decorative styles and pause nonessential loops while the route is unfocused.

- [ ] **Step 4: Run focused and full verification**

Run focused tests, full Jest, TypeScript, and ESLint.

- [ ] **Step 5: Commit**

Commit message: `feat: restyle live telemetry surfaces safely`.

### Task 6: Remaining routes, roles, and state completeness

**Files:**
- Create: `mobile/src/services/__tests__/animatedRouteParity.test.ts`
- Modify: `mobile/src/screens/auth/LoginScreen.tsx`
- Modify: `mobile/src/screens/VehicleOnboardingScreen.tsx`
- Modify: `mobile/src/screens/detail/AIAssistantScreen.tsx`
- Modify: `mobile/src/screens/detail/RouteIntelScreen.tsx`
- Modify: `mobile/src/screens/detail/RouteNudgesScreen.tsx`
- Modify: `mobile/src/components/RouteNudgeCard.tsx`
- Modify: `mobile/src/screens/detail/DailyImpactScreen.tsx`
- Modify: `mobile/src/screens/detail/PastTripsScreen.tsx`
- Modify: `mobile/src/screens/detail/TripDetailsScreen.tsx`
- Modify: `mobile/src/screens/home/MoreMenuScreen.tsx`
- Modify: `mobile/src/screens/settings/SettingsScreen.tsx`
- Modify: `mobile/src/screens/owner/OwnerDashboardScreen.tsx`

**Interfaces:**
- Consumes: all current API/context/navigation interfaces unchanged and Task 3 shared visual shell.
- Produces: complete animated visual coverage for every production route and role.

- [ ] **Step 1: Write failing route/state parity tests**

Assert each route has loading, populated, empty, offline/error, and accessibility-labelled primary-action states where applicable. Assert owner/driver role navigation and logout behavior remain unchanged.

- [ ] **Step 2: Run and verify RED**

Run the new parity test plus assistant, nudge inbox/storage, trip history, presentation, session recovery, and Google auth error tests.

- [ ] **Step 3: Apply the visual system route by route**

Use shared components and tokens; do not duplicate motion loops or alter request/response handling. Preserve honest `estimated`, stale, pending, unavailable, and incomplete labels.

- [ ] **Step 4: Run focused and full verification**

Run focused tests, full Jest, TypeScript, and ESLint.

- [ ] **Step 5: Commit**

Commit message: `feat: complete animated route presentation`.

### Task 7: Native launch handoff and measured performance

**Files:**
- Create: `mobile/android/app/src/main/res/drawable/trickee_launch_background.xml`
- Create: `mobile/android/app/src/main/res/drawable-nodpi/trickee_splash_logo.png`
- Create: `mobile/android/app/src/main/res/values-v31/styles.xml`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/LaunchPresentationTest.kt`
- Modify: `mobile/android/app/src/main/res/values/colors.xml`
- Modify: `mobile/android/app/src/main/res/values/styles.xml`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/MainActivity.kt` only if the failing handoff test proves the resource theme alone is insufficient
- Create: `scripts/measure-android-ui-performance.ps1`
- Create: `docs/PERF_REPORT_1.0.24.md`

**Interfaces:**
- Consumes: branded logo asset and Task 2 intro contract.
- Produces: immediate non-blank native launch surface and reproducible `am start -W`, `gfxinfo`, and `meminfo` evidence.

- [ ] **Step 1: Write the failing native launch test**

Assert the application/activity theme resolves to the branded drawable, background colors match the React surface, Android 12+ splash values exist, and no telemetry permission/service declaration changes.

- [ ] **Step 2: Run and verify RED**

Run: `mobile\android\gradlew.bat -p mobile\android :app:testDebugUnitTest --tests com.trickee.gpsdriver.LaunchPresentationTest --console=plain`.

Expected: FAIL because launch resources do not exist.

- [ ] **Step 3: Implement the minimal native handoff**

Add only theme/resources required to retain the logo until React draws. Do not add a second native timer or change `TripCollectorService`.

- [ ] **Step 4: Build/install baseline and candidate on the same available ADB target**

Capture five normal launches after intro completion, a fixed navigation/map interaction, and before/after ten-minute memory. If no device exists, record `UNAVAILABLE` and use the same stable emulator for both builds.

- [ ] **Step 5: Evaluate budgets and fix regressions test-first**

The report must contain raw measurements, medians, deltas, janky-frame percentages, memory deltas, AAB-size evidence, target identity, and limitations. Do not mark a budget passed without measurements.

- [ ] **Step 6: Run Android tests and release lint**

Run `:app:testDebugUnitTest`, `:app:testReleaseUnitTest`, and `:app:lintRelease` from a short checkout/build root when native CMake tasks are involved.

- [ ] **Step 7: Commit**

Commit message: `perf: verify animated Android launch and motion`.

### Task 8: Version 1.0.24 release identity and signed artifacts

**Files:**
- Modify: `mobile/android/app/src/test/java/com/trickee/gpsdriver/AppIdentityTest.kt`
- Modify: `mobile/android/app/build.gradle`
- Modify: `scripts/build-public-release.ps1`
- Modify: `scripts/verify-public-release-config.ps1`
- Create: `play-store-assets/release-notes-1.0.24.txt`
- Modify: `PROJECT_MEMORY.md`
- Modify: `analysis/daily_logger.md`

**Interfaces:**
- Consumes: completed Tasks 1-7 and existing signing/Firebase injection workflow.
- Produces: package `com.trickee.gpsdriverapp`, version `1.0.24 (26)`, target SDK 36, signed AAB/APK/metadata.

- [ ] **Step 1: Change the identity test first and verify RED**

Update `AppIdentityTest` to expect `1.0.24 (26)`. Run only that test against the still-`1.0.23` build and confirm the failure names the old version.

- [ ] **Step 2: Update version and strict scripts**

Set `versionName "1.0.24"`, `versionCode 26`, and matching defaults in both release scripts. Add concise release notes covering the animated UI and unchanged trip/telemetry behavior.

- [ ] **Step 3: Run identity/configuration tests and full source gates**

Run Android identity tests, `scripts/verify-public-release-config.ps1`, full Jest, TypeScript, ESLint, Android JVM suites, release lint, and `git diff --check`.

- [ ] **Step 4: Verify the live backend without deploying it**

Confirm production `/health` is `ok`; required OpenAPI routes for auth, trip start/complete, telemetry batches, daily plans, destination resolution, live state, guidance, and notifications remain present; inspect recent API error logs. Record that no backend image or migration changed.

- [ ] **Step 5: Commit and push the clean release source**

Commit message: `chore: prepare GPS Driver 1.0.24 release`. Push `feature/animated-ui-v1.0.24` before building so metadata records an immutable source commit.

- [ ] **Step 6: Build from a genuinely short physical checkout**

Use the private signing-properties file and registered Firebase Android configuration through process environment variables. Run `scripts/build-public-release.ps1` with a short checkout such as `E:\g24` and a same-drive working build root.

- [ ] **Step 7: Independently verify artifacts**

Run `jarsigner -verify`, `keytool -printcert -jarfile`, `apksigner verify --print-certs`, `aapt dump badging`, and SHA-256 hashing. Confirm AAB <=35 MB, upload SHA-1 matches the registered certificate, Firebase fields are present, and metadata source SHA matches the pushed release commit.

- [ ] **Step 8: Record and commit release evidence**

Update project context and daily log with tests, performance evidence, artifact paths/hashes, backend health, source commit, and explicit Play/physical-device boundaries. Commit and push documentation.

- [ ] **Step 9: Deliver the AAB**

Provide the absolute clickable AAB path, version, package, size, SHA-256, signature SHA-1, source commit, performance summary, test totals, and any unverified handset scenarios. Do not claim Play publication.
