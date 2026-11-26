# Native VEGA AI Assistant

VEGA Studio provides an integrated firmware assistant in the right **VEGA Assistant** panel:

- Supports **Groq** (`https://api.groq.com/openai/v1` via OpenAI Responses API with `openai/gpt-oss-20b`), **OpenAI**, and custom **OpenAI-compatible** endpoints (such as Ollama or LM Studio).
- API keys are stored in **Windows Credential Manager / Linux Secret Service**, session memory, or read from `GROQ_API_KEY` when configured — never written to SQLite or project files.
- Uses read-only workspace context tools; code suggestions open a **Review & Apply** diff modal into Monaco buffers cleanly without silently overwriting files on disk.

## Security Rules

- `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.git/`, and binary artifacts are automatically excluded from AI context.
- Click **Inspect** in VEGA Assistant before sending a prompt to review exact context size and redaction counts.
