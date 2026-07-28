"""Standard API response envelope."""
from __future__ import annotations

from typing import Any


def ok(data: Any = None, message: str = "OK") -> dict:
    return {"success": True, "data": data, "message": message, "error": None}


def fail(error: str, message: str = "Error") -> dict:
    return {"success": False, "data": None, "message": message, "error": error}
