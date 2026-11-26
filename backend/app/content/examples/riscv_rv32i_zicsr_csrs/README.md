# RISC-V rv32i_zicsr CSR & Cycle Counter Patterns

> **Conceptual Example** — Demonstrates standard RISC-V Zicsr extension instructions (`csrr`) safely guarded with `#ifdef __riscv`. Verify machine-privilege rules and startup environment in your local C-DAC VEGA SDK before hardware execution.

## Example files

| File  | Description |
| ----- | ----------- |
| **[main.c](../../../examples/riscv_rv32i_zicsr_csrs/main.c)** | Machine mode example reading CSRs (`mcycle`, `minstret`) and toggling LEDs via `mcycleh`/`mcycle`/`minstreh`/`minstret` with delays. It includes fallback delays and prints status via UART if enabled. |
| **[build.json](../../../examples/riscv_rv32i_zicsr_csrs/build.json)** | Build configuration for C-DAC VEGA SDK, specifying `arch: "rv32i"`, `extension: ["zicsr"]`, and `compiler: "gcc-riscv32-elf"`. |

## Features demonstrated

- **Machine-privilege**: All CSR operations are performed from M-mode (assumed context).
- **Zicsr**: Instructions like `csrr` are used to read control and status registers.
- **Cycle counter (`mcycle`)**: Increments with every clock cycle (when enabled).
- **Instruction counter (`minstret`)**: Counts retired instructions.
- **Overflow handling**: Uses `mcycleh`/`minstreh` for 64-bit values on a 32-bit architecture.
- **Conditional compilation**: Safe fallback delays (`for (volatile long i = 0; i < 1000000; i++);`) if `__riscv` is not defined.
- **Multiple delays**: Demonstrates different delay patterns using `mcycle`, `minstret`, and software loops.
- **Optional UART**: LED-based output when `UART_EN` is not defined.

## Usage notes

### Prerequisites

- C-DAC VEGA SDK toolchain (specifically `riscv32-elf-gcc`).
- VegaBoard-compatible hardware setup with cycle counter and instruction counter enabled in the RTL.

### Building

Use the provided `build.json` with the VEGA SDK build system:

```bash
# cd to your SDK project directory
vega-studio build --config ../examples/riscv_rv32i_zicsr_csrs/build.json
```

### Running

1. Flash the generated ELF file to your target hardware.
2. Monitor the LED behavior or UART output (if enabled).
3. On hardware with cycle counter enabled, the LED toggle rate should reflect the actual clock frequency and instruction retirement rate.
