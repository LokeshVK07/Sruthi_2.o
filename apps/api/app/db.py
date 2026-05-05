from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
import os

from .config import DATABASE_PATH


_local = threading.local()
_repair_lock = threading.Lock()
_db_ready = False

SCHEMA_SQL = """
        CREATE TABLE IF NOT EXISTS albums (
          album_url TEXT PRIMARY KEY,
          album_id TEXT UNIQUE NOT NULL,
          album_name TEXT NOT NULL,
          year INTEGER,
          music_director TEXT,
          singers_summary TEXT,
          image_url TEXT,
          language TEXT,
          track_count INTEGER DEFAULT 0,
          scrape_ok INTEGER DEFAULT 1,
          first_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS songs (
          song_id TEXT PRIMARY KEY,
          album_url TEXT NOT NULL,
          album_id TEXT NOT NULL,
          album_name TEXT NOT NULL,
          year INTEGER,
          music_director TEXT,
          singers TEXT,
          track_number INTEGER NOT NULL,
          track_name TEXT NOT NULL,
          image_url TEXT,
          url_128kbps TEXT,
          url_320kbps TEXT,
          first_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scrape_runs (
          run_id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          pages_scraped INTEGER DEFAULT 0,
          albums_new INTEGER DEFAULT 0,
          albums_updated INTEGER DEFAULT 0,
          albums_failed INTEGER DEFAULT 0,
          songs_total INTEGER DEFAULT 0,
          status TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          user_id TEXT PRIMARY KEY,
          display_name TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
          user_id TEXT NOT NULL,
          song_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, song_id)
        );

        CREATE TABLE IF NOT EXISTS playlists (
          playlist_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
          playlist_id TEXT NOT NULL,
          song_id TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (playlist_id, song_id)
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id TEXT PRIMARY KEY,
          payload_json TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recently_played (
          user_id TEXT NOT NULL,
          song_id TEXT NOT NULL,
          played_at TEXT NOT NULL,
          PRIMARY KEY (user_id, song_id)
        );

        CREATE INDEX IF NOT EXISTS idx_albums_album_id ON albums(album_id);
        CREATE INDEX IF NOT EXISTS idx_albums_updated_at ON albums(updated_at);
        CREATE INDEX IF NOT EXISTS idx_songs_album_url ON songs(album_url);
        CREATE INDEX IF NOT EXISTS idx_songs_album_id ON songs(album_id);
        CREATE INDEX IF NOT EXISTS idx_songs_track_name ON songs(track_name);
        CREATE INDEX IF NOT EXISTS idx_songs_updated_at ON songs(updated_at);
        CREATE INDEX IF NOT EXISTS idx_recently_played_played_at ON recently_played(played_at);
"""


def connect_to(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), detect_types=sqlite3.PARSE_DECLTYPES, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_connection() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        ensure_database_ready()
        conn = connect_to(DATABASE_PATH)
        _local.conn = conn
    return conn


def close_connection() -> None:
    conn = getattr(_local, "conn", None)
    if conn is None:
        return
    try:
        conn.close()
    finally:
        _local.conn = None


def _integrity_status(path: Path) -> str:
    if not path.exists():
        return "missing"
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        row = connection.execute("PRAGMA integrity_check").fetchone()
        if not row:
            return "missing integrity result"
        return str(row[0])
    except Exception as exc:
        return str(exc)
    finally:
        connection.close()


def _table_columns(connection: sqlite3.Connection, table: str, schema: str | None = None) -> list[str]:
    pragma = f"PRAGMA {schema}.table_info('{table}')" if schema else f"PRAGMA table_info('{table}')"
    rows = connection.execute(pragma).fetchall()
    return [str(row[1]) for row in rows]


def _copy_table_rows(connection: sqlite3.Connection, source_schema: str, target_table: str, *, replace: bool = False) -> None:
    source_columns = _table_columns(connection, target_table, source_schema)
    target_columns = _table_columns(connection, target_table)
    columns = [column for column in target_columns if column in source_columns]
    if not columns:
        return
    command = "INSERT OR REPLACE" if replace else "INSERT OR IGNORE"
    joined = ", ".join(columns)
    connection.execute(
        f"{command} INTO {target_table} ({joined}) SELECT {joined} FROM {source_schema}.{target_table}"
    )


