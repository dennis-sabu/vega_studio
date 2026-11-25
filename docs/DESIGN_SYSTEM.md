# VEGA Studio — UI/UX Design System Reference

> **Status:** Established Design Direction (Phase 1+ Reference)  
> **Scope:** Visual language, surface materials, typography, motion, and component grammar for VEGA Studio. Applied progressively across future phases without sacrificing embedded IDE usability.

---

## 1. Core Design Philosophy

VEGA Studio pairs a **deep obsidian dark canvas** with **precision frosted/liquid-glass floating controls** and **high-contrast matte work surfaces**.

- **IDE Usability First:** Compiler diagnostics, Monaco code editing, file trees, serial telemetry, and interactive PTY terminals always prioritize razor-sharp legibility, high contrast, and zero visual distraction over decorative effects.
- **Layered Depth:**
  - **Layer A — Ambient Canvas / Base (`#06070c`):** Deep dark foundation; reserved for empty/home states (subtle grid/ambient motion paused when hidden or under `prefers-reduced-motion`, never behind active code or logs).
  - **Layer B — Matte IDE Workspaces:** Near-opaque dark panels for Monaco editor, explorer, terminal, serial monitor, and build output.
  - **Layer C — Floating Glass Chrome:** Translucent frosted or Chromium liquid-glass surfaces (`glass`) for top navigation/mode bars, command palette, AI composer, home cards, and inspector/settings sheets.
- **Offline-First Assets:** Bundle fonts (`Geist` and `Geist Mono`) locally with `font-display: swap` so the packaged Electron desktop app makes zero runtime network requests.

---

## 2. Color & Surface Tokens

| Token | Value | Role |
|---|---|---|
| `--bg` | `#06070c` | Root dark canvas / deep IDE background |
| `--text` | `#e8ebf7` | Primary foreground text |
| `--text-soft` | `rgba(232, 235, 247, 0.72)` | Secondary labels, hover states |
| `--muted` | `rgba(232, 235, 247, 0.40)` | Inactive controls, hints, micro-headers |
| `--accent` | `#7aa2ff` | Active indicators, slider fills, focus accents |
| `--focus` | `rgba(122, 162, 255, 0.30)` | Focus-within borders (`3px` soft ring at `0.12` alpha) |
| `--chip` / `--chip-hover` / `--chip-edge` | `rgba(255,255,255,0.05)` / `0.12` / `0.10` | Compact pills, chips, inactive tracks |
| `--thumb` | `rgba(255, 255, 255, 0.14)` | Sliding segmented control thumb |
| `--glass-edge` | `rgba(255, 255, 255, 0.14 * --edge)` | Hairline glass border (`--edge` default `0.55`) |
| `--glass-rim` / `--glass-rim-low` | `rgba(255,255,255, 0.32 / 0.08 * --edge)` | Inset top-left highlight & bottom-right shadow rim |
| `--glass-glow` | `rgba(140, 170, 255, 0.07)` | Subtle cool inner ambient glow |
| `--glass-sheen` | `rgba(255, 255, 255, 0.10)` | Top-down specular sheen (`::after` gradient to 48%) |
| `--glass-shadow` | `0 16px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.40)` | Elevation shadow for floating surfaces |

**Semantic Hardware/IDE Status Accents** (reserved strictly for status, never decorative):
- Connected / Build Passed / SDK Ready: emerald green
- Building / Uploading / Warning: amber
- Disconnected / Error / Failed: soft red
- Board / Port / Neutral Telemetry: cool cyan / `--accent`

---

## 3. Typography

