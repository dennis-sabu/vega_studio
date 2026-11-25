"""Tests for Phase 10 Serial Monitor (models, service, REST API, WebSocket streaming).

All tests run without real hardware. PySerial is mocked throughout.
"""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from collections import deque
from io import BytesIO
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.serial import (
    VALID_BAUD_RATES,
    SerialConnectRequest,
    SerialLogLine,
    SerialSendRequest,
    SerialStateResponse,
)
from app.models.upload import DeviceListResponse
from app.services.serial_service import (
    MAX_SERIAL_LOG_LINES,
    SerialService,
    SerialServiceError,
    get_serial_service,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class FakeSerial:
    """Minimal serial.Serial stub for unit tests."""

    def __init__(self, read_chunks: Optional[List[bytes]] = None) -> None:
        self._read_chunks: deque[bytes] = deque(read_chunks or [])
        self.written: List[bytes] = []
        self._closed = False

    def read(self, n: int = 1) -> bytes:  # noqa: ARG002
        if self._read_chunks:
            chunk = self._read_chunks.popleft()
            if isinstance(chunk, Exception):
                raise chunk  # type: ignore[misc]
            return chunk
        time.sleep(0.05)
        return b""

    def write(self, data: bytes) -> int:
        self.written.append(data)
        return len(data)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        self._closed = True

    @property
    def is_open(self) -> bool:
        return not self._closed


def make_service() -> SerialService:
    """Return a fresh SerialService instance isolated from the singleton."""
    return SerialService()


def _mock_serial_module():
    """Return a mock serial module with FakeSerial as Serial class."""
    mock_serial = MagicMock()
    mock_serial.SerialException = Exception
    mock_serial.tools = MagicMock()
    mock_serial.tools.list_ports = MagicMock()
    return mock_serial


# ---------------------------------------------------------------------------
# 1. Models – validation
# ---------------------------------------------------------------------------


class TestSerialModels:
    def test_valid_baud_rates_list_is_populated(self):
        assert 115200 in VALID_BAUD_RATES
        assert 9600 in VALID_BAUD_RATES
        assert 300 in VALID_BAUD_RATES

    def test_connect_request_rejects_invalid_baud(self):
        with pytest.raises(Exception):
            SerialConnectRequest(port="COM3", baud_rate=12345)

    def test_connect_request_accepts_valid_baud(self):
        req = SerialConnectRequest(port="COM3", baud_rate=115200)
        assert req.baud_rate == 115200

    def test_connect_request_rejects_empty_port(self):
        with pytest.raises(Exception):
            SerialConnectRequest(port="", baud_rate=115200)

    def test_connect_request_rejects_null_bytes_in_port(self):
        with pytest.raises(Exception):
            SerialConnectRequest(port="COM\x003", baud_rate=115200)

    def test_send_request_rejects_oversized_data(self):
        with pytest.raises(Exception):
            SerialSendRequest(data="x" * 4097)

    def test_send_request_accepts_max_data(self):
        req = SerialSendRequest(data="x" * 4096, line_ending="lf")
        assert len(req.data) == 4096

    def test_send_request_empty_string_accepted(self):
        req = SerialSendRequest(data="", line_ending="none")
        assert req.data == ""

    def test_connect_request_path_traversal_rejected(self):
        with pytest.raises(Exception):
            SerialConnectRequest(port="../../etc/passwd", baud_rate=115200)


# ---------------------------------------------------------------------------
# 2. Device discovery
# ---------------------------------------------------------------------------


class TestDeviceDiscovery:
    def test_discover_devices_with_pyserial(self):
        """When PySerial is available, it should return port list."""
        mock_port = MagicMock()
        mock_port.device = "COM5"
        mock_port.description = "USB Serial"
        mock_port.hwid = "USB VID:PID=1234:5678"
        mock_port.manufacturer = "FTDI"
        mock_port.serial_number = "ABC123"
        mock_port.vid = 0x1234
        mock_port.pid = 0x5678

        mock_serial = _mock_serial_module()
        mock_serial.tools.list_ports.comports.return_value = [mock_port]

        svc = make_service()
        with patch.dict("sys.modules", {"serial": mock_serial, "serial.tools": mock_serial.tools, "serial.tools.list_ports": mock_serial.tools.list_ports}):
            with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
                with patch("app.services.serial_service.serial", mock_serial):
                    result = svc.discover_devices()

        assert isinstance(result, DeviceListResponse)
        assert result.discovery_method == "pyserial"
        assert result.discovery_supported is True
        assert len(result.devices) == 1
        assert result.devices[0].port == "COM5"
        assert result.devices[0].vendor_id == "1234"

    def test_discover_devices_no_pyserial_windows(self):
        """Without PySerial on Windows, falls back to registry (or returns empty)."""
        svc = make_service()
        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", False):
            # This may fail on non-Windows in CI; just check it returns a valid response
            result = svc.discover_devices()
        assert isinstance(result, DeviceListResponse)
        assert result.platform_os is not None


# ---------------------------------------------------------------------------
# 3. Connect / Disconnect
# ---------------------------------------------------------------------------


class TestConnectDisconnect:
    def test_connect_raises_503_when_pyserial_unavailable(self):
        svc = make_service()
        req = SerialConnectRequest(port="COM3", baud_rate=115200)
        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", False):
            with pytest.raises(SerialServiceError) as exc_info:
                svc.connect(req)
        assert exc_info.value.status_code == 503
        assert "pyserial" in exc_info.value.message.lower()

    def test_connect_success_with_mocked_serial(self):
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                state = svc.connect(req)

        assert state.status == "connected"
        assert state.port == "COM3"
        assert state.baud_rate == 115200

        # Cleanup
        svc.shutdown()

    def test_connect_duplicate_raises_409(self):
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)
                with pytest.raises(SerialServiceError) as exc_info:
                    svc.connect(req)

        assert exc_info.value.status_code == 409
        svc.shutdown()

    def test_disconnect_cleans_up(self):
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)
                state = svc.disconnect()

        assert state.status == "disconnected"
        assert state.port is None

    def test_disconnect_when_not_connected_raises_400(self):
        svc = make_service()
        with pytest.raises(SerialServiceError) as exc_info:
            svc.disconnect()
        assert exc_info.value.status_code == 400

    def test_connect_serial_exception_becomes_service_error(self):
        svc = make_service()
        req = SerialConnectRequest(port="COM99", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.side_effect = Exception("port not found")
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                with pytest.raises(SerialServiceError):
                    svc.connect(req)

        assert svc.get_state().status == "error"


# ---------------------------------------------------------------------------
# 4. Send
# ---------------------------------------------------------------------------


class TestSend:
    def _connected_service(self) -> tuple[SerialService, FakeSerial]:
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        return svc, fake

    def test_send_success(self):
        svc, fake = self._connected_service()
        req = SerialSendRequest(data="hello", line_ending="lf")
        state = svc.send(req)
        assert state.tx_count > 0
        assert b"hello\n" in fake.written
        svc.shutdown()

    def test_send_crlf_line_ending(self):
        svc, fake = self._connected_service()
        req = SerialSendRequest(data="AT", line_ending="crlf")
        svc.send(req)
        assert b"AT\r\n" in fake.written
        svc.shutdown()

    def test_send_no_line_ending(self):
        svc, fake = self._connected_service()
        req = SerialSendRequest(data="raw", line_ending="none")
        svc.send(req)
        assert b"raw" in fake.written
        svc.shutdown()

    def test_send_when_disconnected_raises_400(self):
        svc = make_service()
        with pytest.raises(SerialServiceError) as exc_info:
            svc.send(SerialSendRequest(data="hello", line_ending="lf"))
        assert exc_info.value.status_code == 400

    def test_send_increments_tx_count(self):
        svc, fake = self._connected_service()
        initial = svc.get_state().tx_count
        svc.send(SerialSendRequest(data="ping", line_ending="lf"))
        assert svc.get_state().tx_count > initial
        svc.shutdown()

    def test_send_empty_text_with_line_ending_sends_newline(self):
        svc, fake = self._connected_service()
        state = svc.send(SerialSendRequest(data="", line_ending="crlf"))
        assert b"\r\n" in fake.written
        assert state.tx_count == 2
        svc.shutdown()

    def test_send_empty_text_with_none_ending_raises_400(self):
        svc, _ = self._connected_service()
        with pytest.raises(SerialServiceError) as exc_info:
            svc.send(SerialSendRequest(data="", line_ending="none"))
        assert exc_info.value.status_code == 400
        svc.shutdown()

    def test_send_write_error_transitions_to_error(self):
        svc, fake = self._connected_service()
        fake.write = MagicMock(side_effect=OSError("write failed"))  # type: ignore[method-assign]
        with pytest.raises(SerialServiceError) as exc_info:
            svc.send(SerialSendRequest(data="hi", line_ending="lf"))
        assert exc_info.value.status_code == 500
        assert svc.get_state().status == "error"
        svc.shutdown()


# ---------------------------------------------------------------------------
# 5. Output clear
# ---------------------------------------------------------------------------


class TestClearOutput:
    def test_clear_output_resets_buffer(self):
        svc = make_service()
        # Manually append some logs
        svc._append_log("system", "test line 1")
        svc._append_log("system", "test line 2")
        assert len(svc._logs) == 2

        state = svc.clear_output()
        assert state.log_line_count == 0
        assert state.logs == []
        assert svc._truncated_logs is False


# ---------------------------------------------------------------------------
# 6. Bounded log buffer
# ---------------------------------------------------------------------------


class TestBoundedBuffer:
    def test_buffer_does_not_exceed_max(self):
        svc = make_service()
        for i in range(MAX_SERIAL_LOG_LINES + 50):
            svc._append_log("system", f"line {i}")

        assert len(svc._logs) <= MAX_SERIAL_LOG_LINES
        assert svc._truncated_logs is True


# ---------------------------------------------------------------------------
# 7. Reader thread – RX streaming
# ---------------------------------------------------------------------------


class TestReaderThread:
    def test_rx_lines_appear_in_logs(self):
        svc = make_service()
        # Inject two lines into the fake serial
        fake = FakeSerial(read_chunks=[b"hello\n", b"world\n", b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        # Give the reader thread time to process
        time.sleep(0.3)
        svc.shutdown()

        log_texts = [l.text for l in svc._logs if l.stream == "rx"]
        assert "hello" in log_texts
        assert "world" in log_texts

    def test_partial_rx_prompt_flushes_without_newline(self):
        svc = make_service()
        fake = FakeSerial(read_chunks=[b"vega> "])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        for _ in range(20):
            if any(l.stream == "rx" and l.text == "vega> " for l in svc._logs):
                break
            time.sleep(0.05)

        svc.shutdown()
        assert any(l.stream == "rx" and l.text == "vega> " for l in svc._logs)

    def test_read_error_updates_status_to_error(self):
        """When the reader thread gets a serial exception, status becomes 'error'."""
        svc = make_service()

        class BadFakeSerial(FakeSerial):
            _call_count = 0

            def read(self, n: int = 1) -> bytes:
                self._call_count += 1
                if self._call_count >= 2:
                    raise Exception("device removed")
                return b""

        fake = BadFakeSerial()
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        # Wait for reader thread to detect error
        for _ in range(20):
            if svc.get_state().status == "error":
                break
            time.sleep(0.1)

        assert svc.get_state().status == "error"

    def test_websocket_disconnect_does_not_close_serial_port(self):
        """Removing a subscriber must not affect the port or reader thread."""
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        loop = asyncio.new_event_loop()
        q: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        svc.add_subscriber(q, loop)
        svc.remove_subscriber(q, loop)
        loop.close()

        # Port should still be open
        assert svc.get_state().status == "connected"
        svc.shutdown()


# ---------------------------------------------------------------------------
# 8. API contract tests (REST)
# ---------------------------------------------------------------------------


class TestSerialAPI:
    @pytest.fixture
    def fresh_service(self):
        """Override serial service with a fresh instance for each API test."""
        svc = SerialService()
        from app.routers import serial as serial_router
        app.dependency_overrides[serial_router.get_serial_service] = lambda: svc
        yield svc
        app.dependency_overrides.clear()
        try:
            svc.shutdown()
        except Exception:
            pass

    def test_get_devices_returns_device_list(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.get("/api/serial/devices")
        assert resp.status_code == 200
        data = resp.json()
        assert "devices" in data
        assert "platform_os" in data

    def test_get_state_returns_disconnected(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.get("/api/serial/state")
        assert resp.status_code == 200
        assert resp.json()["status"] == "disconnected"

    def test_connect_no_pyserial_returns_503(self, fresh_service: SerialService):
        client = TestClient(app)
        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", False):
            resp = client.post(
                "/api/serial/connect",
                json={"port": "COM3", "baud_rate": 115200},
            )
        assert resp.status_code == 503

    def test_connect_success(self, fresh_service: SerialService):
        client = TestClient(app)
        fake = FakeSerial(read_chunks=[b""])
        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                resp = client.post(
                    "/api/serial/connect",
                    json={"port": "COM3", "baud_rate": 115200},
                )

        assert resp.status_code == 202
        assert resp.json()["status"] == "connected"

    def test_disconnect_when_not_connected_returns_400(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.post("/api/serial/disconnect")
        assert resp.status_code == 400

    def test_send_when_disconnected_returns_400(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.post(
            "/api/serial/send",
            json={"data": "test", "line_ending": "lf"},
        )
        assert resp.status_code == 400

    def test_clear_output_always_succeeds(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.post("/api/serial/output/clear")
        assert resp.status_code == 200

    def test_connect_invalid_baud_returns_422(self, fresh_service: SerialService):
        client = TestClient(app)
        resp = client.post(
            "/api/serial/connect",
            json={"port": "COM3", "baud_rate": 99999},
        )
        assert resp.status_code == 422

    def test_full_lifecycle_connect_send_disconnect(self, fresh_service: SerialService):
        """Connect → send → state check → disconnect."""
        client = TestClient(app)
        fake = FakeSerial(read_chunks=[b""])
        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                # Connect
                resp = client.post(
                    "/api/serial/connect",
                    json={"port": "COM3", "baud_rate": 9600},
                )
                assert resp.status_code == 202

                # Send
                resp = client.post(
                    "/api/serial/send",
                    json={"data": "hello", "line_ending": "lf"},
                )
                assert resp.status_code == 200
                assert resp.json()["tx_count"] > 0

                # State
                resp = client.get("/api/serial/state")
                assert resp.json()["status"] == "connected"

                # Disconnect
                resp = client.post("/api/serial/disconnect")
                assert resp.status_code == 200
                assert resp.json()["status"] == "disconnected"


# ---------------------------------------------------------------------------
# 9. WebSocket streaming
# ---------------------------------------------------------------------------


class TestWebSocketStreaming:
    def test_websocket_delivers_snapshot(self):
        svc = SerialService()
        from app.routers import serial as serial_router
        app.dependency_overrides[serial_router.get_serial_service] = lambda: svc

        client = TestClient(app)
        try:
            with client.websocket_connect("/api/serial/ws") as ws:
                msg = ws.receive_json()
                assert msg["type"] == "snapshot"
                assert "state" in msg
                assert "logs" in msg
                assert msg["state"]["status"] == "disconnected"
        finally:
            app.dependency_overrides.clear()
            svc.shutdown()

    def test_websocket_does_not_close_port_on_disconnect(self):
        """WS disconnect must leave the serial session intact."""
        svc = SerialService()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        from app.routers import serial as serial_router
        app.dependency_overrides[serial_router.get_serial_service] = lambda: svc

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        client = TestClient(app)
        try:
            with client.websocket_connect("/api/serial/ws") as ws:
                _snap = ws.receive_json()
                # WS disconnects here (context manager exit)

            # Port must still be open after WS disconnect
            assert svc.get_state().status == "connected"
        finally:
            app.dependency_overrides.clear()
            svc.shutdown()

    def test_websocket_streams_live_logs_and_clear_resets_seq(self):
        """WS receives live log events, cleared event, and subsequent logs after clear."""
        svc = SerialService()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        from app.routers import serial as serial_router
        app.dependency_overrides[serial_router.get_serial_service] = lambda: svc

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        client = TestClient(app)
        try:
            with client.websocket_connect("/api/serial/ws") as ws:
                snap = ws.receive_json()
                assert snap["type"] == "snapshot"
                assert snap["state"]["logs"] == []
                assert len(snap["logs"]) >= 1

                client.post("/api/serial/send", json={"data": "cmd1", "line_ending": "lf"})
                ev1 = ws.receive_json()
                assert ev1["type"] == "log"
                assert ev1["line"]["stream"] == "tx"
                assert ev1["line"]["text"] == "cmd1"
                assert ev1["tx_count"] > 0

                client.post("/api/serial/output/clear")
                ev_clear = ws.receive_json()
                assert ev_clear["type"] == "cleared"

                client.post("/api/serial/send", json={"data": "cmd2", "line_ending": "lf"})
                ev2 = ws.receive_json()
                assert ev2["type"] == "log"
                assert ev2["line"]["seq"] == 1
                assert ev2["line"]["text"] == "cmd2"
        finally:
            app.dependency_overrides.clear()
            svc.shutdown()


# ---------------------------------------------------------------------------
# 10. Shutdown safety
# ---------------------------------------------------------------------------


class TestShutdown:
    def test_shutdown_when_disconnected_is_safe(self):
        svc = make_service()
        svc.shutdown()  # Should not raise

    def test_shutdown_closes_active_connection(self):
        svc = make_service()
        fake = FakeSerial(read_chunks=[b""])
        req = SerialConnectRequest(port="COM3", baud_rate=115200)

        mock_serial = _mock_serial_module()
        mock_serial.Serial.return_value = fake
        mock_serial.SerialException = Exception

        with patch("app.services.serial_service.PYSERIAL_AVAILABLE", True):
            with patch("app.services.serial_service.serial", mock_serial):
                svc.connect(req)

        svc.shutdown()
        assert svc.get_state().status == "disconnected"
        assert fake._closed is True
