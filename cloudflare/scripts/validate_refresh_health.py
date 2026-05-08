#!/usr/bin/env python3
"""
Cliff-fall guard.

Compares the post-refresh SQLite (`--refreshed`) against the previously
validated baseline (`--baseline`, the SQLite that was checked into the repo
or downloaded from the active D1 slot). Refuses to declare the refresh
healthy if the new catalogue has shrunk substantially — a sure sign the
upstream blocked us mid-scrape and the new DB is missing real data.

This guards against the failure mode where the scraper "succeeds" with
mostly-blocked listing pages and the new DB has, e.g., 90 songs from one
unblocked album. We never want that overwriting the live catalogue.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def fail(message: str) -> int:
    print(f"::error::{message}", file=sys.stderr)
    print(message, file=sys.stderr)
    return 1


def counts(db_path: Path) -> tuple[int, int, int]:
    """Return (album_count, song_count, songs_with_url)."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        albums = conn.execute("SELECT COUNT(*) FROM albums").fetchone()[0]
        songs = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
        with_url = conn.execute(
            "SELECT COUNT(*) FROM songs "
            "WHERE coalesce(url_320kbps,'') != '' OR coalesce(url_128kbps,'') != ''"
        ).fetchone()[0]
        return int(albums), int(songs), int(with_url)
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path,
                        help="SQLite that was last known to be healthy")
    parser.add_argument("--refreshed", required=True, type=Path,
                        help="Post-refresh SQLite produced by this run")
    parser.add_argument("--min-coverage", type=float, default=0.85,
                        help="Refreshed counts must be at least this fraction "
                             "of baseline counts.")
    parser.add_argument("--min-url-coverage", type=float, default=0.95,
                        help="Fraction of refreshed songs that must have a "
                             "playable URL.")
    parser.add_argument("--allow-growth", action="store_true",
                        help="Allow refreshed counts to grow beyond baseline "
                             "(default true; here for symmetry).")
    args = parser.parse_args()

    if not args.baseline.exists():
        return fail(f"baseline DB not found: {args.baseline}")
    if not args.refreshed.exists():
        return fail(f"refreshed DB not found: {args.refreshed}")

    try:
        base_albums, base_songs, base_url = counts(args.baseline)
    except sqlite3.Error as exc:
        return fail(f"could not read baseline DB: {exc}")
    try:
        new_albums, new_songs, new_url = counts(args.refreshed)
    except sqlite3.Error as exc:
        return fail(f"could not read refreshed DB: {exc}")

    print("Catalogue health comparison")
    print(f"  baseline: albums={base_albums:,} songs={base_songs:,} "
          f"songs_with_url={base_url:,}")
    print(f"  refreshed: albums={new_albums:,} songs={new_songs:,} "
          f"songs_with_url={new_url:,}")

    if new_songs == 0:
        return fail(
            "Refreshed DB has zero songs — almost certainly a fully blocked "
            "scrape. Skipping unsafe deploy."
        )

    if base_songs > 0 and new_songs < args.min_coverage * base_songs:
        return fail(
            "Refreshed song count fell below the cliff-fall threshold "
            f"({new_songs:,} < {args.min_coverage:.2%} of {base_songs:,}). "
            "Upstream challenge detected. Skipping unsafe deploy."
        )

    if base_albums > 0 and new_albums < args.min_coverage * base_albums:
        return fail(
            "Refreshed album count fell below the cliff-fall threshold "
            f"({new_albums:,} < {args.min_coverage:.2%} of {base_albums:,}). "
            "Upstream challenge detected. Skipping unsafe deploy."
        )

    url_coverage = new_url / new_songs if new_songs else 0.0
    if url_coverage < args.min_url_coverage:
        return fail(
            "Refreshed DB has too many songs without a playable URL "
            f"({url_coverage:.2%} < {args.min_url_coverage:.2%}). "
            "Likely indicates challenge HTML leaked into the catalogue."
        )

    print("OK — refreshed catalogue is healthy")
    print(f"  song delta  = {new_songs - base_songs:+,}")
    print(f"  album delta = {new_albums - base_albums:+,}")
    print(f"  url coverage = {url_coverage:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
