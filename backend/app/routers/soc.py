"""
SOC readings router — manual entry, history, latest.

SOC is required for range estimation (§1 rule 2).
Valid sources: manual, bluetooth_bms, oem_api, fleet_export, dashboard_confirmed.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import SOCReading, User, Vehicle
from app.schemas.api import ok, utc_iso
from app.services.auth import get_current_user

router = APIRouter(prefix="/soc", tags=["soc"])

VALID_SOURCES = {"manual", "bluetooth_bms", "oem_api", "fleet_export", "dashboard_confirmed"}


class SOCReadingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle_id: str = Field(max_length=36)
    value: float = Field(ge=0, le=100)
    source: Literal["manual", "bluetooth_bms", "oem_api", "fleet_export", "dashboard_confirmed"] = "manual"
    confidence: float = Field(default=1.0, ge=0, le=1)
    recorded_at: datetime | None = None


def _soc_dict(s: SOCReading) -> dict:
    return {
        "id": s.id,
        "vehicle_id": s.vehicle_id,
        "driver_id": s.driver_id,
        "value": s.value,
        "source": s.source,
        "confidence": s.confidence,
        "recorded_at": utc_iso(s.recorded_at),
        "created_at": utc_iso(s.created_at),
    }


@router.post("/readings")
def record_soc(
    body: SOCReadingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicle = db.query(Vehicle).filter(Vehicle.id == body.vehicle_id).first()
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")

    reading = SOCReading(
        vehicle_id=body.vehicle_id,
        driver_id=current_user.driver_id,
        value=body.value,
        source=body.source,
        confidence=body.confidence,
        recorded_at=body.recorded_at or datetime.utcnow(),
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)
    return ok(_soc_dict(reading), "SOC reading recorded")


@router.get("/vehicles/{vehicle_id}/latest")
def latest_soc(
    vehicle_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    reading = (
        db.query(SOCReading)
        .filter(SOCReading.vehicle_id == vehicle_id)
        .order_by(desc(SOCReading.recorded_at))
        .first()
    )
    if not reading:
        return ok(None, "No SOC readings found")
    return ok(_soc_dict(reading))


@router.get("/vehicles/{vehicle_id}/history")
def soc_history(
    vehicle_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    readings = (
        db.query(SOCReading)
        .filter(SOCReading.vehicle_id == vehicle_id)
        .order_by(desc(SOCReading.recorded_at))
        .limit(limit)
        .all()
    )
    return ok([_soc_dict(r) for r in readings])
