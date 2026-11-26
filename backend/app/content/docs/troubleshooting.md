# Troubleshooting IDE, Toolchain & Hardware Issues

## Common Scenarios & Fixes

### 1. Build Fails: Cross-Compiler or Make Not Found
- Run **SDK Doctor** (`SDK & Doctor` sidebar or Status Bar).
- Check **Settings → SDK & Toolchain** to verify `sdk_root`, `toolchain_root`, `compiler_path` (`riscv32-vega-elf-gcc`), and GNU `make`.

### 2. Board Compatibility Shows Warning or Error
- Open **Board Manager** (`Board & Tools` sidebar) to confirm `vega-project.json` matches `VEGA_ARIES_V3` (`rv32i_zicsr`, `THEJAS32`).

### 3. Firmware Upload Fails with Busy Port / Permission Denied
- Disconnect the **Serial Monitor** cleanly before uploading (only one process can own `/dev/ttyUSB0` or `COMx`).
- On Ubuntu Linux, verify your user belongs to the `dialout` group when accessing `/dev/ttyUSB*`.

### 4. Native AI Reports Unavailable Credential Store
- On desktop Windows/Linux, VEGA Studio uses native Windows Credential Manager or Linux Secret Service (`keyring` / `secret-tool`).
- If running in a headless container without a keyring daemon, enable the explicit **Session-Only (in-memory)** checkbox when entering your key.
