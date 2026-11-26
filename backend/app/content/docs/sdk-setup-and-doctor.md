# SDK Configuration & SDK Doctor

VEGA Studio discovers and validates your local VEGA SDK toolchain without mutating global host `PATH`.

## Typical Host Locations (Ubuntu 24.04 Reference)

- **VEGA SDK Root**: `~/vega/vega-sdk` (or `VEGA_SDK` / `VEGA_SDK_HOME`)
- **RISC-V Toolchain Root**: `~/vega/vega-tools-rv32` (or `VEGA_TOOLS` / `RISCV_TOOLS`)
- **Cross-Compiler**: `riscv32-vega-elf-gcc` (prefix `riscv32-vega-elf`)
- **Build System**: GNU `make`
- **Upload Script**: `vega_xmodem.py`

## Running SDK Doctor

1. Open **Settings → SDK & Toolchain** or click **SDK & Doctor** in the left rail.
2. Click **Auto-Discover** or browse cleanly to your SDK and toolchain directories.
3. Click **Run Diagnostics** in SDK Doctor to check:
   - SDK root layout
   - Cross-compiler execution and `-march=rv32i_zicsr` support
   - GNU Make & Python runtime
   - `vega_xmodem.py` static AST inspection (read-only, zero automatic flashing)

> [!TIP]
> On Windows development hosts without a Linux RISC-V toolchain installed, you can still inspect projects, configure paths ahead of time, browse documentation, and test IDE workflows safely.
