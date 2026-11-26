"""VEGA Studio Backend – pydantic-settings configuration."""
from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional
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

    # Optional override for application persistence directory (SQLite state)
    DATA_DIR: Optional[str] = None

    def get_data_dir(self) -> Path:
        """Return cross-platform local application data directory."""
        if self.DATA_DIR:
            return Path(self.DATA_DIR).expanduser().resolve()
        if os.name == "nt":
            local_app_data = os.environ.get("LOCALAPPDATA")
            if local_app_data:
                return Path(local_app_data) / "VEGA Studio"
            return Path.home() / "AppData" / "Local" / "VEGA Studio"
        xdg_data = os.environ.get("XDG_DATA_HOME")
        if xdg_data:
            return Path(xdg_data) / "vega-studio"
        return Path.home() / ".local" / "share" / "vega-studio"

    def get_default_projects_dir(self) -> Path:
        """Return sensible cross-platform default location for VEGA projects."""
        docs = Path.home() / "Documents"
        if docs.exists() and docs.is_dir():
            return docs / "VEGA Studio Projects"
        return Path.home() / "VEGA Studio Projects"

    @field_validator("HOST")
    @classmethod
    def _host_local_only(cls, v: str) -> str:
        """Restrict backend binding strictly to loopback addresses."""
        cleaned = v.strip()
        if cleaned not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError(
                f"HOST '{cleaned}' is not allowed – only loopback hosts ('127.0.0.1', 'localhost', '::1') are permitted."
            )
        return cleaned

    @field_validator("LOG_LEVEL")
    @classmethod
    def _validate_log_level(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if cleaned not in ("debug", "info", "warning", "error", "critical"):
            return "info"
        return cleaned

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


def is_allowed_ws_origin(origin: Optional[str]) -> bool:
    """Validate browser/Electron WebSocket Origin headers against local origins.

    Non-browser clients (and Starlette TestClient) omit Origin (`None`). When
    present, reject `'null'` and any origin outside configured loopback/app origins.
    """
    if origin is None or origin == "":
        return True
    cleaned = origin.strip()
    if cleaned.lower() == "null":
        return False
    if cleaned in settings.CORS_ORIGINS:
        return True
    parsed = urlparse(cleaned)
    if parsed.scheme in ("app", "vega"):
        return True
    if parsed.scheme in ("http", "https") and parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return True
    return False
