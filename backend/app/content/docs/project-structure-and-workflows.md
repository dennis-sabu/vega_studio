# Project Structure & Portable Firmware Workflows

Every VEGA Studio workspace uses a portable root manifest named `vega-project.json` (Schema v1.0).

## Standard Project Layout

```text
my_firmware/
├── src/               # C / Assembly source files (entry: src/main.c)
├── include/           # Project header files
├── Makefile           # Portable Make build rules
├── README.md          # Project documentation
├── .gitignore         # Ignores build/ outputs and local .vega-studio/
└── vega-project.json  # Portable target & build layout metadata
```

## Portability Principles

1. **No host paths in project files**: SDK roots (`~/vega/vega-sdk`), compiler binaries (`riscv32-vega-elf-gcc`), serial ports, and AI keys live in VEGA Studio's app data directory or OS Credential Manager — never in `vega-project.json` or `Makefile`.
2. **Explicit saves**: File Explorer and Monaco track dirty tabs and version stamps cleanly so disk conflicts are never overwritten silently.
