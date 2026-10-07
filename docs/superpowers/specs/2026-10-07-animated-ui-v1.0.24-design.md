# GPS Driver Animated UI 1.0.24 Design

**Date:** 2026-10-07  
**Status:** Approved design awaiting written-spec review  
**Production baseline:** `feature/plan-aware-trip-guidance-v1.0.22` at `47bf810` (application source `8cd1dfb`), Android `1.0.23 (25)`  
**Visual reference:** `gpsdriver-latest` at `9184ae8`, published under `main/trickee-animated-android` at `9edbf2f`

## Purpose

Replace the current GPS Driver presentation with the linked animated visual language without replacing or regressing the production application underneath it. The release must preserve the deployed API contracts, Google authentication, trip lifecycle, destination search and voice input, lossless Room telemetry queue, one-second GPS/IMU collector, notifications, daily plans, route guidance, and Play upgrade identity.

Success means:

- production functionality remains behaviorally equivalent to Android `1.0.23`;
- all driver-facing screens use one coherent animated Trickee visual system;
- animations remain responsive during maps, scrolling, GPS capture, uploads, and navigation;
- startup never presents an empty full-screen overlay or traps the driver behind an animation;
- reduced-motion and low-performance paths remain usable;
- the final package is `com.trickee.gpsdriverapp` version `1.0.24 (26)`, signed with the registered upload certificate and configured for the existing production backend and Firebase project;
- a verified AAB is delivered with its hash, certificate identity, measured performance results, and explicit physical-device limitations.

## Source Assessment

The animated source is not a safe drop-in replacement.

- Its merge base with the production line is `7185bf5`, the Android `1.0.17` release checkpoint.
- The animated branch contains three later commits, while the production line contains 28 later commits.
- Compared with `1.0.23`, the animated source has 64 differing mobile files, 31 animation-specific files, and lacks 16 current production files.
- Missing current files include `DestinationPicker`, `NextTripCard`, `TripStartScreen`, notification-route policy, location freshness, plan progress, and their tests.
- The animated performance report does not certify cold launch, sustained FPS, memory, or AAB-size impact.
- The published full-screen intro can remain present for about five seconds while its visible logo content starts transparent and exits early. This known blank-state behavior must not be copied.

Therefore, the linked project is a visual and motion reference. It is not the new backend, telemetry implementation, or application baseline.

## Chosen Integration Strategy

Use a selective three-way visual migration onto the current production branch.

1. Keep the production backend directory unchanged.
2. Keep production TypeScript service contracts and native telemetry classes unchanged unless a test proves that a narrow presentation adapter is required.
3. Import animation assets, licensed fonts, motion tokens, logo primitives, and visual component behavior from the reference branch.
4. Reapply the reference screen styling to the current screens rather than replacing current screen files wholesale.
5. Resolve every overlap in favor of current business logic and current API payloads, then layer the new visual treatment around that logic.
6. Add explicit behavior-parity and performance gates before producing the signed bundle.

Rejected approaches:

- **Replace `mobile/` with the linked folder:** fastest visually, but reverts production flows, versioning, release configuration, and queue-related behavior.
- **Merge the entire animated branch:** also imports stale backend and Android changes that are unrelated to presentation.
- **Ship a second application package:** breaks Play update continuity, authentication setup, and retained local telemetry.

## Compatibility Boundary

### Backend and network

No backend schema, endpoint, deployment, worker, or Cloud SQL change is planned. The release continues to use:

- production REST and WebSocket origins;
- existing Google OAuth audience;
- existing Firebase Android registration;
- existing trip, plan, guidance, notification, live-state, and telemetry contracts.

The animated folder's backend code is not imported. Live verification checks health, OpenAPI presence for the endpoints used by the app, and authenticated smoke behavior where credentials are available. A newly discovered contract mismatch upgrades the work to a separate backend change rather than being hidden inside the UI migration.

### Native Android and telemetry

The following remain functionally unchanged:

