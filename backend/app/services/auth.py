"""
Lightweight auth service for the GPS-first backend.
Mirrors the existing JWT approach.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.entities import User, UserRefreshToken

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    settings = get_settings()
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({**data, "exp": expire}, settings.secret_key, algorithm=settings.algorithm)


@dataclass(frozen=True)
class SessionTokenPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_user_refresh_token(
    user: User,
    family_id: str | None = None,
) -> tuple[str, UserRefreshToken]:
    settings = get_settings()
    raw_token = secrets.token_urlsafe(48)
    record = UserRefreshToken(
        id=str(uuid.uuid4()),
        user_id=user.id,
        family_id=family_id or str(uuid.uuid4()),
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(days=settings.user_refresh_token_expire_days),
    )
    return raw_token, record


def create_user_session(db: Session, user: User) -> SessionTokenPair:
    raw_refresh, record = _new_user_refresh_token(user)
    db.add(record)
    return SessionTokenPair(
        access_token=create_access_token({"sub": user.id, "typ": "user"}),
        refresh_token=raw_refresh,
    )


def rotate_user_session(
    db: Session,
    refresh_token: str,
) -> tuple[SessionTokenPair, User]:
    now = datetime.utcnow()
    token_hash = hash_refresh_token(refresh_token)
    current = db.query(UserRefreshToken).filter(
        UserRefreshToken.token_hash == token_hash
    ).first()
    if not current:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if current.revoked_at is not None:
        db.query(UserRefreshToken).filter(
            UserRefreshToken.family_id == current.family_id,
            UserRefreshToken.revoked_at.is_(None),
        ).update({UserRefreshToken.revoked_at: now}, synchronize_session=False)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token replay detected")
    if current.expires_at <= now:
        current.revoked_at = now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired")

    user = db.query(User).filter(User.id == current.user_id).first()
    if not user or not user.is_active:
        current.revoked_at = now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    raw_refresh, replacement = _new_user_refresh_token(user, current.family_id)
    current.revoked_at = now
    current.replaced_by_token_id = replacement.id
    db.add(replacement)
    return (
        SessionTokenPair(
            access_token=create_access_token({"sub": user.id, "typ": "user"}),
            refresh_token=raw_refresh,
        ),
        user,
    )


def revoke_user_session(db: Session, user: User, refresh_token: str) -> None:
    token_hash = hash_refresh_token(refresh_token)
    current = db.query(UserRefreshToken).filter(
        UserRefreshToken.user_id == user.id,
        UserRefreshToken.token_hash == token_hash,
    ).first()
    if current:
        db.query(UserRefreshToken).filter(
            UserRefreshToken.family_id == current.family_id,
            UserRefreshToken.revoked_at.is_(None),
        ).update({UserRefreshToken.revoked_at: datetime.utcnow()}, synchronize_session=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    settings = get_settings()
    try:
        payload = jwt.decode(creds.credentials, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("typ") not in {None, "user"}:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid user token")
        user_id: str = payload.get("sub", "")
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user
