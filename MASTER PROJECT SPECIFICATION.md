# VEGA STUDIO
## Master Project Specification & Development Blueprint

---

# 1. PROJECT OVERVIEW

**Project Name:** VEGA Studio

**Project Type:** Native Linux Desktop IDE for the VEGA ARIES V3 RISC-V Development Board

**Primary Target OS:** Ubuntu 24.04 LTS

**Target Hardware:** C-DAC VEGA ARIES V3

VEGA Studio is a dedicated desktop Integrated Development Environment (IDE) designed specifically for developing, compiling, managing, uploading, debugging through diagnostics, and interacting with software projects written for the VEGA ARIES V3 development board.

The application aims to provide a unified, modern, intuitive and powerful software development environment that simplifies the development workflow associated with the VEGA RISC-V ecosystem.

The interface and workflow will take inspiration from modern IDEs such as Arduino IDE 2, VS Code and other desktop development tools, while maintaining its own identity, UI, architecture and features.

VEGA Studio is not intended to be a universal embedded development IDE. Its initial purpose is to provide a highly integrated development experience specifically for the VEGA ARIES V3 board and its associated SDK and toolchain.

The existing VEGA SDK, compiler, toolchain, build system and hardware upload mechanisms must remain the underlying technical foundation of the application.

VEGA Studio acts as an orchestration, management and development layer over the existing VEGA ecosystem.

---

# 2. PROJECT MOTIVE

The current development process for the VEGA ARIES V3 board can involve manually managing SDK configurations, compiler toolchains, Makefiles, terminal commands, serial ports, firmware binaries, upload scripts and project files.

This creates friction for developers, particularly beginners and students entering the VEGA RISC-V ecosystem.

VEGA Studio aims to address this problem by providing a single desktop application that integrates these workflows.

## Primary Objectives

- Simplify VEGA ARIES V3 software development.
- Provide a dedicated desktop IDE for the VEGA ecosystem.
- Eliminate repetitive manual terminal operations where appropriate.
- Make project creation and management simple.
- Integrate the existing VEGA SDK and toolchain.
- Provide a graphical build and firmware upload workflow.
- Integrate serial communication and monitoring.
- Provide an integrated terminal.
- Provide Git and GitHub workflows.
- Integrate AI-assisted programming.
- Integrate OpenCode CLI within the IDE.
- Provide SDK-aware assistance and documentation access.
- Improve portability of software projects between Windows and Linux development environments.
- Make the IDE useful for both beginners and experienced embedded developers.
- Provide a clean, modern, professional and intuitive desktop experience.

## Long-Term Vision

VEGA Studio should become a practical, accessible and comprehensive software development environment for developers working with the VEGA ARIES V3 ecosystem.

The objective is to reduce the barrier to entry for VEGA development while preserving access to the underlying SDK, compiler, terminal, hardware and advanced development workflows.

---

# 3. TARGET HARDWARE AND DEVELOPMENT ENVIRONMENT

## Target Board

C-DAC VEGA ARIES V3.

The IDE will initially support only the ARIES V3 board.

Other VEGA boards are outside the initial scope.

## Existing SDK Environment

The application must integrate with the existing VEGA development environment.

Known development environment:

- VEGA SDK
- VEGA RISC-V GCC toolchain
- Make-based build system
- Python-based utilities
- XMODEM firmware uploader
- UART serial communication

Existing environment examples:

SDK:

`~/vega/vega-sdk`

Toolchain:

`~/vega/vega-tools-rv32`

Compiler:

`riscv32-vega-elf-gcc`

Cross-compilation prefix:

`riscv32-vega-elf`

Architecture configuration:

`rv32i_zicsr`

SDK configuration:

`VEGA_MACHINE=THEJAS32`

SDK settings:

`~/.config/vega-tools/settings.mk`

Python-based upload utility:

`vega_xmodem.py`

Serial communication may use USB-to-UART devices such as CP210x.

Typical Linux serial device:

`/dev/ttyUSB0`

The application must not assume that these paths are permanently fixed.

The IDE should detect and validate the installed SDK, compiler, build utilities, Python dependencies and serial hardware.

These paths are examples of the currently validated environment and must not be hardcoded as universal paths.

---

# 4. TECHNOLOGY STACK

## Desktop Application

**Electron**

Electron will serve as the desktop application shell.

Responsibilities:

- Desktop application lifecycle.
- Window management.
- Desktop integration.
- Launching and managing the local backend.
- Secure communication between desktop components.
- Application packaging.
- Linux desktop integration.
- Application menus.
- Native desktop launch experience.

The application must behave like a real desktop application rather than a website running in an ordinary browser.

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Radix UI
- Lucide icons

The frontend will provide the user interface for the IDE.

## Code Editor

**Monaco Editor**

Monaco will power the main source code editing environment.

Features include:

