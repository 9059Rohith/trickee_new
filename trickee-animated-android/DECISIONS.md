# DECISIONS.md — GPS-First EV Intelligence Open Decisions

> Conservative defaults are applied until the founder confirms otherwise.

| # | Decision | Default | Status |
|---|----------|---------|--------|
| 1 | Foreground-trip-only vs background location | **Foreground-only** | Awaiting founder |
| 2 | How drivers start/stop GPS collection | **Explicit button in DriverActionSheet** | Awaiting founder |
| 3 | Starting-SOC workflow for GPS-only vehicles | **Manual entry modal on trip start** | Awaiting founder |
| 4 | Which vehicles provide paired BMS ground truth | TBD | Awaiting founder |
| 5 | Vehicle categories/chemistries for first release | TBD | Awaiting founder |
| 6 | Elevation/route/weather/traffic providers | **None for v1** | Awaiting founder |
| 7 | Mobile battery-consumption threshold per hour | **< 5% per tracked hour** | Awaiting founder |
| 8 | Precise-location retention period | **90 days** | Awaiting founder |
| 9 | Error threshold to remove "estimated" label | TBD | Awaiting founder |
| 10 | First output priority | **Wh/km + trip energy + SOC consumed (multi-output)** | Awaiting founder |

Source: FOUNDER_DIRECTION_GPS_APPROACH.md
