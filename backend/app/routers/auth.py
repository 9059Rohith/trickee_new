"""Auth router — login, signup, me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import User, Driver, Fleet
from app.schemas.api import ok
from app.services.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=255)


class SignupRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=6, max_length=255)
    full_name: str = Field(max_length=255)


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
