# GPS Driver UX Hardening Design

## Status

Approved on 2026-09-11. Source implementation checkpoint completed on
2026-09-11. This specification incorporates the complete Android UX audit and
the clarification that one spoken schedule may contain many stops at different
times.

The implemented source candidate includes stable per-stop identities and
independent time selection, Today/Tomorrow/calendar input, durable local planner
drafts, explicit confirmation progress, push-to-talk transcript entry, one-step
trip SOC sheets, persistent trip controls, incremental map updates, packaged
Leaflet runtime assets, throttled route refresh, driver-first monitoring,
honest unavailable states, actionable nudge labels, a non-blocking stationary
trip decision card, virtualized clickable trip history, expandable trip data
quality, role-aware navigation and read-only driver vehicle specifications.

The production contracts remain frozen: no Room schema, telemetry collector,
outbox acknowledgement, trip lifecycle, authentication, route/SOC calculation,
notification occurrence or backend payload meaning was changed. The full
source gates pass, but physical handset verification is still mandatory before
this candidate can be called release-ready or non-regressing on a real device.
Authorized place search/catalog selection, server-side trip pagination/filtering
and cross-screen provider-cache expansion remain additive follow-up work; the
current UI does not fabricate these capabilities.

## Goal

Make every GPS Driver workflow fast, understandable and accessible without
changing the authoritative telemetry, authentication, routing, SOC, trip or
notification semantics already used by production version `1.0.15 (16)`.

The primary user journey is:

1. Sign in.
2. Start and monitor a trip.
3. Plan one or more stops for a day by voice, text or direct form entry.
4. Review route, SOC and charger evidence.
5. Receive and act on reminders or route nudges.
6. End the trip and review recorded history.

## Non-regression boundary

The UX work must not rewrite or bypass these existing systems:

- the native foreground telemetry service, one-second Room capture, outbox,
  acknowledgement and recovery state machine;
- existing Google sign-in, encrypted session and refresh-token handling;
- current trip IDs, sequence numbers, SOC capture, finalization and training
  eligibility rules;
- deterministic route, charger, traffic, SOC and energy tool outputs;
- notification occurrence IDs, deduplication, deep links and local scheduling;
- existing backend request fields or response meanings.

Existing mobile data must remain readable after an in-place update. New local
UX state uses new namespaced AsyncStorage keys and tolerant versioned decoding.
Backend additions, if required, are optional additive fields or new endpoints;
existing fields are never renamed or assigned a new meaning. The app must
continue to render older responses when new optional fields are absent.

No screen-level refactor may modify native telemetry collection or Room schema
unless it receives its own telemetry design, migration and recovery test cycle.

## UX requirements

### UX-001: Role-aware application shell

- Every authenticated role retains a working application shell and a visible
  route back to its home screen.
- Driver-only actions are hidden or disabled by capability; a role must not be
  placed on an isolated screen without navigation.
- Deep links opened by notifications must resolve inside the same role-aware
  shell and provide a usable back action.

### UX-002: One-step trip controls

- Idle drivers see a persistent `Start trip` action without scrolling.
- Tapping it opens one sheet containing the starting SOC field and confirmation.
- Active drivers see a persistent, visually distinct `End trip` action.
- Ending uses one sheet containing ending SOC, a summary and an explicit
  confirmation that prevents accidental termination.
- The existing native start/end commands, idempotency and recovery behavior are
  retained; this requirement removes redundant presentation steps only.

### UX-003: Persistent input labels

- Every input has a visible label that remains after entry.
- Labels state required/optional status and units where relevant.
- Placeholder text is an example, never the sole label.
- Validation appears below the affected control and tells the user how to fix
  that value without discarding other valid input.

### UX-004: Multi-stop voice and text planning

- The driver may speak or type a complete schedule containing between 1 and 10
  ordered stops, each with its own time.
- Example: `Office at 9, client at 12:30, warehouse at 4, home by 7` becomes
  four independently editable stop cards.
