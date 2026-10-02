# GPS Driver app map

## Runtime

Bare React Native 0.80.3; React 19.1; Hermes enabled and New Architecture disabled in Android Gradle properties. Android min SDK 24, target/compile SDK 36, build tools 36.0.0, Kotlin 2.1.20, NDK 27.1.12297006. `mobile/App.tsx` wraps the app in Gesture Handler, safe area, auth, error boundary, and live-data providers.

## Navigation

`AppNavigator.tsx` switches between Login and the authenticated root stack. The main tab group contains Home, Live Map, Monitoring, and More. Root stack details include AI Assistant, Route Intelligence, Past Trips, Trip Details, Daily Impact, Route Nudges, Daily Planner, vehicle onboarding, and owner dashboard. The drawer routes to tabs or root details. Existing navigation uses a native stack with `slide_from_right` on detail screens.

## Data and rendering

`AuthContext` owns user identity and session restoration. `LiveDataContext` polls and publishes vehicle, driver, SOC, GPS, alerts, and trip state. `services/api.ts` contains HTTP calls; `services/liveSocket.ts` consumes live updates; `services/telemetryNative.ts` bridges the Kotlin foreground collector and Room-backed telemetry outbox. Home has a long `ScrollView`, refresh control, trip actions, SOC modal, wait/charging flows, and many live cards. The map uses a WebView/OpenStreetMap HTML surface. These data paths must continue to work during motion changes.

## Existing motion

The tab bar animates glass, label, icon, ripple, and an entrance from below. The drawer springs from the side. Battery, calculation overlay, and background orbs use React Native Animated with native-driver transforms/opacity where possible. There is no animation QA gallery, logo timeline, or web-parity motion-token module yet.

## Performance risks

The long Home scroll, animated tab bar, WebView map, telemetry polling, and foreground native collector can run concurrently. Measurements must cover an active trip as well as idle UI. Background loops should pause when their screen is unfocused or the app is backgrounded.
