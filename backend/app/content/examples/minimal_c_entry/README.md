# Minimal C Firmware & Portable Makefile (VEGA ARIES V3)

This starter example uses VEGA Studio's verified portable project structure and Make environment contract:

- **Target Board:** C-DAC VEGA ARIES V3 (`VEGA_ARIES_V3`)
- **Architecture:** `rv32i_zicsr`
- **Machine:** `THEJAS32`
- **Verification Level:** `template_verified` (IDE scaffold & build contract verified; requires local VEGA SDK startup files & toolchain to link a full board binary)

## Files

- `src/main.c` — Minimal freestanding firmware entry point with a `volatile` heartbeat loop
- `include/app_config.h` — Portable project configuration constants
- `Makefile` — Portable build rules consuming `CROSS_COMPILE`, `RISCV_ARCH`, and `VEGA_MACHINE`
