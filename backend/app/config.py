from __future__ import annotations

from functools import lru_cache
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
    allowed_origins: str = "*"
    gps_raw_retention_days: int = 90
    max_batch_points: int = 500
    debug: bool = False

    @property
    def allowed_origin_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

@lru_cache()
def get_settings() -> Settings:
    return Settings()
