from __future__ import annotations

import argparse
import json

from app.db import init_db
from app.schemas import ScrapeSummary
from app.scraper import ChallengeError, site_scraper


def merge_counts(*summaries):
    return {
        "runs": len(summaries),
        "pages_scraped": sum(summary.pages_scraped for summary in summaries),
        "albums_new": sum(summary.albums_new for summary in summaries),
        "albums_updated": sum(summary.albums_updated for summary in summaries),
        "albums_failed": sum(summary.albums_failed for summary in summaries),
        "songs_total": sum(summary.songs_total for summary in summaries),
        "statuses": [summary.status for summary in summaries],
    }


parser = argparse.ArgumentParser()
parser.add_argument("--full", action="store_true", help="Run a full page-wise scan and full movie-index scan.")
parser.add_argument("--skip-pagewise", action="store_true", help="Skip the paginated tamil-songs scan.")
parser.add_argument("--skip-movie-index", action="store_true", help="Skip the movie-index scan.")
args = parser.parse_args()

init_db()

summaries = []

if not args.skip_pagewise:
    summaries.append(
        site_scraper.scrape_site(
            incremental=not args.full,
            full_scan=args.full,
        )
    )

if not args.skip_movie_index:
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
