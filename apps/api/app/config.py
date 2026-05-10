from __future__ import annotations

import os
from pathlib import Path
from datetime import datetime


ROOT_DIR = Path(__file__).resolve().parents[3]
PORT = int(os.getenv("PORT", "4000"))
WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:5173")
APP_BASE_URL = os.getenv("APP_BASE_URL", f"http://localhost:{PORT}")
PYTHON_BIN = os.getenv("PYTHON_BIN", "python3")
FRONTEND_DIST_DIR = Path(os.getenv("FRONTEND_DIST_DIR", str(ROOT_DIR / "apps/web/dist")))

DATABASE_PATH = Path(os.getenv("DATABASE_PATH", os.getenv("DUCKDB_PATH", str(ROOT_DIR / "apps/api/data/melodify.sqlite3"))))
CACHE_DIR = Path(os.getenv("CACHE_DIR", str(ROOT_DIR / "apps/api/.cache/audio")))
TEMP_CACHE_DIR = Path(os.getenv("TEMP_CACHE_DIR", str(ROOT_DIR / "apps/api/.cache/temp")))
ARTWORK_CACHE_DIR = Path(os.getenv("ARTWORK_CACHE_DIR", str(ROOT_DIR / "apps/api/.cache/artwork")))
SHARED_CACHE_DIR = Path(os.getenv("SHARED_CACHE_DIR", str(ROOT_DIR / "apps/api/.cache/shared"))) if os.getenv("SHARED_CACHE_DIR") else None
PUBLISHED_MANIFEST_PATH = Path(os.getenv("PUBLISHED_MANIFEST_PATH", str(ROOT_DIR / "apps/api/data/library-manifest.json")))
REFRESH_STATE_DIR = Path(os.getenv("REFRESH_STATE_DIR", str(ROOT_DIR / "apps/api/.cache/refresh")))
SNAPSHOT_CACHE_PATH = Path(os.getenv("SNAPSHOT_CACHE_PATH", str(REFRESH_STATE_DIR / "library-snapshot.sqlite3")))
LOCAL_REFRESH_MANIFEST_PATH = Path(
    os.getenv("LOCAL_REFRESH_MANIFEST_PATH", str(REFRESH_STATE_DIR / "library-manifest.local.json"))
)
DEFAULT_REFRESH_MANIFEST_URL = "https://raw.githubusercontent.com/LokeshVK07/Sruthi_2.o/main/apps/api/data/library-manifest.json"
REFRESH_ENABLED = os.getenv("REFRESH_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
REFRESH_MANIFEST_URL = os.getenv("REFRESH_MANIFEST_URL", DEFAULT_REFRESH_MANIFEST_URL).strip()
REFRESH_INTERVAL_SECONDS = int(os.getenv("REFRESH_INTERVAL_SECONDS", "1800"))
REFRESH_TIMEOUT_SECONDS = float(os.getenv("REFRESH_TIMEOUT_SECONDS", "60"))
MAX_CACHE_SIZE_MB = int(os.getenv("MAX_CACHE_SIZE_MB", "4096"))
MIN_CACHE_FILE_BYTES = int(os.getenv("MIN_CACHE_FILE_BYTES", "65536"))
STREAM_PREFETCH_LIMIT = int(os.getenv("STREAM_PREFETCH_LIMIT", "8"))
WARMUP_BATCH_SIZE = int(os.getenv("WARMUP_BATCH_SIZE", "48"))

SITE_BASE_URL = os.getenv("MASSTAMILAN_BASE_URL", "https://www.masstamilan.dev")
SITE_LIST_PATH = os.getenv("MASSTAMILAN_LIST_PATH", "/tamil-songs")
SITE_MAX_PAGES = int(os.getenv("MASSTAMILAN_MAX_PAGES", "481"))


def _scraper_env(name: str, legacy_name: str, default: str) -> str:
    return os.getenv(name, os.getenv(legacy_name, default))


def _env_bool(name: str, legacy_name: str, default: str = "false") -> bool:
    return _scraper_env(name, legacy_name, default).strip().lower() in {"1", "true", "yes", "on"}


# Generic per-fetch polite delay; older callers use this. New code uses the
# listing/detail-specific delays below — when those env vars aren't set,
# this value is the fallback.
SCRAPER_DELAY_SECONDS = float(_scraper_env("SCRAPER_DELAY_SECONDS", "MASSTAMILAN_DELAY_SECONDS", "0.2"))
# Two-track polite delay so listing pages (the ones Cloudflare flags hardest
# from CI runners) can crawl slower than per-album detail fetches without
# throttling the whole refresh in lockstep. Workflow defaults override these.
LISTING_DELAY_SECONDS = float(_scraper_env("SCRAPER_LISTING_DELAY_SECONDS", "MASSTAMILAN_LISTING_DELAY", str(SCRAPER_DELAY_SECONDS)))
DETAIL_DELAY_SECONDS = float(_scraper_env("SCRAPER_DETAIL_DELAY_SECONDS", "MASSTAMILAN_DETAIL_DELAY", str(SCRAPER_DELAY_SECONDS)))
SCRAPER_JITTER_SECONDS = float(_scraper_env("SCRAPER_JITTER_SECONDS", "MASSTAMILAN_JITTER_SECONDS", "1.5"))
# Stop the listing crawl after this many consecutive challenged listing
# fetches. Prevents the refresh from walking pages 40, 50, 70 once Cloudflare
# clearly flagged the runner's IP. Set to 0 to disable.
MAX_CHALLENGE_STREAK = int(_scraper_env("SCRAPER_MAX_LIMITER_STREAK", "MASSTAMILAN_MAX_CHALLENGE_STREAK", "4"))
SCRAPER_MAX_ATTEMPTS = max(1, int(_scraper_env("SCRAPER_MAX_ATTEMPTS", "MASSTAMILAN_MAX_ATTEMPTS", "3")))
SCRAPER_RETRY_BASE_DELAY_SECONDS = float(_scraper_env("SCRAPER_RETRY_BASE_DELAY_SECONDS", "MASSTAMILAN_RETRY_BASE_DELAY", "1.5"))
SCRAPER_RETRY_MAX_DELAY_SECONDS = float(_scraper_env("SCRAPER_RETRY_MAX_DELAY_SECONDS", "MASSTAMILAN_RETRY_MAX_DELAY", "20"))
SCRAPER_CHALLENGE_COOLDOWN_SECONDS = float(_scraper_env("SCRAPER_LIMITER_COOLDOWN_SECONDS", "MASSTAMILAN_CHALLENGE_COOLDOWN", "0"))
SCRAPER_LIMITER_MAX_COOLDOWN_SECONDS = float(_scraper_env("SCRAPER_LIMITER_MAX_COOLDOWN_SECONDS", "MASSTAMILAN_LIMITER_MAX_COOLDOWN", "300"))
SCRAPER_ABORT_ON_PAGE1_LIMITED = _env_bool("SCRAPER_ABORT_ON_PAGE1_LIMITED", "MASSTAMILAN_ABORT_ON_PAGE1_LIMITED", "true")
MOVIE_INDEX_MIN_YEAR = int(os.getenv("MASSTAMILAN_MIN_YEAR", "1930"))
MOVIE_INDEX_MAX_YEAR = int(os.getenv("MASSTAMILAN_MAX_YEAR", str(datetime.utcnow().year)))
SCRAPER_PLAYWRIGHT_ENABLED = os.getenv("MASSTAMILAN_USE_PLAYWRIGHT", "false").strip().lower() in {"1", "true", "yes", "on"}
SCRAPER_PLAYWRIGHT_TIMEOUT_MS = int(os.getenv("MASSTAMILAN_PLAYWRIGHT_TIMEOUT_MS", "45000"))

for directory in [
    DATABASE_PATH.parent,
    CACHE_DIR,
    TEMP_CACHE_DIR,
    ARTWORK_CACHE_DIR,
    SHARED_CACHE_DIR,
    REFRESH_STATE_DIR,
    PUBLISHED_MANIFEST_PATH.parent,
]:
    if directory is None:
        continue
    directory.mkdir(parents=True, exist_ok=True)
