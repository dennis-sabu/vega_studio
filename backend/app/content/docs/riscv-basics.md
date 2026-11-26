# RISC-V rv32i_zicsr Architecture Basics

VEGA ARIES V3 runs on the 32-bit **VEGA ET1031** core configured with `-march=rv32i_zicsr` (`THEJAS32`).

## Key Characteristics of `rv32i_zicsr`

- **Base Integer (`RV32I`)**: 32 general-purpose 32-bit registers (`x0` hardwired to `0`, `x1`/`ra` return address, `x2`/`sp` stack pointer, `a0–a7` args, `s0–s11` callee-saved, `t0–t6` temporaries).
- **Zero hardware Multiply/Divide or Floating-Point unless enabled in ISA**: Avoid `float`/`double` math in tight loops; use integer fixed-point arithmetic and power-of-two bitmasks (`& (N - 1)`) instead of modulo/division where practical.
- **`Zicsr` Extension**: Atomic instructions (`csrr`, `csrw`, `csrs`, `csrc`) to read and modify Control and Status Registers (such as standard counters `mcycle`/`mcycleh`).

## Recommended Reading Order

1. Check **RISC-V `rv32i_zicsr` CSR & Cycle Counter Patterns** in Examples.
2. Check your local C-DAC VEGA SDK linker/startup script (`crt0.S`) once SDK paths are configured.