def _remove_sqlite_sidecars(path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        path.with_name(f"{path.name}{suffix}").unlink(missing_ok=True)


def _repair_database_from_backup(path: Path, backup_path: Path) -> bool:
    if not backup_path.exists() or _integrity_status(backup_path).lower() != "ok":
        return False

    repaired_path = path.with_suffix(".repaired.sqlite3")
    corrupt_backup_path = path.with_suffix(".corrupt.sqlite3")
    repaired_path.unlink(missing_ok=True)
    corrupt_backup_path.unlink(missing_ok=True)

    repaired = sqlite3.connect(str(repaired_path), isolation_level=None)
    repaired.row_factory = sqlite3.Row
    try:
        repaired.executescript(SCHEMA_SQL)
        repaired.execute("ATTACH DATABASE ? AS snapshot_backup", [str(backup_path)])
        repaired.execute("BEGIN IMMEDIATE")
        for table in (
            "albums",
            "songs",
            "scrape_runs",
            "users",
            "sessions",
            "favorites",
            "playlists",
            "playlist_songs",
            "user_preferences",
            "recently_played",
        ):
            _copy_table_rows(repaired, "snapshot_backup", table)
        repaired.commit()

        try:
            repaired.execute("ATTACH DATABASE ? AS corrupt_live", [str(path)])
            repaired.execute("BEGIN IMMEDIATE")
            for table in ("users", "sessions", "favorites", "playlists", "playlist_songs", "user_preferences", "recently_played"):
                try:
                    _copy_table_rows(repaired, "corrupt_live", table, replace=True)
                except Exception:
                    continue
            repaired.commit()
        except Exception:
            repaired.rollback()
        finally:
            try:
                repaired.execute("DETACH DATABASE corrupt_live")
            except Exception:
                pass
    finally:
        try:
            repaired.execute("DETACH DATABASE snapshot_backup")
        except Exception:
            pass
        repaired.close()

    if _integrity_status(repaired_path).lower() != "ok":
        repaired_path.unlink(missing_ok=True)
        return False
    validation = sqlite3.connect(f"file:{repaired_path}?mode=ro", uri=True)
    try:
        albums = int(validation.execute("SELECT COUNT(*) FROM albums").fetchone()[0] or 0)
        songs = int(validation.execute("SELECT COUNT(*) FROM songs").fetchone()[0] or 0)
    finally:
        validation.close()
    if albums <= 0 or songs <= 0:
        repaired_path.unlink(missing_ok=True)
        return False

    _remove_sqlite_sidecars(path)
    if path.exists():
        os.replace(path, corrupt_backup_path)
        _remove_sqlite_sidecars(corrupt_backup_path)
    os.replace(repaired_path, path)
    _remove_sqlite_sidecars(repaired_path)
    return True


def ensure_database_ready() -> None:
    global _db_ready
    if _db_ready:
        return
    with _repair_lock:
        if _db_ready:
            return
        status = _integrity_status(DATABASE_PATH)
        if status not in {"missing", "ok"}:
            close_connection()
            backup_path = DATABASE_PATH.with_suffix(".snapshot-backup.sqlite3")
            repaired = _repair_database_from_backup(DATABASE_PATH, backup_path)
            if repaired:
                status = _integrity_status(DATABASE_PATH)
        if status not in {"missing", "ok"}:
            raise RuntimeError(f"Catalog database failed integrity check: {status}")
        _db_ready = True


@contextmanager
def transaction():
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db() -> None:
    ensure_database_ready()
    conn = get_connection()
    conn.executescript(SCHEMA_SQL)


def init_db_path(path: Path) -> None:
    conn = connect_to(path)
    try:
        conn.executescript(SCHEMA_SQL)
    finally:
        conn.close()