- The existing deterministic parser remains authoritative for stop and time
  extraction. An LLM may help normalize conversational wording but may not
  invent a stop, time, coordinate, route, traffic state, charger fact or SOC.
- A transcript is always shown for review before it is submitted.
- Missing or ambiguous information marks only the affected card. It does not
  reject or silently alter the rest of the schedule.
- Drivers may add, remove and reorder cards after parsing and before confirming.
- The existing 1-to-10-stop backend contract remains unchanged.

### UX-005: Reusable time picker with per-stop values

- Every stop card owns an independent `requested_arrival_local` value.
- Tapping the time on any card opens one reusable time-picker modal initialized
  with that card's current value.
- Selecting a time updates only the active card.
- Reopening the picker for another card displays that other card's value.
- Reordering or deleting cards must not move a time to the wrong stop; stop
  identity is stable and is not based solely on the current array index.
- Manual `HH:MM` typing is removed from the primary flow. The stored and API
  representation remains 24-hour `HH:MM` for backward compatibility.

### UX-006: Voice capture and privacy

- Plan My Day and AI Intelligence provide a clearly labelled push-to-talk
  control; voice capture never starts automatically or continuously.
- Android microphone permission is requested only after the user presses the
  microphone control and sees a concise purpose explanation.
- On-device speech recognition is preferred when the handset supports it.
  Device recognition may otherwise be used only after the user is informed
  that processing can depend on the installed recognition service.
- The app and Trickee backend store only the editable transcript, not raw audio.
- Denial, cancellation, recognizer unavailability, silence and network failure
  retain typed entry and provide an actionable retry state.
- The recognizer is stopped and destroyed when the screen closes or capture is
  cancelled. Continuous recognition is prohibited.
- While a trip is moving, voice entry must not require visual correction; the
  app prompts the driver to review the transcript when safely stopped.

### UX-007: Fast schedule entry

- Provide `Today` and `Tomorrow` date shortcuts plus the calendar picker.
- Provide recent places, saved places and repeat-previous-plan shortcuts where
  those values exist locally or come from an authorized endpoint.
- Location input supports search, current location, map pin and manual label.
- A selected map point displays a resolved address or explicit coordinate
  evidence before confirmation.
- No default city coordinate may be silently accepted as the user's stop. If a
  map fallback is displayed, confirmation remains unavailable until the user
  deliberately moves the pin or selects a result.

### UX-008: Durable planner drafts

- Free text, service date, starting SOC and structured stop edits are saved
  locally after a short debounce.
- A draft is restored after navigation, process death or app restart.
- The UI displays `Saved on this phone`, `Saving` or `Save failed`.
- Confirming a plan replaces the matching draft without deleting unrelated
  plans. A visible discard action is required.
- Local draft persistence does not claim backend confirmation or scheduled
  notifications.

### UX-009: Observable plan confirmation

- Confirmation exposes the stages `Checking location`, `Checking routes`,
  `Estimating SOC`, `Saving plan` and `Scheduling reminders`.
- A failed stage retains all completed work and identifies which legs degraded.
- Retry repeats only the failed operation where the existing API allows it.
- The driver can cancel before server confirmation. After confirmation starts,
  the app must reconcile the plan before offering another confirm action.
- The heading reflects the selected date, such as `Tomorrow's plan` or
  `Plan for 14 September`, rather than always saying `Today's prediction`.

### UX-010: Stable live map and route intelligence

- The Leaflet map instance remains mounted while markers, polylines and status
  update through a message bridge; GPS updates must not recreate the WebView.
- Zoom, pan and selected charger state survive live updates.
- Required Leaflet assets are bundled with the app. Weak connectivity shows the
  last known route and an explicit tile/network status instead of a blank map.
- Route and charger refreshes are throttled by elapsed time, meaningful movement
  or destination change; one-second GPS collection must not create one-second
  provider API requests.
- LiveMap and Route Intelligence share cached charger and route evidence where
  the query inputs match.

### UX-011: Honest live status