- C syntax highlighting.
- C++ syntax highlighting where applicable.
- Header file editing.
- Assembly editing.
- Makefile syntax highlighting.
- JSON editing.
- YAML editing.
- Markdown editing.
- Multiple editor tabs.
- Search and replace.
- Code folding.
- Bracket matching.
- Diagnostics.
- Autocomplete.
- Keyboard shortcuts.
- Editor themes.
- Font configuration.
- Code navigation.

## Backend

**Python + FastAPI**

The backend will manage local development operations.

Responsibilities:

- Workspace management.
- File operations.
- SDK detection.
- Toolchain detection.
- SDK diagnostics.
- Build orchestration.
- Clean and rebuild operations.
- Firmware upload.
- Serial communication.
- Serial monitoring.
- Terminal and agent session coordination where applicable.
- Git integration.
- AI tool execution.
- System diagnostics.
- Application settings.
- Project metadata.
- API communication with the frontend.

## Frontend-Backend Communication

- REST APIs for ordinary operations.
- WebSockets for real-time processes.

WebSocket streams will be used for:

- Build output.
- Build status.
- Upload progress and output.
- Serial monitoring.
- Terminal output where backend-managed.
- AI agent streaming.
- Diagnostic updates.
- Process status.

## Terminal Integration

- xterm.js for terminal rendering.
- PTY-based terminal sessions.
- Linux shell support.

The terminal must support interactive sessions, not merely display command output.

## Git

- Git CLI.

## GitHub

- Git CLI.
- GitHub CLI where available.
- GitHub authentication through supported CLI/browser authentication workflows.

## Serial Communication

- Python.
- PySerial.

## Firmware Upload

- Existing VEGA XMODEM upload workflow.
- Python-based uploader integration.

## AI Integration

Provider-independent AI architecture.

Potential providers:

- OpenAI API.
- Groq API.
- OpenAI-compatible API endpoints.

The AI system should support configurable providers and models.

## AI CLI Integration

**OpenCode CLI**

OpenCode must be integrated as an independent CLI agent inside the IDE.

## Database

- SQLite for local application persistence.
- JSON for suitable configuration files.

## Linux Packaging

Initially target:

- Ubuntu 24.04 LTS.
- Debian package.
- AppImage where practical.

---

# 5. APPLICATION ARCHITECTURE

The application should be divided into independent but connected layers.

## Layer 1: Electron Desktop Shell

Responsible for:

- Application startup.
- Desktop window.
- Native application lifecycle.
- Frontend loading.
- Backend lifecycle.
- Secure IPC.
- Desktop packaging.

## Layer 2: Frontend UI

Responsible for:

- IDE interface.
- Project explorer.
- Code editor.
- Build interface.
- Serial monitor.
- Terminal UI.
- AI interface.
- OpenCode terminal interface.
- Git interface.
- Settings.
- Application navigation.

## Layer 3: Backend Service

Responsible for:

- SDK operations.
- Build operations.
- Upload operations.
- Filesystem operations.
- Serial operations.
- Git operations.
- AI tools.
- Diagnostics.
- Workspace management.
- Configuration.
- Process management.

## Layer 4: VEGA SDK

The existing SDK remains responsible for:

- Compilation.
- Linking.
- SDK-specific build logic.
- Firmware generation.
- Existing hardware configuration.

VEGA Studio must not unnecessarily duplicate or rewrite the SDK.

## Layer 5: Hardware

The IDE interacts with the ARIES V3 through supported communication and upload mechanisms.

---

# 6. APPLICATION UI DESIGN

The application should use a modern desktop IDE layout.

The UI must be clean, responsive, keyboard-friendly, professional and optimized for actual development.

## Main Layout

### Top Toolbar

Contains:

- Application logo.
- Project name.
- Build button.
- Clean button.
- Rebuild button.
- Upload button.
- Board selector.
- Serial port selector.
- Connect button.
- OpenCode button.
- Run/build status.
- Settings access.

The toolbar must provide quick access to the most frequently used operations.

### Left Sidebar

The sidebar should provide navigation between:

- Explorer.
- Git.
- Examples.
- SDK.
- Project tools.

The sidebar should be collapsible.

### Center Workspace

The primary workspace contains:

- Monaco Editor.
- Editor tabs.
- File editing.
- Search.
- Navigation.
- Diagnostics.
- Code-related interaction.

### Bottom Panel

The bottom panel should contain configurable tabs:

- Build Output.
- Terminal.
- Serial Monitor.
- Diagnostics.
- Upload Output.
- Logs.

The panel should be resizable and collapsible.

### Right Panel

The right-side panel should contain:

- Native AI assistant.
- Project-aware AI conversation.
- Context selection.
- AI activity.
- File modification information.
- Approval controls.

This panel must be hideable.

### Status Bar

The bottom status bar should display:

- SDK status.
- Target board.
- Serial connection status.
- Build status.
- Git branch.
- Git changes.
- Current file language.
- Editor information.
- Backend status where appropriate.

