# VEGA ARIES V3 Hardware Overview

The primary hardware target registered in VEGA Studio (`BoardManager`) is the **C-DAC VEGA ARIES V3**.

## Verified Target Profile

| Specification | Value |
|---|---|
| **Board ID** | `VEGA_ARIES_V3` |
| **Vendor / Family** | C-DAC · VEGA |
| **Core** | VEGA ET1031 |
| **Architecture** | RISC-V 32-bit |
| **ISA** | `rv32i_zicsr` |
| **Machine Config** | `THEJAS32` |
| **Clock Frequency** | `100 MHz` |
| **On-Chip SRAM** | `256 KB` |
| **Onboard Sensors** | `MPU6050 IMU`, `BMP280 Barometer` |
| **Cross-Compile Prefix** | `riscv32-vega-elf` |
| **Firmware Upload** | `vega_xmodem.py` over USB-UART (`/dev/ttyUSB*` or `COM*`) |

> [!NOTE]
> Board-specific MMIO register addresses and peripheral driver APIs depend on your local C-DAC VEGA SDK headers and datasheets. Never guess undocumented register offsets.
