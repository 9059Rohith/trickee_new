from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.services.monitoring_identity import (
    require_monitoring_caller,
    verify_monitoring_caller_token,
)


def _settings(**overrides) -> Settings:
    values = {
        "monitoring_audience": "https://trickee-pilot-api.example",
        "monitoring_caller_service_accounts": "trickee-backend@example.iam.gserviceaccount.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _claims(**overrides) -> dict:
    values = {
        "iss": "https://accounts.google.com",
        "aud": "https://trickee-pilot-api.example",
        "sub": "service-account-subject",
        "email": "trickee-backend@example.iam.gserviceaccount.com",
        "email_verified": True,
    }
    values.update(overrides)
    return values


def test_monitoring_identity_fails_closed_without_configuration():
    with pytest.raises(HTTPException) as exc:
        verify_monitoring_caller_token(
            "token",
            _settings(monitoring_audience=""),
            verifier=lambda *_args: _claims(),
        )

    assert exc.value.status_code == 503
    assert exc.value.detail == "Pilot monitoring is not configured"


def test_monitoring_identity_rejects_wrong_audience():
    with pytest.raises(HTTPException) as exc:
        verify_monitoring_caller_token(
            "token",
            _settings(),
            verifier=lambda *_args: _claims(aud="https://wrong.example"),
        )

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid monitoring credentials"


def test_monitoring_identity_rejects_unapproved_service_account():
    with pytest.raises(HTTPException) as exc:
        verify_monitoring_caller_token(
            "token",
            _settings(),
            verifier=lambda *_args: _claims(email="other@example.iam.gserviceaccount.com"),
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "Monitoring caller is not allowed"


def test_monitoring_identity_accepts_allowlisted_google_service_account():
    caller = verify_monitoring_caller_token(
        "token",
        _settings(),
        verifier=lambda *_args: _claims(),
    )

    assert caller.email == "trickee-backend@example.iam.gserviceaccount.com"
    assert caller.subject == "service-account-subject"


def test_monitoring_dependency_requires_bearer_token():
    with pytest.raises(HTTPException) as exc:
        require_monitoring_caller(authorization=None, settings=_settings())

    assert exc.value.status_code == 401
    assert exc.value.detail == "Monitoring credentials are required"
