# Trickee web typography sources

These are the same three families loaded by the website's `app/layout.tsx`: Manrope, Syne, and Michroma. Font binaries and the matching OFL license files were downloaded from the official [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl) on 2026-09-24:

- `ofl/manrope/Manrope[wght].ttf` → `ManropeVariable.ttf`
- `ofl/syne/Syne[wght].ttf` → `SyneVariable.ttf`
- `ofl/michroma/Michroma-Regular.ttf` → `Michroma-Regular.ttf`

The font binaries are licensed under the SIL Open Font License. The corresponding license files are retained beside them. The Android app must use the bundled font assets explicitly; a system font fallback is not considered a parity pass.
