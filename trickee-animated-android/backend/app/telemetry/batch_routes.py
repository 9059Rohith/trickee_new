"""Device-authenticated telemetry batch ingestion endpoint."""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import time
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import Device, MobileTripSession, ServerOutbox, TelemetryRejection
from app.observability.metrics import INGESTED_WINDOWS, INGEST_LATENCY, OUTBOX_BACKLOG
from app.schemas.api import ok
from app.services.device_auth import get_current_device
from app.telemetry.contracts import TelemetryBatchRequestV1
from app.telemetry.persistence import persist_telemetry_batch


router = APIRouter(prefix="/api/v2/trips", tags=["telemetry"])
MAX_UNCOMPRESSED_BATCH_BYTES = 512 * 1024
MAX_VALIDATION_ERRORS = 20
logger = logging.getLogger(__name__)


def _safe_validation_errors(exc: ValidationError, loose_payload: dict) -> list[dict]:
    windows = loose_payload.get("windows") if isinstance(loose_payload.get("windows"), list) else []
    errors = []
    for item in exc.errors(include_url=False, include_context=False)[:MAX_VALIDATION_ERRORS]:
        location = list(item.get("loc", ()))
        window_index = location[1] if len(location) > 1 and location[0] == "windows" and isinstance(location[1], int) else None
        window = windows[window_index] if window_index is not None and window_index < len(windows) and isinstance(windows[window_index], dict) else {}
        field_parts = location[2:] if window_index is not None else location
        errors.append({
            "sequence_no": window.get("sequence_no") if isinstance(window.get("sequence_no"), int) else None,
            "sample_id": window.get("sample_id") if isinstance(window.get("sample_id"), str) else None,
            "field": ".".join(str(part) for part in field_parts)[:120] or "batch",
            "reason": str(item.get("msg", "Invalid value"))[:120],
            "window": window,
        })
    return errors


def _record_validation_failures(
    db: Session,
    *,
    device: Device,
    trip: MobileTripSession,
    loose_payload: dict,
    errors: list[dict],
) -> None:
    batch_id = loose_payload.get("batch_id")
    if not isinstance(batch_id, str) or not 1 <= len(batch_id) <= 80:
        batch_id = "unavailable"
    recorded = 0
    for error in errors:
        sequence_no = error["sequence_no"]
        sample_id = error["sample_id"]
        if not isinstance(sequence_no, int) or sequence_no < 1:
            continue
        if not isinstance(sample_id, str) or not 1 <= len(sample_id) <= 64:
            continue
        canonical = json.dumps(error["window"], sort_keys=True, separators=(",", ":"), default=str).encode()
        db.add(TelemetryRejection(
            device_id=device.id,
            trip_id=trip.id,
            sample_id=sample_id,
            sequence_no=sequence_no,
            batch_id=batch_id,
            code="CONTRACT_VALIDATION",
            message=f"{error['field']}: {error['reason']}"[:255],
            payload_hash=hashlib.sha256(canonical).hexdigest(),
        ))
        recorded += 1
    if recorded:
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception(
                "telemetry_contract_validation_record_failed trip_id=%s device_id=%s batch_id=%s",
                trip.id,
                device.id,
                batch_id,
            )
    logger.warning(
        "telemetry_contract_validation_failed trip_id=%s device_id=%s batch_id=%s errors=%s recorded=%s",
        trip.id,
        device.id,
        batch_id,
        [{key: error[key] for key in ("sequence_no", "field", "reason")} for error in errors],
        recorded,
    )


async def _parse_batch(
    request: Request,
    *,
    db: Session,
    device: Device,
    trip: MobileTripSession,
) -> TelemetryBatchRequestV1:
    compressed = await request.body()
    encoding = request.headers.get("content-encoding", "identity").lower()
    if encoding in {"", "identity"}:
        raw = compressed
    elif encoding == "gzip":
        try:
            with gzip.GzipFile(fileobj=BytesIO(compressed), mode="rb") as stream:
                raw = stream.read(MAX_UNCOMPRESSED_BATCH_BYTES + 1)
        except (OSError, EOFError) as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid gzip body") from exc
    else:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported content encoding")

    if len(raw) > MAX_UNCOMPRESSED_BATCH_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Telemetry batch exceeds 512 KiB")
    try:
        return TelemetryBatchRequestV1.model_validate_json(raw)
    except ValidationError as exc:
        try:
            loose_payload = json.loads(raw) if raw else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            loose_payload = {}
        if not isinstance(loose_payload, dict):
            loose_payload = {}
        errors = _safe_validation_errors(exc, loose_payload)
        _record_validation_failures(
            db,
            device=device,
            trip=trip,
            loose_payload=loose_payload,
            errors=errors,
        )
        public_errors = [
            {key: error[key] for key in ("sequence_no", "field", "reason")}
            for error in errors
        ]
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "INVALID_TELEMETRY_CONTRACT", "errors": public_errors},
        ) from exc


@router.post("/{trip_id}/telemetry-batches")
async def upload_telemetry_batch(
    trip_id: str,
    request: Request,
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    started = time.perf_counter()
    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.vehicle_id == device.vehicle_id,
    ).first()
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    batch = await _parse_batch(request, db=db, device=device, trip=trip)
    if batch.trip_id != trip_id or batch.device_id != device.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Batch identity mismatch")
    if any(window.vehicle_id != device.vehicle_id for window in batch.windows):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Window vehicle mismatch")

    ack = persist_telemetry_batch(db, device, trip, batch)
    INGEST_LATENCY.observe(time.perf_counter() - started)
    accepted = sum(end - start + 1 for start, end in ack.accepted_sequences)
    if accepted:
        INGESTED_WINDOWS.labels(result="accepted").inc(accepted)
    if ack.duplicate_sequences:
        INGESTED_WINDOWS.labels(result="duplicate").inc(len(ack.duplicate_sequences))
    if ack.rejections:
        INGESTED_WINDOWS.labels(result="rejected").inc(len(ack.rejections))
    OUTBOX_BACKLOG.set(db.query(ServerOutbox).filter(ServerOutbox.state == "pending").count())
    return ok(ack.model_dump(mode="json"))
