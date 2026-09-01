from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, status
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token as google_id_token

from app.config import Settings, get_settings


@dataclass(frozen=True)
class MonitoringCaller:
    subject: str
    email: str


TokenVerifier = Callable[[str, Request, str], dict]


def verify_monitoring_caller_token(
    token: str,
    settings: Settings,
    *,
    verifier: TokenVerifier = google_id_token.verify_oauth2_token,
) -> MonitoringCaller:
    audience = settings.monitoring_audience.strip()
    allowed_callers = set(settings.monitoring_caller_service_account_list)
    if not audience or not allowed_callers:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pilot monitoring is not configured",
        )

    try:
        claims = verifier(token, Request(), audience)
    except (ValueError, GoogleAuthError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid monitoring credentials",
        ) from exc

    issuer = str(claims.get("iss") or "")
    claim_audience = str(claims.get("aud") or "")
    subject = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    email_verified = claims.get("email_verified") in {True, "true"}
    if (
        issuer not in {"accounts.google.com", "https://accounts.google.com"}
        or claim_audience != audience
        or not subject
        or not email
        or not email_verified
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid monitoring credentials",
        )
    if email not in allowed_callers:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Monitoring caller is not allowed",
        )
    return MonitoringCaller(subject=subject, email=email)


def require_monitoring_caller(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    settings: Settings = Depends(get_settings),
) -> MonitoringCaller:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Monitoring credentials are required",
        )
    return verify_monitoring_caller_token(token.strip(), settings)