- Driver-facing status uses `Live - updated Ns ago`, `Delayed` or `Offline`.
- Sequence numbers, timestamps, provider codes and model provenance appear only
  under expandable technical details.
- `Available now` is shown only when availability is backed by current provider
  evidence. Otherwise use `Availability unconfirmed`.
- A fetch failure is never presented as zero trips, zero impact, zero alerts or
  a successful empty result.

### UX-012: Actionable nudges and alerts

- Action labels describe their real effect: `Use this route`, `Open navigation`,
  `Remind me later` and `Dismiss`.
- `Use this route` is shown only if the action actually selects/launches that
  route. Recording an outcome alone is labelled accordingly.
- Accepted and dismissed cards leave the active feed and remain available in
  history; reversible actions provide a short `Undo` period.
- Home alerts require an explicit action. Tapping the body opens details and
  does not silently acknowledge the alert.
- Stationary-trip decisions use a non-blocking high-priority surface with
  `Continue trip`, `End trip` and `Remind me in 5 minutes`.

### UX-013: Driver-first monitoring

- The default monitoring view contains tracking state, last update age, GPS
  quality, unsynced backlog, current trip state and battery estimate.
- Raw sequences, Wh/km, demand, server commit timestamps and model evidence are
  grouped under `Technical details`.
- Stale or degraded data includes a user action or support diagnostic reference.

### UX-014: Scalable trip history

- Past Trips uses a virtualized paginated list grouped by local date.
- Drivers can filter by date, trip status and data/training readiness.
- Trip details lead with route, duration, distance, SOC used and measured or
  estimated energy with explicit provenance.
- Data quality, finalization, missing sequences and event details are placed in
  an expandable evidence section.
- Maps use recorded GPS only and retain correct trip numbering within the day.

### UX-015: Driver-safe vehicle onboarding

- Drivers select a verified make, model and variant or scan an authorized
  identifier; known specifications are populated from the owned catalog.
- Technical battery, voltage, motor and weight fields are read-only for drivers.
- Admin-only advanced editing is grouped separately with unit and range
  validation.
- The screen uses the standard header, back navigation and progress state.

### UX-016: Navigation simplification

- Primary driver destinations are Home/Trip, Plan, Updates and More. Live map
  remains directly reachable during an active trip.
- Drawer and tab entries must not duplicate the same destinations without a
  distinct purpose.
- Monitoring diagnostics, onboarding, history and settings live under More
  unless the current trip requires a direct shortcut.

### UX-017: Accessibility and automated selection

- Every interactive element has an accessibility role, label, state and hint
  where the result is not obvious from its label.
- Icon-only controls expose meaningful names and disabled states.
- Interactive targets are at least 44 by 44 density-independent pixels.
- Normal text is at least 14sp unless an accessibility-reviewed exception is
  documented; content supports font scaling and adequate contrast.
- Modals trap focus, restore focus on close and announce progress, errors and
  important state changes.
- Critical elements receive stable `testID` values for automated device tests.

### UX-018: User-facing error vocabulary

- Network, authentication, provider, permission, validation and server errors
  have distinct user-facing states and recovery actions.
- Raw internal codes remain under technical details with a bounded correlation
  identifier for support.
- Existing successful data stays visible while background refresh fails.
- Retry buttons are idempotent and disabled while their operation is in flight.

## Component boundaries

The implementation keeps behavior isolated behind focused interfaces:

- `VoiceInputButton` owns microphone permission, recognizer lifecycle and an
  editable transcript result. It does not parse or submit schedules.
- `StopTimePickerModal` receives `{stopId, value}` and emits
  `{stopId, requestedArrivalLocal}`. It does not own the stops array.
- `DailyPlanStopEditor` owns labelled stop cards, stable stop IDs, add/remove,
  reordering, validation and picker/location launch actions.
- `dailyPlanDraftStore` owns versioned local draft encoding, debounce and
  recovery. It does not claim server confirmation.
- `PlanConfirmationProgress` renders the state machine supplied by the existing
  planner orchestration layer.