- Room schema and migrations;
- telemetry entities, DAO, upload queue, acknowledgements, repair, and backfill;
- `TripCollectorService` and one-second GPS/IMU capture;
- device and human credential stores;
- FCM token sync and bounded notification routes;
- voice-recognition bridge and current destination-search behavior.

Allowed native changes are limited to release version identity, bundled fonts/assets, and the native launch theme needed for a seamless non-blank handoff. Any native logic change requires a failing regression test first.

## Visual System

### Brand foundation

Adopt the reference palette, typography, logo art, glass-card language, technical labels, and restrained cyan/yellow accents. Bundle the Manrope, Syne, and Michroma font files and their licences. Define all shared colors, type families, spacing, radii, shadows, and motion durations centrally so screens do not invent local variants.

Glass effects use translucent fills, borders, and small elevation values. Live blur is excluded from the release because it is expensive and inconsistent across Android versions. Decorative elements never obscure GPS status, queue state, controls, warnings, or accessibility focus.

### Screen coverage

Apply the visual system to all current routes:

- login and account recovery;
- vehicle onboarding;
- Home and next-trip card;
- destination-aware trip start, address search, voice input, and movable map pin;
- active trip, wait/charge, resume, and end-trip SOC flows;
- Live Map and charger states, both idle and active;
- Monitoring;
- Plan My Day and recurring plans;
- Route Intelligence and Route Updates;
- Assistant;
- Daily Impact;
- Past Trips and Trip Details;
- owner dashboard where the authenticated role permits it;
- More, Settings, logout, loading, empty, offline, and error states.

No route disappears because the visual reference predates it. Role gating continues to come from the authenticated production session.

### Navigation

Retain the current navigation tree and deep-link policy. Restyle the tab bar, header, drawer, and transitions using the animated reference. Notification links continue to use the current bounded route allow-list; no arbitrary URL navigation is introduced.

Tab feedback uses opacity, translation, and scale on the native/UI thread. Hidden tab animations stop when the route is not focused. Navigation cannot wait for a decorative animation to complete.

## Startup and Intro

The native launch surface shows a static Trickee mark immediately. The React intro then follows these rules:

1. The full branded sequence runs only once for each installed application version.
2. Later launches transition directly from the native mark to authentication or the restored app state without replaying the long sequence.
3. Visible route, energy, and journey copy remains on-screen throughout the full sequence; there is no empty animation stage.
4. A visible **Skip** action is available immediately.
5. A fallback deadline dismisses the overlay if an animation callback is lost.
6. Reduced-motion mode uses a static brand card and short fade no longer than 500 ms.
7. Authentication restoration runs underneath but no authenticated screen is exposed before session state is resolved.

The version-keyed completion flag is presentation state only. Clearing it may replay the intro but cannot affect authentication or telemetry data.

## Motion and Performance Architecture

### Allowed motion

- transform and opacity animations;
- SVG path progress for the logo;
- short card entrance and status-transition feedback;
- bounded button, tab, and progress feedback;
- slow decorative drift only on the login/intro surfaces.

### Prohibited or constrained motion

- no per-frame JavaScript state updates;
- no animation around the WebView map surface;
- no continuous layout, width, height, blur, or shadow animation;
- no unlimited off-screen loops;
- no animation that blocks start trip, end trip, emergency navigation, or permission handling;
- no animation of rapidly updating telemetry values beyond small bounded transitions;
- no repeated intro on every application launch.

React Native `Animated` operations use `useNativeDriver: true` where supported. Reanimated shared values and SVG animated props run on the UI thread. Loops stop on unfocused routes and when `AppState` is not active. Long lists preserve stable keys and avoid recreating animated values during render.

### Performance budgets

Measure the current `1.0.23` build and the candidate on the same available emulator or device. The candidate passes only when:

- there is no ANR, crash, or animation watchdog timeout;
- normal-launch time after the intro has been seen regresses by no more than 300 ms at the median;
- measured janky-frame percentage is no more than one percentage point worse than baseline and remains at or below 3% during the tested navigation/map scenario;
- ten-minute navigation memory is no more than 10% or 15 MiB above baseline, whichever allowance is larger;
- map pan/zoom and scrolling remain responsive while the telemetry foreground service is active;
- the signed AAB is at most 35 MB;
- reduced-motion behavior is functionally complete.

