#!/usr/bin/env python3
"""
Validate the data the export script produced before we let the deploy run.

Catches the cases that have hurt us before:
    - schema.sql / seed.sql / *.ndjson missing or empty
    - songs.ndjson rows without any playable URL (`url_320kbps` or
      `url_128kbps` populated)
    - row counts way below what we expect (a partial scrape that should not
      be allowed to land in D1 and overwrite a healthy live catalogue)

Exit code 0 = OK, 1 = generated data is unsafe, 2 = configuration error.

The minimum thresholds default to roughly 80 % of the historically healthy
catalogue (see DEFAULT_MIN_*). Tune via CLI flags if the source ever shrinks
intentionally.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

DEFAULT_DATA_DIR = Path("cloudflare/data")
DEFAULT_MIN_ALBUMS = 3500
DEFAULT_MIN_SONGS = 22000
SAMPLE_BATCH = 1000  # number of songs to sample for URL coverage check


def fail(messages: list[str]) -> int:
    print("Generated-data validation FAILED:")
    for line in messages:
        print(f"  - {line}")
    return 1


def warn(message: str) -> None:
    print(f"WARN: {message}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--source-db", type=Path, default=None,
                        help="Optional SQLite path to cross-check counts against")
    parser.add_argument("--min-albums", type=int, default=DEFAULT_MIN_ALBUMS)
    parser.add_argument("--min-songs", type=int, default=DEFAULT_MIN_SONGS)
    parser.add_argument("--min-url-coverage", type=float, default=0.99,
                        help="Fraction of sampled songs that must have a URL")
    args = parser.parse_args()

    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        return fail([f"data directory not found: {data_dir}"])

    schema_sql = data_dir / "schema.sql"
    seed_sql = data_dir / "seed.sql"
    albums_ndjson = data_dir / "albums.ndjson"
    songs_ndjson = data_dir / "songs.ndjson"

    problems: list[str] = []
    for required in (schema_sql, seed_sql, albums_ndjson, songs_ndjson):
        if not required.exists():
            problems.append(f"missing: {required}")
        elif required.stat().st_size == 0:
            problems.append(f"empty: {required}")
    if problems:
        return fail(problems)

    # Schema must mention the two tables the Worker reads from.
    schema_text = schema_sql.read_text(encoding="utf-8")
    if "CREATE TABLE albums" not in schema_text:
        problems.append("schema.sql does not declare table 'albums'")
    if "CREATE TABLE songs" not in schema_text:
        problems.append("schema.sql does not declare table 'songs'")

    # seed.sql must INSERT into both. We don't full-parse SQL, just sniff.
    seed_text = seed_sql.read_text(encoding="utf-8")
    if not re.search(r'INSERT\s+INTO\s+"?albums"?', seed_text, flags=re.IGNORECASE):
        problems.append("seed.sql contains no INSERTs into albums")
    if not re.search(r'INSERT\s+INTO\s+"?songs"?', seed_text, flags=re.IGNORECASE):
        problems.append("seed.sql contains no INSERTs into songs")

    # ndjson row counts.
    album_count = sum(1 for line in albums_ndjson.read_text(encoding="utf-8").splitlines() if line.strip())
    if album_count < args.min_albums:
        problems.append(
            f"albums.ndjson has {album_count} rows, below minimum {args.min_albums}"
        )

    song_count = 0
    sampled = 0
    with_url = 0
    missing_required: list[str] = []
    with songs_ndjson.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            line = line.strip()
            if not line:
                continue
            song_count += 1
            if sampled < SAMPLE_BATCH:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as exc:
                    problems.append(f"songs.ndjson line {index + 1}: invalid JSON ({exc})")
                    continue
                sampled += 1
                if not obj.get("song_id"):
                    missing_required.append(f"line {index + 1}: missing song_id")
                if not obj.get("track_name"):
                    missing_required.append(f"line {index + 1}: missing track_name")
                url320 = (obj.get("url_320kbps") or "").strip()
                url128 = (obj.get("url_128kbps") or "").strip()
                if url320 or url128:
                    with_url += 1
    if song_count < args.min_songs:
        problems.append(
            f"songs.ndjson has {song_count} rows, below minimum {args.min_songs}"
        )
    if missing_required:
        problems.extend(missing_required[:10])

    if sampled:
        coverage = with_url / sampled
        if coverage < args.min_url_coverage:
            problems.append(
                f"only {with_url}/{sampled} sampled songs have a url_320kbps "
                f"or url_128kbps (coverage {coverage:.3f} below "
                f"{args.min_url_coverage:.3f})"
            )

    # Optional: cross-check counts against the source SQLite.
    if args.source_db:
        src = args.source_db.resolve()
        if not src.exists():
            problems.append(f"--source-db not found: {src}")
        else:
            conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
            try:
                src_albums = conn.execute("SELECT COUNT(*) FROM albums").fetchone()[0]
                src_songs = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
            finally:
                conn.close()
            if src_albums != album_count:
                warn(f"album count drift: source={src_albums}, ndjson={album_count}")
            if src_songs != song_count:
                warn(f"song count drift: source={src_songs}, ndjson={song_count}")

    if problems:
        return fail(problems)

    print("Generated-data validation OK")
    print(f"  schema.sql       : {schema_sql.stat().st_size:,} bytes")
    print(f"  seed.sql         : {seed_sql.stat().st_size:,} bytes")
    print(f"  albums.ndjson    : {album_count:,} rows")
    print(f"  songs.ndjson     : {song_count:,} rows")
    if sampled:
        print(f"  url coverage     : {with_url}/{sampled} = {with_url / sampled:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
