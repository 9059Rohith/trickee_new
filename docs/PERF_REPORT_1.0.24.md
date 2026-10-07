# GPS Driver 1.0.24 performance report

## Scope

This report compares the immutable production baseline (`47bf810`) with the `1.0.24` animated-UI candidate on the same Android target. The reusable capture command is `scripts/measure-android-ui-performance.ps1`.

## Target and method

- Target: `Pixel_7` AVD (`emulator-5554`, Google `sdk_gphone16k_x86_64`)
- Android SDK: 37
- Launches: five force-stopped `am start -W` launches per build
- Frame evidence: `dumpsys gfxinfo ... framestats`
- Memory evidence: `dumpsys meminfo --local` before and after a 600-second observation
- Interaction boundary: map/navigation interaction requires an authenticated test session; if unavailable on the clean test target, the report must say so rather than substitute fabricated numbers.

## Results

| Metric | 1.0.23 baseline | 1.0.24 candidate | Delta | Gate |
| --- | ---: | ---: | ---: | --- |
| Median normal launch `TotalTime` | 3,320 ms | 2,362 ms | -958 ms (-28.9%) | Pass: no regression |
| Janky frames | 4/6 (66.7%) | 7/7 (100%) | insufficient sample | Unverified: no authenticated interaction |
| PSS delta over 10 minutes | -27,409 KiB | -8,361 KiB | neither build grew | Pass: no idle growth |
| Ending PSS | 43,346 KiB | 56,910 KiB | +13,564 KiB | Recorded; emulator-only |
| Release AAB size | pending | pending | pending | <= 35 MB |

## Raw evidence

Raw captures are retained locally at `E:\vab-downloads\trickeeomen\.codex-tmp\perf-1.0.24`:

- Five `am start -W` outputs and CSV summaries for each build.
- `gfxinfo framestats` outputs for each build.
- `meminfo --local` outputs before and after 600 seconds for each build.
- Target identity JSON for each capture.

The baseline was built from immutable commit `47bf810` as the bundled `pilot` variant. The candidate was built from this branch with the same bundled variant and x86_64 ABI. Both were installed and measured sequentially on the same running emulator. The candidate was launched once and allowed to complete the version-gated intro before the five recorded normal launches.

## Limitations

The frame samples contain only six and seven rendered frames after reset and therefore are not decision-grade jank measurements. The clean emulator was not authenticated, so a fixed map/navigation interaction could not be reproduced honestly. Launch and idle-memory results are valid same-target comparisons, but authenticated map interaction, physical-handset GPS collection, and OEM background-service behavior remain release acceptance checks.
