#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

import duckdb


def load_previous_manifest(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read previous manifest {path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise SystemExit(f"Previous manifest {path} must be a JSON object.")
    return manifest


def collect_sqlite_stats(path: Path) -> dict[str, int | str]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0] or "")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
        required_tables = {"songs", "albums"}
        missing_tables = sorted(required_tables - tables)
        if missing_tables:
            raise SystemExit(f"Snapshot is missing required tables: {', '.join(missing_tables)}")

        songs_pk = primary_key_column(connection, "songs")
        albums_pk = primary_key_column(connection, "albums")

        songs = int(connection.execute("SELECT COUNT(*) FROM songs").fetchone()[0] or 0)
        albums = int(connection.execute("SELECT COUNT(*) FROM albums").fetchone()[0] or 0)
        distinct_song_ids = int(
            connection.execute(f"SELECT COUNT(DISTINCT {songs_pk}) FROM songs WHERE {songs_pk} IS NOT NULL").fetchone()[0]
            or 0
        )
        distinct_album_ids = int(
            connection.execute(
                f"SELECT COUNT(DISTINCT {albums_pk}) FROM albums WHERE {albums_pk} IS NOT NULL"
            ).fetchone()[0]
            or 0
        )
    finally:
        connection.close()

    return {
        "integrity": integrity,
        "songs": songs,
        "albums": albums,
        "distinct_song_ids": distinct_song_ids,
        "distinct_album_ids": distinct_album_ids,
    }


def primary_key_column(connection: sqlite3.Connection, table: str) -> str:
    columns = connection.execute(f"PRAGMA table_info({table})").fetchall()
    for _, name, _, _, _, pk in columns:
        if pk:
            return str(name)
    raise SystemExit(f"Could not determine primary key column for table {table}.")


def evaluate_with_duckdb(
    *,
    file_size: int,
    stats: dict[str, int | str],
    previous_manifest: dict[str, Any] | None,
    min_bytes: int,
    min_ratio: float,
) -> dict[str, Any]:
    previous_songs = int(previous_manifest["songs"]) if previous_manifest and previous_manifest.get("songs") else None
    previous_albums = int(previous_manifest["albums"]) if previous_manifest and previous_manifest.get("albums") else None

    connection = duckdb.connect(database=":memory:")
    try:
        connection.execute(
            """
            CREATE TABLE metrics AS
            SELECT
              ?::BIGINT AS file_size,
              ?::VARCHAR AS integrity,
              ?::BIGINT AS songs,
              ?::BIGINT AS albums,
              ?::BIGINT AS distinct_song_ids,
              ?::BIGINT AS distinct_album_ids,
              ?::BIGINT AS previous_songs,
              ?::BIGINT AS previous_albums
            """,
            [
                file_size,
                str(stats["integrity"]),
                int(stats["songs"]),
                int(stats["albums"]),
                int(stats["distinct_song_ids"]),
                int(stats["distinct_album_ids"]),
                previous_songs,
                previous_albums,
            ],
        )

        row = connection.execute(
            """
            SELECT
              integrity = 'ok' AS integrity_ok,
              file_size >= ? AS size_ok,
              songs > 0 AS songs_nonzero,
              albums > 0 AS albums_nonzero,
              distinct_song_ids = songs AS song_ids_consistent,
              distinct_album_ids = albums AS album_ids_consistent,
              CASE
                WHEN previous_songs IS NULL THEN TRUE
                ELSE songs >= CEIL(previous_songs * ?)
              END AS songs_ratio_ok,
              CASE
                WHEN previous_albums IS NULL THEN TRUE
                ELSE albums >= CEIL(previous_albums * ?)
              END AS albums_ratio_ok
            FROM metrics
            """,
            [min_bytes, min_ratio, min_ratio],
        ).fetchone()
    finally:
        connection.close()

    (
        integrity_ok,
        size_ok,
        songs_nonzero,
        albums_nonzero,
        song_ids_consistent,
        album_ids_consistent,
        songs_ratio_ok,
        albums_ratio_ok,
    ) = row

    checks = {
        "integrity_ok": bool(integrity_ok),
        "size_ok": bool(size_ok),
        "songs_nonzero": bool(songs_nonzero),
        "albums_nonzero": bool(albums_nonzero),
        "song_ids_consistent": bool(song_ids_consistent),
        "album_ids_consistent": bool(album_ids_consistent),
        "songs_ratio_ok": bool(songs_ratio_ok),
        "albums_ratio_ok": bool(albums_ratio_ok),
    }
    checks["ok"] = all(checks.values())
    return checks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--previous-manifest")
    parser.add_argument("--min-bytes", type=int, default=1_000_000)
    parser.add_argument("--min-ratio", type=float, default=0.75)
    parser.add_argument("--summary-path")
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        raise SystemExit(f"Snapshot does not exist: {db_path}")

    previous_manifest = load_previous_manifest(Path(args.previous_manifest)) if args.previous_manifest else None
    stats = collect_sqlite_stats(db_path)
    checks = evaluate_with_duckdb(
        file_size=db_path.stat().st_size,
        stats=stats,
        previous_manifest=previous_manifest,
        min_bytes=args.min_bytes,
        min_ratio=args.min_ratio,
    )

    summary = {
        "path": str(db_path),
        "file_size": db_path.stat().st_size,
        "stats": stats,
        "previous_manifest": {
            "version": previous_manifest.get("version") if previous_manifest else None,
            "songs": previous_manifest.get("songs") if previous_manifest else None,
            "albums": previous_manifest.get("albums") if previous_manifest else None,
        },
        "checks": checks,
    }

    if args.summary_path:
        summary_path = Path(args.summary_path)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    print(json.dumps(summary, indent=2, sort_keys=True))

    if not checks["ok"]:
        raise SystemExit("Snapshot validation failed; refusing to publish.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover
        print(f"Snapshot validation crashed: {exc}", file=sys.stderr)
        raise
