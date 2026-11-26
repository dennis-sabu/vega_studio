# Integrated PTY Terminal

The **Terminal** bottom panel (Phase 11) provides interactive PTY shell sessions backed by `xterm.js` over WebSocket.

## Key Capabilities

- **True PTY Interactive Shells**: Supports Unix PTY on Ubuntu 24.04 (`bash` / `sh`) and Windows ConPTY (`pywinpty` PowerShell / Command Prompt) safely.
- **Session Lifecycle**: Open multiple terminal tabs anchored to your active workspace directory, resize dynamically, restart dead shells, and switch IDE panels without losing active processes.
- **Scoped AI Handoff**: Select a specific command output block in `xterm.js` and click **Analyze Sel** to inspect ONLY the selected snippet in Native VEGA AI — never flooding context with full scrollback history.
