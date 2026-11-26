# Board Manager & Compatibility Validation

The **Board Manager** (`Board & Tools` sidebar or Status Bar board indicator) manages target selection per project cleanly.

## Selecting & Validating a Target

- Active selection is stored in `vega-project.json` under `target.board` (e.g. `VEGA_ARIES_V3`), `target.arch` (`rv32i_zicsr`), and `target.machine` (`THEJAS32`).
- Compatibility checks compare the board's verified build profile against your Phase 6 SDK configuration:
  - Cross-compile prefix match (`riscv32-vega-elf`)
  - Expected ISA match (`rv32i_zicsr`)
  - Expected machine match (`THEJAS32`)
  - Validated SDK directory and toolchain binaries

Unsupported or legacy project board tokens load cleanly with explicit warnings rather than silently overwriting your manifest.
