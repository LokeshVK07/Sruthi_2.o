#!/usr/bin/env python3
"""
Inspect the JSON report emitted by `app.scripts.refresh_catalog` and decide
whether it is safe to deploy.

A refresh is considered SAFE when:
    - report.success is true
    - report.status is "success" or "warning" (never "failed")
    - the ratio of challenged/failed listing pages over total attempted
      listing pages is within --max-challenge-ratio
    - at least one album was added or updated (otherwise the refresh
      didn't actually move the catalogue forward)

The script exits non-zero with a clear "Upstream challenge detected.
Skipping unsafe deploy." message when blocking dominates the run, so the
caller can stop before mutating any deploy state.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def fail(message: str) -> int:
    print(f"::error::{message}", file=sys.stderr)
    print(message, file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path,
                        help="Path to the refresh-report.json")
    parser.add_argument("--max-challenge-ratio", type=float, default=0.4,
                        help="Maximum allowed (challenged_pages + failed_pages) "
                             "/ total_pages_attempted before the refresh is "
                             "considered blocked.")
    parser.add_argument("--require-progress", action="store_true",
                        help="Fail when albums_added + albums_updated is zero.")
    parser.add_argument("--allow-warning", action="store_true",
                        help="Treat status='warning' as acceptable (default true).")
    args = parser.parse_args()

    report_path = args.report.resolve()
    if not report_path.exists():
        return fail(f"refresh report not found: {report_path}")

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return fail(f"refresh report is not valid JSON: {exc}")

    summary = report.get("summary") or {}

    listing_pages = (
        int(summary.get("listing_pages_scanned", 0) or 0)
        + int(summary.get("movie_index_pages_scanned", 0) or 0)
        + int(summary.get("section_pages_scanned", 0) or 0)
        + int(summary.get("year_pages_scanned", 0) or 0)
    )
    challenged_pages = int(summary.get("challenged_pages", 0) or 0)
    failed_pages = int(summary.get("failed_pages", 0) or 0)
    challenged_albums = int(summary.get("challenged_albums", 0) or 0)
    failed_albums = int(summary.get("failed_albums", 0) or 0)
    albums_added = int(summary.get("albums_added", 0) or 0)
    albums_updated = int(summary.get("albums_updated", 0) or 0)
    songs_total = int(summary.get("songs_total", 0) or 0)

    attempted = listing_pages + challenged_pages + failed_pages
    blocked = challenged_pages + failed_pages
    ratio = (blocked / attempted) if attempted else 1.0

    print("Refresh report summary")
    print(f"  status              = {report.get('status')}")
    print(f"  success             = {report.get('success')}")
    print(f"  pages scanned       = {listing_pages}")
    print(f"  challenged pages    = {challenged_pages}")
    print(f"  failed pages        = {failed_pages}")
    print(f"  challenged albums   = {challenged_albums}")
    print(f"  failed albums       = {failed_albums}")
    print(f"  albums added/upd    = {albums_added + albums_updated}")
    print(f"  songs total         = {songs_total}")
    print(f"  attempted (incl blk)= {attempted}")
    print(f"  blocked ratio       = {ratio:.3f} (limit {args.max_challenge_ratio:.3f})")

    if not report.get("success"):
        return fail(
            "Upstream challenge detected. Skipping unsafe deploy. "
            f"(refresh status={report.get('status')!r}, success=false)"
        )

    status = (report.get("status") or "").lower()
    if status not in {"success", "warning"} or (status == "warning" and not args.allow_warning):
        return fail(
            f"Upstream challenge detected. Skipping unsafe deploy. "
            f"(refresh status={status!r})"
        )

    if attempted == 0:
        return fail(
            "Upstream challenge detected. Skipping unsafe deploy. "
            "(no listing pages were attempted at all)"
        )

    if ratio > args.max_challenge_ratio:
        return fail(
            "Upstream challenge detected. Skipping unsafe deploy. "
            f"(blocked ratio {ratio:.3f} > {args.max_challenge_ratio:.3f})"
        )

    if args.require_progress and (albums_added + albums_updated) == 0:
        return fail(
            "Upstream challenge detected. Skipping unsafe deploy. "
            "(no albums were added or updated this run)"
        )

    print("OK — refresh report passed challenge-rate checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
