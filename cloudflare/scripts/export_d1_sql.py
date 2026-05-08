#!/usr/bin/env python3
"""
Export the local SQLite catalogue (apps/api/data/melodify.sqlite3) to a D1-
compatible SQL dump that wrangler can `wrangler d1 execute --file=...` into a
freshly-created D1 database.

Usage:
    python3 cloudflare/scripts/export_d1_sql.py
        --db apps/api/data/melodify.sqlite3
        --out cloudflare/data/seed.sql

D1 supports a subset of SQLite, so we strip features that don't translate:
- FTS5 virtual tables (D1 doesn't support FTS5 yet — we reimplement search via
  LIKE inside the Worker; cheap enough for ~28k rows)
- Triggers tied to FTS5
- WITHOUT ROWID
- Full-text shadow tables

Albums + songs survive verbatim.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


# Tables that are part of the FTS5 virtual table machinery and must NOT be
# copied. D1 has no FTS5 support; we keep search in the Worker.
FTS_TABLE_PATTERNS = ("songs_fts",)


def quote(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"


def is_fts_table(name: str) -> bool:
    return any(name == pat or name.startswith(pat + "_") for pat in FTS_TABLE_PATTERNS)


def write_table(connection: sqlite3.Connection, name: str, out, batch_size: int = 500):
    cursor = connection.execute(f'SELECT * FROM "{name}"')
    columns = [c[0] for c in cursor.description]
    column_list = ", ".join(f'"{col}"' for col in columns)

    rows_buffer: list[str] = []
    total = 0

    for row in cursor:
        values = ", ".join(quote(value) for value in row)
        rows_buffer.append(f"({values})")
        if len(rows_buffer) >= batch_size:
            out.write(f'INSERT INTO "{name}" ({column_list}) VALUES\n')
            out.write(",\n".join(rows_buffer))
            out.write(";\n")
            total += len(rows_buffer)
            rows_buffer = []

    if rows_buffer:
        out.write(f'INSERT INTO "{name}" ({column_list}) VALUES\n')
        out.write(",\n".join(rows_buffer))
        out.write(";\n")
        total += len(rows_buffer)
    return total


SCHEMA_SQL = """\
-- D1 schema for Sruthi 2.o catalogue. Paste this whole block into the
-- Cloudflare D1 Console (single Execute) — it's small and well under the
-- console's paste limit.

DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS songs;

CREATE TABLE albums (
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
CREATE INDEX idx_albums_album_id ON albums(album_id);
CREATE INDEX idx_albums_updated_at ON albums(updated_at);
CREATE INDEX idx_albums_name_lower ON albums(lower(album_name));

CREATE TABLE songs (
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
CREATE INDEX idx_songs_album_id ON songs(album_id);
CREATE INDEX idx_songs_album_url ON songs(album_url);
CREATE INDEX idx_songs_track_name_lower ON songs(lower(track_name));
CREATE INDEX idx_songs_singers_lower ON songs(lower(singers));
CREATE INDEX idx_songs_director_lower ON songs(lower(music_director));
"""


ALBUM_COLUMNS = (
    "album_url album_id album_name year music_director singers_summary "
    "image_url language track_count scrape_ok first_seen_at updated_at"
).split()

SONG_COLUMNS = (
    "song_id album_url album_id album_name year music_director singers "
    "track_number track_name image_url url_128kbps url_320kbps "
    "first_seen_at updated_at"
).split()


def write_ndjson(connection: sqlite3.Connection, table: str, columns: list[str], out_path: Path) -> int:
    import json

    select = ", ".join(f'"{c}"' for c in columns)
    cursor = connection.execute(f"SELECT {select} FROM {table}")
    count = 0
    with out_path.open("w", encoding="utf-8") as out:
        for row in cursor:
            obj = {col: row[col] for col in columns}
            out.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
            out.write("\n")
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Export SQLite catalogue to a D1 seed file")
    parser.add_argument("--db", default="apps/api/data/melodify.sqlite3")
    parser.add_argument("--out", default="cloudflare/data/seed.sql")
    parser.add_argument(
        "--browser-only",
        action="store_true",
        help="Also emit cloudflare/data/schema.sql + albums.ndjson + songs.ndjson "
        "for the no-CLI seed flow (the Worker reads the ndjson files via raw "
        "GitHub URL and batches them into D1).",
    )
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    out_path = Path(args.out).resolve()
    if not db_path.exists():
        print(f"error: SQLite DB not found at {db_path}", file=sys.stderr)
        return 2

    out_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row

    # Always emit the small schema.sql + ndjson alongside the legacy seed.sql.
    data_dir = out_path.parent
    schema_path = data_dir / "schema.sql"
    schema_path.write_text(SCHEMA_SQL, encoding="utf-8")

    albums_path = data_dir / "albums.ndjson"
    songs_path = data_dir / "songs.ndjson"
    album_count = write_ndjson(connection, "albums", ALBUM_COLUMNS, albums_path)
    song_count = write_ndjson(connection, "songs", SONG_COLUMNS, songs_path)
    print(
        f"wrote {schema_path.name}, {albums_path.name} ({album_count} rows), "
        f"{songs_path.name} ({song_count} rows)"
    )

    with out_path.open("w", encoding="utf-8") as out:
        out.write("-- Auto-generated by cloudflare/scripts/export_d1_sql.py\n")
        out.write("PRAGMA defer_foreign_keys = TRUE;\n\n")

        # Schema we re-create explicitly so D1 only sees the tables it can
        # actually use. We deliberately omit FTS5 indexes/triggers.
        out.write("DROP TABLE IF EXISTS albums;\n")
        out.write("DROP TABLE IF EXISTS songs;\n")
        out.write("""
CREATE TABLE albums (
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
CREATE INDEX idx_albums_album_id ON albums(album_id);
CREATE INDEX idx_albums_updated_at ON albums(updated_at);
CREATE INDEX idx_albums_name_lower ON albums(lower(album_name));
""")
        out.write("""
CREATE TABLE songs (
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
CREATE INDEX idx_songs_album_id ON songs(album_id);
CREATE INDEX idx_songs_album_url ON songs(album_url);
CREATE INDEX idx_songs_track_name_lower ON songs(lower(track_name));
CREATE INDEX idx_songs_singers_lower ON songs(lower(singers));
CREATE INDEX idx_songs_director_lower ON songs(lower(music_director));
""")

        album_count = write_table(connection, "albums", out)
        song_count = write_table(connection, "songs", out)

    connection.close()
    print(f"wrote {out_path}: {album_count} albums, {song_count} songs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
