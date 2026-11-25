"""VEGA Studio Backend – Pydantic models for Phase 10 Serial Monitor."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.upload import validate_port_token

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

SerialStatus = Literal["disconnected", "connecting", "connected", "error", "disconnecting"]
SerialStream = Literal["rx", "tx", "system", "error"]
SerialDataBits = Literal[5, 6, 7, 8]
SerialParity = Literal["N", "E", "O", "M", "S"]
SerialStopBits = Literal["1", "1.5", "2"]
LineEnding = Literal["none", "lf", "cr", "crlf"]

# Validated baud rate whitelist
VALID_BAUD_RATES: List[int] = [
    300, 1200, 2400, 4800, 9600, 19200, 38400,
    57600, 115200, 230400, 460800, 921600,
]

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class SerialConnectRequest(BaseModel):
    """Parameters for opening a serial connection."""

    port: str
    baud_rate: int = 115200
    data_bits: SerialDataBits = 8
    parity: SerialParity = "N"
    stop_bits: SerialStopBits = "1"
    read_timeout: float = Field(default=1.0, ge=0.1, le=30.0)
    write_timeout: float = Field(default=2.0, ge=0.1, le=30.0)

    @field_validator("port", mode="before")
    @classmethod
    def _clean_port(cls, value: Optional[str]) -> str:
        result = validate_port_token(value)
        if not result:
            raise ValueError("Serial port must not be empty.")
        return result

    @field_validator("baud_rate", mode="before")
    @classmethod
    def _check_baud(cls, value: int) -> int:
        if int(value) not in VALID_BAUD_RATES:
            raise ValueError(
                f"Baud rate {value!r} is not supported. Valid baud rates: {VALID_BAUD_RATES}"
            )
        return int(value)


class SerialSendRequest(BaseModel):
    """Data to transmit over the open serial port."""

    data: str = Field(min_length=0, max_length=4096)
    line_ending: LineEnding = "lf"

    @field_validator("data", mode="before")
    @classmethod
    def _check_data(cls, value: str) -> str:
        if len(value) > 4096:
            raise ValueError("Send payload must not exceed 4096 characters.")
        return value

# ---------------------------------------------------------------------------
# Response / event models
# ---------------------------------------------------------------------------


class SerialLogLine(BaseModel):
    """Single bounded serial output line."""

    seq: int
    timestamp: str
    stream: SerialStream
    text: str


class SerialConfig(BaseModel):
    """Currently active serial configuration."""

    port: Optional[str] = None
    baud_rate: int = 115200
    data_bits: SerialDataBits = 8
    parity: SerialParity = "N"
    stop_bits: SerialStopBits = "1"


class SerialStateResponse(BaseModel):
    """Current serial monitor state and buffered logs."""

    status: SerialStatus
    pyserial_available: bool = True
    port: Optional[str] = None
    baud_rate: Optional[int] = None
    config: Optional[SerialConfig] = None
    error_message: Optional[str] = None
    rx_count: int = 0
    tx_count: int = 0
    log_line_count: int = 0
    truncated_logs: bool = False
    logs: List[SerialLogLine] = Field(default_factory=list)