---

# 7. HOME SCREEN

The home screen should provide an entry point to development.

Features:

- Create New Project.
- Open Project.
- Open Recent Project.
- Import Project.
- Connect Board.
- SDK Setup.
- SDK Health Status.
- Recent Projects.

Recent projects should show:

- Project name.
- Project location.
- Last opened time.
- Project status where available.

The home screen must be useful without requiring a project to be open.

---

# 8. PROJECT MANAGEMENT

VEGA Studio must provide complete project management functionality.

## New Project

The project creation wizard should allow:

- Project name.
- Project location.
- Project template.
- Project description.
- Project configuration.

## Project Templates

Initial templates may include:

- Empty project.
- Hello World.
- UART Console.
- GPIO example.
- Timer example.
- Interrupt example.
- Peripheral example.
- Custom template.

Templates must be validated against the actual VEGA SDK.

Do not invent unsupported SDK functions, hardware pin mappings or peripheral APIs.

## Project Structure

A typical project may look like:

```text
my_vega_project/
├── src/
│   └── main.c
├── include/
├── Makefile
├── README.md
├── vega-project.json
└── .gitignore
```

The structure should remain flexible enough to accommodate actual SDK requirements.

## Project Operations

- Create project.
- Open project.
- Import project.
- Save project.
- Rename files.
- Rename folders.
- Create files.
- Create folders.
- Delete files.
- Delete folders.
- Move files.
- Copy files.
- Refresh workspace.
- Project search.
- Project settings.
- Project metadata.

## Project Safety

- Confirm destructive operations.
- Detect unsaved files.
- Avoid silent overwriting.
- Protect against path traversal.
- Avoid accidental workspace-wide deletion.
- Provide clear error messages.

---

# 9. FILE EXPLORER

The IDE must include a project explorer.

Features:

- Tree-based file navigation.
- Expand and collapse folders.
- File creation.
- Folder creation.
- Rename.
- Delete.
- Move.
- Context menu.
- File opening.
- Drag-and-drop where practical.
- Refresh.
- Hidden-file visibility.
- Search.
- Git status indicators.
- File icons.
- Open file in editor.

The explorer should support common source and project files including:

- `.c`
- `.h`
- `.cpp`
- `.hpp`
- `.s`
- `.asm`
- `Makefile`
- `.mk`
- `.json`
- `.yaml`
- `.yml`
- `.md`
- `.txt`

---

# 10. CODE EDITOR

Monaco Editor will be the primary editor.

## Core Features

- Multiple tabs.
- Tab management.
- Dirty-file indicators.
- Save.
- Save all.
- Undo.
- Redo.
- Find.
- Replace.
- Find in files.
- Code folding.
- Bracket matching.
- Syntax highlighting.
- Line numbers.
- Indentation.
- Editor themes.
- Font size.
- Font family.
- Word wrapping.
- Keyboard shortcuts.
- File navigation.

## Language Support

Initially:

- C.
- C++.
- Assembly.
- Makefile.
- JSON.
- YAML.
- Markdown.
- Plain text.

## Code Intelligence

Where feasible, integrate clangd.

clangd should be configured using the appropriate VEGA compiler and SDK environment.

Potential functionality:

- Autocomplete.
- Diagnostics.
- Symbol navigation.
- Go to definition.
- Go to declaration.
- Reference search.
- Hover information.
- Code navigation.

Code intelligence must be configured for the actual VEGA environment.

Do not present generic compiler intelligence as VEGA SDK intelligence unless it is correctly configured.

---

# 11. BUILD SYSTEM

VEGA Studio must integrate with the existing SDK build system.

The IDE must orchestrate existing SDK compilation rather than replacing the build system.

## Build Operations

- Build.
- Clean.
- Rebuild.

## Build Workflow

Before building, validate:

- Project structure.
- SDK configuration.
- SDK installation.
- Toolchain.
- Compiler.
- Required dependencies.
- Makefile.
- Build configuration.

Then execute the actual SDK build process.

## Build Interface

Display:

- Build status.
- Build progress where available.
- Build output.
- Compiler errors.
- Warnings.
- Linker errors.
- Build duration.
- Build result.

## Build Output

Build output must be streamed in real time.

The user should be able to:

- View logs.
- Clear logs.
- Search logs.
- Copy logs.
- Save logs.
- Navigate to source files from diagnostics.

## Build Diagnostics

Parse compiler and linker diagnostics where possible.

Provide:

- Error category.
- Source file.
- Line number.
- Diagnostic message.
- Navigation to the corresponding file and line.

## Build Artifacts

Display generated artifacts only when they actually exist.

Potential artifacts:

- ELF.
- BIN.
- HEX.
- Map files.
- Other SDK-generated artifacts.

Show:

- File name.
- Location.
- Size.
- Build status.

## Build Safety and Performance

