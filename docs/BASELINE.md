# Android baseline before motion changes

Commit: `7185bf5` (`feature/daily-planner-v1.0.12`). Node 24.11.1, npm 11.6.2, Java 17, Gradle 8.14.1. The Android SDK is installed under `%LOCALAPPDATA%\\Android\\Sdk`; this linked worktree requires `ANDROID_HOME` or a local `sdk.dir` to build.

| Check | Result |
| --- | --- |
| `npm ci` in `mobile` | passed; 909 packages installed |
| `npm test -- --runInBand --watch=false` | 25 suites, 87 tests passed |
| `npm run lint` | passed |
| `npx tsc --noEmit` | passed |
| `:app:assembleDebug` first attempt | blocked at Gradle configuration because SDK path was unset |
| `:app:assembleDebug` second/third attempts | Reanimated CMake failed on Windows path length; `subst T:` still canonicalized to the deep source path. A genuinely short build checkout is required. |

The checked-in app has no bespoke animated launch logo. `App.tsx` enters the auth and live-data providers immediately, and `AppNavigator.tsx` shows a stock `ActivityIndicator` while auth restores. Existing `AnimatedOrbs`, `BatteryVisualizer`, `CalculationOverlay`, `LiquidGlassTabBar`, and `SideDrawer` use React Native Animated. No React Reanimated import appears in app source despite the dependency and Babel plugin being present.

Device baseline video, cold-start time, frame statistics, and screen recordings are pending emulator boot and a successful debug build. They must be collected before making a performance claim.
