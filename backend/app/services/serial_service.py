"""VEGA Studio Backend – Phase 10 Serial Monitor Service.

Architecture:
- One active serial session at a time (enforced by lock + status check).
- PySerial is imported lazily; if unavailable, connect() raises a 503 error.
- Reader runs in a background thread (PySerial is synchronous).
- Lines are accumulated in a bounded deque and pushed to asyncio subscriber
  queues (same pattern as BuildService / UploadService).
- The serial port remains open if the frontend WebSocket disconnects;
  only an explicit POST /disconnect or backend shutdown closes it.
"""
from __future__ import annotations

import asyncio
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from app.models.serial import (
    LineEnding,
    SerialConfig,
    SerialConnectRequest,
    SerialLogLine,
    SerialSendRequest,
    SerialStateResponse,
    SerialStatus,
)
from app.models.upload import DeviceListResponse, SerialDeviceInfo
from app.services.process_utils import utc_now_iso
from app.services.sdk_service import _host_os_name
from app.services.upload_service import UploadService

# ---------------------------------------------------------------------------
# Optional pyserial import
# ---------------------------------------------------------------------------

try:
    import serial  # type: ignore[import-untyped]
    import serial.tools.list_ports  # type: ignore[import-untyped]

    PYSERIAL_AVAILABLE = True
except ImportError:  # pragma: no cover
    serial = None  # type: ignore[assignment]
    PYSERIAL_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_SERIAL_LOG_LINES = 5000
_PARTIAL_FLUSH_INTERVAL_S = 0.1  # seconds between forced partial-line flushes
_POLL_READ_TIMEOUT_S = 0.05  # keep reader responsive without busy-spinning

LINE_ENDING_BYTES: Dict[LineEnding, bytes] = {
    "none": b"",
    "lf": b"\n",
    "cr": b"\r",
    "crlf": b"\r\n",
}


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------


