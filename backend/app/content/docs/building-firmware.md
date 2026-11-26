# Building Firmware & Reading Compiler Diagnostics

VEGA Studio builds firmware by invoking GNU Make inside your active project directory with a clean, isolated toolchain environment.

## Build Operations

- **Build**: Runs `make` (or your custom target in **Default**, **Debug**, or **Release** mode).
- **Clean**: Runs `make clean` to clear stale `.o`, `.elf`, `.bin`, and `.map` outputs.
- **Rebuild**: Performs Clean followed by Build cleanly.
- **Cancel**: Terminates the Make subprocess tree immediately.

## Unsaved Files & Diagnostics Navigation

- Before compiling, VEGA Studio prompts you cleanly to save dirty Monaco tabs so Make compiles what you see in the editor.
- Compiler errors and warnings (`file:line:col: error: ...`) are parsed automatically into the **Diagnostics** bottom tab. Click **Open** to jump straight to that line in Monaco, or **Ask Native AI** / **Ask OpenCode** to analyze the exact error.
