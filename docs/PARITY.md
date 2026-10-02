# Web to Android motion parity

Reference: `../trcikee-animated/docs/ANIMATION_INVENTORY.md`, generated from the web main branch. Its 513 IDs are **source occurrences**, including static transforms, font declarations, assets, and transition call sites. They are not 513 distinct animations. An ID is not marked ported merely because it appears in the Android gallery.

| Effect group | Android implementation | Evidence | Status |
| --- | --- | --- | --- |
| Intro logo route path and circle | Exact SVG commands and Chromium-measured path lengths in `mobile/src/motion/logoTimeline.ts`; Reanimated animated props over `react-native-svg` | 21 GSAP easing samples per curve and Android emulator route-build frame pass | Partial: web-to-device SSIM pending |
| Intro artwork and type | Exact web `trickee_logo.png`; licensed Manrope, Syne, Michroma files bundled and static Android cuts generated | Source and font licenses retained in `mobile/assets` | Partial: text width and fallback tests pending |
| Intro grid, orbits, ripples, pulse, halo, caption, exit | UI-thread shared-value styles in `TrickeeLogoAnimated.tsx`; source timing in `logoTimeline.ts` | Timeline and easing Jest tests | Partial: glow/blur, masked shine, exact radial gradient, and native splash handoff remain unmatched |
| Header logo | Same artwork with idle breath; full intro does not replay in header | Static source review | Partial: scroll shrink and lifecycle pause pending |
| Reduced motion | Reanimated reduced-motion hook exposes a static mark with 200ms fade; the exit stage also stays static | Emulator reduced-preview screenshot at the 5,050ms endpoint passes | Partial: Android system setting and physical-device test pending |
| Logo playground | Dev Motion Gallery with scrub, frame steps, slow speed, reduced preview, FPS display; the resolved mark remains visible between replays | Emulator entry, Replay midpoint/end, and reduced-preview endpoint screenshots pass | Partial: frame timing and FPS measurements pending |
| Other web source IDs | Listed by ID and source in the dev gallery | No per-ID Android implementation or visual test | Open |

The web's `logo_reveal.mp4` is tracked but has no active source reference in the public journey. The rendered intro uses the transparent PNG plus SVG, GSAP, and CSS. It is not counted as a missing Android video port.

The app remains on React Native 0.80's old architecture with Reanimated 3.19.4. Current Skia/Reanimated UI-thread integration requires Reanimated 4 and the New Architecture, so this first implementation uses SVG animated props. A Skia migration, native splash art handoff, gallery entries that truly replay every effect, and the requested cross-device SSIM measurements are open work.

No SSIM score, timing tolerance, repeat-loop count, FPS target, or font-width/color tolerance is marked passed without measured device evidence.
