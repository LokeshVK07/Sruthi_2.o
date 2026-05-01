# Sruthi

Sruthi is a scraper-backed Tamil music player with:

- a Python backend in [apps/api](/Users/lokesh/Sruthi%202.o/apps/api)
- a React frontend in [apps/web](/Users/lokesh/Sruthi%202.o/apps/web)
- normalized album/song storage in a local SQLite database
- backend-controlled playback through `/api/stream/:songId`
- cache-backed streaming and on-demand album refresh when links go stale

## Current stack

- Frontend: React, Vite, TypeScript, TanStack Query, Zustand
- Backend: FastAPI
- Scraper: `cloudscraper` + `BeautifulSoup`/`lxml` + `tenacity`
- Stream fetch path: `curl_cffi`
- Local database: SQLite

SQLite is used here because repeated album upserts and refresh writes were not stable enough with DuckDB under this workload.

## Project layout

- [apps/api](/Users/lokesh/Sruthi%202.o/apps/api): active backend
- [apps/api/app/main.py](/Users/lokesh/Sruthi%202.o/apps/api/app/main.py): FastAPI app and routes
- [apps/api/app/scraper.py](/Users/lokesh/Sruthi%202.o/apps/api/app/scraper.py): listing and album scraper
- [apps/api/app/repository.py](/Users/lokesh/Sruthi%202.o/apps/api/app/repository.py): normalized storage and queries
- [apps/api/app/playback.py](/Users/lokesh/Sruthi%202.o/apps/api/app/playback.py): stream, cache, and refresh logic
- [apps/web](/Users/lokesh/Sruthi%202.o/apps/web): custom player UI
- [apps/server](/Users/lokesh/Sruthi%202.o/apps/server): older temporary Node backend kept only for reference

## Local setup

1. Install dependencies:

```bash
npm install
python3 -m pip install -r apps/api/requirements.txt
```

2. Copy env values if you want to customize paths or ports:

```bash
cp .env.example .env
```

3. Initialize the database:

```bash
npm run db:init
```

4. Start the backend and frontend:

```bash
npm --workspace @melodify/api run dev
npm --workspace @melodify/web run dev -- --host 127.0.0.1
```

5. Open:

- Web UI: [http://127.0.0.1:5173/](http://127.0.0.1:5173/)
- API health: [http://127.0.0.1:4000/api/health](http://127.0.0.1:4000/api/health)

## Scraping

Run a real scrape through the backend:

```bash
curl -X POST "http://127.0.0.1:4000/api/admin/scrape?page=1&limit=1&full_scan=true"
```

The implemented scraper:

- walks listing pages
- discovers album/detail URLs incrementally
- parses album name, year, music director, singers, track names, track numbers, 128/320 links, and artwork
- stores one album row per album URL and one song row per track
- keeps deterministic song ids from `album_url + track_number`
- refreshes album metadata again if playback finds a stale link

### Source-site limitation

`masstamilan.dev` still intermittently serves Cloudflare or challenge pages on some album or track-detail requests. The scraper now stores successful albums reliably and skips failures without corrupting the database, but a true 100% scrape still depends on how often the source allows those requests through.

## Playback flow

Every playable song exposed to the frontend uses only an internal URL:

- `/api/stream/:songId`

The browser never receives the raw third-party MP3 URL as its player source.

The backend stream flow is:

1. resolve song from SQLite
2. prefer stored 320 kbps URL, fallback to 128 kbps
3. serve local cache if valid
4. fetch upstream audio with `curl_cffi`
5. reject non-audio responses
6. refresh the parent album page once if the stored link is stale
7. retry once with the refreshed URL
8. cache successful full downloads to disk

## Useful endpoints

- `GET /api/health`
- `GET /api/library`
- `GET /api/library/home`
- `GET /api/library/songs`
- `GET /api/albums`
- `GET /api/albums/:albumId`
- `GET /api/song/:songId`
- `GET /api/search?q=...`
- `GET /api/stream/:songId`
- `POST /api/admin/scrape`
- `POST /api/warmup`
- `POST /api/playback/prefetch`
- `GET /api/cache/status`
- `POST /api/cache/trim`
- `GET /api/song-status/:songId`

## Verified locally

These flows were verified locally on April 29, 2026:

- backend and frontend compile cleanly
- `GET /api/health` returns healthy
- a real page-1 scrape stored `14 albums` and `55 songs`
- `GET /api/library/songs` returns only backend-owned stream URLs
- a real stream request for a scraped song returned MP3 bytes through `/api/stream/:songId`

## Environment variables

See [.env.example](/Users/lokesh/Sruthi%202.o/.env.example).

Most important values:

- `DATABASE_PATH`
- `CACHE_DIR`
- `TEMP_CACHE_DIR`
- `ARTWORK_CACHE_DIR`
- `MASSTAMILAN_BASE_URL`
- `MASSTAMILAN_LIST_PATH`
- `MASSTAMILAN_MAX_PAGES`
- `MAX_CACHE_SIZE_MB`
- `STREAM_PREFETCH_LIMIT`
- `WARMUP_BATCH_SIZE`
