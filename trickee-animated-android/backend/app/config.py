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
    google_maps_api_key: str = ""
    external_api_timeout_seconds: float = Field(default=5.0, ge=1.0, le=20.0)
    external_api_cache_seconds: int = Field(default=300, ge=30, le=3600)
    groq_api_key: str = ""
    # This account exposes GPT-OSS for chat-completions tool calling; keep the
    # model configurable so availability changes do not require protocol edits.
    groq_model: str = "openai/gpt-oss-20b"
    llm_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)
    fcm_project_id: str = ""
    fcm_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)

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
