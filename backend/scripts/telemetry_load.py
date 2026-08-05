"""Deterministic live/backfill telemetry capacity harness (2 to 150 identities)."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx


@dataclass(frozen=True)
class Identity:
    trip_id: str
    device_id: str
    vehicle_id: str
    token: str = ""


@dataclass(order=True)
class ScheduledBatch:
    due_second: int
    priority: int
    identity_index: int
    sequences: tuple[int, ...] = field(compare=False)
    mode: str = field(compare=False, default="live")


def deterministic_identity(index: int) -> Identity:
    return Identity(
        trip_id=str(uuid.UUID(int=10_000 + index)),
        device_id=str(uuid.UUID(int=20_000 + index)),
        vehicle_id=str(uuid.UUID(int=30_000 + index)),
    )


def build_schedule(identity_count: int, duration_seconds: int, *, backfill_devices: int = 0,
                   backfill_windows: int = 0, backfill_batch_size: int = 100,
                   burst_windows_per_second: int = 0, burst_seconds: int = 1) -> list[ScheduledBatch]:
    if not 1 <= identity_count <= 150:
        raise ValueError("identity_count must be between 1 and 150")
    backfill_identity_count = min(identity_count, backfill_devices)
    schedule = [
        ScheduledBatch(
            second,
            0,
            identity,
            ((backfill_windows if identity < backfill_identity_count else 0) + second + 1,),
            "live",
        )
        for second in range(duration_seconds)
        for identity in range(identity_count)
    ]
    for identity in range(min(identity_count, backfill_devices)):
        for offset in range(0, backfill_windows, backfill_batch_size):
            sequences = tuple(range(offset + 1, min(offset + backfill_batch_size, backfill_windows) + 1))
            schedule.append(ScheduledBatch(offset // backfill_batch_size, 2, identity, sequences, "backfill"))
    for burst_second in range(max(0, burst_seconds)):
        remaining = burst_windows_per_second
        identity = 0
        offsets = [0] * identity_count
        while remaining > 0:
            size = min(100, remaining)
            identity_backfill = backfill_windows if identity < min(identity_count, backfill_devices) else 0
            start = duration_seconds + identity_backfill + offsets[identity] + 1
            sequences = tuple(range(start, start + size))
            schedule.append(ScheduledBatch(duration_seconds // 2 + burst_second, 1, identity, sequences, "burst"))
            offsets[identity] += size
            remaining -= size
            identity = (identity + 1) % identity_count
    return sorted(schedule)


def telemetry_window(identity: Identity, sequence: int, epoch_ms: int) -> dict:
    return {
        "schema_version": 1,
        "sample_id": str(uuid.uuid5(uuid.UUID(identity.trip_id), str(sequence))),
        "trip_id": identity.trip_id,
        "device_id": identity.device_id,
        "vehicle_id": identity.vehicle_id,
        "sequence_no": sequence,
        "boot_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, identity.device_id)),
        "event_time_utc_ms": epoch_ms + sequence * 1000,
        "monotonic_time_ns": sequence * 1_000_000_000,
        "window_duration_ms": 1000,
        "gps_available": True,
        "gps": {"latitude": 11.0168, "longitude": 76.9558, "altitude_m": None,
                "speed_mps": 8.0, "bearing_deg": 90.0, "horizontal_accuracy_m": 5.0,
                "vertical_accuracy_m": None, "provider": "load-test", "is_mock_location": True,
                "fix_time_utc_ms": epoch_ms + sequence * 1000, "fix_monotonic_time_ns": sequence * 1_000_000_000,
                "fix_age_ms": 0},
        "imu": {"accelerometer_sample_count": 50, "gyroscope_sample_count": 50,
                "accelerometer_complete_pct": 100, "gyroscope_complete_pct": 100,
                "accel_mean_mps2": [0, 0, 9.81], "accel_std_mps2": [0.1, 0.1, 0.1],
                "accel_rms_mps2": [0.1, 0.1, 9.81], "accel_min_mps2": [-0.2, -0.2, 9.5],
                "accel_max_mps2": [0.2, 0.2, 10.1], "accel_magnitude_rms_mps2": 9.81,
                "accel_magnitude_max_mps2": 10.1, "jerk_rms_mps3": 0.5, "jerk_max_mps3": 1.0,
                "gyro_mean_rads": [0, 0, 0], "gyro_rms_rads": [0.01, 0.01, 0.01],
                "gyro_max_abs_rads": [0.02, 0.02, 0.02], "accelerometer_present": True,
                "gyroscope_present": True, "accelerometer_accuracy": 3, "gyroscope_accuracy": 3},
        "health": {"battery_pct": 80, "charging": False, "network_type": "LOAD_TEST",
                   "location_permission": "SYNTHETIC", "gps_enabled": True, "collector_state": "ACTIVE",
                   "local_outbox_pending": 0, "app_version": "load-test", "os_version": "synthetic",
                   "device_model": "capacity-harness"},
    }


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(p * len(ordered)) - 1)]


async def execute(base_url: str, identities: list[Identity], schedule: list[ScheduledBatch], dry_run: bool) -> dict:
    latencies: list[float] = []
    accepted = duplicates = rejected = failed = 0
    epoch_ms = 1_788_000_000_000
    started = time.perf_counter()
    semaphore = asyncio.Semaphore(50)
    async with httpx.AsyncClient(timeout=15) as client:
        async def send(item: ScheduledBatch) -> None:
            nonlocal accepted, duplicates, rejected, failed
            identity = identities[item.identity_index]
            windows = [telemetry_window(identity, sequence, epoch_ms) for sequence in item.sequences]
            if dry_run:
                accepted += len(windows)
                return
            async with semaphore:
                before = time.perf_counter()
                try:
                    response = await client.post(
                        f"{base_url}/api/v2/trips/{identity.trip_id}/telemetry-batches",
                        headers={"Authorization": f"Bearer {identity.token}"},
                        json={"schema_version": 1, "batch_id": str(uuid.uuid4()), "trip_id": identity.trip_id,
                              "device_id": identity.device_id, "windows": windows},
                    )
                    latencies.append(time.perf_counter() - before)
                    response.raise_for_status()
                    data = response.json()["data"]
                    accepted += sum(end - start + 1 for start, end in data["accepted_sequences"])
                    duplicates += len(data["duplicate_sequences"])
                    rejected += len(data["rejections"])
                except Exception:
                    failed += len(windows)

        for due_second in sorted({item.due_second for item in schedule}):
            if not dry_run:
                delay = started + due_second - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
            due = [item for item in schedule if item.due_second == due_second]
            await asyncio.gather(*(send(item) for item in due))
    elapsed = time.perf_counter() - started
    sent = sum(len(item.sequences) for item in schedule)
    return {"identities": len(identities), "sent_windows": sent, "accepted_windows": accepted,
            "duplicate_windows": duplicates, "rejected_windows": rejected, "failed_windows": failed,
            "loss_pct": round(100 * failed / max(sent, 1), 6), "duration_seconds": round(elapsed, 3),
            "p50_latency_ms": round(percentile(latencies, .5) * 1000, 2),
            "p95_latency_ms": round(percentile(latencies, .95) * 1000, 2),
            "p99_latency_ms": round(percentile(latencies, .99) * 1000, 2)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--identity-file", type=Path)
    parser.add_argument("--identities", type=int, default=2)
    parser.add_argument("--duration-seconds", type=int, default=10)
    parser.add_argument("--backfill-devices", type=int, default=0)
    parser.add_argument("--backfill-windows", type=int, default=0)
    parser.add_argument("--burst-windows-per-second", type=int, default=0)
    parser.add_argument("--burst-seconds", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.identity_file:
        identities = [Identity(**row) for row in json.loads(args.identity_file.read_text(encoding="utf-8"))]
    else:
        identities = [deterministic_identity(index) for index in range(args.identities)]
    schedule = build_schedule(len(identities), args.duration_seconds,
                              backfill_devices=args.backfill_devices, backfill_windows=args.backfill_windows,
                              burst_windows_per_second=args.burst_windows_per_second,
                              burst_seconds=args.burst_seconds)
    result = asyncio.run(execute(args.base_url, identities, schedule, args.dry_run))
    encoded = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
