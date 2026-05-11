#!/usr/bin/env python3
"""
Validate a release at one of two checkpoints:

    --mode d1        After import: query the inactive D1 directly via
                     `wrangler d1 execute --remote` and confirm the catalogue
                     has landed (counts + url coverage). Run BEFORE deploy.

    --mode http      After deploy: hit the live Worker URL's /api/diag and a
                     handful of API endpoints to confirm the new D1 binding
                     is wired up. Run AFTER deploy, BEFORE the slot marker
                     is committed.

Either mode exits non-zero if the catalogue isn't healthy enough to ship.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import ssl
import subprocess
import sys
import urllib.request
from urllib.error import HTTPError, URLError

DEFAULT_MIN_ALBUMS = 3500
DEFAULT_MIN_SONGS = 22000
DEFAULT_MIN_URL_COVERAGE = 0.95


def fail(message: str) -> int:
    print(f"Release validation FAILED: {message}", file=sys.stderr)
    return 1


def run_wrangler_query(database_name: str, config: str | None, sql: str) -> dict | None:
    wrangler = shlex.split(os.environ.get("WRANGLER_BIN", "wrangler"))
    cmd = [
        *wrangler, "d1", "execute", database_name,
        "--remote", "--json", "--command", sql,
    ]
    if config:
        cmd.extend(["--config", config])
    env = dict(os.environ)
    # Suppress wrangler's interactive prompts in CI.
    env.setdefault("CI", "1")
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        return None
    # Wrangler emits a JSON array. The actual rows are nested.
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(proc.stdout, file=sys.stderr)
        return None
    if not isinstance(payload, list) or not payload:
        return None
    first = payload[0]
    rows = first.get("results") or first.get("result") or []
    return rows[0] if rows else {}


def validate_d1(args: argparse.Namespace) -> int:
    expected_counts = None
    if args.manifest:
        try:
            manifest = json.loads(open(args.manifest, encoding="utf-8").read())
        except (OSError, json.JSONDecodeError) as exc:
            return fail(f"could not read --manifest: {exc}")
        expected_counts = manifest.get("counts") or {}

    counts = run_wrangler_query(
        args.database_name,
        args.config,
        "SELECT (SELECT COUNT(*) FROM albums) AS albums, "
        "(SELECT COUNT(*) FROM songs) AS songs",
    )
    if counts is None:
        return fail("could not query D1 counts via wrangler")
    albums = int(counts.get("albums", 0))
    songs = int(counts.get("songs", 0))
    print(f"D1 counts: albums={albums:,}, songs={songs:,}")
    if albums < args.min_albums:
        return fail(f"albums={albums} below minimum {args.min_albums}")
    if songs < args.min_songs:
        return fail(f"songs={songs} below minimum {args.min_songs}")
    if expected_counts:
        expected_albums = int(expected_counts.get("albums") or 0)
        expected_songs = int(expected_counts.get("songs") or 0)
        if albums != expected_albums or songs != expected_songs:
            return fail(
                "D1 counts do not match release manifest: "
                f"albums={albums} expected={expected_albums}, "
                f"songs={songs} expected={expected_songs}"
            )

    coverage_row = run_wrangler_query(
        args.database_name,
        args.config,
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN coalesce(url_320kbps,'') != '' OR "
        "         coalesce(url_128kbps,'') != '' THEN 1 ELSE 0 END) AS with_url "
        "FROM songs",
    )
    if coverage_row is None:
        return fail("could not check URL coverage in D1")
    total = int(coverage_row.get("total", 0)) or 1
    with_url = int(coverage_row.get("with_url", 0))
    coverage = with_url / total
    print(f"D1 url coverage: {with_url}/{total} = {coverage:.3f}")
    if coverage < args.min_url_coverage:
        return fail(
            f"URL coverage {coverage:.3f} below minimum {args.min_url_coverage:.3f}"
        )

    print("D1 validation OK")
    return 0


def http_get_json(url: str, timeout: int = 30) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "sruthi-release-validate/1"})
    context = None
    try:
        import certifi  # type: ignore[import-not-found]

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def validate_http(args: argparse.Namespace) -> int:
    base = args.url.rstrip("/")
    try:
        diag = http_get_json(f"{base}/api/diag")
    except (HTTPError, URLError, json.JSONDecodeError) as exc:
        return fail(f"GET /api/diag failed: {exc}")
    print(f"GET /api/diag → {json.dumps(diag, indent=2)}")
    if not diag.get("ok"):
        return fail("/api/diag returned ok=false")
    counts = diag.get("counts") or {}
    albums = int(counts.get("albums", 0))
    songs = int(counts.get("songs", 0))
    if albums < args.min_albums:
        return fail(f"deployed albums={albums} below {args.min_albums}")
    if songs < args.min_songs:
        return fail(f"deployed songs={songs} below {args.min_songs}")

    # One more spot-check: home endpoint should return non-empty library.
    try:
        home = http_get_json(f"{base}/api/library/home")
    except (HTTPError, URLError, json.JSONDecodeError) as exc:
        return fail(f"GET /api/library/home failed: {exc}")
    if not home.get("library"):
        return fail("/api/library/home returned an empty library list")

    print("HTTP smoke validation OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("d1", "http"), required=True)
    parser.add_argument("--database-name", help="D1 database_name (mode=d1)")
    parser.add_argument("--config", help="Path to rendered wrangler config (mode=d1)")
    parser.add_argument("--manifest", help="Release manifest for exact count checks (mode=d1)")
    parser.add_argument("--url", help="Deployed Worker URL (mode=http)")
    parser.add_argument("--baseline", help="release-baseline.json with minimum count/coverage floors")
    parser.add_argument("--min-albums", type=int, default=DEFAULT_MIN_ALBUMS)
    parser.add_argument("--min-songs", type=int, default=DEFAULT_MIN_SONGS)
    parser.add_argument("--min-url-coverage", type=float, default=DEFAULT_MIN_URL_COVERAGE)
    args = parser.parse_args()

    if args.baseline:
        try:
            baseline = json.loads(open(args.baseline, encoding="utf-8").read())
        except (OSError, json.JSONDecodeError) as exc:
            return fail(f"could not read --baseline: {exc}")
        args.min_albums = int(baseline.get("min_albums", args.min_albums))
        args.min_songs = int(baseline.get("min_songs", args.min_songs))
        args.min_url_coverage = float(
            baseline.get("min_url_coverage", args.min_url_coverage)
        )

    if args.mode == "d1":
        if not args.database_name:
            return fail("--database-name is required for --mode=d1")
        return validate_d1(args)
    if not args.url:
        return fail("--url is required for --mode=http")
    return validate_http(args)


if __name__ == "__main__":
    raise SystemExit(main())
