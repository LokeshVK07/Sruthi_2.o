from __future__ import annotations

import argparse

from app.db import init_db
from app.repository import upsert_album
from app.scraper import site_scraper

parser = argparse.ArgumentParser()
parser.add_argument("album_url")
args = parser.parse_args()

init_db()
album = site_scraper.scrape_album_url(args.album_url)
is_new, songs = upsert_album(album)
print(
    {
        "ok": True,
        "album": album.album_name,
        "is_new": is_new,
        "songs": songs,
        "album_url": album.album_url,
    }
)