- Use asynchronous process execution.
- Stream output.
- Avoid blocking the UI.
- Avoid unnecessary clean operations.
- Preserve incremental builds.
- Avoid launching duplicate builds unintentionally.
- Provide cancellation when safely supported.
- Record build history.

---

# 12. SDK MANAGER AND SDK DOCTOR

VEGA Studio must provide an SDK management and diagnostic interface.

The IDE must detect:

- VEGA SDK.
- SDK directory.
- RISC-V toolchain.
- Compiler.
- Make.
- Python.
- Python dependencies.
- Uploader utility.
- Required environment configuration.
- Serial-related dependencies.

## SDK Doctor

SDK Doctor should provide an understandable diagnostic report.

Possible statuses:

- Ready.
- Missing.
- Incorrect configuration.
- Warning.
- Unsupported configuration.
- Needs attention.

## Diagnostic Checks

- SDK directory exists.
- SDK files are accessible.
- Toolchain directory exists.
- Compiler exists.
- Compiler executable.
- Compiler version where detectable.
- Build tools available.
- Python available.
- Required Python packages available.
- SDK configuration valid.
- Environment variables valid.
- Serial permissions.
- USB device accessibility.

## Guided Fixes

Where safe, provide:

- Configuration guidance.
- Install instructions.
- Permission instructions.
- Path configuration.
- Dependency checks.
- Recheck functionality.

The application must not blindly modify system configurations or reinstall software without user awareness.

---

# 13. BOARD MANAGER

The initial board manager must support:

**VEGA ARIES V3 only.**

Features:

- Board selection.
- Board information.
- SDK configuration.
- Serial device detection.
- Refresh devices.
- Manual port selection.
- Automatic detection where possible.
- Device status.
- USB device information.
- Connection status.

Serial devices must not be hardcoded.

The IDE should handle:

- `/dev/ttyUSB0`.
- `/dev/ttyACM0`.
- Stable `/dev/serial/by-id/` paths.
- Other valid Linux serial device paths.

Where possible, prefer stable device identifiers over transient device names.

---

# 14. FIRMWARE UPLOAD

VEGA Studio must integrate the existing VEGA firmware upload workflow.

The application must not invent a new flashing protocol.

It must use the validated VEGA upload mechanism and associated uploader utility.

## Upload Interface

Provide:

- Upload button.
- Board status.
- Port selection.
- Upload prerequisite validation.
- Upload progress where available.
- Upload logs.
- Success status.
- Failure status.
- Retry functionality where safe.

## Upload Workflow

1. Validate the project.
2. Validate SDK and toolchain.
3. Validate firmware artifacts.
4. Validate serial device availability.
5. Display hardware prerequisites.
6. Require explicit user initiation.
7. Execute the actual upload process.
8. Stream upload output.
9. Display final result.

## Hardware Procedure

If the board requires boot selection or a hardware-specific upload procedure, provide clear instructions.

Hardware actions must never be silently initiated by an AI agent.

## Upload Safety

- Upload requires explicit user approval.
- AI agents cannot silently upload.
- Validate device and port.
- Avoid uploading to an incorrect device where possible.
- Display the target board.
- Record upload history.

---

# 15. SERIAL MONITOR

VEGA Studio must provide an integrated serial monitor.

## Core Features

- Connect.
- Disconnect.
- Port selection.
- Baud rate.
- Send text.
- Receive text.
- RX/TX display.
- Timestamps.
- Auto-scroll.
- Clear output.
- Save logs.
- Copy output.
- Connection status.
- Reconnection support.
- Configurable line endings.

## Serial Configuration

- Port.
- Baud rate.
- Data bits.
- Stop bits.
- Parity where supported.

The default baud rate may initially be 115200, but it must remain configurable.

## Serial Monitor UX

The interface should include:

- Connection controls.
- Input field.
- Send button.
- Receive output.
- Status.
- Optional timestamp toggle.
- Auto-scroll toggle.
- Clear.
- Save.

## Serial Plotter

A future or expanded serial plotter should support:

- Real-time plotting.
- Multiple channels.
- Sensor values.
- ADC values.
- Temperature.
- IMU data.
- PID data.
- Pause.
- Resume.
- Export.

Serial plotter parsing should be configurable and not assume one universal telemetry format.

---

# 16. INTEGRATED TERMINAL

VEGA Studio must include an integrated Linux terminal.

The terminal should support interactive shell sessions.

## Features

- Terminal tabs.
- Shell session.
- Project working directory.
- Command execution.
- Interactive commands.
- Terminal resize.
- Clear terminal.
- Copy.
- Paste.
- Session termination.
- Session status.
- Reopen terminal.

Use PTY-based terminal sessions.

The terminal should behave like an actual terminal rather than a simulated command output panel.

---

# 17. OPENCODE CLI INTEGRATION

OpenCode must be a dedicated feature inside VEGA Studio.

