from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import Device, DeviceRefreshToken, User, Vehicle
from app.schemas.api import ok
from app.services.auth import get_current_user
from app.services.device_auth import create_device_session, rotate_device_session


router = APIRouter(prefix="/api/v2/devices", tags=["devices"])


class RegisterDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    installation_id: str = Field(min_length=8, max_length=255)
    vehicle_id: str = Field(min_length=36, max_length=36)
    platform: Literal["android"]
    device_model: str = Field(min_length=1, max_length=100)
    app_version: str = Field(min_length=1, max_length=50)


class DeviceTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=36, max_length=36)
    refresh_token: str = Field(min_length=32, max_length=512)


def _device_dict(device: Device) -> dict:
    return {
        "id": device.id,
        "fleet_id": device.fleet_id,
        "vehicle_id": device.vehicle_id,
        "installation_id": device.installation_id,
        "platform": device.platform,
        "device_model": device.device_model,
        "app_version": device.app_version,
        "is_active": device.is_active,
    }


@router.post("/register")
def register_device(
    body: RegisterDeviceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == body.vehicle_id,
        Vehicle.fleet_id == current_user.fleet_id,
        Vehicle.is_active.is_(True),
    ).first()
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")

    device = db.query(Device).filter(
        Device.installation_id == body.installation_id
    ).first()
    if device:
        if (
            device.fleet_id != current_user.fleet_id
            or device.vehicle_id != vehicle.id
            or device.revoked_at is not None
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Installation is already registered")
        db.query(DeviceRefreshToken).filter(
            DeviceRefreshToken.device_id == device.id,
            DeviceRefreshToken.revoked_at.is_(None),
        ).update({DeviceRefreshToken.revoked_at: datetime.utcnow()}, synchronize_session=False)
        device.device_model = body.device_model
        device.app_version = body.app_version
    else:
        device = Device(
            fleet_id=current_user.fleet_id,
            vehicle_id=vehicle.id,
            registered_by_user_id=current_user.id,
            installation_id=body.installation_id,
            platform=body.platform,
            device_model=body.device_model,
            app_version=body.app_version,
        )
        db.add(device)
        db.flush()

    tokens = create_device_session(db, device)
    db.commit()
    return ok({
        "device": _device_dict(device),
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "token_type": tokens.token_type,
    })


@router.post("/token")
def refresh_device_token(body: DeviceTokenRequest, db: Session = Depends(get_db)):
    tokens, device = rotate_device_session(db, body.device_id, body.refresh_token)
    db.commit()
    return ok({
        "device": _device_dict(device),
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "token_type": tokens.token_type,
    })


@router.post("/{device_id}/revoke")
def revoke_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(
        Device.id == device_id,
        Device.fleet_id == current_user.fleet_id,
    ).first()
    if not device or (
        current_user.role == "driver"
        and device.registered_by_user_id != current_user.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    now = datetime.utcnow()
    device.is_active = False
    device.revoked_at = now
    db.query(DeviceRefreshToken).filter(
        DeviceRefreshToken.device_id == device.id,
        DeviceRefreshToken.revoked_at.is_(None),
    ).update({DeviceRefreshToken.revoked_at: now}, synchronize_session=False)
    db.commit()
    return ok({"device_id": device.id, "revoked": True})
