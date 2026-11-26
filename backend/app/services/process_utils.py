"""Shared cross-platform subprocess tree termination and timestamp utilities."""
from __future__ import annotations

import os
import signal
import subprocess
from datetime import datetime, timezone

from app.services.sdk_service import _host_os_name


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def terminate_process_tree(proc: subprocess.Popen[str]) -> None:
    """Safely terminate a subprocess and its descendant process tree without raising."""
    if proc.poll() is not None:
        return

    if _host_os_name() == "windows":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                shell=False,
                capture_output=True,
                timeout=3.0,
            )
        except (subprocess.TimeoutExpired, OSError):
            try:
                proc.kill()
            except OSError:
                pass
        try:
            proc.wait(timeout=1.0)
        except (subprocess.TimeoutExpired, OSError):
            pass
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=1.2)
            return
        except (subprocess.TimeoutExpired, OSError):
            pass
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            try:
                proc.kill()
            except OSError:
                pass
        try:
            proc.wait(timeout=1.0)
        except (subprocess.TimeoutExpired, OSError):
            pass
