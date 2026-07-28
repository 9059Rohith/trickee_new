"""Standard API response envelope."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def ok(data: Any = None, message: str = "OK") -> dict:
    return {"success": True, "data": data, "message": message, "error": None}


def fail(error: str, message: str = "Error") -> dict:
    return {"success": False, "data": None, "message": message, "error": error}


def utc_iso(value: datetime | None) -> str | None:
    """Serialize database datetimes as unambiguous UTC ISO-8601 strings."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")
