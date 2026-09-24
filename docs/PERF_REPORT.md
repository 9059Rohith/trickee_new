# Motion performance report

No before/after performance claim is available yet. The baseline APK was not launched before motion changes because this worktree initially lacked an SDK path and its deep Windows path broke Reanimated's CMake build. Source-level baseline tests were recorded in `BASELINE.md`.

| Metric | Baseline | Current | Budget | Measurement |
| --- | --- | --- | --- | --- |
| Cold launch to interactive | not captured | pending emulator launch | <=1.5s mid-range | `adb shell am start -W` plus visible-frame review |
| Sustained FPS / janky frames | not captured | pending | >=60 FPS, <1% jank | `dumpsys gfxinfo framestats` / trace |
| Logo frame parity | not captured | pending | SSIM >=0.92 | web frame export and Android gallery frames |
| Memory after 30-minute soak | not captured | pending | within 10% | `dumpsys meminfo` before/after |
| AAB size delta | not captured | pending signing config | report delta | `bundleRelease` with registered upload key |

Only an Android 16 x86_64 emulator is currently available. Requested Android 9/10/14/15 images, 120Hz profile, and a physical device have not been measured.
