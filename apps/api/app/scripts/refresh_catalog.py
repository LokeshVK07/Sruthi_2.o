from __future__ import annotations

import argparse
import json
import os

from app.db import init_db
from app.schemas import ScrapeSummary
from app.scraper import ChallengeError, site_scraper


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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.delay is not None:
        os.environ["MASSTAMILAN_DELAY_SECONDS"] = str(args.delay)

    init_db()

    summaries: list[ScrapeSummary] = []
    run_pagewise = args.mode in {"all", "pagewise"} and not args.skip_pagewise
    run_movie_index = args.mode in {"all", "movie-index"} and not args.skip_movie_index

    print("=" * 64)
    print(f"INFO - Vibe 2.o standalone scraper - MODE: {args.mode.upper()}")
    print("=" * 64)

    if run_pagewise:
        print("INFO - [1/2] Refreshing page-wise listings...")
        summaries.append(
            site_scraper.scrape_site(
                incremental=not args.full,
                full_scan=args.full,
            )
        )

    if run_movie_index:
        print("INFO - [2/2] Refreshing movie-index catalog...")
        try:
            summaries.append(
                site_scraper.scrape_movie_index(
                    incremental=not args.full,
                    full_scan=args.full,
                )
            )
        except ChallengeError:
            summaries.append(
                ScrapeSummary(
                    run_id="movie-index-skipped",
                    pages_scraped=0,
                    albums_new=0,
                    albums_updated=0,
                    albums_failed=0,
                    songs_total=0,
                    status="skipped",
                )
            )

    print(json.dumps(merge_counts(*summaries), indent=2))


if __name__ == "__main__":
    main()
