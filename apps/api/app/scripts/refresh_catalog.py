from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import DATABASE_PATH, SITE_MAX_PAGES
from app.db import init_db
from app.schemas import ScrapeSummary
from app.scraper import site_scraper


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def merge_counts(*summaries: ScrapeSummary) -> dict[str, object]:
    return {
        "runs": len(summaries),
        "pages_scraped": sum(summary.pages_scraped for summary in summaries),
        "albums_new": sum(summary.albums_new for summary in summaries),
        "albums_updated": sum(summary.albums_updated for summary in summaries),
        "albums_failed": sum(summary.albums_failed for summary in summaries),
        "songs_total": sum(summary.songs_total for summary in summaries),
        "statuses": [summary.status for summary in summaries],
    }


def _safe_read_report(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _load_retry_album_urls(path: Path) -> list[str]:
    previous = _safe_read_report(path)
    if not previous:
        return []
    urls: list[str] = []
    for key in ("challenged_albums", "failed_albums"):
        for entry in previous.get(key, []):
            if isinstance(entry, dict) and isinstance(entry.get("url"), str):
                urls.append(entry["url"])
    return list(dict.fromkeys(urls))


def _ensure_progress(report: dict[str, Any]) -> None:
    summary = report["summary"]
    processed_pages = (
        summary["listing_pages_scanned"]
        + summary["movie_index_pages_scanned"]
        + summary["section_pages_scanned"]
        + summary["year_pages_scanned"]
    )
    processed_albums = summary["albums_added"] + summary["albums_updated"]
    if report["mode"] == "full" and not report["config"]["retryFailedOnly"] and processed_pages <= 0:
        raise RuntimeError("Refresh aborted because no source discovery pages were processed successfully")
    if processed_pages <= 0 and processed_albums <= 0:
        raise RuntimeError("Refresh aborted because no source pages or albums were processed successfully")


def _new_report(args: argparse.Namespace) -> dict[str, Any]:
    mode = "full" if args.full else "incremental"
    return {
        "mode": mode,
        "startedAt": iso_now(),
        "finishedAt": None,
        "durationSeconds": 0.0,
        "status": "running",
        "success": False,
        "databasePath": str(DATABASE_PATH),
        "config": {
            "mode": args.mode,
            "full": args.full,
            "workers": args.workers,
            "batchSize": args.batch_size,
            "startPage": args.start_page,
            "maxPages": args.max_pages,
            "delay": args.delay,
            "retryFailedOnly": args.retry_failed_only,
            "dryRun": args.dry_run,
        },
        "summary": {
            "listing_pages_scanned": 0,
            "movie_index_pages_scanned": 0,
            "section_pages_scanned": 0,
            "year_pages_scanned": 0,
            "albums_discovered": 0,
            "albums_added": 0,
            "albums_updated": 0,
            "albums_failed": 0,
            "albums_skipped": 0,
            "tracks_added": 0,
            "tracks_updated": 0,
            "tracks_skipped": 0,
            "songs_total": 0,
            "challenged_pages": 0,
            "failed_pages": 0,
            "challenged_albums": 0,
            "failed_albums": 0,
        },
        "phases": {},
        "summaries": [],
        "warnings": [],
        "errors": [],
        "challenged_pages": [],
        "failed_pages": [],
        "challenged_albums": [],
        "failed_albums": [],
    }


def _update_summary(report: dict[str, Any]) -> None:
    summary = report["summary"]
    phase_totals = {
        "albums_discovered": 0,
        "albums_added": 0,
        "albums_updated": 0,
        "albums_failed": 0,
        "albums_skipped": 0,
        "tracks_added": 0,
        "tracks_updated": 0,
        "tracks_skipped": 0,
        "songs_total": 0,
    }

    pagewise = report["phases"].get("pagewise", {})
    movie_index = report["phases"].get("movie_index", {})
    summary["listing_pages_scanned"] = int(pagewise.get("pages_scanned", 0))
    summary["movie_index_pages_scanned"] = int(movie_index.get("movie_index_pages_scanned", 0))
    summary["section_pages_scanned"] = int(movie_index.get("section_pages_scanned", 0))
    summary["year_pages_scanned"] = int(movie_index.get("year_pages_scanned", 0))

    for phase in report["phases"].values():
        for key in phase_totals:
            phase_totals[key] += int(phase.get(key, 0) or 0)

    for key, value in phase_totals.items():
        summary[key] = value

    summary["challenged_pages"] = len(report.get("challenged_pages", []))
    summary["failed_pages"] = len(report.get("failed_pages", []))
    summary["challenged_albums"] = len(report.get("challenged_albums", []))
    summary["failed_albums"] = len(report.get("failed_albums", []))


def _append_summary(report: dict[str, Any], name: str, summary: ScrapeSummary) -> None:
    report["summaries"].append(
        {
            "phase": name,
            "run_id": summary.run_id,
            "pages_scraped": summary.pages_scraped,
            "albums_new": summary.albums_new,
            "albums_updated": summary.albums_updated,
            "albums_failed": summary.albums_failed,
            "songs_total": summary.songs_total,
            "status": summary.status,
        }
    )


def _write_report(report: dict[str, Any], report_path: Path | None) -> None:
    if report_path is None:
        return
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("all", "pagewise", "movie-index"),
        default="all",
        help="Which discovery mode to run.",
    )
    parser.add_argument("--full", action="store_true", help="Run a full page-wise scan and full movie-index scan.")
    parser.add_argument("--delay", type=float, default=None, help="Delay between page fetches in seconds.")
    parser.add_argument("--skip-pagewise", action="store_true", help="Skip the paginated tamil-songs scan.")
    parser.add_argument("--skip-movie-index", action="store_true", help="Skip the movie-index scan.")
    parser.add_argument("--workers", type=int, default=4, help="Bounded worker count used for album detail parsing.")
    parser.add_argument("--batch-size", type=int, default=16, help="Album detail batch size.")
    parser.add_argument("--start-page", type=int, default=1, help="First tamil-songs listing page to scan.")
    parser.add_argument("--max-pages", type=int, default=None, help="Optional hard limit for tamil-songs listing pages.")
    parser.add_argument("--retry-failed-only", action="store_true", help="Retry album URLs captured in a previous report.")
    parser.add_argument("--dry-run", action="store_true", help="Parse pages without writing DB updates.")
    parser.add_argument("--report-path", type=Path, default=None, help="Where to write the refresh report JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.delay is not None:
        os.environ["MASSTAMILAN_DELAY_SECONDS"] = str(args.delay)

    init_db()

    report = _new_report(args)
    report_path = args.report_path
    started_at = time.monotonic()
    exit_code = 0
    summaries: list[ScrapeSummary] = []

    run_pagewise = args.mode in {"all", "pagewise"} and not args.skip_pagewise
    run_movie_index = args.mode in {"all", "movie-index"} and not args.skip_movie_index

    print("=" * 64)
    print(f"INFO - Vibe 2.o standalone scraper - MODE: {report['mode'].upper()}")
    print("=" * 64)

    try:
        if args.retry_failed_only:
            if report_path is None:
                raise RuntimeError("--retry-failed-only requires --report-path so the previous failure list can be loaded")
            retry_urls = _load_retry_album_urls(report_path)
            if not retry_urls:
                raise RuntimeError("No failed or challenged album URLs were found in the previous report")
            print(f"INFO - Retrying {len(retry_urls)} album URL(s) from the previous report")
            counts = site_scraper.refresh_album_urls(
                retry_urls,
                phase="retry",
                workers=max(1, args.workers),
                batch_size=max(1, args.batch_size),
                report=report,
                dry_run=args.dry_run,
            )
            retry_summary = ScrapeSummary(
                run_id="retry-failed-only",
                pages_scraped=0,
                albums_new=counts["albums_added"],
                albums_updated=counts["albums_updated"],
                albums_failed=counts["albums_failed"],
                songs_total=counts["songs_total"],
                status="warning" if counts["albums_failed"] and (counts["albums_added"] or counts["albums_updated"]) else "success",
            )
            summaries.append(retry_summary)
            _append_summary(report, "retry", retry_summary)
        else:
            if run_pagewise:
                print("INFO - [1/3] Refreshing page-wise listings...")
                try:
                    page_limit = args.max_pages if args.max_pages is not None else (SITE_MAX_PAGES if args.full else min(12, SITE_MAX_PAGES))
                    summary = site_scraper.scrape_site(
                        page_from=max(1, args.start_page),
                        page_to=page_limit,
                        incremental=not args.full,
                        full_scan=args.full,
                        workers=max(1, args.workers),
                        batch_size=max(1, args.batch_size),
                        report=report,
                        dry_run=args.dry_run,
                    )
                    summaries.append(summary)
                    _append_summary(report, "pagewise", summary)
                except Exception as exc:
                    message = f"Page-wise refresh failed: {exc}"
                    if args.full:
                        report["warnings"].append(message)
                        report["errors"].append(message)
                        print(f"WARN - {message}")
                    else:
                        raise

            if run_movie_index:
                print("INFO - [2/3] Refreshing movie-index catalog...")
                try:
                    max_section_pages = None if args.full else 2
                    summary = site_scraper.scrape_movie_index(
                        incremental=not args.full,
                        full_scan=args.full,
                        max_section_pages=max_section_pages,
                        workers=max(1, args.workers),
                        batch_size=max(1, args.batch_size),
                        report=report,
                        dry_run=args.dry_run,
                    )
                    summaries.append(summary)
                    _append_summary(report, "movie_index", summary)
                except Exception as exc:
                    message = f"Movie-index refresh failed: {exc}"
                    if args.full:
                        report["warnings"].append(message)
                        report["errors"].append(message)
                        print(f"WARN - {message}")
                    else:
                        raise

            if args.full:
                print("INFO - [3/3] Re-scraping every known album in the catalog...")
                summary = site_scraper.rescrape_catalog(
                    batch_size=max(1, args.batch_size),
                    workers=max(1, args.workers),
                    report=report,
                    dry_run=args.dry_run,
                )
                summaries.append(summary)
                _append_summary(report, "catalog_rescrape", summary)

        _update_summary(report)
        _ensure_progress(report)

        report["success"] = True
        report["status"] = "warning" if any(
            [
                report["summary"]["challenged_pages"],
                report["summary"]["failed_pages"],
                report["summary"]["challenged_albums"],
                report["summary"]["failed_albums"],
                report["warnings"],
            ]
        ) else "success"
        if report["status"] == "warning" and not report["warnings"]:
            report["warnings"].append("Refresh completed with warnings. Some pages or albums were skipped.")
        if summaries:
            print(json.dumps(merge_counts(*summaries), indent=2))
        else:
            print(json.dumps({"runs": 0, "status": report["status"]}, indent=2))
    except Exception as exc:
        exit_code = 1
        report["success"] = False
        report["status"] = "failed"
        report["errors"].append(str(exc))
        print(f"ERROR - {exc}", file=sys.stderr)
    finally:
        report["finishedAt"] = iso_now()
        report["durationSeconds"] = round(time.monotonic() - started_at, 2)
        _update_summary(report)
        _write_report(report, report_path)

    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
