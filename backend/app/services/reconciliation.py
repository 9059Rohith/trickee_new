"""Bounded helpers shared by trip monitoring and finalization reconciliation."""
from __future__ import annotations

from collections.abc import Iterable


# A one-second window over 48 hours is the largest supported sealed mobile trip.
MAX_FINAL_SEQUENCE_NO = 172_800
MAX_MISSING_RANGES = 100
MAX_RECONCILIATION_CANDIDATES = 100


def percentage(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100.0, 2)


def bounded_missing_ranges(
    received_sequences: Iterable[int],
    final_sequence_no: int,
    *,
    limit: int = MAX_MISSING_RANGES,
) -> list[list[int]]:
    """Return at most ``limit`` gaps without walking an attacker-sized range."""
    if not 0 <= final_sequence_no <= MAX_FINAL_SEQUENCE_NO:
        raise ValueError("final sequence is outside the supported bound")

    ranges: list[list[int]] = []
    expected = 1
    for sequence in sorted({int(value) for value in received_sequences if 1 <= int(value) <= final_sequence_no}):
        if sequence > expected:
            ranges.append([expected, sequence - 1])
            if len(ranges) >= limit:
                return ranges
        expected = sequence + 1
    if expected <= final_sequence_no and len(ranges) < limit:
        ranges.append([expected, final_sequence_no])
    return ranges