It must be integrated as the actual OpenCode CLI application, not simulated or replaced with a custom chat interface.

## Objective

Allow developers to launch and use OpenCode directly inside VEGA Studio without opening a separate external terminal window.

## UI

Provide a dedicated OpenCode button in the IDE toolbar.

Potential interface:

- OpenCode.
- Launch OpenCode.
- OpenCode Session.

The button should open or activate an integrated terminal session.

## Integration Requirements

- Launch the actual OpenCode CLI.
- Run within the current project directory.
- Use the project's working directory.
- Preserve the OpenCode CLI's own configuration.
- Preserve its own authentication and model configuration.
- Preserve its own permissions and tools.
- Provide an interactive terminal.
- Support terminal input.
- Support terminal output.
- Support resizing.
- Support stopping the session.
- Support session status.
- Support reopening or creating a session.
- Support terminal tabs or dedicated agent sessions.

## Technical Implementation

Use a real PTY-based terminal session.

Possible architecture:

- Electron.
- xterm.js.
- node-pty or an appropriate backend-managed PTY implementation.

The implementation should be selected based on the most stable and secure architecture for the packaged Linux application.

## Project Context

OpenCode must launch with the current VEGA Studio project as its working directory.

It must be able to work with project files according to its own CLI permissions and configuration.

Changes made by OpenCode must be reflected inside VEGA Studio.

The application should refresh file explorer state and editor contents appropriately when files are modified externally.

## Session Management

- Start OpenCode.
- Stop OpenCode.
- Restart session.
- Display session state.
- Manage terminal tabs.
- Handle process termination.
- Handle application shutdown.
- Handle session errors.

## OpenCode Independence

OpenCode is independent of VEGA Studio's native API-based AI assistant.

VEGA Studio must not attempt to emulate OpenCode.

OpenCode should run using its own actual CLI environment.

---

# 18. NATIVE AI ASSISTANT

VEGA Studio must also provide its own AI assistant integrated into the IDE.

This AI assistant is separate from OpenCode.

## AI UI

A dedicated right-side panel.

Features:

- Chat interface.
- Streaming responses.
- Conversation history.
- Project context.
- File context.
- Context selection.
- Agent activity.
- Tool activity.
- File changes.
- Approval controls.

## AI Capabilities

The native AI assistant should be able to:

- Explain code.
- Generate code.
- Edit code.
- Create files.
- Modify files.
- Refactor code.
- Debug code.
- Analyze build errors.
- Fix compilation issues.
- Search project files.
- Search SDK source files.
- Search SDK headers.
- Search examples.
- Access available documentation.
- Generate documentation.
- Generate test code where applicable.
- Review code.
- Explain hardware interfaces.
- Assist with project development.
- Suggest implementation approaches.
- Analyze project structure.

## AI Tool Architecture

The AI should use tools rather than having unrestricted access by default.

Possible tools:

- Workspace reader.
- File reader.
- File writer.
- File creator.
- Project search.
- SDK search.
- Documentation search.
- Build tool.
- Diagnostic tool.
- Git tools.
- Controlled terminal tool.

## AI Providers

Support configurable AI providers:

- OpenAI.
- Groq.
- OpenAI-compatible providers.

Provider configuration:

- Provider.
- API endpoint where applicable.
- API key.
- Model.
- Optional provider-specific configuration.

The architecture must remain provider-independent.

## AI Permissions

The user must be able to control permissions.

Potential permission categories:

- Read files.
- Search files.
- Edit files.
- Create files.
- Build project.
- Execute commands.
- Access Git operations.
- Delete files.
- Upload firmware.

Dangerous operations must require explicit approval.

## AI Change Review

When AI modifies a project, provide a review interface.

Display:

- Files modified.
- Files created.
- Files deleted.
- Change summaries.
- Diff view.
- Build results.

The user must be able to inspect AI changes.

## AI Safety

- Restrict workspace operations to authorized project locations.
- Validate paths.
- Avoid arbitrary unrestricted filesystem access by default.
- Protect API keys.
- Never store API keys inside project files.
- Avoid shell injection.
- Use controlled execution.
- Require explicit upload approval.
- Require approval for destructive operations.

---

# 19. AI AND OPENCODE WORKFLOW

VEGA Studio will contain two separate AI workflows.

## Native AI

Integrated API-based assistant.

Managed by VEGA Studio.

Uses:

- AI provider APIs.
- VEGA Studio tools.
- Workspace context.
- Project-aware operations.

## OpenCode

Actual OpenCode CLI.

Managed as an interactive terminal session.

Uses:

- OpenCode's own configuration.
- OpenCode's own tools.
- OpenCode's own agent functionality.
- OpenCode's own permissions.
- Its interactive terminal.

## Shared Workspace

Both systems work on the same project workspace.

However, they remain separate agents.

Changes must be visible in the IDE.

The IDE should track changes and refresh files.

Neither agent should silently perform dangerous hardware actions.