- `LiveMapController` owns one WebView instance and sends incremental data
  messages to the existing map HTML runtime.
- `routeRefreshPolicy` is a pure function that decides whether a provider query
  is due. It does not collect GPS.
- shared labelled fields, status banners and accessible icon buttons provide
  consistent semantics across screens.

## Data and API compatibility

- The confirmed-plan API continues to receive ordered stop objects with `label`,
  `requested_arrival_local` and optional coordinates.
- A local-only stable stop ID is stripped before API submission unless a future
  backend contract explicitly adopts it as an optional field.
- Times continue to be serialized as `HH:MM`; human-readable 12-hour display is
  presentation only.
- Speech recognition outputs text into the same schedule input consumed today.
- Route/SOC/charger calculations continue to use backend-owned tools. Voice and
  UI shortcuts cannot supply calculated values.
- Existing persisted daily-plan objects, notifications and trip history remain
  readable. Decoders supply defaults only for newly added optional UI fields.

## Verification gates

### Automated gates

- Pure tests prove a paragraph with several stops preserves independent times,
  edits only the selected stop, and retains stop/time association after reorder.
- Draft tests prove debounce, restoration, schema upgrade, failure retention,
  discard and confirmed-plan replacement.
- Voice lifecycle tests cover permission denial, cancellation, partial/final
  transcript, screen unmount, recognizer error and fallback to typing.
- Planner tests cover calendar reopening, past-month prevention, date headings,
  per-field errors and staged confirmation failures.
- Map tests prove live updates do not regenerate HTML and route refresh policy
  suppresses one-second API calls.
- Navigation tests cover driver, fleet manager, owner and admin shells plus
  notification deep links.
- Accessibility tests require labels/roles for critical controls and stable
  `testID`s for device automation.
- Existing mobile Jest, TypeScript, ESLint and Android JVM suites remain green.
- Existing backend tests remain green even when no backend source changes.

### Physical handset gates

- Update in place from Play version `1.0.15 (16)` without uninstalling or
  clearing app data.
- Verify Google sign-in, logout and sign-in recovery.
- Verify an existing local telemetry backlog and active/closed trip remain
  unchanged after opening every redesigned screen.
- Speak schedules containing one, four and ten stops; edit different stop times
  with the same picker; deny and later grant microphone permission.
- Background/resume the app during draft editing and an active trip.
- Verify map pan/zoom stability, offline/degraded rendering and throttled route
  refresh while GPS continues at one-second collection.
- Verify local notification receipt, notification deep link, nudge actions,
  TalkBack order, large font layout and keyboard behavior.

### Release gates

- Do not reuse version code `16`; the next Play artifact must use a strictly
  higher version code selected at release time.
- Review microphone-related Play disclosure and privacy text before upload.
- Signed build, package ID, target SDK, OAuth audience, upload certificate and
  artifact SHA-256 are independently verified.
- Building an AAB is not evidence of Play publication. Play tester availability
  and physical-device UX are recorded as separate outcomes.

## Rollout strategy

Implementation is divided into independently reversible slices:

1. Foundation: labelled fields, accessibility primitives, role shell and honest
   status/error components.
2. Planner: stable stop identities, per-stop picker, draft persistence, calendar
   corrections and progress states.
3. Voice: native recognizer bridge, privacy/permission UX and planner/assistant
   integration.
4. Trip and nudge flow: sticky trip controls and precise actions.
5. Map and route performance: persistent WebView, bundled assets, caching and
   refresh policy.
6. History, monitoring, onboarding and navigation simplification.

Each slice must pass the full existing regression suite before the next slice.
No slice is published solely because its focused tests pass.

## What breaks first

The highest risks are losing the association between a reordered stop and its
time, accidentally treating a restored local draft as confirmed, leaking a
speech recognizer after leaving a screen, and coupling live GPS frequency to
paid provider requests. Stable local stop IDs, explicit persistence states,
recognizer lifecycle cleanup and a pure throttling policy address those risks
before visual restyling begins.
