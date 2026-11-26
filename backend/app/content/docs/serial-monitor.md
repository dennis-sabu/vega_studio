# USB-UART Serial Monitor

The **Serial Monitor** (Phase 10) provides real-time bidirectional USB-UART telemetry using PySerial in the FastAPI backend (the frontend never accesses serial hardware directly).

## Features

- **Port Discovery**: Scans available CP210x / USB-UART serial devices and shows hardware metadata when available.
- **UART Configuration**: Select baud rate (`300` to `921600`), data bits (`5-8`), parity (`N/E/O/M/S`), stop bits (`1/1.5/2`), and TX line endings (`None`, `LF`, `CR`, `CRLF`).
- **Live Output Controls**: Toggle millisecond timestamps, toggle auto-scroll, replay bounded RX/TX history, or click **Analyze AI** to inspect the newest 35 lines inside **Native VEGA AI**.
