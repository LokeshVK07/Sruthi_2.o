#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

import duckdb


SHARED_TABLES = ("albums", "songs", "scrape_runs")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sqlite_columns(connection: sqlite3.Connection, table: str) -> list[tuple[str, str]]:
    columns: list[tuple[str, str]] = []
    for row in connection.execute(f"PRAGMA table_info({table})").fetchall():
        _, name, kind, *_ = row
        columns.append((str(name), normalize_sqlite_type(str(kind))))
    return columns


def normalize_sqlite_type(kind: str) -> str:
    upper = kind.upper()
    if "INT" in upper:
        return "BIGINT"
    if any(token in upper for token in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if any(token in upper for token in ("REAL", "FLOA", "DOUB")):
        return "DOUBLE"
    if "BLOB" in upper:
        return "BLOB"
    return "TEXT"


def export_sqlite_to_duckdb(sqlite_path: Path, output_path: Path) -> dict[str, int]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    sqlite_connection = sqlite3.connect(sqlite_path)
    duck_connection = duckdb.connect(str(output_path))
    counts: dict[str, int] = {}
    try:
        for table in SHARED_TABLES:
            columns = sqlite_columns(sqlite_connection, table)
            column_names = [name for name, _ in columns]
            column_defs = ", ".join(f'"{name}" {kind}' for name, kind in columns)
            placeholders = ", ".join("?" for _ in columns)
            select_columns = ", ".join(f'"{name}"' for name in column_names)

            duck_connection.execute(f'DROP TABLE IF EXISTS "{table}"')
            duck_connection.execute(f'CREATE TABLE "{table}" ({column_defs})')

            rows = sqlite_connection.execute(f"SELECT {select_columns} FROM {table}").fetchall()
            counts[table] = len(rows)
            if rows:
                duck_connection.executemany(
                    f'INSERT INTO "{table}" VALUES ({placeholders})',
                    rows,
                )
    finally:
        duck_connection.close()
        sqlite_connection.close()

    return counts


def manifest_payload(db_path: Path, repo: str, ref: str, version: str, counts: dict[str, int]) -> dict[str, object]:
    raw_name = db_path.name
    return {
        "version": version,
        "updated_at": version,
        "size": db_path.stat().st_size,
        "sha256": sha256_file(db_path),
        "download_url": f"https://raw.githubusercontent.com/{repo}/{ref}/{raw_name}",
        "songs": counts.get("songs", 0),
        "albums": counts.get("albums", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True, help="Source refreshed SQLite database path.")
    parser.add_argument("--output-db", required=True, help="Destination DuckDB path.")
    parser.add_argument("--manifest", required=True, help="Manifest output path.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    sqlite_path = Path(args.db_path)
    output_db = Path(args.output_db)
    manifest_path = Path(args.manifest)

    counts = export_sqlite_to_duckdb(sqlite_path, output_db)
    payload = manifest_payload(output_db, args.repo, args.ref, args.version, counts)

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
