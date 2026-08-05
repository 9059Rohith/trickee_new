"""Canonical version 1 GPS/IMU telemetry contracts.

Field names include their units. Unknown data is rejected so an Android client
cannot silently drift from the server contract or label GPS estimates as BMS
telemetry.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class GpsSampleV1(StrictContract):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float | None = None
    speed_mps: float | None = Field(default=None, ge=0)
    bearing_deg: float | None = Field(default=None, ge=0, lt=360)
    horizontal_accuracy_m: float | None = Field(default=None, ge=0)
    vertical_accuracy_m: float | None = Field(default=None, ge=0)
    provider: str = Field(min_length=1, max_length=50)
    is_mock_location: bool
    fix_time_utc_ms: int = Field(ge=0)
    fix_monotonic_time_ns: int = Field(ge=0)
    fix_age_ms: int = Field(ge=0)


Axis3 = tuple[float, float, float]


class ImuSummaryV1(StrictContract):
    accelerometer_sample_count: int = Field(ge=0)
    gyroscope_sample_count: int = Field(ge=0)
    accelerometer_complete_pct: float = Field(ge=0, le=100)
    gyroscope_complete_pct: float = Field(ge=0, le=100)
    accel_mean_mps2: Axis3
    accel_std_mps2: Axis3
    accel_rms_mps2: Axis3
    accel_min_mps2: Axis3
    accel_max_mps2: Axis3
    jerk_rms_mps3: float = Field(ge=0)
    jerk_max_mps3: float = Field(ge=0)
    gyro_mean_rads: Axis3
    gyro_rms_rads: Axis3
    gyro_max_abs_rads: Axis3


class DeviceHealthV1(StrictContract):
    battery_pct: float = Field(ge=0, le=100)
    charging: bool
    network_type: str = Field(min_length=1, max_length=30)
    location_permission: str = Field(min_length=1, max_length=50)
    gps_enabled: bool
    collector_state: str = Field(min_length=1, max_length=30)
    local_outbox_pending: int = Field(ge=0)
    app_version: str = Field(min_length=1, max_length=50)
    os_version: str = Field(min_length=1, max_length=100)
    device_model: str = Field(min_length=1, max_length=100)


class TelemetryWindowV1(StrictContract):
    schema_version: Literal[1]
    sample_id: str = Field(min_length=1, max_length=64)
    trip_id: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1, max_length=64)
    vehicle_id: str = Field(min_length=1, max_length=64)
    sequence_no: int = Field(ge=1)
    boot_id: str = Field(min_length=1, max_length=64)
    event_time_utc_ms: int = Field(ge=0)
    monotonic_time_ns: int = Field(ge=0)
    window_duration_ms: int = Field(gt=0)
    gps_available: bool
    gps: GpsSampleV1 | None
    imu: ImuSummaryV1
    health: DeviceHealthV1

    @model_validator(mode="after")
    def validate_gps_availability(self) -> "TelemetryWindowV1":
        if self.gps_available != (self.gps is not None):
            raise ValueError("gps_available must agree with the gps payload")
        return self


class TelemetryBatchRequestV1(StrictContract):
    schema_version: Literal[1]
    batch_id: str = Field(min_length=1, max_length=80)
    trip_id: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1, max_length=64)
    windows: list[TelemetryWindowV1] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_window_identity(self) -> "TelemetryBatchRequestV1":
        sample_ids: set[str] = set()
        sequences: set[int] = set()
        for window in self.windows:
            if window.trip_id != self.trip_id or window.device_id != self.device_id:
                raise ValueError("every window must match the batch trip and device")
            if window.sample_id in sample_ids or window.sequence_no in sequences:
                raise ValueError("sample_id and sequence_no must be unique within a batch")
            sample_ids.add(window.sample_id)
            sequences.add(window.sequence_no)
        return self


class TelemetryRejectionV1(StrictContract):
    sequence_no: int = Field(ge=1)
    sample_id: str | None = Field(default=None, min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=255)
    retryable: Literal[False] = False


class TelemetryBatchAckV1(StrictContract):
    batch_id: str
    trip_id: str
    committed: bool
    highest_contiguous_sequence: int = Field(ge=0)
    accepted_sequences: list[tuple[int, int]]
    duplicate_sequences: list[int]
    rejections: list[TelemetryRejectionV1]
    missing_ranges: list[tuple[int, int]]
    server_received_at: datetime


def compress_sequence_ranges(sequences: Iterable[int]) -> list[tuple[int, int]]:
    """Compress non-negative sequence numbers into deterministic ranges."""
    ordered = sorted(set(sequences))
    ranges: list[tuple[int, int]] = []
    for value in ordered:
        if value < 1:
            raise ValueError("sequence numbers must be positive")
        if not ranges or value > ranges[-1][1] + 1:
            ranges.append((value, value))
        else:
            ranges[-1] = (ranges[-1][0], value)
    return ranges


def missing_sequence_ranges(
    highest_contiguous: int,
    received: Iterable[int],
) -> list[tuple[int, int]]:
    """Return known holes above a committed cursor through the highest receipt."""
    if highest_contiguous < 0:
        raise ValueError("highest_contiguous cannot be negative")
    received_set = {value for value in received if value > highest_contiguous}
    if not received_set:
        return []
    missing = (
        value
        for value in range(highest_contiguous + 1, max(received_set) + 1)
        if value not in received_set
    )
    return compress_sequence_ranges(missing)
