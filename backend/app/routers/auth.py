"""Auth router — login, signup, me."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.entities import User, Driver, Fleet
from app.schemas.api import ok
from app.services.auth import (
    create_access_token,
    create_user_session,
    get_current_user,
    hash_password,
    rotate_user_session,
    revoke_user_session,
    verify_password,
)
from app.services.google_identity import GoogleIdentityError, verify_google_identity

router = APIRouter(prefix="/auth", tags=["auth"])
v2_router = APIRouter(prefix="/api/v2/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=255)


class SignupRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=6, max_length=255)
    full_name: str = Field(max_length=255)


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192)
    nonce: str = Field(min_length=1, max_length=255)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=512)


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "fleet_id": u.fleet_id,
        "driver_id": u.driver_id,
        "is_active": u.is_active,
    }


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = create_access_token({"sub": user.id})
    return ok({"access_token": token, "token_type": "bearer", "user": _user_dict(user)})


@router.post("/signup")
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # Auto-create a fleet and driver for new signups
    fleet = db.query(Fleet).first()
    if not fleet:
        fleet = Fleet(name="Default Fleet", city="Surat")
        db.add(fleet)
        db.flush()

    driver = Driver(
        fleet_id=fleet.id,
        driver_code=f"DRV-{body.email.split('@')[0][:8].upper()}",
        full_name=body.full_name,
    )
    db.add(driver)
    db.flush()

    user = User(
        email=body.email.strip().lower(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id})
    return ok({"access_token": token, "token_type": "bearer", "user": _user_dict(user)})


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return ok(_user_dict(current_user))


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return ok({"logged_out": True})


@v2_router.post("/google")
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    try:
        identity = verify_google_identity(
            body.id_token,
            settings.google_oauth_client_id,
            body.nonce,
        )
    except GoogleIdentityError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    if not identity.email_verified:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google email is not verified")

    user = db.query(User).filter(User.google_sub == identity.sub).first()
    if not user:
        user = db.query(User).filter(User.email == identity.email).first()
        if not user:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "User is not provisioned")
        if user.google_sub and user.google_sub != identity.sub:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Google identity does not match user")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User is inactive")
    if (
        user.role != "driver"
        and settings.google_workspace_domain
        and identity.hosted_domain != settings.google_workspace_domain.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Company Workspace account required")

    user.google_sub = identity.sub
    user.google_hd = identity.hosted_domain
    user.last_google_login_at = datetime.utcnow()
    tokens = create_user_session(db, user)
    db.commit()
    return ok({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "token_type": tokens.token_type,
        "user": _user_dict(user),
    })


@v2_router.post("/refresh")
def refresh_session(body: RefreshRequest, db: Session = Depends(get_db)):
    tokens, user = rotate_user_session(db, body.refresh_token)
    db.commit()
    return ok({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "token_type": tokens.token_type,
        "user": _user_dict(user),
    })


@v2_router.post("/logout")
def logout_session(
    body: RefreshRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    revoke_user_session(db, current_user, body.refresh_token)
    db.commit()
    return ok({"logged_out": True})
