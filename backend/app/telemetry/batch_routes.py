"""Device-authenticated telemetry batch ingestion endpoint."""
from __future__ import annotations

import gzip
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import Device, MobileTripSession
from app.schemas.api import ok
from app.services.device_auth import get_current_device
from app.telemetry.contracts import TelemetryBatchRequestV1
from app.telemetry.persistence import persist_telemetry_batch


router = APIRouter(prefix="/api/v2/trips", tags=["telemetry"])
MAX_UNCOMPRESSED_BATCH_BYTES = 512 * 1024


async def _parse_batch(request: Request) -> TelemetryBatchRequestV1:
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid telemetry contract") from exc


@router.post("/{trip_id}/telemetry-batches")
async def upload_telemetry_batch(
    trip_id: str,
    request: Request,
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    batch = await _parse_batch(request)
    trip = db.query(MobileTripSession).filter(
        MobileTripSession.id == trip_id,
        MobileTripSession.vehicle_id == device.vehicle_id,
    ).first()
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    if batch.trip_id != trip_id or batch.device_id != device.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Batch identity mismatch")
    if any(window.vehicle_id != device.vehicle_id for window in batch.windows):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Window vehicle mismatch")

    ack = persist_telemetry_batch(db, device, trip, batch)
    return ok(ack.model_dump(mode="json"))
