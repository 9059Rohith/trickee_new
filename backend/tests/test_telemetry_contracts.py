from __future__ import annotations

import copy
import importlib

import pytest
from pydantic import ValidationError


def _contracts():
    try:
        return importlib.import_module("app.telemetry.contracts")
    except ModuleNotFoundError:
        pytest.fail("app.telemetry.contracts has not been implemented")


def valid_window(**overrides) -> dict:
    payload = {
        "schema_version": 1,
        "sample_id": "0198f2d0-31be-7000-8000-000000000001",
        "trip_id": "0198f2d0-31be-7000-8000-000000000002",
        "device_id": "0198f2d0-31be-7000-8000-000000000003",
        "vehicle_id": "0198f2d0-31be-7000-8000-000000000004",
        "sequence_no": 1,
        "boot_id": "0198f2d0-31be-7000-8000-000000000005",
        "event_time_utc_ms": 1_785_941_720_000,
        "monotonic_time_ns": 382_004_912_345_678,
        "window_duration_ms": 1_000,
        "gps_available": True,
        "gps": {
            "latitude": 11.0168,
            "longitude": 76.9558,
            "altitude_m": 411.2,
            "speed_mps": 12.8,
            "bearing_deg": 145.2,
            "horizontal_accuracy_m": 4.7,
            "vertical_accuracy_m": 8.0,
            "provider": "fused",
            "is_mock_location": False,
            "fix_time_utc_ms": 1_785_941_719_980,
            "fix_monotonic_time_ns": 382_004_892_345_678,
            "fix_age_ms": 20,
        },
        "imu": {
            "accelerometer_sample_count": 49,
            "gyroscope_sample_count": 50,
            "accelerometer_complete_pct": 98.0,
            "gyroscope_complete_pct": 100.0,
            "accel_mean_mps2": [0.04, -0.12, 9.79],
            "accel_std_mps2": [0.13, 0.10, 0.18],
            "accel_rms_mps2": [0.14, 0.16, 9.79],
            "accel_min_mps2": [-0.28, -0.39, 9.21],
            "accel_max_mps2": [0.35, 0.30, 10.31],
            "jerk_rms_mps3": 1.2,
            "jerk_max_mps3": 3.7,
            "gyro_mean_rads": [0.01, 0.02, -0.01],
            "gyro_rms_rads": [0.03, 0.04, 0.03],
            "gyro_max_abs_rads": [0.08, 0.11, 0.09],
        },
        "health": {
            "battery_pct": 72,
            "charging": False,
            "network_type": "CELLULAR",
            "location_permission": "PRECISE_FOREGROUND",
            "gps_enabled": True,
            "collector_state": "ACTIVE",
            "local_outbox_pending": 17,
            "app_version": "2.1.0",
            "os_version": "Android 16",
            "device_model": "Pixel",
        },
    }
    payload.update(overrides)
    return payload


def test_missing_gps_window_is_valid():
    contracts = _contracts()
    window = contracts.TelemetryWindowV1.model_validate(
        valid_window(gps_available=False, gps=None)
    )
    assert window.gps is None
    assert window.gps_available is False


def test_omitted_gps_is_normalized_when_window_reports_no_fix():
    contracts = _contracts()
    payload = valid_window(gps_available=False)
    payload.pop("gps")

    window = contracts.TelemetryWindowV1.model_validate(payload)

    assert window.gps is None
    assert window.gps_available is False


def test_claiming_gps_without_payload_is_rejected():
    contracts = _contracts()
    with pytest.raises(ValidationError):
        contracts.TelemetryWindowV1.model_validate(
            valid_window(gps_available=True, gps=None)
        )


def test_gps_payload_when_unavailable_is_rejected():
    contracts = _contracts()
    with pytest.raises(ValidationError):
        contracts.TelemetryWindowV1.model_validate(
            valid_window(gps_available=False)
        )


def test_contract_rejects_unknown_fields_and_invalid_coordinates():
    contracts = _contracts()
    unknown = valid_window()
    unknown["battery_soc"] = 72
    with pytest.raises(ValidationError):
        contracts.TelemetryWindowV1.model_validate(unknown)

    invalid_gps = valid_window()
    invalid_gps["gps"]["latitude"] = 91
    with pytest.raises(ValidationError):
        contracts.TelemetryWindowV1.model_validate(invalid_gps)


def test_contract_enforces_sequence_completeness_and_three_axes():
    contracts = _contracts()
    invalid = valid_window(sequence_no=0)
    invalid["imu"]["accelerometer_complete_pct"] = 101
    invalid["imu"]["accel_mean_mps2"] = [1, 2]
    with pytest.raises(ValidationError):
        contracts.TelemetryWindowV1.model_validate(invalid)


def test_batch_has_a_hard_limit_of_100_windows():
    contracts = _contracts()
    windows = []
    for sequence in range(1, 102):
        window = copy.deepcopy(valid_window(sequence_no=sequence))
        window["sample_id"] = f"sample-{sequence}"
        windows.append(window)
    with pytest.raises(ValidationError):
        contracts.TelemetryBatchRequestV1.model_validate({
            "schema_version": 1,
            "batch_id": "batch-1",
            "trip_id": windows[0]["trip_id"],
            "device_id": windows[0]["device_id"],
            "windows": windows,
        })


def test_sequence_ranges_are_deterministic():
    contracts = _contracts()
    assert contracts.compress_sequence_ranges([4, 2, 3, 7, 7]) == [(2, 4), (7, 7)]
    assert contracts.compress_sequence_ranges([]) == []


def test_missing_ranges_begin_after_the_contiguous_cursor():
    contracts = _contracts()
    assert contracts.missing_sequence_ranges(2, [4, 5, 7]) == [(3, 3), (6, 6)]
    assert contracts.missing_sequence_ranges(7, [1, 2, 7]) == []
