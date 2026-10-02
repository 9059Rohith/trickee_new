from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from app.services.trip_history import (
    downsample_route_points,
    telemetry_quality,
    valid_route_points,
)


def _window(sequence_no: int, latitude, longitude, *, gps_available: bool = True):
    return SimpleNamespace(
        sequence_no=sequence_no,
        event_time=datetime(2026, 9, 10, 8, 0, sequence_no % 60),
        gps_available=gps_available,
        latitude=latitude,
        longitude=longitude,
    )


def test_route_points_exclude_unavailable_non_finite_and_out_of_bounds_gps():
    windows = [
        _window(1, 21.17, 72.83),
        _window(2, 21.18, 72.84, gps_available=False),
        _window(3, float("nan"), 72.85),
        _window(4, 91.0, 72.86),
        _window(5, 21.19, 181.0),
        _window(6, 21.20, 72.87),
    ]

    assert valid_route_points(windows) == [
        {
            "sequence_no": 1,
            "event_time": "2026-09-10T08:00:01Z",
            "latitude": 21.17,
            "longitude": 72.83,
        },
        {
            "sequence_no": 6,
            "event_time": "2026-09-10T08:00:06Z",
            "latitude": 21.2,
            "longitude": 72.87,
        },
    ]


def test_downsampling_preserves_order_and_both_endpoints():
    points = [
        {"sequence_no": number, "latitude": 21 + number / 1000, "longitude": 72.8}
        for number in range(1, 11)
    ]

    sampled = downsample_route_points(points, limit=4)

    assert [point["sequence_no"] for point in sampled] == [1, 4, 7, 10]


def test_telemetry_quality_separates_stored_missing_and_unknown_final_count():
    assert telemetry_quality(stored_windows=675, final_sequence_no=1098) == {
        "stored_windows": 675,
        "final_windows": 1098,
        "actual_missing_windows": 423,
        "completeness_pct": 61.48,
    }
    assert telemetry_quality(stored_windows=12, final_sequence_no=None) == {
        "stored_windows": 12,
        "final_windows": None,
        "actual_missing_windows": None,
        "completeness_pct": None,
    }
