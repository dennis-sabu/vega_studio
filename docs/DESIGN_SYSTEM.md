# VEGA Studio — UI/UX Design System Reference

> **Status:** Updated Desktop IDE Reference (Phase 17.5 Architecture)  
> **Scope:** Visual language, surface hierarchy, restrained radius grammar, typography, motion timings, and component architecture for VEGA Studio.

---

## 1. Core Design Philosophy

VEGA Studio pairs a **deep obsidian workspace palette** with **disciplined hairline panel separation**, **purposeful monochrome chrome**, and **cool-blue focus/selection semantics** (`#7aa2ff`).

- **IDE Legibility & Restraint First:** Monaco code editing, file trees, interactive PTY terminals, UART telemetry streams, compiler diagnostics, and AI code assistants prioritize crisp typography, high contrast, and uncluttered vertical density over decorative glow or oversized rounded SaaS containers.
- **Layered Depth Hierarchy:**
  - **Layer A — Deep Canvas (`#06070c`):** Primary editor, terminal canvas, serial console, and ambient Home backdrop (`GlyphAnimalsCanvas` calmed when focused or inside Workspace).
  - **Layer B — Workspace Chrome (`#070910` – `#0a0d15`):** Compact `40px` top toolbar, `44px` left activity rail, `24px` footer status bar, and subtle matte/translucent dock regions delimited by `rgba(255, 255, 255, 0.075)` borders.
  - **Layer C — Elevated Overlays (`rgba(14, 17, 27, 0.94)`):** Modal sheets (`SettingsModal`), menus, tooltips, and dialogs with crisp borders (`1px`) and tight elevation shadows.
- **Zero External Font/Network Calls:** All UI, technical, and terminal fonts (`Geist`, `Geist Mono`, and `JetBrains Mono`) are bundled locally under `frontend/public/fonts/` with `font-display: swap`.

---

## 2. Color & Radius Tokens

| Token | Value | Role |
|---|---|---|
| `--bg` / `--bg-app` | `#06070c` | Root dark obsidian canvas & terminal/editor background |
| `--bg-workspace` | `#090b12` | Primary IDE surface layer |
| `--bg-panel` | `#0a0d15` | Dock panels and structured settings/overview panels |
| `--bg-elevated` | `rgba(14, 17, 27, 0.94)` | Menus, popovers, modal surfaces |
| `--text` | `#e8ebf7` | Primary foreground ink |
| `--text-secondary` | `rgba(232, 235, 247, 0.72)` | Labels, hover controls |
| `--muted` | `rgba(232, 235, 247, 0.45)` | Inactive icons, metadata, hints |
| `--accent` | `#7aa2ff` | Active indicators, tab accents, focus rings, sliders |
| `--border-subtle` | `rgba(255, 255, 255, 0.075)` | Standard hairline region divider |
| `--border-strong` | `rgba(255, 255, 255, 0.14)` | Focused inputs, active popovers |
| `--radius-sm` | `4px` | Status badges, inline code tags, tree rows |
| `--radius-md` | `6px` | Toolbar/panel buttons, selects, segmented items, inputs |
| `--radius-lg` | `8px` | Embedded cards, composer docks, dropdown menus, list items |
| `--radius-xl` | `10px` | Hero Home command box, application modals |

**Semantic Status Accents** (strictly operational telemetry):
- Connected / Build Passed / SDK Ready: `--status-success` (`#34d399`)
- Warning / Building / Unsaved: `--status-warning` (`#fbbf24`)
- Disconnected / Failed / Error: `--status-error` (`#f87171`)
- Informational / Active Hardware Target: `--status-info` (`#60a5fa` / `--accent`)

---

## 3. Typography Stack

| Role | Font Family | Defaults |
|---|---|---|
| **UI & Controls** | `"Geist", ui-sans-serif, system-ui, sans-serif` | `400`–`500`, `11.5px`–`13px` |
| **Technical Metadata & Badges** | `"Geist Mono", ui-monospace, Menlo, monospace` | `500`–`600`, `10px`–`11.5px` |
| **Terminal, Build & Serial Consoles** | `"JetBrains Mono", "Geist Mono", ui-monospace, monospace` | Regular `400`, `13px`, `1.4` line-height (user-configurable in **Settings -> Integrated Terminal**) |
| **Home Heading** | `"Geist", system-ui, sans-serif` | `500`, `clamp(22px, 3.2vw, 28px)` |

`XtermSurface` explicitly preloads `"JetBrains Mono"` / `"Geist Mono"` via `document.fonts.load(...)` prior to `fitAddon.fit()` so glyph cell metrics measure accurately without fallback distortion.

---

## 4. Chrome & Workspace Architecture

1. **Top Application Chrome (`AppToolbar`, `40px`):**
   - **Left:** VEGA mark, `Home | Workspace` compact switcher, active project chip with close control, `New` / `Open`.
   - **Center:** Compact grouped firmware controls (`Build`, `Clean`, `Rebuild`, conditional `Cancel`, `Upload`, hardware target chip opening **Board Manager**, optional active `selectedPort`, `Serial` monitor trigger).
   - **Right:** Dock toggles (`Sidebar`, `Bottom Panel`, `AI Workspace`), conditional two-step layout `Reset`, unified `AI` toggle, and `Settings`.
2. **Unified Right AI Workspace (`RightPanel`):**
   - Houses `VEGA Assistant` and `OpenCode` inside one crisp segmented switcher (`VEGA Assistant` | `OpenCode`) so both remain immediately reachable without competing top-bar buttons, while preserving independent configurations and credentials.
3. **Direct Bottom Terminal (`TerminalPanel` + `XtermSurface`):**
   - Opening the `Terminal` tab in Workspace launches the user's configured default shell directly when `autoLaunch` is enabled and no active sessions exist, focusing input cleanly without requiring a landing-screen click.
   - Secondary actions (`Copy Selection`, `Paste`, `New Session in Folder`, `Analyze Selection in AI`, `Refresh Shells`, `Terminal Settings`) live neatly in a compact `...` menu alongside primary session tabs, shell picker, `+ New`, `Restart`, and `Clear`.
4. **Status Bar (`StatusBar`, `24px`):**
   - Crisp left telemetry strip (Backend status dot, active project, reconciled short board label e.g. `ARIES V3`, SDK state, Git branch/changes, latest build/upload/serial/terminal states, unsaved count) paired with right editor metrics (`Ln/Col`, indent, line ending, language, `UTF-8`, host platform).

---

## 5. Motion & Accessibility Rules

- **Snappy Non-Bouncy Timings:** `--motion-fast` (`110ms`), `--motion-tab` (`150ms`), `--motion-panel` (`180ms`) using smooth ease-out curves (`cubic-bezier(0.22, 1, 0.36, 1)`).
- **`prefers-reduced-motion`:** Disables decorative animations/transitions globally and renders settled static ambient canvas frames.
- **Hidden Chromium Thin Scrollbars:** `.vega-scroll` + global WebKit `6px` subtle scrollbars preserve clean dark contrast without native thick scrollbars obscuring panel controls.
