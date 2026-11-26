"""Local SQLite persistence for application workspace state and recent projects."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, List, Optional

_SCHEMA_LOCKS_GUARD = threading.Lock()
_INITIALIZED_DBS: set[Path] = set()


class PersistenceError(RuntimeError):
    """Safe wrapper for local SQLite persistence failures."""


class AppPersistence:
    """Manages local application state in SQLite without touching project files."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve(strict=False)
        self._initialized = False

    def ensure_schema(self) -> None:
        if self._initialized and self.db_path in _INITIALIZED_DBS and self.db_path.exists():
            return
        with _SCHEMA_LOCKS_GUARD:
            if self.db_path in _INITIALIZED_DBS and self.db_path.exists():
                self._initialized = True
                return
            try:
                self.db_path.parent.mkdir(parents=True, exist_ok=True)
                with closing(sqlite3.connect(self.db_path, timeout=10.0)) as conn:
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute("PRAGMA busy_timeout=5000")
                    conn.execute("PRAGMA foreign_keys=ON")
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
                    ver_row = conn.execute("PRAGMA user_version").fetchone()
                    if ver_row is not None and int(ver_row[0]) == 0:
                        conn.execute("PRAGMA user_version = 1")
                    conn.commit()
                _INITIALIZED_DBS.add(self.db_path)
                self._initialized = True
            except (OSError, sqlite3.Error) as exc:
                raise PersistenceError(f"Failed initializing local application database: {exc}") from exc

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.ensure_schema()
        try:
            conn = sqlite3.connect(self.db_path, timeout=10.0)
        except sqlite3.Error as exc:
            raise PersistenceError(f"Unable to open local application database: {exc}") from exc
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
            conn.commit()
        except sqlite3.Error as exc:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            raise PersistenceError(f"Local database operation failed: {exc}") from exc
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

    def get_default_projects_dir_override(self) -> Optional[str]:
        """Return user-configured default parent directory for new projects, if any."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM app_state WHERE key = ?",
                ("default_projects_dir",),
            ).fetchone()
            return str(row["value"]) if row else None

    def set_default_projects_dir_override(self, projects_dir: Optional[str]) -> None:
        """Persist or clear the user-configured default projects directory."""
        if not projects_dir:
            self.delete_state("default_projects_dir")
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO app_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                ("default_projects_dir", projects_dir, self._utc_now()),
            )

    def get_project_board_override(self, project_dir: str) -> Optional[dict[str, str]]:
        """Return locally persisted board target selection for workspaces without vega-project.json."""
        record = self.get_state_json("external_project_boards")
        if not record or not isinstance(record[0], dict):
            return None
        entry = record[0].get(project_dir)
        if not isinstance(entry, dict):
            return None
        board = entry.get("board")
        arch = entry.get("arch")
        machine = entry.get("machine")
        if isinstance(board, str) and board.strip():
            return {
                "board": board.strip(),
                "arch": str(arch or "rv32i_zicsr"),
                "machine": str(machine or "THEJAS32"),
            }
        return None

    def set_project_board_override(
        self, project_dir: str, board: str, arch: str, machine: str
    ) -> None:
        """Store board selection in SQLite without writing vega-project.json into external repos."""
        record = self.get_state_json("external_project_boards")
        mapping: dict[str, dict[str, str]] = (
            dict(record[0]) if record and isinstance(record[0], dict) else {}
        )
        mapping[project_dir] = {
            "board": board,
            "arch": arch,
            "machine": machine,
        }
        self.set_state_json("external_project_boards", mapping)
