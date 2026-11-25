"""VEGA Studio Backend – pydantic-settings configuration."""
from __future__ import annotations

from typing import List
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
    HOST: str = "127.0.0.1"
    PORT: int = 8765

    # CORS – list of allowed localhost origins; never wildcard
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Logging
    LOG_LEVEL: str = "info"

    # Environment
    APP_ENV: str = "development"

    # App metadata
    APP_NAME: str = "vega-studio-backend"
    APP_VERSION: str = "0.1.0"

    @field_validator("HOST")
    @classmethod
    def _host_local_only(cls, v: str) -> str:
        """Reject 0.0.0.0 to prevent accidental public network exposure."""
        if v.strip() == "0.0.0.0":
            raise ValueError(
                "HOST must not be 0.0.0.0 – use 127.0.0.1 for local-only binding."
            )
        return v.strip()

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors(cls, v: object) -> List[str]:
        """Accept a comma-separated string or a list."""
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v  # type: ignore[return-value]

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _validate_cors_localhost_only(cls, v: List[str]) -> List[str]:
        """Ensure CORS origins are localhost/127.0.0.1 only and never wildcard."""
        for origin in v:
            if origin == "*":
                raise ValueError("Wildcard '*' is not allowed in CORS_ORIGINS.")
            parsed = urlparse(origin)
            if parsed.hostname not in ("localhost", "127.0.0.1"):
                raise ValueError(
                    f"CORS origin '{origin}' is not allowed; only localhost and 127.0.0.1 are permitted."
                )
        return v


# Singleton – import this everywhere
settings = Settings()
