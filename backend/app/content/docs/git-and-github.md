# Git Source Control & GitHub Integration

Phases 12 and 13 integrate local **Git** and **GitHub CLI (`gh`)** directly inside VEGA Studio without duplicating existing Git internals.

## Local Git

- Strict project-directory scoping (parent directories never silently hijack non-Git projects).
- Stage/unstage individual files or hunks, preview side-by-side diffs in Monaco, commit with repository identity checks, create/switch branches cleanly, and inspect commit history.
- Discarding modified files or deleting untracked files always requires explicit confirmation.

## GitHub Integration

- Detects installed `gh` CLI and non-secret authentication state (usernames/remotes shown cleanly; OAuth/PAT tokens are never stored in SQLite or leaked in API logs).
- Supports creating GitHub repos, adding/updating HTTPS/SSH remotes (rejecting embedded URL credentials like `https://user:token@...`), publishing, pulling, and pushing with divergence prechecks.
