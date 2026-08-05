"""Atomic, idempotent persistence for canonical telemetry batches."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.entities import (
    Device,
    DeviceTripUploadCursor,
    MobileTripSession,
    ServerOutbox,
    TelemetryReceipt,
    TelemetryRejection,
    TelemetryWindow,
)
from app.telemetry.contracts import (
    TelemetryBatchAckV1,
    TelemetryBatchRequestV1,
    TelemetryRejectionV1,
    TelemetryWindowV1,
    compress_sequence_ranges,
    missing_sequence_ranges,
)


@dataclass(frozen=True)
class WindowOutcome:
    status: str
    sequence_no: int
    rejection: TelemetryRejectionV1 | None = None


def _canonical_payload(window: TelemetryWindowV1) -> tuple[dict, str]:
    payload = window.model_dump(mode="json")
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return payload, hashlib.sha256(encoded).hexdigest()


def _get_or_create_cursor(
    db: Session,
    device_id: str,
    trip_id: str,
) -> DeviceTripUploadCursor:
    cursor = (
        db.query(DeviceTripUploadCursor)
        .filter(
            DeviceTripUploadCursor.device_id == device_id,
            DeviceTripUploadCursor.trip_id == trip_id,
        )
        .with_for_update()
        .first()
    )
    if cursor is None:
        cursor = DeviceTripUploadCursor(device_id=device_id, trip_id=trip_id)
        db.add(cursor)
        db.flush()
    return cursor


def _persist_window(
    db: Session,
    device: Device,
    trip: MobileTripSession,
    batch_id: str,
    window: TelemetryWindowV1,
    received_at: datetime,
) -> WindowOutcome:
    raw_payload, payload_hash = _canonical_payload(window)
    existing = db.query(TelemetryReceipt).filter(
        or_(
            TelemetryReceipt.sample_id == window.sample_id,
            (
                (TelemetryReceipt.device_id == device.id)
                & (TelemetryReceipt.trip_id == trip.id)
                & (TelemetryReceipt.sequence_no == window.sequence_no)
            ),
        )
    ).first()
    if existing is not None:
        exact_identity = (
            existing.sample_id == window.sample_id
            and existing.device_id == device.id
            and existing.trip_id == trip.id
            and existing.sequence_no == window.sequence_no
        )
        if exact_identity and existing.payload_hash == payload_hash:
            return WindowOutcome("duplicate", window.sequence_no)

        rejection = TelemetryRejectionV1(
            sequence_no=window.sequence_no,
            sample_id=window.sample_id,
            code="IDENTITY_CONFLICT",
            message="sample_id or device/trip/sequence was reused with different telemetry",
            retryable=False,
        )
        db.add(TelemetryRejection(
            device_id=device.id,
            trip_id=trip.id,
            sample_id=window.sample_id,
            sequence_no=window.sequence_no,
            batch_id=batch_id,
            code=rejection.code,
            message=rejection.message,
            payload_hash=payload_hash,
            received_at=received_at,
        ))
        return WindowOutcome("rejected", window.sequence_no, rejection)

    db.add(TelemetryReceipt(
        sample_id=window.sample_id,
        device_id=device.id,
        trip_id=trip.id,
        sequence_no=window.sequence_no,
        batch_id=batch_id,
        payload_hash=payload_hash,
        first_received_at=received_at,
    ))
    gps_payload = window.gps.model_dump(mode="json") if window.gps else None
    db.add(TelemetryWindow(
        sample_id=window.sample_id,
        device_id=device.id,
        trip_id=trip.id,
        vehicle_id=window.vehicle_id,
        sequence_no=window.sequence_no,
        boot_id=window.boot_id,
        event_time=datetime.fromtimestamp(window.event_time_utc_ms / 1000, tz=timezone.utc),
        monotonic_time_ns=window.monotonic_time_ns,
        window_duration_ms=window.window_duration_ms,
        gps_available=window.gps_available,
        latitude=window.gps.latitude if window.gps else None,
        longitude=window.gps.longitude if window.gps else None,
        gps_payload=gps_payload,
        imu_payload=window.imu.model_dump(mode="json"),
        health_payload=window.health.model_dump(mode="json"),
        raw_payload=raw_payload,
        received_at=received_at,
    ))
    db.flush()
    return WindowOutcome("accepted", window.sequence_no)


def persist_telemetry_batch(
    db: Session,
    device: Device,
    trip: MobileTripSession,
    batch: TelemetryBatchRequestV1,
) -> TelemetryBatchAckV1:
    """Commit all ingestion state before returning a positive acknowledgement."""
    received_at = datetime.now(timezone.utc)
    try:
        cursor = _get_or_create_cursor(db, device.id, trip.id)
        outcomes = [
            _persist_window(db, device, trip, batch.batch_id, window, received_at)
            for window in batch.windows
        ]

        all_received = {
            row[0]
            for row in db.query(TelemetryReceipt.sequence_no).filter(
                TelemetryReceipt.device_id == device.id,
                TelemetryReceipt.trip_id == trip.id,
            ).all()
        }
        next_sequence = cursor.highest_contiguous_sequence + 1
        while next_sequence in all_received:
            cursor.highest_contiguous_sequence = next_sequence
            next_sequence += 1
        cursor.highest_received_sequence = max(
            [cursor.highest_received_sequence, *all_received]
        )
        cursor.updated_at = received_at
        device.last_seen_at = received_at

        accepted = [item.sequence_no for item in outcomes if item.status == "accepted"]
        duplicates = sorted(
            item.sequence_no for item in outcomes if item.status == "duplicate"
        )
        rejections = [
            item.rejection for item in outcomes if item.rejection is not None
        ]
        if accepted:
            db.add(ServerOutbox(
                event_type="telemetry.batch_committed",
                aggregate_type="trip",
                aggregate_id=trip.id,
                payload={
                    "batch_id": batch.batch_id,
                    "trip_id": trip.id,
                    "device_id": device.id,
                    "vehicle_id": device.vehicle_id,
                    "accepted_sequences": compress_sequence_ranges(accepted),
                    "highest_contiguous_sequence": cursor.highest_contiguous_sequence,
                },
            ))

        ack = TelemetryBatchAckV1(
            batch_id=batch.batch_id,
            trip_id=trip.id,
            committed=True,
            highest_contiguous_sequence=cursor.highest_contiguous_sequence,
            accepted_sequences=compress_sequence_ranges(accepted),
            duplicate_sequences=duplicates,
            rejections=rejections,
            missing_ranges=missing_sequence_ranges(
                cursor.highest_contiguous_sequence,
                all_received,
            ),
            server_received_at=received_at,
        )
        db.flush()
        db.commit()
        return ack
    except Exception:
        db.rollback()
        raise