---

# 20. GIT INTEGRATION

VEGA Studio must provide an integrated Git interface.

Use the Git CLI as the underlying Git engine.

## Git Features

- Git status.
- Repository initialization.
- Clone.
- Fetch.
- Pull.
- Push.
- Commit.
- Stage.
- Unstage.
- Branch management.
- Checkout.
- Branch creation.
- Branch deletion.
- Remote management.
- Diff.
- History.
- Changed files.
- Untracked files.
- Deleted files.
- Conflict detection.

## Git UI

Provide:

- Repository status.
- Current branch.
- File change list.
- Stage and unstage controls.
- Commit interface.
- Commit message.
- Diff viewer.
- History viewer.

## GitHub Integration

Where possible, support:

- GitHub CLI.
- Authentication through browser/CLI.
- Repository cloning.
- Pull.
- Push.
- Fetch.
- Remote configuration.
- Repository creation where supported by the authentication tooling.

The application should guide users when GitHub authentication is unavailable.

## Safety

- Warn before destructive Git actions.
- Display changes before committing.
- Handle conflicts.
- Avoid silently overwriting work.
- Never embed authentication tokens in project files.

---

# 21. SDK EXAMPLES AND DOCUMENTATION

VEGA Studio should provide a dedicated examples browser.

## Example Categories

Where supported by the SDK:

- Hello World.
- UART.
- GPIO.
- Timers.
- Interrupts.
- Serial communication.
- ADC.
- Peripherals.
- Architecture-specific examples.
- Advanced examples.

Examples must be derived from validated SDK sources or tested examples.

Do not fabricate SDK functions or unsupported examples.

## Example Operations

- View.
- Open.
- Copy.
- Create project from example.
- Build.
- Read README.
- Inspect source.

## Documentation

Provide an integrated documentation viewer where practical.

Potential content:

- SDK documentation.
- Toolchain documentation.
- Board documentation.
- Example documentation.
- Build instructions.
- Upload instructions.

Offline documentation access should be supported where practical.

---

# 22. SETTINGS

VEGA Studio must provide a comprehensive settings interface.

## Application

- Theme.
- UI preferences.
- Startup behavior.
- Application settings.

## Editor

- Font.
- Font size.
- Theme.
- Word wrapping.
- Tab size.
- Indentation.
- Autosave preferences.
- Keyboard shortcuts.

## SDK

- SDK location.
- Toolchain location.
- Build configuration.
- Compiler configuration.
- SDK diagnostics.

## Board

- Target board.
- Serial port.
- Upload settings.

## AI

- Provider.
- API key.
- Model.
- Endpoint.
- Permissions.
- Context configuration.

## Git

- Git executable.
- Git configuration.
- GitHub CLI configuration status.

## Terminal

- Shell.
- Terminal settings.
- Terminal behavior.

---

# 23. COMMAND PALETTE

Provide a command palette.

It should allow developers to quickly search and execute IDE commands.

Examples:

- Build.
- Clean.
- Rebuild.
- Upload.
- Connect board.
- Open serial monitor.
- Open terminal.
- OpenCode.
- Native AI.
- Open project.
- New project.
- Search files.
- Git operations.
- Settings.
- SDK Doctor.

The command palette should support keyboard navigation.

---

# 24. KEYBOARD SHORTCUTS

Provide common keyboard shortcuts.

Examples:

- Ctrl+S: Save.
- Ctrl+Shift+S: Save all or the configured save operation.
- Ctrl+F: Find.
- Ctrl+H: Replace.
- Ctrl+Shift+F: Search across project.
- Ctrl+Z: Undo.
- Ctrl+Y: Redo.
- Ctrl+B: Build.
- Ctrl+Shift+P: Command palette.

Upload shortcuts must be configurable and should not trigger accidentally.

Keyboard shortcuts must be configurable where practical.

---

# 25. PORTABLE PROJECTS AND WINDOWS-LINUX WORKFLOW

VEGA Studio projects must be portable across development environments.

The developer may:

1. Develop or edit the project on Windows.
2. Commit the project to GitHub.
3. Push the project.
4. Open Ubuntu.
5. Clone or pull the repository.
6. Open the project in VEGA Studio.
7. Configure the local SDK.
8. Build.
9. Upload to ARIES V3.

The project repository must not depend on the developer's host-specific configuration.

## Portable Project Configuration

Use project-relative configuration.

Example:

```text
my_vega_project/
├── src/
├── include/
├── Makefile
├── README.md
├── vega-project.json
└── .gitignore
```

## Do Not Store

- Host-specific absolute SDK paths.
- Host-specific compiler paths.
- Serial port names.
- API keys.
- Authentication tokens.
- Personal credentials.
- Host-specific temporary configuration.

## Local Environment

VEGA Studio should maintain local environment configuration separately from portable project files.

The IDE must resolve:

- SDK installation.
- Toolchain.
- Compiler.
- Serial port.
- Host-specific dependencies.

## Opening a Project

When opening a project:

1. Detect project metadata.
2. Validate project structure.
3. Detect the local VEGA SDK.
4. Detect the toolchain.
5. Validate build configuration.
6. Identify missing dependencies.
7. Provide SDK Doctor.
8. Allow the developer to build.

The goal is to make project portability straightforward.

---

# 26. APPLICATION PERSISTENCE

Use SQLite for suitable local application state.

Potential data:

- Recent projects.
- Project history.
- AI conversations.
- Session metadata.
- Build history.
- Upload history.
- Application history.

Use JSON for suitable settings and configuration.

Project files should remain independent of the application's internal database.

---

# 27. LOGGING

Provide categorized logs.

Potential categories:

- Application.
- Backend.
- SDK.
- Build.
- Upload.
- Serial.
- Git.
- AI.
- OpenCode session.
- Diagnostics.

Logs must help diagnose failures.

Where possible:

- Save logs.
- Copy logs.
- Search logs.
- View timestamps.
- View error details.

---

# 28. SECURITY

Security must be incorporated into the architecture from the beginning.

## Electron

- Context isolation.
- Secure IPC.
- Restricted renderer permissions.
- Avoid unrestricted shell access from the frontend.
- Avoid unrestricted Node.js access in the renderer.

## Backend

- Localhost-only service.
- Authentication or secure session mechanism between frontend and backend.
- Path validation.
- Project directory boundaries.
- Safe process execution.
- Argument-based subprocess invocation.
- Avoid shell injection.
- Process management.

## AI

- Permission controls.
- Workspace boundaries.
- Secret protection.
- Approval for dangerous actions.
- File change review.

## Hardware

- Explicit upload action.
- No silent hardware operations.
- Target device verification where possible.

## Git

- Confirmation of destructive operations.
- Conflict handling.
- Authentication protection.

---

# 29. PERFORMANCE

VEGA Studio should remain responsive.

Requirements:

- Asynchronous build operations.
- Real-time output streaming.
- Efficient workspace scanning.
- Lazy-loading editor and panels where appropriate.
- Avoid unnecessary SDK scans.
- Incremental builds.
- Efficient file watching.
- Efficient terminal sessions.
- Efficient serial streaming.
- Caching where beneficial.
- Avoid blocking frontend rendering.

Large SDK directories must not freeze the interface.

---

# 30. DEVELOPMENT ROADMAP

Development must occur in incremental, testable phases.

Do not implement the entire IDE in a single uncontrolled development operation.

Each phase must be completed, reviewed, tested and stabilized before the next major phase.

## Phase 1 — Desktop Foundation

- Electron.
- Next.js.
- TypeScript.
- Tailwind.
- Desktop shell.
- Initial IDE layout.
- Backend lifecycle.
- Secure IPC.
- Application startup.

## Phase 2 — Workspace

- Project opening.
- Project creation.
- Project metadata.
- File explorer.
- File operations.
- Workspace management.

## Phase 3 — Editor

- Monaco.
- Tabs.
- Saving.
- Editing.
- Search.
- Keyboard shortcuts.
- Editor configuration.

## Phase 4 — SDK Doctor

- SDK detection.
- Compiler detection.
- Toolchain detection.
- Python dependencies.
- Configuration validation.
- Diagnostics.

## Phase 5 — Build System

- Build.
- Clean.
- Rebuild.
- Streaming logs.
- Diagnostics.
- Artifacts.

## Phase 6 — Board Manager

- ARIES V3 configuration.
- Serial detection.
- USB information.
- Port selection.
- Connection status.

## Phase 7 — Upload

- Firmware validation.
- XMODEM integration.
- Upload interface.
- Upload logs.
- Upload status.
- Hardware workflow.

## Phase 8 — Serial Monitor

- Connection.
- Transmit.
- Receive.
- Logs.
- Configuration.
- Reconnection.

## Phase 9 — Terminal

- PTY.
- xterm.js.
- Interactive terminal.
- Terminal tabs.
- Session management.

## Phase 10 — Git

- Git status.
- Stage.
- Unstage.
- Commit.
- Diff.
- Branches.
- History.
- Push.
- Pull.
- GitHub integration.

## Phase 11 — OpenCode

- OpenCode CLI detection.
- Integrated PTY session.
- Launch.
- Interactive terminal.
- Session management.
- Workspace integration.
- File refresh.

## Phase 12 — Native AI Assistant

- Provider configuration.
- API integration.
- Streaming chat.
- Tool calling.
- Workspace context.
- File editing.
- Build integration.
- Diff review.
- Permission controls.

## Phase 13 — Examples and Documentation

- Example browser.
- SDK example integration.
- Documentation viewer.
- Project creation from examples.

## Phase 14 — Polish

