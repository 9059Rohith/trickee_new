# GPS Driver UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved driver-first UX redesign without changing production telemetry, authentication, trip, route/SOC evidence or notification semantics.

**Architecture:** Introduce pure UX policies and small reusable React Native components around the existing services. Keep voice capture behind a narrow Android native bridge, planner drafts behind versioned local storage, and live-map changes behind an incremental message protocol. Existing backend payloads remain compatible and native telemetry code stays outside the change set.

**Tech Stack:** React Native 0.80, React 19, TypeScript, Jest, AsyncStorage, Android Kotlin, Android `SpeechRecognizer`, Leaflet WebView, Gradle/JUnit.

**Spec:** `docs/superpowers/specs/2026-09-11-driver-ux-hardening-design.md`

## Global Constraints

- Preserve `com.trickee.gpsdriverapp`, Google OAuth audiences and existing encrypted sessions.
- Do not modify Room telemetry tables, outbox acknowledgement, one-second capture or trip finalization behavior.
- Preserve the confirmed daily-plan stop payload and 24-hour `HH:MM` representation.
- Use 1–10 stops with independent times and stable local IDs.
- Never send or store raw microphone audio in Trickee mobile storage or backend APIs.
- Route, traffic, charger, energy and SOC facts remain backend-owned evidence.
- No Play upload occurs until automated gates and the physical in-place handset checklist pass.

---

### Task 1: Stable planner stop identities and per-stop time selection

**Files:**
- Modify: `mobile/src/services/plannerForm.ts`
- Modify: `mobile/src/services/__tests__/plannerForm.test.ts`
- Modify: `mobile/src/services/types.ts`
- Create: `mobile/src/components/StopTimePickerModal.tsx`
- Modify: `mobile/src/components/DailyPlanStopEditor.tsx`

**Interfaces:**
- Produces: `PlannerStopView`, `withPlannerStopIds(stops)`, `setPlannerStopTime(stops, stopId, HH_MM)`, and `StopTimePickerModal({stopId, value, onSelect})`.
- Preserves: API `DailyPlanStop` objects by removing local IDs when serializing confirmation.

- [ ] Add failing Jest cases proving four parsed stops retain four independent times, only the selected stop changes, and reorder/delete cannot attach a time to another stop.
- [ ] Run `npm test -- --runInBand src/services/__tests__/plannerForm.test.ts` and confirm failure is caused by the missing stable-ID/time APIs.
- [ ] Implement stable local stop IDs and pure ID-based operations; keep index wrappers only where existing callers still require them.
- [ ] Implement one reusable accessible time-picker modal and replace manual `HH:MM` input with a labelled time button per card.
- [ ] Re-run the focused test, full Jest, TypeScript and ESLint.

### Task 2: Versioned durable planner drafts and date UX

**Files:**
- Modify: `mobile/src/services/dailyPlans.ts`
- Modify: `mobile/src/services/__tests__/dailyPlans.test.ts`
- Modify: `mobile/src/services/plannerForm.ts`
- Modify: `mobile/src/services/__tests__/plannerForm.test.ts`
- Modify: `mobile/src/components/CalendarPickerModal.tsx`
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`

**Interfaces:**
- Produces: `PlannerLocalDraftV2`, `loadPlannerLocalDraft()`, `savePlannerLocalDraft()`, `discardPlannerLocalDraft()`, `plannerDateHeading()` and calendar month guards.

- [ ] Add failing tests for v1 migration, corrupt-state retention, draft restoration, discard, selected-date heading, Today/Tomorrow shortcuts and disabled past-month navigation.
- [ ] Run focused Jest and confirm the expected behavioral failures.
- [ ] Add tolerant versioned storage and debounced save state for message/date/SOC/structured stops without marking a draft confirmed.
- [ ] Synchronize calendar month on reopen, add date shortcuts, prevent useless past-month navigation and render a human-readable selected-date heading.
- [ ] Replace the planner's placeholder-only fields with persistent labels and field-specific validation.
- [ ] Re-run focused/full mobile gates.

### Task 3: Push-to-talk voice input

**Files:**
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/voice/VoiceRecognitionPolicy.kt`
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/voice/VoiceRecognitionModule.kt`
- Create: `mobile/android/app/src/main/java/com/trickee/gpsdriver/voice/VoiceRecognitionPackage.kt`
- Create: `mobile/android/app/src/test/java/com/trickee/gpsdriver/voice/VoiceRecognitionPolicyTest.kt`
- Modify: `mobile/android/app/src/main/java/com/trickee/gpsdriver/MainApplication.kt`
- Create: `mobile/src/services/voiceInput.ts`
- Create: `mobile/src/services/__tests__/voiceInput.test.ts`
- Create: `mobile/src/components/VoiceInputButton.tsx`
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`
- Modify: `mobile/src/screens/detail/AIAssistantScreen.tsx`

