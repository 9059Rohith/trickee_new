"""Manifest validation required before canonical hot rows may be retired."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class VerifiedArchive:
    row_count: int
    first_sequence_no: int
    last_sequence_no: int
    sha256: str
    object_generation: str


def inspect_ndjson(content: bytes, object_generation: str) -> VerifiedArchive:
    rows = [json.loads(line) for line in content.splitlines() if line.strip()]
    if not rows:
        raise ValueError("archive contains no telemetry rows")
    sequences = [int(row["sequence_no"]) for row in rows]
    if sequences != list(range(min(sequences), max(sequences) + 1)):
        raise ValueError("archive sequence range is not contiguous")
    return VerifiedArchive(
        row_count=len(rows),
        first_sequence_no=sequences[0],
        last_sequence_no=sequences[-1],
        sha256=hashlib.sha256(content).hexdigest(),
        object_generation=object_generation,
    )


def verify_manifest(content: bytes, expected: dict, actual_generation: str) -> VerifiedArchive:
    actual = inspect_ndjson(content, actual_generation)
    checks = {
        "row_count": actual.row_count,
        "first_sequence_no": actual.first_sequence_no,
        "last_sequence_no": actual.last_sequence_no,
        "sha256": actual.sha256,
        "object_generation": actual.object_generation,
    }
    mismatches = [name for name, value in checks.items() if str(expected.get(name)) != str(value)]
    if mismatches:
        raise ValueError(f"archive manifest mismatch: {', '.join(mismatches)}")
    return actual


def retirement_authorized(restore_status: str, verified_at: object | None) -> bool:
    return restore_status == "restored_and_compared" and verified_at is not None
