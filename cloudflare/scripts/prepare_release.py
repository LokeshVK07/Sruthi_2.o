#!/usr/bin/env python3
"""
Validate the post-refresh SQLite catalogue against a baseline floor, generate
the D1 seed file, optionally cross-check counts via DuckDB, and write a
release manifest.

Usage:

    python cloudflare/scripts/prepare_release.py \\
        --db data/sruthi.db \\
        --seed cloudflare/data/seed.sql \\
        --baseline cloudflare/data/release-baseline.json \\
        --manifest cloudflare/.generated/release-manifest.json \\
        --duckdb-path cloudflare/.generated/release-check.duckdb

Exit codes:
    0 — release is healthy and seed/manifest were written
    1 — release is unsafe (counts below baseline, missing URLs, etc.)
    2 — configuration / I/O error before any validation could run

The script reads the floors from `release-baseline.json`. Tune that file to
match the upstream catalogue size. Release tooling should refuse to deploy
any refresh that produced fewer rows than these floors.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_SCRIPT = REPO_ROOT / "cloudflare/scripts/export_d1_sql.py"


def fail_config(message: str) -> int:
    print(f"::error::{message}", file=sys.stderr)
    return 2


def fail_validation(messages: list[str]) -> int:
    print("::error::Release validation failed:", file=sys.stderr)
    for line in messages:
        print(f"  - {line}", file=sys.stderr)
    return 1


def read_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        albums = conn.execute("SELECT COUNT(*) FROM albums").fetchone()[0]
        songs = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
        with_url = conn.execute(
            "SELECT COUNT(*) FROM songs "
            "WHERE coalesce(url_320kbps,'') != '' OR coalesce(url_128kbps,'') != ''"
        ).fetchone()[0]
        return {"albums": int(albums), "songs": int(songs), "songs_with_url": int(with_url)}
    finally:
        conn.close()


def check_named_entries(db_path: Path, baseline: dict) -> list[str]:
    """Optional sanity: confirm a few specific titles still resolve.

    Tunes via `checked_albums` / `checked_tracks` arrays in the baseline.
    Used to catch the "scraper succeeded but the table is somehow empty for
    every song you actually care about" failure mode.
    """
    problems: list[str] = []
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for album in baseline.get("checked_albums", []) or []:
            row = conn.execute(
                "SELECT 1 FROM albums WHERE lower(album_name) LIKE ? LIMIT 1",
                [f"%{album.lower()}%"],
            ).fetchone()
            if row is None:
                problems.append(f"missing checked album: {album!r}")
        for track in baseline.get("checked_tracks", []) or []:
            row = conn.execute(
                "SELECT 1 FROM songs WHERE lower(track_name) LIKE ? LIMIT 1",
                [f"%{track.lower()}%"],
            ).fetchone()
            if row is None:
                problems.append(f"missing checked track: {track!r}")
    finally:
        conn.close()
    return problems


def duckdb_cross_check(data_dir: Path, duckdb_path: Path, expected: dict[str, int]) -> str | None:
    """Use DuckDB to re-count generated NDJSON without downloading extensions."""
    try:
        import duckdb  # type: ignore[import-untyped]
    except ImportError:
        return "duckdb is not installed in this environment"

    albums_path = data_dir / "albums.ndjson"
    songs_path = data_dir / "songs.ndjson"
    if not albums_path.exists():
        return f"generated albums.ndjson missing: {albums_path}"
    if not songs_path.exists():
        return f"generated songs.ndjson missing: {songs_path}"

    duckdb_path.parent.mkdir(parents=True, exist_ok=True)
    if duckdb_path.exists():
        duckdb_path.unlink()
    con = duckdb.connect(str(duckdb_path))
    try:
        duck_albums = con.execute(
            "SELECT COUNT(*) FROM read_json_auto(?)",
            [str(albums_path)],
        ).fetchone()[0]
        duck_songs = con.execute(
            "SELECT COUNT(*) FROM read_json_auto(?)",
            [str(songs_path)],
        ).fetchone()[0]
    except duckdb.Error as exc:
        return f"DuckDB query failed: {exc}"
    finally:
        con.close()
    if duck_albums != expected["albums"]:
        return f"DuckDB album count {duck_albums} != sqlite {expected['albums']}"
    if duck_songs != expected["songs"]:
        return f"DuckDB song count {duck_songs} != sqlite {expected['songs']}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, type=Path,
                        help="Refreshed SQLite catalogue (e.g. data/sruthi.db)")
    parser.add_argument("--seed", required=True, type=Path,
                        help="Output path for the generated D1 seed SQL")
    parser.add_argument("--baseline", required=True, type=Path,
                        help="JSON file with min_albums / min_songs / etc.")
    parser.add_argument("--manifest", required=True, type=Path,
                        help="Output JSON manifest summarising the release")
    parser.add_argument("--duckdb-path", type=Path, default=None,
                        help="Optional DuckDB file used to cross-check counts")
    args = parser.parse_args()

    if not args.db.exists():
        return fail_config(f"sqlite catalogue not found: {args.db}")
    if args.db.stat().st_size == 0:
        return fail_config(f"sqlite catalogue is empty: {args.db}")
    if not args.baseline.exists():
        return fail_config(f"baseline not found: {args.baseline}")
    if not EXPORT_SCRIPT.exists():
        return fail_config(f"export script missing: {EXPORT_SCRIPT}")

    try:
        baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return fail_config(f"baseline is not valid JSON: {exc}")

    min_albums = int(baseline.get("min_albums", 0))
    min_songs = int(baseline.get("min_songs", 0))
    min_url_coverage = float(baseline.get("min_url_coverage", 0.95))
    max_seed_age_seconds = int(baseline.get("max_seed_age_seconds", 0) or 0)

    try:
        counts = read_counts(args.db)
    except sqlite3.Error as exc:
        return fail_config(f"could not read sqlite catalogue: {exc}")

    coverage = (counts["songs_with_url"] / counts["songs"]) if counts["songs"] else 0.0
    print("Catalogue stats")
    print(f"  albums         = {counts['albums']:,}  (floor {min_albums:,})")
    print(f"  songs          = {counts['songs']:,}  (floor {min_songs:,})")
    print(f"  songs_with_url = {counts['songs_with_url']:,}  ({coverage:.3f}, floor {min_url_coverage:.3f})")

    failures: list[str] = []
    if counts["albums"] < min_albums:
        failures.append(
            f"album count {counts['albums']:,} < baseline floor {min_albums:,}"
        )
    if counts["songs"] < min_songs:
        failures.append(
            f"song count {counts['songs']:,} < baseline floor {min_songs:,}"
        )
    if counts["songs"] > 0 and coverage < min_url_coverage:
        failures.append(
            f"URL coverage {coverage:.3f} < baseline floor {min_url_coverage:.3f}"
        )
    failures.extend(check_named_entries(args.db, baseline))

    if failures:
        return fail_validation(failures)

    # Generate the D1 seed via the existing export script (subprocess so we
    # don't import-link the two scripts; keeps each independently runnable).
    args.seed.parent.mkdir(parents=True, exist_ok=True)
    print(f"Generating seed: {args.seed}")
    completed = subprocess.run(
        [
            sys.executable,
            str(EXPORT_SCRIPT),
            "--db", str(args.db),
            "--out", str(args.seed),
        ],
        check=False,
    )
    if completed.returncode != 0:
        return fail_config(
            f"export_d1_sql.py exited with status {completed.returncode}"
        )
    if not args.seed.exists() or args.seed.stat().st_size == 0:
        return fail_config(f"export produced no usable seed at {args.seed}")

    duckdb_error: str | None = None
    if args.duckdb_path:
        duckdb_error = duckdb_cross_check(args.seed.parent, args.duckdb_path, counts)
        if duckdb_error:
            # Cross-check disagreement is treated as a hard failure; that's
            # the whole point of running it.
            return fail_validation([f"DuckDB cross-check: {duckdb_error}"])

    if max_seed_age_seconds:
        now = datetime.datetime.now(datetime.UTC).timestamp()
        seed_mtime = args.seed.stat().st_mtime
        age = now - seed_mtime
        if age > max_seed_age_seconds:
            return fail_validation(
                [f"seed.sql is older than {max_seed_age_seconds}s ({age:.0f}s)"]
            )

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat(),
        "deployment_id": os.environ.get("GITHUB_RUN_ID") or None,
        "git_sha": os.environ.get("GITHUB_SHA") or None,
        "db_path": str(args.db),
        "seed_path": str(args.seed),
        "seed_size_bytes": args.seed.stat().st_size,
        "counts": counts,
        "url_coverage": coverage,
        "baseline_floors": {
            "min_albums": min_albums,
            "min_songs": min_songs,
            "min_url_coverage": min_url_coverage,
        },
        "duckdb_path": str(args.duckdb_path) if args.duckdb_path else None,
        "duckdb_cross_check": "skipped" if duckdb_error is None and not args.duckdb_path else "ok",
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest written: {args.manifest}")
    print("OK — release prepared")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
