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
from app.scraper import log_info, site_scraper
import app.scraper as scraper_module


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
    if (
        report.get("blocked")
        or int(summary.get("challenged_pages", 0) or 0)
        or int(summary.get("challenged_albums", 0) or 0)
    ):
        return
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


def _ensure_publishable(report: dict[str, Any]) -> None:
    summary = report["summary"]
    limited_pages = int(summary.get("challenged_pages", 0) or 0)
    limited_albums = int(summary.get("challenged_albums", 0) or 0)
    failed_pages = int(summary.get("failed_pages", 0) or 0)
    failed_albums = int(summary.get("failed_albums", 0) or 0)
    if limited_pages or limited_albums:
        report["blocked"] = True
        report["partial"] = True
        raise RuntimeError(
            "Refresh blocked by source limiter; preserving previous catalog "
            f"(limited_pages={limited_pages}, limited_albums={limited_albums})"
        )
    if failed_pages or failed_albums:
        report["partial"] = True
        raise RuntimeError(
            "Refresh produced partial results; preserving previous catalog "
            f"(failed_pages={failed_pages}, failed_albums={failed_albums})"
        )


def _new_report(args: argparse.Namespace) -> dict[str, Any]:
    mode = "full" if args.full else "incremental"
    return {
        "mode": mode,
        "startedAt": iso_now(),
        "finishedAt": None,
        "durationSeconds": 0.0,
        "status": "running",
        "success": False,
        "blocked": False,
        "partial": False,
        "databasePath": str(DATABASE_PATH),
        "config": {
            "mode": args.mode,
            "full": args.full,
            "workers": args.workers,
            "batchSize": args.batch_size,
            "startPage": args.start_page,
            "maxPages": args.max_pages,
            "delay": args.delay,
            "listingDelay": args.listing_delay,
            "detailDelay": args.detail_delay,
            "pageDelay": args.page_delay,
            "albumDelay": args.album_delay,
            "jitter": args.jitter,
            "limiterCooldown": args.limiter_cooldown,
            "maxLimiterStreak": args.max_limiter_streak or args.max_challenge_streak,
            "abortOnPage1Limited": args.abort_on_page1_limited,
            "retryCount": args.retry_count,
            "retryBaseDelay": args.retry_base_delay,
            "retryMaxDelay": args.retry_max_delay,
            "stopAfterKnownPages": args.stop_after_known_pages,
            "movieIndexStopAfterKnownPages": args.movie_index_stop_after_known_pages,
            "origin": args.origin,
            "listingPath": args.listing_path,
            "movieIndexPath": args.movie_index_path,
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
    parser.add_argument("--delay", type=float, default=None, help="(Deprecated) generic per-fetch delay; use --listing-delay/--detail-delay.")
    parser.add_argument("--listing-delay", type=float, default=None, help="Polite delay (seconds) between listing-page fetches.")
    parser.add_argument("--detail-delay", type=float, default=None, help="Polite delay (seconds) between album-detail fetches.")
    parser.add_argument("--page-delay", type=float, default=None, help="Legacy alias for --listing-delay.")
    parser.add_argument("--album-delay", type=float, default=None, help="Legacy alias for --detail-delay.")
    parser.add_argument("--jitter", type=float, default=None, help="Maximum random jitter (seconds) added to scraper sleeps.")
    parser.add_argument("--limiter-cooldown", type=float, default=None, help="Base shared cooldown after a source limiter response.")
    parser.add_argument("--retry-count", type=int, default=None, help="Maximum HTTP attempts per source page.")
    parser.add_argument("--retry-base-delay", type=float, default=None, help="Base retry/backoff delay in seconds.")
    parser.add_argument("--retry-max-delay", type=float, default=None, help="Maximum retry/backoff delay in seconds.")
    parser.add_argument("--stop-after-known-pages", type=int, default=None, help="Incremental listing crawl stops after N consecutive known pages.")
    parser.add_argument(
        "--movie-index-stop-after-known-pages",
        type=int,
        default=None,
        help="Incremental movie-index crawl stops after N consecutive known pages.",
    )
    parser.add_argument("--origin", default=None, help="Override source origin, e.g. https://www.masstamilan.dev.")
    parser.add_argument("--listing-path", default=None, help="Override listing path, e.g. /tamil-songs.")
    parser.add_argument("--movie-index-path", default=None, help="Override movie-index path, e.g. /movie-index.")
    parser.add_argument("--include-tag-index", action="store_true", help="Accepted for legacy compatibility; tag sections are already included.")
    parser.add_argument("--abort-on-page1-limited", action=argparse.BooleanOptionalAction, default=None, help="Abort safely if listing page 1 remains limited after retries.")
    parser.add_argument(
        "--max-challenge-streak",
        type=int,
        default=None,
        help="Stop the listing crawl after N consecutive challenged listing pages (0 disables).",
    )
    parser.add_argument(
        "--max-limiter-streak",
        type=int,
        default=None,
        help="Alias for --max-challenge-streak using limiter terminology.",
    )
    parser.add_argument(
        "--max-rescrape",
        type=int,
        default=None,
        help="Cap the per-run --full rescrape to this many albums, prioritised by missing URLs / staleness.",
    )
    parser.add_argument("--skip-pagewise", action="store_true", help="Skip the paginated tamil-songs scan.")
    parser.add_argument("--skip-movie-index", action="store_true", help="Skip the movie-index scan.")
    parser.add_argument("--skip-rescrape", action="store_true", help="Skip the full-mode known-album detail rescrape.")
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
    if args.page_delay is not None and args.listing_delay is None:
        args.listing_delay = args.page_delay
    if args.album_delay is not None and args.detail_delay is None:
        args.detail_delay = args.album_delay

    # Map the CLI knobs onto the env vars the scraper / config module reads.
    # We only set env when the caller passed an explicit value, so anything
    # already set via the workflow's `env:` block wins.
    if args.delay is not None:
        os.environ["MASSTAMILAN_DELAY_SECONDS"] = str(args.delay)
    if args.listing_delay is not None:
        os.environ["MASSTAMILAN_LISTING_DELAY"] = str(args.listing_delay)
    if args.detail_delay is not None:
        os.environ["MASSTAMILAN_DETAIL_DELAY"] = str(args.detail_delay)
    if args.jitter is not None:
        os.environ["SCRAPER_JITTER_SECONDS"] = str(args.jitter)
    if args.limiter_cooldown is not None:
        os.environ["SCRAPER_LIMITER_COOLDOWN_SECONDS"] = str(args.limiter_cooldown)
    if args.retry_count is not None:
        os.environ["SCRAPER_MAX_ATTEMPTS"] = str(args.retry_count)
    if args.retry_base_delay is not None:
        os.environ["SCRAPER_RETRY_BASE_DELAY_SECONDS"] = str(args.retry_base_delay)
    if args.retry_max_delay is not None:
        os.environ["SCRAPER_RETRY_MAX_DELAY_SECONDS"] = str(args.retry_max_delay)
    if args.stop_after_known_pages is not None:
        os.environ["SCRAPER_STOP_AFTER_KNOWN_PAGES"] = str(args.stop_after_known_pages)
    if args.movie_index_stop_after_known_pages is not None:
        os.environ["SCRAPER_MOVIE_INDEX_STOP_AFTER_KNOWN_PAGES"] = str(args.movie_index_stop_after_known_pages)
    limiter_streak = args.max_limiter_streak if args.max_limiter_streak is not None else args.max_challenge_streak
    if limiter_streak is not None:
        os.environ["MASSTAMILAN_MAX_CHALLENGE_STREAK"] = str(limiter_streak)
    if args.abort_on_page1_limited is not None:
        os.environ["SCRAPER_ABORT_ON_PAGE1_LIMITED"] = "true" if args.abort_on_page1_limited else "false"
    if args.origin:
        scraper_module.SITE_BASE_URL = args.origin.rstrip("/")
    if args.listing_path:
        listing_path = args.listing_path if args.listing_path.startswith("/") else f"/{args.listing_path}"
        scraper_module.SITE_LIST_PATH = listing_path

    init_db()
    # Apply the streak/delay overrides to the live scraper instance after
    # init_db (which can be a no-op but is the canonical "ready" point).
    if args.listing_delay is not None:
        site_scraper.listing_delay_seconds = max(0.0, args.listing_delay)
    if args.detail_delay is not None:
        site_scraper.detail_delay_seconds = max(0.0, args.detail_delay)
    if args.jitter is not None:
        site_scraper.jitter_seconds = max(0.0, args.jitter)
    if args.limiter_cooldown is not None:
        site_scraper.limiter_cooldown_seconds = max(0.0, args.limiter_cooldown)
    if args.retry_count is not None:
        site_scraper.max_attempts = max(1, args.retry_count)
    if args.retry_base_delay is not None:
        site_scraper.retry_base_delay_seconds = max(0.0, args.retry_base_delay)
    if args.retry_max_delay is not None:
        site_scraper.retry_max_delay_seconds = max(0.1, args.retry_max_delay)
    if args.stop_after_known_pages is not None:
        site_scraper.stop_after_known_pages = max(1, args.stop_after_known_pages)
    if args.movie_index_stop_after_known_pages is not None:
        site_scraper.movie_index_stop_after_known_pages = max(1, args.movie_index_stop_after_known_pages)
    if args.movie_index_path:
        site_scraper.movie_index_path = args.movie_index_path if args.movie_index_path.startswith("/") else f"/{args.movie_index_path}"
    if limiter_streak is not None:
        site_scraper.max_listing_challenge_streak = max(0, limiter_streak)
    if args.abort_on_page1_limited is not None:
        site_scraper.abort_on_page1_limited = bool(args.abort_on_page1_limited)

    report = _new_report(args)
    report_path = args.report_path
    started_at = time.monotonic()
    exit_code = 0
    summaries: list[ScrapeSummary] = []
    source_blocked_early = False

    project_name = os.getenv("SCRAPER_PROJECT_NAME", "Vibe 2.o")

    # For Vibe 2.o, "all" mirrors the older production refresh shape:
    # scan the plain /tamil-songs listing and the movie index before publish.
    run_pagewise = args.mode in {"all", "pagewise"} and not args.skip_pagewise
    run_movie_index = args.mode in {"all", "movie-index"} and not args.skip_movie_index

    log_info("============================================================")
    log_info(f"{project_name} MassTamilan scraper - MODE: {args.mode.upper()}")
    log_info("============================================================")
    log_info("[1/4] Connecting to SQLite catalog...")

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
                    report["warnings"].append(message)
                    print(f"WARN - {message}")
                    source_blocked_early = bool(report.get("blocked"))

            if run_movie_index and source_blocked_early:
                message = "Skipped secondary discovery because source limited page 1 from this runner."
                report["warnings"].append(message)
                print(f"NOTICE - {message}")
            elif run_movie_index:
                log_info(f"[2/4] Discovering albums using '{args.mode}' mode...")
                try:
                    max_section_pages = None if args.full or args.mode == "all" else 2
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
                    report["warnings"].append(message)
                    print(f"WARN - {message}")

            if args.full and not args.skip_rescrape:
                discovery_pages = sum(summary.pages_scraped for summary in summaries)
                if (run_pagewise or run_movie_index) and discovery_pages <= 0 and report.get("challenged_pages"):
                    raise RuntimeError("Source discovery was blocked before full catalog rescrape")
                cap = args.max_rescrape if args.max_rescrape and args.max_rescrape > 0 else None
                if cap:
                    print(f"INFO - [3/3] Re-scraping up to {cap} prioritised albums (capped) ...")
                else:
                    print("INFO - [3/3] Re-scraping every known album in the catalog...")
                summary = site_scraper.rescrape_catalog(
                    batch_size=max(1, args.batch_size),
                    workers=max(1, args.workers),
                    report=report,
                    max_count=cap,
                    dry_run=args.dry_run,
                )
                summaries.append(summary)
                _append_summary(report, "catalog_rescrape", summary)

        _update_summary(report)
        _ensure_progress(report)
        _ensure_publishable(report)

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
        if report.get("blocked") or report.get("challenged_pages") or report.get("challenged_albums"):
            report["blocked"] = True
            report["partial"] = True
            report["status"] = "blocked"
            log_prefix = "NOTICE"
        elif report.get("partial"):
            report["status"] = "partial"
            log_prefix = "NOTICE"
        else:
            report["status"] = "failed"
            log_prefix = "ERROR"
        report["errors"].append(str(exc))
        print(f"{log_prefix} - {exc}", file=sys.stderr)
    finally:
        report["finishedAt"] = iso_now()
        report["durationSeconds"] = round(time.monotonic() - started_at, 2)
        _update_summary(report)
        _write_report(report, report_path)

    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
