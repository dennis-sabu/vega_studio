"""Local SQLite persistence for application workspace state and recent projects."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, List, Optional


class AppPersistence:
    """Manages local application state in SQLite without touching project files."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._initialized = False

    def ensure_schema(self) -> None:
        if self._initialized and self.db_path.exists():
            return
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS recent_projects (
                    project_dir TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    board TEXT NOT NULL,
                    schema_version TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL
                )
                """
            )
            conn.commit()
        self._initialized = True

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.ensure_schema()
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_active_project_dir(self) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM app_state WHERE key = ?",
                ("active_project_dir",),
            ).fetchone()
            return str(row["value"]) if row else None

    def set_active_project_dir(self, project_dir: Optional[str]) -> None:
        with self._connect() as conn:
            if project_dir is None:
                conn.execute(
                    "DELETE FROM app_state WHERE key = ?",
                    ("active_project_dir",),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO app_state (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    ("active_project_dir", project_dir, self._utc_now()),
                )

    def upsert_recent_project(
        self,
        *,
        project_dir: str,
        name: str,
        board: str,
        schema_version: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO recent_projects (
                    project_dir, name, board, schema_version, last_opened_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_dir) DO UPDATE SET
                    name = excluded.name,
                    board = excluded.board,
                    schema_version = excluded.schema_version,
                    last_opened_at = excluded.last_opened_at
                """,
                (project_dir, name, board, schema_version, self._utc_now()),
            )

    def list_recent_projects(self, limit: int = 20) -> List[dict[str, str]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT project_dir, name, board, schema_version, last_opened_at
                FROM recent_projects
                ORDER BY last_opened_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def remove_recent_project(self, project_dir: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM recent_projects WHERE project_dir = ?",
                (project_dir,),
            )

    def get_state_json(self, key: str) -> Optional[tuple[Any, str]]:
        """Read a JSON-encoded record and its updated_at timestamp from app_state."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value, updated_at FROM app_state WHERE key = ?",
                (key,),
            ).fetchone()
            if not row:
                return None
            try:
                return json.loads(str(row["value"])), str(row["updated_at"])
            except json.JSONDecodeError:
                return None

    def set_state_json(self, key: str, value: Any) -> str:
        """Persist a JSON-encoded record into app_state and return updated_at."""
        now = self._utc_now()
        payload = json.dumps(value)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO app_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, payload, now),
            )
        return now

    def delete_state(self, key: str) -> None:
        """Remove a key from app_state."""
        with self._connect() as conn:
            conn.execute("DELETE FROM app_state WHERE key = ?", (key,))
