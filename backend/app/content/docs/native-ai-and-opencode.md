# Native VEGA AI Assistant & OpenCode CLI

VEGA Studio cleanly separates two complementary AI workflows in the right Assistant dock:

| Mode | Purpose | Execution & Boundaries |
|---|---|---|
| **Native VEGA AI** (Phase 15) | Provider-independent firmware Q&A, error debugging, code review | Supports OpenAI, Groq, OpenAI-compatible endpoints (Ollama/LM Studio). API keys live in **Windows Credential Manager / Linux Secret Service**, never SQLite. Read-only context tools only; suggested code opens a **Review & Apply** diff modal into Monaco buffers cleanly without writing disk silently. |
| **OpenCode CLI** (Phase 14) | Autonomous workspace agent | Orchestrates loopback `opencode serve` with ephemeral auth, workspace confinement (`409` cross-project block), and explicit permission cards (`Allow Once`, `Always`, `Reject`). |

## Security Rules

- `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.git/`, and binary artifacts are automatically excluded from AI context.
- Click **Inspect** in Native AI before sending a prompt to review exact context size and redaction counts.