When the available emulator is too unstable for a trustworthy absolute measurement, report both builds' raw results and keep physical-handset performance as an explicit release gate rather than claiming success.

## Behavior-Parity Matrix

Automated and runtime checks cover:

1. Google sign-in success, cancellation, unavailable configuration, token refresh, and logout.
2. Role-aware routes and vehicle assignment.
3. Start trip with planned destination, typed search, voice transcript, map pin, and explicit destinationless choice.
4. Foreground-service start only after the backend trip exists.
5. Active trip continuity through tab changes, background/foreground, offline intervals, waiting, charging, and resume.
6. End-trip SOC, flush/finalization states, and incomplete-sync messaging.
7. Queue/backlog visibility without altering acknowledgement or retry behavior.
8. Plan My Day creation, confirmation, next-leg launch, and recurring plans.
9. Idle and active Live Map location/charger behavior without fabricated coordinates.
10. Route updates, notifications, and deep links.
11. Past trips, trip details, assistant, impact, monitoring, settings, and error/empty/loading states.
12. Process restart and retained local telemetry during an in-place update.

## Testing Strategy

Implementation follows test-driven development. Each behavior or regression test is run red before its implementation and green afterward.

### New automated tests

- intro visibility never becomes empty during its mounted lifetime;
- intro skip and fallback deadline each dismiss exactly once;
- full intro is version-gated and normal launches do not replay it;
- reduced-motion mode avoids the full timeline;
- off-screen/app-background loops stop;
- tab presses navigate immediately regardless of animation state;
- current production routes remain registered;
- new trip-start/destination controls retain their production payloads under the new presentation;
- map and telemetry surfaces are not wrapped in layout-driven animation;
- loading, error, offline, and accessibility labels remain visible.

### Existing gates

- full mobile Jest suite;
- TypeScript `--noEmit`;
- ESLint;
- Android JVM tests, including identity and telemetry policy tests;
- Android release lint/lint-vital;
- strict public-release configuration verifier;
- signed AAB and APK build;
- manifest, target SDK, permission, OAuth, production-origin, Firebase, package, version, and upload-certificate checks;
- independent AAB `jarsigner`, certificate, and SHA-256 verification.

### Runtime checks

- cold and normal launch screenshots/video;
- authentication screen reachability;
- tab, drawer, scrolling, modal, and map interaction;
- reduced-motion rendering;
- background/foreground recovery;
- active collector with live UI navigation when an emulator/device can supply the required permissions;
- `dumpsys gfxinfo`, `am start -W`, and `dumpsys meminfo` capture for both baseline and candidate.

## Release and Rollback

Prepare Android `1.0.24 (26)` from a clean isolated branch. Build from a genuinely short Windows checkout to avoid the known React Native CMake path-length failure. Inject signing and Firebase configuration transiently; do not commit secrets.

Deliver:

- signed AAB;
- signed APK for controlled runtime verification;
- metadata JSON;
- SHA-256 hashes and upload-certificate SHA-1;
- performance comparison;
- test and runtime evidence;
- concise tester upgrade instructions.

This request delivers the AAB but does not implicitly authorize Google Play publication. Testers must update in place and must not uninstall or clear data while local telemetry may be pending.

Because Play version codes cannot be downgraded, rollback after publication is a forward fix using a higher version code. Before publication, rollback is simply abandoning the candidate and retaining `1.0.23`. The backend requires no rollback because this design makes no backend change.

## Explicit Non-Goals

- replacing or redeploying the backend;
- changing telemetry schema, queue, acknowledgement, upload, or finalization behavior;
- redesigning product workflows beyond their presentation;
- adding unverified charger, traffic, BMS, or SOC data;
- copying stale backend or Android business logic from the animated folder;
- claiming physical-device smoothness without measured device evidence;
- uploading to Play without a separate explicit publication request.
