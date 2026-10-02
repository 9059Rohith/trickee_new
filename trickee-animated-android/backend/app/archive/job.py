"""Export and object-verify one finalized trip without retiring hot rows."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime

from google.cloud import storage
from sqlalchemy.orm import Session

from app.archive.manifest import verify_manifest
from app.models.entities import ArchiveManifest, MobileTripSession, TelemetryWindow


def archive_trip(db: Session, bucket_name: str, trip_id: str) -> ArchiveManifest:
    trip = db.query(MobileTripSession).filter_by(id=trip_id, finalization_state="completed").first()
    if trip is None:
        raise ValueError("trip must be finalized before archive")
    rows = db.query(TelemetryWindow).filter_by(trip_id=trip_id).order_by(TelemetryWindow.sequence_no).all()
    if not rows:
        raise ValueError("trip has no telemetry windows")
    content = b"".join(
        (json.dumps({**row.raw_payload, "sequence_no": row.sequence_no}, sort_keys=True, separators=(",", ":")) + "\n").encode()
        for row in rows
    )
    bucket = storage.Client().bucket(bucket_name)
    object_name = f"telemetry/year={trip.started_at.year}/month={trip.started_at.month:02d}/trip={trip_id}/windows.ndjson"
    blob = bucket.blob(object_name)
    blob.upload_from_string(content, content_type="application/x-ndjson", if_generation_match=0)
    blob.reload()
    downloaded = blob.download_as_bytes(if_generation_match=blob.generation)
    expected = {
        "row_count": len(rows), "first_sequence_no": rows[0].sequence_no,
        "last_sequence_no": rows[-1].sequence_no, "sha256": hashlib.sha256(content).hexdigest(),
        "object_generation": str(blob.generation),
    }
    verify_manifest(downloaded, expected, str(blob.generation))
    manifest = ArchiveManifest(
        trip_id=trip_id, object_uri=f"gs://{bucket_name}/{object_name}", object_generation=str(blob.generation),
        row_count=len(rows), first_sequence_no=rows[0].sequence_no, last_sequence_no=rows[-1].sequence_no,
        sha256=expected["sha256"], restore_status="object_verified", verified_at=datetime.utcnow(),
    )
    db.add(manifest)
    db.commit()
    return manifest
