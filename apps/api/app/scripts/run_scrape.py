from __future__ import annotations

import argparse

from app.db import init_db
from app.scraper import site_scraper

parser = argparse.ArgumentParser()
parser.add_argument("--page", type=int, default=1)
parser.add_argument("--limit", type=int, default=1)
parser.add_argument("--incremental", action="store_true")
parser.add_argument("--full-scan", action="store_true")
args = parser.parse_args()

init_db()
summary = site_scraper.scrape_site(
    page_from=args.page,
    page_to=args.page + args.limit - 1,
    incremental=args.incremental,
    full_scan=args.full_scan,
)
print(summary.model_dump_json(indent=2))
