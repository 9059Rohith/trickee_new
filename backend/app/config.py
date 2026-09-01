from __future__ import annotations

from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="TRICKEE_",
        extra="ignore",
    )
    app_name: str = "Trickee GPS-First EV Intelligence"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./trickee_gps.db"
    secret_key: str = "trickee-gps-dev-secret-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    user_refresh_token_expire_days: int = 30
    device_access_token_expire_minutes: int = 60
    device_refresh_token_expire_days: int = 90
    google_oauth_client_id: str = ""
    google_workspace_domain: str = ""
    password_auth_enabled: bool = True
    allowed_origins: str = "*"
    gps_raw_retention_days: int = 90
    max_batch_points: int = 500
    debug: bool = False
    db_pool_size: int = 2
    db_max_overflow: int = 1
    db_pool_timeout_seconds: int = 10
    monitoring_audience: str = ""
    monitoring_caller_service_accounts: str = ""
    incomplete_finalization_timeout_hours: int = Field(default=24, ge=1, le=720)

    @property
    def allowed_origin_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def monitoring_caller_service_account_list(self) -> list[str]:
        return [
            email.strip().lower()
            for email in self.monitoring_caller_service_accounts.split(",")
            if email.strip()
        ]

@lru_cache()
def get_settings() -> Settings:
    return Settings()
