from __future__ import annotations

from dataclasses import dataclass

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token as google_id_token


class GoogleIdentityError(ValueError):
    pass


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    hosted_domain: str | None
    full_name: str


def verify_google_identity(
    token: str,
    audience: str,
    expected_nonce: str,
) -> GoogleIdentity:
    if not audience:
        raise GoogleIdentityError("Google OAuth is not configured")
    try:
        payload = google_id_token.verify_oauth2_token(token, Request(), audience)
    except (ValueError, GoogleAuthError) as exc:
        raise GoogleIdentityError("Invalid Google ID token") from exc

    if payload.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise GoogleIdentityError("Invalid Google token issuer")
    if payload.get("aud") != audience:
        raise GoogleIdentityError("Invalid Google token audience")
    if payload.get("nonce") != expected_nonce:
        raise GoogleIdentityError("Invalid Google token nonce")

    subject = str(payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    verified_claim = payload.get("email_verified")
    email_verified = verified_claim is True or verified_claim == "true"
    if not subject or not email:
        raise GoogleIdentityError("Google token is missing identity claims")

    return GoogleIdentity(
        sub=subject,
        email=email,
        email_verified=email_verified,
        hosted_domain=str(payload["hd"]).lower() if payload.get("hd") else None,
        full_name=str(payload.get("name") or email.split("@", 1)[0]).strip(),
    )