class SerialServiceError(Exception):
    """Domain error with associated HTTP status code."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Subscriber entry type alias
# ---------------------------------------------------------------------------

_SubscriberEntry = Tuple["asyncio.Queue[Dict[str, Any]]", asyncio.AbstractEventLoop]


# ---------------------------------------------------------------------------
# Serial Monitor Service
# ---------------------------------------------------------------------------


class SerialService:
    """Manages a single serial port connection with live log streaming."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()

        # Connection state
        self._status: SerialStatus = "disconnected"
        self._port: Optional[str] = None
        self._config: Optional[SerialConfig] = None
        self._serial_conn: Any = None  # serial.Serial instance or None
        self._error_message: Optional[str] = None

        # Reader thread
        self._reader_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Bounded log buffer
        self._logs: Deque[SerialLogLine] = deque(maxlen=MAX_SERIAL_LOG_LINES)
        self._seq = 0
        self._log_line_count = 0
        self._truncated_logs = False

        # Byte counters (per active session)
        self._rx_count = 0
        self._tx_count = 0

        # WebSocket subscribers: (asyncio.Queue, event_loop)
        self._subscribers: Set[_SubscriberEntry] = set()

    # ------------------------------------------------------------------
    # Device discovery – pyserial in-process + cross-platform OS fallbacks
    # ------------------------------------------------------------------

    def discover_devices(self) -> DeviceListResponse:
        """Discover serial/USB-UART devices using pyserial or OS fallbacks."""
        devices: List[SerialDeviceInfo] = []
        warnings: List[str] = []
        notes: List[str] = []
        host_os = _host_os_name()

        # --- In-process PySerial path ---
        if PYSERIAL_AVAILABLE and serial is not None:
            try:
                ports = serial.tools.list_ports.comports()
                for p in ports:
                    vid_val = getattr(p, "vid", None)
                    pid_val = getattr(p, "pid", None)
                    desc = getattr(p, "description", "") or ""
                    label = (
                        f"{p.device} — {desc}"
                        if desc and desc.lower() != "n/a"
                        else p.device
                    )
                    port_accessible = (
                        os.access(p.device, os.R_OK | os.W_OK)
                        if (host_os != "windows" and str(p.device).startswith("/dev/"))
                        else True
                    )
                    devices.append(
                        SerialDeviceInfo(
                            port=p.device,
                            display_name=label,
                            description=desc,
                            hardware_id=getattr(p, "hwid", None),
                            manufacturer=getattr(p, "manufacturer", None),
                            serial_number=getattr(p, "serial_number", None),
                            vendor_id=f"{vid_val:04X}" if vid_val is not None else None,
                            product_id=f"{pid_val:04X}" if pid_val is not None else None,
                            transport="serial",
                            accessible=port_accessible,
                        )
                    )
                if host_os != "windows":
                    devfs_devices, dev_warnings = UploadService._discover_linux_devfs_ports()
                    warnings.extend(dev_warnings)
                    by_real = {}
                    for d in devfs_devices:
                        if d.stable_path:
                            try:
                                by_real[str(Path(d.stable_path).resolve())] = d
                            except OSError:
                                pass
                    merged: List[SerialDeviceInfo] = []
                    seen: Set[str] = set()
                    for d in devices:
                        stable = by_real.get(d.port)
                        if stable and stable.stable_path:
                            merged.append(
                                d.model_copy(
                                    update={
                                        "port": stable.stable_path,
                                        "stable_path": stable.stable_path,
                                        "display_name": f"{d.display_name} ({Path(stable.stable_path).name})",
                                    }
                                )
                            )
                            seen.add(stable.stable_path)
                        else:
                            merged.append(d)
                            seen.add(d.port)
                    for d in devfs_devices:
                        if d.port not in seen:
                            merged.append(d)
                    devices = merged

                if not devices:
                    notes.append("No serial/USB-UART devices currently connected.")
                return DeviceListResponse(
                    platform_os=host_os,
                    discovery_method="pyserial",
                    discovery_supported=True,
                    devices=devices,
                    warnings=warnings,
                    notes=notes,
                )
            except Exception as exc:
                warnings.append(f"PySerial port enumeration failed: {exc}")

        # --- Delegate OS fallbacks cleanly without importing winreg on Linux ---
        uploader_helper = UploadService()
        if host_os == "windows":
            win_devices = uploader_helper._discover_windows_registry_ports()
            notes.append(
                "PySerial is not installed in the backend Python environment; "
                "serial port discovery used Windows SERIALCOMM registry. "
                "Install pyserial in backend/.venv to connect."
            )
            if not win_devices:
                notes.append(
                    "No active Windows COM ports detected. Actual VEGA ARIES V3 hardware "
                    "validation targets Ubuntu Linux."
                )
            return DeviceListResponse(
                platform_os=host_os,
                discovery_method="windows_registry",
                discovery_supported=True,
                devices=win_devices,
                warnings=warnings,
                notes=notes,
            )

        linux_devices, linux_warnings = uploader_helper._discover_linux_devfs_ports()
        warnings.extend(linux_warnings)
        notes.append(
            "PySerial is not installed in the backend Python environment; "
            "scanned /dev/serial/by-id, /dev/ttyUSB*, and /dev/ttyACM*. "
            "Install pyserial in backend/.venv to connect."
        )
        if not linux_devices:
            notes.append("No serial USB-UART devices currently connected under /dev.")
        return DeviceListResponse(
            platform_os=host_os,
            discovery_method="linux_devfs",
            discovery_supported=True,
            devices=linux_devices,
            warnings=warnings,
            notes=notes,
        )

    # ------------------------------------------------------------------
    # Connect
    # ------------------------------------------------------------------

    def connect(self, req: SerialConnectRequest) -> SerialStateResponse:
        """Open a serial port and start the reader thread."""
        if not PYSERIAL_AVAILABLE or serial is None:
            raise SerialServiceError(
                "PySerial is not installed in the backend Python environment. "
                "Install pyserial to use the Serial Monitor.",
                status_code=503,
            )

        with self._lock:
            if self._status in ("connected", "connecting", "disconnecting"):
                raise SerialServiceError(
                    f"A serial session is already active on {self._port!r}. "
                    "Disconnect first.",
                    status_code=409,
                )
            self._status = "connecting"
            self._error_message = None
            self._port = req.port

        self._emit_event(
            {
                "type": "status",
                "status": "connecting",
                "error_message": None,
                "port": req.port,
            }
        )

        try:
            stop_bits_map = {"1": 1, "1.5": 1.5, "2": 2}
            stop_bits_val = stop_bits_map[req.stop_bits]
            poll_timeout = min(float(req.read_timeout), _POLL_READ_TIMEOUT_S)

            conn = serial.Serial(
                port=req.port,
                baudrate=req.baud_rate,
                bytesize=req.data_bits,
                parity=req.parity,
                stopbits=stop_bits_val,
                timeout=poll_timeout,
                write_timeout=req.write_timeout,
            )
        except Exception as exc:
            with self._lock:
                self._status = "error"
                self._port = None
                self._error_message = str(exc)
            self._append_log("error", f"Failed to open {req.port}: {exc}")
            self._emit_event(
                {
                    "type": "status",
                    "status": "error",
                    "error_message": str(exc),
                    "port": None,
                }
            )
            raise SerialServiceError(str(exc), status_code=400) from exc

        config = SerialConfig(
            port=req.port,
            baud_rate=req.baud_rate,
            data_bits=req.data_bits,
            parity=req.parity,
            stop_bits=req.stop_bits,
        )

        with self._lock:
            self._serial_conn = conn
            self._config = config
            self._status = "connected"
            self._rx_count = 0
            self._tx_count = 0
            self._stop_event.clear()

        self._append_log(
            "system",
            f"Connected to {req.port} at {req.baud_rate} baud "
            f"({req.data_bits}{req.parity}{req.stop_bits})",
        )
        self._emit_event(
            {
                "type": "status",
                "status": "connected",
                "error_message": None,
                "port": req.port,
                "baud_rate": req.baud_rate,
                "config": config.model_dump(),
            }
        )

        self._reader_thread = threading.Thread(
            target=self._reader_worker,
            daemon=True,
            name=f"serial-reader:{req.port}",
        )
        self._reader_thread.start()

        return self.get_state()

    # ------------------------------------------------------------------
    # Disconnect
    # ------------------------------------------------------------------

    def disconnect(self) -> SerialStateResponse:
        """Close the active serial port cleanly."""
        with self._lock:
            if self._status not in ("connected", "error"):
                raise SerialServiceError(
                    "No active serial connection to disconnect.",
                    status_code=400,
                )
            port = self._port
            self._status = "disconnecting"

        if port:
            self._append_log("system", f"Disconnecting from {port}…")
        self._emit_event(
            {
                "type": "status",
                "status": "disconnecting",
                "error_message": None,
                "port": port,
            }
        )

        self._stop_event.set()

        conn = self._serial_conn
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

        thread = self._reader_thread
        if thread and thread.is_alive():
            thread.join(timeout=3.0)

        with self._lock:
            self._serial_conn = None
            self._reader_thread = None
            self._status = "disconnected"
            self._port = None
            self._config = None
            self._error_message = None

        self._append_log("system", f"Disconnected from {port or 'serial port'}.")
        self._emit_event(
            {
                "type": "status",
                "status": "disconnected",
                "error_message": None,
                "port": None,
                "baud_rate": None,
                "config": None,
            }
        )
        return self.get_state()

    # ------------------------------------------------------------------
    # Send
    # ------------------------------------------------------------------

    def send(self, req: SerialSendRequest) -> SerialStateResponse:
        """Transmit data over the open serial port."""
        with self._lock:
            if self._status != "connected" or self._serial_conn is None:
                raise SerialServiceError(
                    "Cannot send: no active serial connection.", status_code=400
                )
            conn = self._serial_conn

        raw_text = req.data
        line_ending_bytes = LINE_ENDING_BYTES.get(req.line_ending, b"\n")
        payload_bytes = raw_text.encode("utf-8", errors="replace") + line_ending_bytes

        if not payload_bytes:
            raise SerialServiceError("Send payload is empty.", status_code=400)

        try:
            with self._write_lock:
                conn.write(payload_bytes)
                conn.flush()
        except Exception as exc:
            with self._lock:
                if self._status == "connected":
                    self._status = "error"
                    self._error_message = str(exc)
            self._append_log("error", f"Serial write error: {exc}")
            self._emit_event(
                {
                    "type": "status",
                    "status": "error",
                    "error_message": str(exc),
                    "port": self._port,
                }
            )
            raise SerialServiceError(
                f"Serial write error: {exc}", status_code=500
            ) from exc

        with self._lock:
            self._tx_count += len(payload_bytes)

        display_text = raw_text if raw_text else f"[{req.line_ending.upper()}]"
        self._append_log("tx", display_text)
        return self.get_state()

    # ------------------------------------------------------------------
    # Clear output
    # ------------------------------------------------------------------

    def clear_output(self) -> SerialStateResponse:
        """Clear buffered log lines (does not close the port)."""
        with self._lock:
            self._logs.clear()
            self._seq = 0
            self._log_line_count = 0
            self._truncated_logs = False
        self._emit_event({"type": "cleared"})
        return self.get_state()

    # ------------------------------------------------------------------
    # State snapshot
    # ------------------------------------------------------------------

    def get_state(self, include_logs: bool = True) -> SerialStateResponse:
        with self._lock:
            status = self._status
            port = self._port
            config = self._config
            error_message = self._error_message
            rx_count = self._rx_count
            tx_count = self._tx_count
            log_line_count = self._log_line_count
            truncated_logs = self._truncated_logs
            logs = list(self._logs) if include_logs else []
            baud_rate = config.baud_rate if config else None

        return SerialStateResponse(
            status=status,
            pyserial_available=PYSERIAL_AVAILABLE,
            port=port,
            baud_rate=baud_rate,
            config=config,
            error_message=error_message,
            rx_count=rx_count,
            tx_count=tx_count,
            log_line_count=log_line_count,
            truncated_logs=truncated_logs,
            logs=logs,
        )

    # ------------------------------------------------------------------
    # Subscriber management (for WebSocket streaming)
    # ------------------------------------------------------------------

    def add_subscriber(
        self,
        queue: "asyncio.Queue[Dict[str, Any]]",
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        with self._lock:
            self._subscribers.add((queue, loop))

    def remove_subscriber(
        self,
        queue: "asyncio.Queue[Dict[str, Any]]",
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        with self._lock:
            self._subscribers.discard((queue, loop))

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def shutdown(self) -> None:
        """Clean up on application shutdown."""
        try:
            with self._lock:
                cur_status = self._status
            if cur_status in ("connected", "connecting", "error"):
                self.disconnect()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Private: append log line + emit to subscribers
    # ------------------------------------------------------------------

    def _append_log(self, stream: str, text: str) -> None:
        with self._lock:
            self._seq += 1
            line = SerialLogLine(
                seq=self._seq,
                timestamp=utc_now_iso(),
                stream=stream,  # type: ignore[arg-type]
                text=text,
            )
            self._logs.append(line)
            self._log_line_count += 1
            if self._log_line_count > MAX_SERIAL_LOG_LINES:
                self._truncated_logs = True
            rx_count = self._rx_count
            tx_count = self._tx_count

        self._emit_event(
            {
                "type": "log",
                "line": line.model_dump(),
                "rx_count": rx_count,
                "tx_count": tx_count,
            }
        )

    def _emit_event(self, payload: Dict[str, Any]) -> None:
        """Thread-safe broadcast to all WebSocket subscribers."""
        dead: List[_SubscriberEntry] = []
        with self._lock:
            subs = set(self._subscribers)
        for entry in subs:
            queue, loop = entry
            try:
                asyncio.run_coroutine_threadsafe(
                    self._enqueue(queue, payload), loop
                )
            except Exception:
                dead.append(entry)
        if dead:
            with self._lock:
                for d in dead:
                    self._subscribers.discard(d)

    @staticmethod
    async def _enqueue(
        queue: "asyncio.Queue[Dict[str, Any]]",
        payload: Dict[str, Any],
    ) -> None:
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    # ------------------------------------------------------------------
    # Private: background reader thread
    # ------------------------------------------------------------------

    def _reader_worker(self) -> None:
        """Read from the serial port in a background thread."""
        partial: bytes = b""
        last_flush = time.monotonic()

        try:
            while not self._stop_event.is_set():
                conn = self._serial_conn
                if conn is None:
                    break

                try:
                    in_waiting = getattr(conn, "in_waiting", 0)
                    if isinstance(in_waiting, int) and in_waiting > 0:
                        chunk = conn.read(min(in_waiting, 4096))
                    else:
                        chunk = conn.read(1)
                except Exception as exc:
                    if self._stop_event.is_set():
                        break
                    with self._lock:
                        if self._status == "connected":
                            self._status = "error"
                            self._error_message = str(exc)
                        err_port = self._port
                    self._append_log("error", f"Serial read error: {exc}")
                    self._emit_event(
                        {
                            "type": "status",
                            "status": "error",
                            "error_message": str(exc),
                            "port": err_port,
                        }
                    )
                    break

                now = time.monotonic()
                if chunk:
                    with self._lock:
                        self._rx_count += len(chunk)

                    partial += chunk
                    while b"\n" in partial:
                        line_bytes, partial = partial.split(b"\n", 1)
                        text = line_bytes.decode("utf-8", errors="replace").rstrip("\r")
                        self._append_log("rx", text)
                        last_flush = now
                    if len(partial) >= 4096:
                        text = partial.decode("utf-8", errors="replace").rstrip("\r")
                        self._append_log("rx", text)
                        partial = b""
                        last_flush = now

                if partial and (now - last_flush) >= _PARTIAL_FLUSH_INTERVAL_S:
                    text = partial.decode("utf-8", errors="replace").rstrip("\r")
                    self._append_log("rx", text)
                    partial = b""
                    last_flush = now

            if partial:
                text = partial.decode("utf-8", errors="replace").rstrip("\r")
                self._append_log("rx", text)
        finally:
            # Close underlying handle if loop exited unexpectedly on read error
            with self._lock:
                stale_conn = self._serial_conn
                if not self._stop_event.is_set() and stale_conn is not None:
                    self._serial_conn = None
                else:
                    stale_conn = None
            if stale_conn is not None:
                try:
                    stale_conn.close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_service_instance: Optional[SerialService] = None
_service_lock = threading.Lock()


def get_serial_service() -> SerialService:
    global _service_instance
    if _service_instance is None:
        with _service_lock:
            if _service_instance is None:
                _service_instance = SerialService()
    return _service_instance
