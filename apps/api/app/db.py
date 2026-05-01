from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from .config import DATABASE_PATH


_local = threading.local()

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
    conn = get_connection()
    conn.executescript(SCHEMA_SQL)


def init_db_path(path: Path) -> None:
    conn = connect_to(path)
    try:
        conn.executescript(SCHEMA_SQL)
    finally:
        conn.close()
