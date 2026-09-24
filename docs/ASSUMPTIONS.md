# Motion transformation decisions

- The web reference is the existing `trcikee-animated` checkout. Its spelling differs from the brief's `trickee-animated` label, but its remote is `9059Rohith/trcikee-animated` and it contains the described cinematic public journey.
- The Android target is this `trickee_new-gpsdriver` worktree at GitHub commit `7185bf5` on `feature/daily-planner-v1.0.12`. The older `trickee_new` main checkout has unrelated uncommitted work and is left untouched as requested.
- The live website's logo intro is 5,050ms including exit, with the logo resolved at 2,600ms. Exact source parity takes priority over the brief's suggested shorter intro. A later repeat can be shorter only when it is intentionally documented as a variation.
- `public/trickee_logo.png` is the actual transparent brand artwork. The web's `public/trickee-logo.svg` is a simplified placeholder icon, so it is not the source for the Android logo.
- This is a bare React Native 0.80.3 app using React 19.1, Reanimated 3.19.4, Gesture Handler 2.28, Android min SDK 24 and target/compile SDK 36. `newArchEnabled=false` and `hermesEnabled=true`. Its existing native location and authentication flows are the regression contract.
- Current React Native Skia requires Reanimated 4 and the New Architecture for UI-thread integration. Reanimated 4 only works with New Architecture. Upgrading this production telemetry app's renderer is a separate native migration, so initial vector motion uses `react-native-svg` animated props with Reanimated 3 worklets. This keeps the logo path drawing on the UI thread while preserving the existing architecture; the Skia-specific parity gap is tracked explicitly.
- Only Android 36.1 and 37.0 system images are installed locally. The requested Android 9/10, 14, and 15 emulator matrix needs additional images. No physical device is connected.
- Store signing properties and registered upload keystore are not in this workspace. A signed Play release cannot be certified from this checkout without those external credentials.

These decisions may be revised when device measurements or source review provide stronger evidence. No performance or visual-parity target is marked passed without a recorded measurement.
