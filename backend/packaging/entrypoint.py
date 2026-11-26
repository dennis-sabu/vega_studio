"""PyInstaller standalone production entrypoint for the VEGA Studio FastAPI backend."""
from __future__ import annotations

import multiprocessing
import uvicorn

from app.config import settings
from app.main import app


def main() -> None:
    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        log_level=settings.LOG_LEVEL.lower(),
        access_log=False,
    )


if __name__ == "__main__":
    main()
