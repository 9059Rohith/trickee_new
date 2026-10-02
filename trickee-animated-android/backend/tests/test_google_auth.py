from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from google.oauth2 import id_token as google_id_token
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.models.entities import Driver, Fleet, User


TEST_DB_URL = "sqlite:///./test_google_auth.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
client = TestClient(app)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db(monkeypatch: pytest.MonkeyPatch):
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setenv("TRICKEE_GOOGLE_OAUTH_CLIENT_ID", "trickee-web-client")
    monkeypatch.setenv("TRICKEE_GOOGLE_WORKSPACE_DOMAIN", "company.example")
    get_settings.cache_clear()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)
    get_settings.cache_clear()


@pytest.fixture
def seeded_users():
    db = TestSession()
    fleet = Fleet(name="Google Fleet", city="Surat")
    db.add(fleet)
    db.flush()
    driver = Driver(
        fleet_id=fleet.id,
        driver_code="DRV-GOOGLE",
        full_name="Google Driver",
    )
    db.add(driver)
    db.flush()
    driver_user = User(
        email="driver@outside.example",
        password_hash=None,
        full_name="Google Driver",
        role="driver",
        fleet_id=fleet.id,
        driver_id=driver.id,
    )
    admin_user = User(
        email="admin@company.example",
        password_hash=None,
        full_name="Fleet Admin",
        role="fleet_admin",
        fleet_id=fleet.id,
    )
    db.add_all([driver_user, admin_user])
    db.commit()
    result = {
        "driver": {"id": driver_user.id, "email": driver_user.email},
        "admin": {"id": admin_user.id, "email": admin_user.email},
    }
    db.close()
    return result


@pytest.fixture
def google_claims(monkeypatch: pytest.MonkeyPatch) -> dict[str, dict]:
    claims_by_token: dict[str, dict] = {}

    def verify(token: str, _request, audience: str) -> dict:
        assert audience == "trickee-web-client"
        if token not in claims_by_token:
            raise ValueError("invalid token")
        return claims_by_token[token]

    monkeypatch.setattr(google_id_token, "verify_oauth2_token", verify)
    return claims_by_token


def claims(
    *,
    sub: str,
    email: str,
    nonce: str,
    email_verified: bool = True,
    hosted_domain: str | None = None,
) -> dict:
    value = {
        "sub": sub,
        "email": email,
        "email_verified": email_verified,
        "name": "Verified User",
        "nonce": nonce,
        "iss": "https://accounts.google.com",
        "aud": "trickee-web-client",
    }
    if hosted_domain:
        value["hd"] = hosted_domain
    return value


def login(token: str, nonce: str = "nonce-1"):
    return client.post(
        "/api/v2/auth/google",
        json={"id_token": token, "nonce": nonce},
    )


def test_google_login_links_preprovisioned_verified_driver(
    seeded_users,
    google_claims,
):
    google_claims["driver-token"] = claims(
        sub="google-driver-sub",
        email=seeded_users["driver"]["email"],
        nonce="nonce-1",
    )

    response = login("driver-token")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["user"]["id"] == seeded_users["driver"]["id"]
    assert payload["access_token"]
    assert payload["refresh_token"]
    db = TestSession()
    linked = db.query(User).filter(User.id == seeded_users["driver"]["id"]).one()
    assert linked.google_sub == "google-driver-sub"
    db.close()


def test_google_login_rejects_unknown_unprovisioned_identity(google_claims):
    google_claims["unknown-token"] = claims(
        sub="unknown-google-sub",
        email="unknown@example.com",
        nonce="nonce-1",
    )

    response = login("unknown-token")

    assert response.status_code == 403


def test_password_login_and_signup_are_not_exposed_when_disabled(monkeypatch):
    monkeypatch.setenv("TRICKEE_PASSWORD_AUTH_ENABLED", "false")
    get_settings.cache_clear()

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "any@example.com", "password": "not-used"},
    )
    signup_response = client.post(
        "/api/v1/auth/signup",
        json={"email": "new@example.com", "password": "not-used", "full_name": "New User"},
    )

    assert login_response.status_code == 404
    assert signup_response.status_code == 404


def test_google_login_rejects_unverified_email(seeded_users, google_claims):
    google_claims["unverified-token"] = claims(
        sub="unverified-google-sub",
        email=seeded_users["driver"]["email"],
        email_verified=False,
        nonce="nonce-1",
    )

    response = login("unverified-token")

    assert response.status_code == 401


def test_company_admin_requires_configured_workspace_domain(
    seeded_users,
    google_claims,
):
    google_claims["wrong-domain-token"] = claims(
        sub="admin-google-sub",
        email=seeded_users["admin"]["email"],
        nonce="nonce-1",
        hosted_domain="outside.example",
    )

    response = login("wrong-domain-token")

    assert response.status_code == 403


def test_google_login_rejects_nonce_mismatch(seeded_users, google_claims):
    google_claims["nonce-token"] = claims(
        sub="nonce-google-sub",
        email=seeded_users["driver"]["email"],
        nonce="different-nonce",
    )

    response = login("nonce-token", nonce="nonce-1")

    assert response.status_code == 401


def test_refresh_token_rotates_and_replay_is_rejected(seeded_users, google_claims):
    google_claims["session-token"] = claims(
        sub="session-google-sub",
        email=seeded_users["driver"]["email"],
        nonce="nonce-1",
    )
    signed_in_response = login("session-token")
    assert signed_in_response.status_code == 200
    signed_in = signed_in_response.json()["data"]

    first = client.post(
        "/api/v2/auth/refresh",
        json={"refresh_token": signed_in["refresh_token"]},
    )
    replay = client.post(
        "/api/v2/auth/refresh",
        json={"refresh_token": signed_in["refresh_token"]},
    )

    assert first.status_code == 200
    assert first.json()["data"]["refresh_token"] != signed_in["refresh_token"]
    assert replay.status_code == 401


def test_logout_revokes_the_refresh_token_family(seeded_users, google_claims):
    google_claims["logout-token"] = claims(
        sub="logout-google-sub",
        email=seeded_users["driver"]["email"],
        nonce="nonce-1",
    )
    signed_in = login("logout-token").json()["data"]

    logout_response = client.post(
        "/api/v2/auth/logout",
        headers={"Authorization": f"Bearer {signed_in['access_token']}"},
        json={"refresh_token": signed_in["refresh_token"]},
    )
    refresh_response = client.post(
        "/api/v2/auth/refresh",
        json={"refresh_token": signed_in["refresh_token"]},
    )

    assert logout_response.status_code == 200
    assert refresh_response.status_code == 401