| Usage | Font Stack | Weight / Style |
|---|---|---|
| **Display / Greeting** (Home screen) | `-apple-system, BlinkMacSystemFont, "SF Pro Display", Geist, system-ui, sans-serif` | `500`, `clamp(24px, 5vw, 32px)`, `-0.02em` tracking, `1.15` line-height |
| **UI & Body** | `Geist, ui-sans-serif, system-ui, sans-serif` | `400`–`500`, antialiased |
| **Composer / Inputs** | `-apple-system, BlinkMacSystemFont, "SF Pro Text", Geist, system-ui, sans-serif` | `14px`–`17px`, `1.55` line-height |
| **Monospace / Telemetry / Micro-headers** | `"Geist Mono", ui-monospace, Menlo, monospace` | `600` (`10px` uppercase section headers at `0.08em` tracking; `11px` numeric values, shortcuts, status hints) |

---

## 4. Glass Material & Chromium Refraction

- **Base Frosted Glass (`.glass`):**
  - `isolation: isolate`, `135deg` subtle white alpha gradient, `1px` `--glass-edge` border, multi-stop inset specular rim + inner glow + drop shadow, and `::after` top sheen.
  - `backdrop-filter: blur(var(--blur, 6px)) saturate(180%)`.
- **Optional Chromium Liquid Displacement (`html.liquid`):**
  - Since Electron renders inside Chromium, subtle SVG `feTurbulence` + `feGaussianBlur` + `feDisplacementMap` refraction (`url(#liquid-glass)`) can be applied selectively to **large floating shells** (top pill bar, home composer, modal overlays) while keeping dense control drawers, text inputs, and code/log surfaces on clean frosted or matte backgrounds without distortion.
  - Non-Chromium contexts gracefully fall back to standard frosted blur.

---

## 5. Component & Interaction Grammar (IDE Adaptation)

1. **Segmented Pill Switchers (Top Mode / View / Panel Switchers):**
   - Capsule container (`999px` radius, `4px` padding, `32px` item height) with subtle `9px` radial-lit status dots where applicable.
   - Sliding `--thumb` highlight tracking `offsetLeft`/`offsetTop` and dimensions over `0.35s` with `cubic-bezier(0.3, 1.3, 0.5, 1)` slight spring overshoot.
   - Full keyboard `radiogroup` roving `tabIndex` (`Left`/`Right` arrows).
2. **Floating Composer / Command Surfaces (Native AI Input, Command Palette, Home Hero):**
   - `24px` radius frosted glass card, subtle `focus-within` `--focus` accent border and `3px` ring.
   - Auto-growing input (`max-height: 200px`), `Enter` submit (respecting `Shift+Enter` and IME `isComposing`), pill secondary context buttons (`Add files/context`, `34px` height), and circular primary action button (`34px`).
3. **Inspector / Settings & Configurator Panels (SDK Doctor, Board/Serial Settings, Preferences):**
   - Clean `20px` radius drawer/sheet with `Geist Mono` `10px` uppercase group headers.
   - Two-column rows (label + right-aligned `Geist Mono` `11px` numeric readout) above `4px` accent-filled sliders (`14px` thumb) or `30x18px` switches.
   - **Micro-UX safeguards:** Double-click label to reset default; non-intrusive hover/focus hints; two-step destructive confirmation (e.g., `"Reset all?"` / `"Confirm delete?"` 3s timeout before committing destructive actions).
4. **Home Screen (No Project Open):**
   - Centered, calm entry surface combining an ambient dark grid/board-inspired backdrop (only when no workspace is open) with a centered VEGA Studio identity badge, contextual greeting/workspace prompt, quick actions (`New Project`, `Open Project`, `Recent Projects`, `SDK Doctor`, `Connect ARIES V3`), and live backend/board status.

---

## 6. Performance, Motion & Accessibility Rules

- **`prefers-reduced-motion`:** Disable decorative CSS transitions and ambient animation loops; render a settled static frame.
- **Visibility & Viewport Gating:** Pause non-essential canvas loops whenever the window is hidden (`document.visibilityState === "hidden"`) or off-screen (`IntersectionObserver`), reserving CPU for builds, serial streams, and PTY terminals.
- **Responsive Collapse:** Narrow/compact windows wrap top pill bars cleanly (no awkward horizontal clipping) and adapt floating inspectors into bottom/side sheets without overlapping the active editor or status bar.