**Interfaces:**
- Produces: `TrickeeVoiceRecognition.start(locale)`, `stop()`, `cancel()`, event payloads `{type, text?, code?, message?}`, and a UI component that emits transcript text only.

- [ ] Add failing Kotlin policy and Jest adapter tests for permission denial, unsupported recognizer, partial/final text, cancel/error and cleanup.
- [ ] Run focused suites and confirm failures are caused by missing voice interfaces.
- [ ] Implement the lifecycle-safe Android recognizer bridge, preferring on-device recognition when available and always destroying it on termination.
- [ ] Declare/request `RECORD_AUDIO` only from the microphone interaction and add rationale/denial states.
- [ ] Add labelled push-to-talk controls to planner and assistant; append or replace text only after transcript review.
- [ ] Re-run focused/full mobile and Android JVM gates.

### Task 4: Planner confirmation progress and location safety

**Files:**
- Create: `mobile/src/services/planConfirmationState.ts`
- Create: `mobile/src/services/__tests__/planConfirmationState.test.ts`
- Create: `mobile/src/components/PlanConfirmationProgress.tsx`
- Modify: `mobile/src/components/LocationPickerModal.tsx`
- Modify: `mobile/src/screens/detail/DailyPlannerScreen.tsx`

**Interfaces:**
- Produces: typed confirmation stages and a location selection state that distinguishes current, existing, fallback preview and deliberate user selection.

- [ ] Add failing tests for stage transitions, retryable failures and refusal to confirm an untouched fallback coordinate.
- [ ] Run focused Jest and confirm the missing behavior.
- [ ] Render explicit progress while preserving already completed data and retry information.
- [ ] Disable fallback confirmation until the pin moves or a location is deliberately selected; add recenter/current-location controls and clear evidence copy.
- [ ] Re-run full mobile gates.

### Task 5: Role shell, navigation and trip controls

**Files:**
- Create: `mobile/src/services/navigationPolicy.ts`
- Create: `mobile/src/services/__tests__/navigationPolicy.test.ts`
- Modify: `mobile/src/navigation/AppNavigator.tsx`
- Modify: `mobile/src/components/LiquidGlassTabBar.tsx`
- Modify: `mobile/src/components/SideDrawer.tsx`
- Modify: `mobile/src/screens/home/HomeScreen.tsx`
- Modify: `mobile/src/components/DriverActionSheet.tsx`

**Interfaces:**
- Produces: `navigationForRole(role)` and one role-aware authenticated shell. Existing native trip start/end calls remain the final action boundary.

- [ ] Add failing policy tests for driver, owner, fleet-admin and admin navigation plus notification deep-link reachability.
- [ ] Run focused Jest and confirm role-shell failures.
- [ ] Route every authenticated role through the shared shell, with owner dashboard as role home rather than an isolated root.
- [ ] Present Plan and Updates as primary jobs and remove duplicate drawer entries.
- [ ] Make Start/End Trip persistent and collapse each path to one SOC/confirmation sheet without changing native commands.
- [ ] Re-run full mobile gates.

### Task 6: Incremental map and throttled route refresh

