from __future__ import annotations

import argparse
import sys

from app.db import init_db
from app.schemas import ScrapeSummary
from app.scraper import ChallengeError, site_scraper


parser = argparse.ArgumentParser()
parser.add_argument("--incremental", action="store_true")
parser.add_argument("--full-scan", action="store_true")
parser.add_argument("--alphabet-only", action="store_true")
parser.add_argument("--years-only", action="store_true")
parser.add_argument("--max-section-pages", type=int, default=None)
args = parser.parse_args()

init_db()

include_alphabet = not args.years_only
include_years = not args.alphabet_only

try:
    summary = site_scraper.scrape_movie_index(
        include_alphabet=include_alphabet,
        include_years=include_years,
        incremental=args.incremental,
        full_scan=args.full_scan,
        max_section_pages=args.max_section_pages,
    )
except ChallengeError as exc:
    print(f"Movie-index refresh skipped: {exc}", file=sys.stderr)
    summary = ScrapeSummary(
        run_id="movie-index-skipped",
        pages_scraped=0,
        albums_new=0,
        albums_updated=0,
        albums_failed=0,
        songs_total=0,
        status="skipped",
    )

print(summary.model_dump_json(indent=2))
