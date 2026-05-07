#!/usr/bin/env python3
"""
Validate the local Vibe 2.o catalog.

Usage:
    python3 tools/validate_catalog.py
    python3 tools/validate_catalog.py --check "Pavazha Malli" "Oorum Blood" "God Mode"
    python3 tools/validate_catalog.py --album "Appuchi Gramam"
    python3 tools/validate_catalog.py --json

Reports total albums/tracks, source-URL coverage, cache coverage,
and whether named albums/tracks are present.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "apps/api/data/melodify.sqlite3"
DEFAULT_CACHE_DIR = REPO_ROOT / "apps/api/.cache/audio"

EXPECTED_ALBUMS = ["Appuchi Gramam"]
EXPECTED_TRACKS = ["Pavazha Malli", "Pavazha Malli Unplugged", "Oorum Blood", "God Mode"]


def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"Database not found at {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def check_album(conn: sqlite3.Connection, name: str) -> dict[str, object]:
    rows = conn.execute(
        """
        SELECT album_id, album_name, album_url, music_director, year, track_count
        FROM albums
        WHERE LOWER(album_name) LIKE LOWER(?)
        ORDER BY updated_at DESC
        LIMIT 5
        """,
        [f"%{name}%"],
    ).fetchall()
    return {"query": name, "found": [dict(row) for row in rows]}


def check_track(conn: sqlite3.Connection, name: str) -> dict[str, object]:
    rows = conn.execute(
        """
        SELECT song_id, track_name, album_name, music_director,
               url_320kbps IS NOT NULL AND url_320kbps != '' AS has_320,
               url_128kbps IS NOT NULL AND url_128kbps != '' AS has_128
        FROM songs
        WHERE LOWER(track_name) LIKE LOWER(?)
        ORDER BY updated_at DESC
        LIMIT 10
        """,
        [f"%{name}%"],
    ).fetchall()
    return {"query": name, "found": [dict(row) for row in rows]}


def coverage_summary(conn: sqlite3.Connection, cache_dir: Path) -> dict[str, object]:
    total_songs = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
    total_albums = conn.execute("SELECT COUNT(*) FROM albums").fetchone()[0]
    has_url = conn.execute(
        "SELECT COUNT(*) FROM songs WHERE (url_320kbps IS NOT NULL AND url_320kbps != '') OR (url_128kbps IS NOT NULL AND url_128kbps != '')"
    ).fetchone()[0]
    no_url = conn.execute(
        "SELECT COUNT(*) FROM songs WHERE (url_320kbps IS NULL OR url_320kbps = '') AND (url_128kbps IS NULL OR url_128kbps = '')"
    ).fetchone()[0]
    albums_no_tracks = conn.execute(
        """
        SELECT COUNT(*) FROM albums a
        WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = a.album_id)
        """
    ).fetchone()[0]
    cached_files = 0
    cache_bytes = 0
    if cache_dir.exists():
        for entry in cache_dir.iterdir():
            if entry.is_file() and entry.suffix in {".mp3", ".m4a", ".aac", ".ogg", ".wav", ""}:
                cached_files += 1
                cache_bytes += entry.stat().st_size
    return {
        "total_albums": total_albums,
        "total_tracks": total_songs,
        "tracks_with_source_url": has_url,
        "tracks_without_source_url": no_url,
        "albums_with_zero_tracks": albums_no_tracks,
        "cached_audio_files": cached_files,
        "cached_audio_bytes": cache_bytes,
    }


def composer_summary(conn: sqlite3.Connection, top: int = 10) -> list[dict[str, object]]:
    rows = conn.execute(
        """
        SELECT music_director AS name, COUNT(*) AS song_count, COUNT(DISTINCT album_id) AS album_count
        FROM songs
        WHERE music_director IS NOT NULL AND music_director != ''
        GROUP BY music_director
        ORDER BY song_count DESC
        LIMIT ?
        """,
        [top],
    ).fetchall()
    return [dict(row) for row in rows]


def report_text(summary: dict[str, object], composers: list[dict[str, object]],
                albums: list[dict[str, object]], tracks: list[dict[str, object]]) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("VIBE 2.o CATALOG VALIDATION")
    lines.append("=" * 60)
    lines.append(f"Total albums:                   {summary['total_albums']}")
    lines.append(f"Total tracks:                   {summary['total_tracks']}")
    lines.append(f"Tracks with source URL:         {summary['tracks_with_source_url']}")
    lines.append(f"Tracks WITHOUT source URL:      {summary['tracks_without_source_url']}")
    lines.append(f"Albums with zero tracks:        {summary['albums_with_zero_tracks']}")
    lines.append(f"Cached audio files on disk:     {summary['cached_audio_files']}")
    lines.append(f"Cached audio total bytes:       {summary['cached_audio_bytes']:,}")
    lines.append("")
    lines.append(f"Top {len(composers)} composers by song count:")
    for c in composers:
        lines.append(f"  {c['song_count']:>5} songs · {c['album_count']:>3} albums · {c['name']}")
    lines.append("")
    lines.append("-" * 60)
    lines.append("ALBUM PRESENCE CHECKS")
    lines.append("-" * 60)
    for album_check in albums:
        if album_check["found"]:
            for hit in album_check["found"]:
                lines.append(
                    f"  [FOUND]  album {album_check['query']!r:30s} → "
                    f"album_id={hit['album_id']} | {hit['album_name']}"
                )
        else:
            lines.append(f"  [MISSING] album {album_check['query']!r}: not in DB. "
                         f"Likely was never crawled.")
    lines.append("")
    lines.append("-" * 60)
    lines.append("TRACK PRESENCE CHECKS")
    lines.append("-" * 60)
    for track_check in tracks:
        if track_check["found"]:
            for hit in track_check["found"]:
                url_state = []
                if hit["has_320"]:
                    url_state.append("320")
                if hit["has_128"]:
                    url_state.append("128")
                tag = ",".join(url_state) if url_state else "NO URL"
                lines.append(
                    f"  [FOUND]  track {track_check['query']!r:30s} → "
                    f"song_id={hit['song_id']} | urls={tag} | {hit['track_name']}"
                )
        else:
            lines.append(f"  [MISSING] track {track_check['query']!r}: no DB row matches.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--check", nargs="+", default=EXPECTED_TRACKS,
                        help="Track titles to check for presence.")
    parser.add_argument("--album", nargs="+", default=EXPECTED_ALBUMS,
                        help="Album names to check for presence.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text report.")
    args = parser.parse_args()

    conn = open_db(args.db)
    summary = coverage_summary(conn, args.cache_dir)
    composers = composer_summary(conn)
    album_results = [check_album(conn, name) for name in args.album]
    track_results = [check_track(conn, name) for name in args.check]

    if args.json:
        print(json.dumps({
            "summary": summary,
            "top_composers": composers,
            "albums": album_results,
            "tracks": track_results,
        }, indent=2))
    else:
        print(report_text(summary, composers, album_results, track_results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
