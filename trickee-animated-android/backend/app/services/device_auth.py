from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.entities import Device, DeviceRefreshToken
from app.services.auth import bearer_scheme, hash_refresh_token


@dataclass(frozen=True)
class DeviceSessionPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def create_device_access_token(device_id: str) -> str:
    settings = get_settings()
    expires_at = datetime.utcnow() + timedelta(
        minutes=settings.device_access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": device_id, "typ": "device", "exp": expires_at},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def _new_device_refresh_token(
    device: Device,
    family_id: str | None = None,
) -> tuple[str, DeviceRefreshToken]:
    settings = get_settings()
    raw_token = secrets.token_urlsafe(48)
    record = DeviceRefreshToken(
        id=str(uuid.uuid4()),
        device_id=device.id,
        family_id=family_id or str(uuid.uuid4()),
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(days=settings.device_refresh_token_expire_days),
    )
    return raw_token, record


def create_device_session(db: Session, device: Device) -> DeviceSessionPair:
    raw_refresh, record = _new_device_refresh_token(device)
    db.add(record)
    return DeviceSessionPair(
        access_token=create_device_access_token(device.id),
        refresh_token=raw_refresh,
    )


def rotate_device_session(
    db: Session,
    device_id: str,
    refresh_token: str,
) -> tuple[DeviceSessionPair, Device]:
    now = datetime.utcnow()
    current = db.query(DeviceRefreshToken).filter(
        DeviceRefreshToken.token_hash == hash_refresh_token(refresh_token),
        DeviceRefreshToken.device_id == device_id,
    ).first()
    if not current:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device refresh token")
    if current.revoked_at is not None:
        db.query(DeviceRefreshToken).filter(
            DeviceRefreshToken.family_id == current.family_id,
            DeviceRefreshToken.revoked_at.is_(None),
        ).update({DeviceRefreshToken.revoked_at: now}, synchronize_session=False)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device token replay detected")
    if current.expires_at <= now:
        current.revoked_at = now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device refresh token expired")

    device = db.query(Device).filter(Device.id == current.device_id).first()
    if not device or not device.is_active or device.revoked_at is not None:
        current.revoked_at = now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device is revoked")

    raw_refresh, replacement = _new_device_refresh_token(device, current.family_id)
    current.revoked_at = now
    current.replaced_by_token_id = replacement.id
    db.add(replacement)
    return (
        DeviceSessionPair(
            access_token=create_device_access_token(device.id),
            refresh_token=raw_refresh,
        ),
        device,
    )


def get_current_device(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Device:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing device token")
    settings = get_settings()
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.secret_key,
            algorithms=[settings.algorithm],
        )
        if payload.get("typ") != "device":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device token")
        device_id = str(payload.get("sub") or "")
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device token") from exc

    device = db.query(Device).filter(Device.id == device_id).first()
    if not device or not device.is_active or device.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device not found or revoked")
    return device