**Files:**
- Create: `mobile/src/services/routeRefreshPolicy.ts`
- Create: `mobile/src/services/__tests__/routeRefreshPolicy.test.ts`
- Modify: `mobile/src/services/openStreetMapHtml.ts`
- Modify: `mobile/src/services/__tests__/openStreetMapHtml.test.ts`
- Modify: `mobile/src/components/OpenStreetMap.tsx`
- Modify: `mobile/src/screens/home/LiveMapScreen.tsx`
- Modify: `mobile/src/screens/detail/RouteIntelScreen.tsx`

**Interfaces:**
- Produces: `shouldRefreshRoute(previous, next, now)` and map messages for markers/polylines/viewport that do not replace the HTML source.

- [ ] Add failing pure tests proving one-second GPS updates do not trigger provider calls and meaningful movement/time/destination changes do.
- [ ] Add a failing map test proving updated data is serialized as a bridge message without regenerating base HTML.
- [ ] Implement background refresh policy, shared cache inputs and incremental WebView updates that preserve user viewport.
- [ ] Package critical map runtime assets or provide the verified local fallback state without changing recorded-route provenance.
- [ ] Re-run full mobile gates and inspect API call counts in a controlled movement fixture.

### Task 7: Honest status, actions, history and accessibility

**Files:**
- Create: `mobile/src/components/LabeledField.tsx`
- Create: `mobile/src/components/AccessibleIconButton.tsx`
- Create: `mobile/src/services/presentation.ts`
- Create: `mobile/src/services/__tests__/presentation.test.ts`
- Modify: `mobile/src/screens/home/MonitoringScreen.tsx`
- Modify: `mobile/src/screens/detail/DailyImpactScreen.tsx`
- Modify: `mobile/src/components/RouteNudgeCard.tsx`
- Modify: `mobile/src/screens/detail/RouteNudgesScreen.tsx`
- Modify: `mobile/src/screens/detail/PastTripsScreen.tsx`
- Modify: `mobile/src/screens/detail/TripDetailsScreen.tsx`
- Modify: `mobile/src/screens/VehicleOnboardingScreen.tsx`
- Modify: all touched controls lacking accessibility semantics.

**Interfaces:**
- Produces: freshness, evidence and error presentation helpers plus reusable accessible controls.

- [ ] Add failing tests for live/delayed/offline thresholds, unavailable-versus-zero values, nudge action labels and driver-friendly evidence formatting.
- [ ] Run focused Jest and confirm failures.
- [ ] Replace technical default copy with driver status and move raw evidence under expandable details.
- [ ] Keep stale successful data visible on refresh errors and prevent fetch failures from becoming authoritative zero values.
- [ ] Virtualize/paginate history presentation and separate summary from data-quality evidence.
- [ ] Add roles, labels, hints, states, 44dp targets, scalable text and stable `testID`s to critical flows.
- [ ] Simplify driver onboarding to catalog selection while preserving admin advanced fields and backend payload compatibility.
- [ ] Re-run full mobile gates.

### Task 8: Regression, handset and release handoff

**Files:**
- Modify: `analysis/daily_logger.md`
- Modify: `analysis/built_implementation_and_remaining_work.md`
- Modify: `mobile/android/app/build.gradle` only after a release candidate passes.

**Interfaces:**
- Produces: a verified source revision and a separately tracked candidate artifact; it does not imply Play publication.

- [ ] Run `npm test -- --runInBand`, `npx tsc --noEmit` and `npm run lint` under `mobile`.
- [ ] Run `./gradlew testReleaseUnitTest lintRelease assembleRelease bundleRelease` under `mobile/android` with the repository's configured signing environment.
- [ ] Run the full backend pytest suite to prove no existing contract regressed.
- [ ] Perform the spec's in-place physical-handset checklist, including retained Room telemetry, Google sign-in recovery, 1/4/10-stop voice schedules, background/resume, maps, reminders and TalkBack.
- [ ] Only after all physical gates pass, increment to an unused version code, rebuild, verify signature/package/OAuth/target SDK, hash artifacts and update the evidence logs.
- [ ] Treat Cloud deployment, Play upload and tester availability as separate explicitly authorized operations.