- Themes.
- Settings.
- Command palette.
- Keyboard shortcuts.
- UI improvements.
- Diagnostics.
- Performance.

## Phase 15 — Linux Packaging

- Application packaging.
- Debian package.
- AppImage where practical.
- Desktop launcher.
- Icon.
- Installation.
- Uninstallation.
- Application lifecycle testing.

---

# 31. TESTING STRATEGY

Testing must be performed throughout development.

## Frontend

- UI components.
- Navigation.
- Project state.
- Editor.
- File operations.
- Settings.
- Panels.

## Backend

- Workspace services.
- File operations.
- SDK detection.
- Diagnostics.
- Build.
- Serial.
- Upload.
- Git.
- AI tools.

## Integration

- Frontend-backend communication.
- Backend-SDK communication.
- Compiler.
- Build process.
- Serial.
- Upload.
- Git.
- AI.
- OpenCode.

## Hardware

Test with the actual VEGA ARIES V3 board.

Test:

- USB detection.
- Serial connection.
- Serial transmission.
- Serial reception.
- Firmware upload.
- Firmware execution.
- Reconnection.
- Upload failures.
- Recovery.

## Application

Test:

- Startup.
- Shutdown.
- Project opening.
- Project creation.
- Editing.
- Building.
- Uploading.
- Serial monitoring.
- Git.
- AI.
- OpenCode.
- Installation.
- Uninstallation.

---

# 32. DEVELOPMENT RULES

The development process must follow these rules.

1. Do not attempt to implement the entire IDE at once.
2. Build the architecture incrementally.
3. Complete and test each phase before advancing.
4. Do not invent VEGA SDK functions.
5. Do not invent hardware pin mappings.
6. Verify SDK APIs against the actual SDK.
7. Preserve the existing VEGA SDK build system.
8. Avoid unnecessary changes to the SDK.
9. Keep the application modular.
10. Separate frontend, backend and hardware operations.
11. Use TypeScript for frontend code.
12. Use Python for backend operations.
13. Use secure subprocess execution.
14. Avoid shell injection.
15. Use project-relative configuration.
16. Do not store host-specific paths in project repositories.
17. Keep secrets outside project files.
18. Ensure projects remain Git-portable.
19. Provide meaningful error messages.
20. Do not silently perform destructive actions.
21. Do not silently upload firmware.
22. Make AI changes inspectable.
23. Keep OpenCode independent from the native AI assistant.
24. Use actual OpenCode CLI functionality.
25. Ensure the desktop application feels like a real IDE.
26. Prioritize functionality and stability over decorative features.
27. Keep the interface clean and intuitive.
28. Avoid unnecessary features that distract from the ARIES V3 workflow.
29. Maintain testable architecture.
30. Document implementation decisions.

---

# 33. FEATURES OUTSIDE INITIAL SCOPE

The following features are not part of the initial release unless explicitly added later:

- Universal embedded IDE support.
- ESP32 support.
- Arduino support.
- STM32 support.
- Other VEGA boards.
- Universal board manager.
- JTAG debugger.
- Hardware simulation.
- Advanced memory profiling.
- Plugin marketplace.
- Cloud workspace.
- Online collaboration.
- Remote development server.

These may be considered in future versions.

---

# 34. MVP DEFINITION

The first stable release of VEGA Studio should contain:

- Linux desktop application.
- Electron desktop shell.
- Next.js frontend.
- FastAPI backend.
- Monaco editor.
- Workspace and project management.
- Project templates.
- File explorer.
- SDK detection.
- SDK Doctor.
- Build.
- Clean.
- Rebuild.
- Build logs.
- Diagnostics.
- ARIES V3 board management.
- Serial port detection.
- Firmware upload integration.
- Serial monitor.
- Integrated terminal.
- Git integration.
- GitHub workflow support.
- Native AI assistant.
- OpenCode CLI integration.
- Settings.
- Command palette.
- Keyboard shortcuts.
- Project portability.
- Linux packaging.

---

# 35. FINAL PROJECT GOAL

VEGA Studio should be a dedicated, modern, practical and reliable desktop IDE for the VEGA ARIES V3 board.

It should combine the essential capabilities of an embedded development environment into a single desktop application:

- Project management.
- Code editing.
- SDK integration.
- Compilation.
- Firmware uploading.
- Serial communication.
- Terminal.
- Git.
- GitHub.
- AI-assisted development.
- OpenCode integration.
- SDK diagnostics.
- Examples and documentation.

The existing VEGA SDK and toolchain must remain the foundation of the development environment.

VEGA Studio should simplify the ecosystem without hiding the underlying technology from developers.

The final result should feel like a genuine embedded development IDE built specifically for the VEGA ARIES V3 ecosystem, with a modern user experience, reliable hardware workflows, portable projects and integrated AI-assisted development.

**Build VEGA Studio incrementally. Validate every subsystem. Prioritize reliability, security, portability, usability and actual hardware compatibility.**