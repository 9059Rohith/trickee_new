from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def valid_route_points(windows: Iterable[Any]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for window in windows:
        if not window.gps_available:
            continue
        try:
            latitude = float(window.latitude)
            longitude = float(window.longitude)
        except (TypeError, ValueError):
            continue
        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            continue
        points.append(
            {
                "sequence_no": int(window.sequence_no),
                "event_time": _utc_iso(window.event_time),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
    return points


def downsample_route_points(
    points: list[dict[str, Any]], limit: int = 800
) -> list[dict[str, Any]]:
    if limit < 2:
        raise ValueError("Route point limit must be at least 2")
    if len(points) <= limit:
        return list(points)
    last_index = len(points) - 1
    indexes = [round(position * last_index / (limit - 1)) for position in range(limit)]
    return [points[index] for index in indexes]


def telemetry_quality(
    *, stored_windows: int, final_sequence_no: int | None
) -> dict[str, int | float | None]:
    if final_sequence_no is None or final_sequence_no <= 0:
        return {
            "stored_windows": stored_windows,
            "final_windows": None,
            "actual_missing_windows": None,
            "completeness_pct": None,
        }
    missing = max(final_sequence_no - stored_windows, 0)
    return {
        "stored_windows": stored_windows,
        "final_windows": final_sequence_no,
        "actual_missing_windows": missing,
        "completeness_pct": round(min(stored_windows / final_sequence_no * 100, 100.0), 2),
    }
