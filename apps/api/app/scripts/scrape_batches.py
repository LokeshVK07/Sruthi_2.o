from __future__ import annotations

import argparse
import time

from app.db import init_db
from app.scraper import site_scraper


parser = argparse.ArgumentParser()
parser.add_argument("--start-page", type=int, default=1)
parser.add_argument("--end-page", type=int, default=481)
parser.add_argument("--batch-size", type=int, default=5)
parser.add_argument("--sleep-seconds", type=float, default=1.5)
parser.add_argument("--incremental", action="store_true")
args = parser.parse_args()

init_db()

page = args.start_page
total_pages = 0
total_new = 0
total_updated = 0
total_failed = 0
total_songs = 0

while page <= args.end_page:
    batch_end = min(args.end_page, page + args.batch_size - 1)
    print(f"[batch] scraping pages {page}-{batch_end}")
    summary = site_scraper.scrape_site(
        page_from=page,
        page_to=batch_end,
        incremental=args.incremental,
        full_scan=not args.incremental,
    )
    total_pages += summary.pages_scraped
    total_new += summary.albums_new
    total_updated += summary.albums_updated
    total_failed += summary.albums_failed
    total_songs += summary.songs_total
    print(
        f"[batch] pages {page}-{batch_end} done: "
        f"pages_scraped={summary.pages_scraped} albums_new={summary.albums_new} "
        f"albums_updated={summary.albums_updated} albums_failed={summary.albums_failed} songs_total={summary.songs_total}"
    )
    page = batch_end + 1
    if page <= args.end_page:
        time.sleep(args.sleep_seconds)

print(
    f"[batch] all done: pages_scraped={total_pages} albums_new={total_new} "
    f"albums_updated={total_updated} albums_failed={total_failed} songs_total={total_songs}"
)
