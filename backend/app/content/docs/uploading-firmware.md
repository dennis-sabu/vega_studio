# Uploading Firmware via vega_xmodem.py

VEGA Studio flashes firmware exclusively when **you explicitly trigger and confirm an upload**. Neither AI assistants nor background tasks ever flash hardware automatically.

## Upload Workflow

1. Build your firmware first so compiled `.bin` / `.elf` / `.hex` artifacts exist in your workspace.
2. Disconnect the **Serial Monitor** if it is holding the same UART device (`/dev/ttyUSB0` or `COMx`), otherwise OS port locking prevents uploading.
3. Open **Upload Output** (bottom panel) or click the Upload toolbar action:
   - Review the **Preflight Check** (board compatibility, SDK python path, verified `vega_xmodem.py`, artifact existence, and target port).
   - Confirm port and artifact selection in the explicit confirmation prompt.
4. Watch live stdout/stderr streaming from `vega_xmodem.py`, and use **Cancel** if you need to abort.
