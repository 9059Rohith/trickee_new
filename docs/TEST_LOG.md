# Motion test log

| ID | Severity | Reproduction / finding | Root cause and fix | Retest |
| --- | --- | --- | --- | --- |
| M001 | P1 build | `:app:assembleDebug` from the deep checkout fails in `react-native-reanimated:buildCMakeDebug[x86_64]` with `ninja: error: mkdir(...): No such file or directory` | Windows CMake object path exceeded the practical path limit. `subst T:` still resolved to the deep source path. The verification build is moving to a genuinely short checkout. | Pending short-checkout build |
| M002 | P2 | Dev gallery could not be reached without authenticated backend access | Added a development-only auth stack route and login entry | Device test pending |
| M003 | P2 | Header placed `TRICKEE` text beside artwork that already has its own wordmark | Removed duplicate header text and kept the original PNG | Device visual test pending |
| M004 | P1 visual | Initial logo pulse, ripples, and halo used linear progress despite GSAP source easings | Added worklet implementations of the exact easing families and 21-point GSAP sample fixture | Jest easing suite passed |
| M005 | P1 web test | Browser smoke timed out before the new gallery finished first compilation while Gradle compiled native dependencies | No gallery assertion was reached; rerun the same test after the native build frees resources | Pending |

The Android functional regression suite and motion tests passed together: 27 suites and 95 tests. Android lint and TypeScript passed. Web source tests passed 43/43. Browser, native launch, visual parity, soak, accessibility matrix, and release signing remain unverified.
