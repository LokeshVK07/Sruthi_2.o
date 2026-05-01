# Vibe 2.o

Vibe 2.o is a scraper-backed Tamil music player with:

- a Python backend in [apps/api](/Users/lokesh/Sruthi%202.o/apps/api)
- a React frontend in [apps/web](/Users/lokesh/Sruthi%202.o/apps/web)
- normalized album/song storage in a local SQLite database
- backend-controlled playback through `/api/stream/:songId`
- cache-backed streaming and on-demand album refresh when links go stale
- a GitHub Actions produced library snapshot refresh flow

## Current stack

- Frontend: React, Vite, TypeScript, TanStack Query, Zustand
- Backend: FastAPI
- Scraper: `cloudscraper` + `BeautifulSoup`/`lxml` + `tenacity`
- Stream fetch path: `curl_cffi`
- Local database: SQLite

SQLite is used here because repeated album upserts and refresh writes were not stable enough with DuckDB under this workload.

## Automated background refresh

The catalog refresh producer runs in GitHub Actions on a schedule and on manual trigger.

The workflow refreshes a temporary snapshot first, validates it, builds the app, and only then publishes:

- the refreshed SQLite snapshot to the `library-snapshot` GitHub Release
- the updated manifest at `apps/api/data/library-manifest.json`

Safety guarantees:

- refresh runs use a temp snapshot in the Actions runner, never the live published file
- snapshot publication happens only after refresh, validation, and build all succeed
- DuckDB-backed validation rejects empty, corrupt, or sharply regressed snapshots
- the workflow uses GitHub Actions concurrency protection to prevent overlapping refresh runs
- if any step fails, the previous published manifest and snapshot stay untouched

## Project layout

- [apps/api](/Users/lokesh/Sruthi%202.o/apps/api): active backend
- [apps/api/app/main.py](/Users/lokesh/Sruthi%202.o/apps/api/app/main.py): FastAPI app and routes
- [apps/api/app/scraper.py](/Users/lokesh/Sruthi%202.o/apps/api/app/scraper.py): listing and album scraper
- [apps/api/app/repository.py](/Users/lokesh/Sruthi%202.o/apps/api/app/repository.py): normalized storage and queries
- [apps/api/app/playback.py](/Users/lokesh/Sruthi%202.o/apps/api/app/playback.py): stream, cache, and refresh logic
- [apps/api/app/refresh.py](/Users/lokesh/Sruthi%202.o/apps/api/app/refresh.py): background snapshot refresh consumer
- [apps/web](/Users/lokesh/Sruthi%202.o/apps/web): custom player UI
- [apps/server](/Users/lokesh/Sruthi%202.o/apps/server): older temporary Node backend kept only for reference
- [.github/workflows/background-refresh.yml](/Users/lokesh/Sruthi%202.o/.github/workflows/background-refresh.yml): GitHub Actions snapshot producer
- [scripts/publish_snapshot_manifest.py](/Users/lokesh/Sruthi%202.o/scripts/publish_snapshot_manifest.py): manifest builder

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

## Background snapshot refresh

The app now uses a producer/consumer refresh model:

- GitHub Actions is the producer
- the running FastAPI app is the consumer

### Producer

The workflow in [.github/workflows/background-refresh.yml](/Users/lokesh/Sruthi%202.o/.github/workflows/background-refresh.yml):

- runs every 6 hours
- supports manual trigger
- downloads the previously published snapshot release asset when available
- scrapes into that existing snapshot so historical shared catalog data is preserved
- uploads the refreshed SQLite snapshot to the `library-snapshot` GitHub Release as `vibe2o-library.sqlite3`
- rewrites [apps/api/data/library-manifest.json](/Users/lokesh/Sruthi%202.o/apps/api/data/library-manifest.json) with:
  - `version`
  - `updated_at`
  - `size`
  - `sha256`
  - `download_url`
- commits only the manifest update back to git

### Consumer

The backend refresh worker in [apps/api/app/refresh.py](/Users/lokesh/Sruthi%202.o/apps/api/app/refresh.py):

- starts on backend startup when refresh is enabled
- polls the remote manifest on the configured interval
- skips work if the remote version matches the local version
- downloads a new snapshot into a temp file
- verifies size and sha256
- verifies the SQLite snapshot with integrity checks and required table checks
- atomically replaces the local cached snapshot file
- merges shared catalog tables (`albums`, `songs`, `scrape_runs`) into the live SQLite database inside a transaction
- preserves local mutable state automatically because it does not overwrite:
  - `favorites`
  - `playlists`
  - `playlist_songs`
  - `recently_played`
  - `users`
  - `sessions`
  - `user_preferences`
- keeps a backup of the live database before applying a refresh

### Runtime APIs

- `GET /api/refresh/status`
- `POST /api/refresh/check`

Status fields include:

- `enabled`
- `status`
- `message`
- `currentVersion`
- `remoteVersion`
- `checkedAt`
- `updatedAt`
- `downloadedBytes`
- `totalBytes`
- `error`

### Frontend wiring

The React app polls refresh status and exposes a manual refresh check button in the search/filter bar.
When a new snapshot version is applied, the frontend invalidates the cached library/home/album queries and reloads the catalog without a hard app restart.

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
- `GET /api/refresh/status`
- `POST /api/refresh/check`
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
