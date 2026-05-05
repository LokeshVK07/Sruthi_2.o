from __future__ import annotations

import os
from pathlib import Path


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
REFRESH_INTERVAL_SECONDS = int(os.getenv("REFRESH_INTERVAL_SECONDS", "21600"))
REFRESH_TIMEOUT_SECONDS = float(os.getenv("REFRESH_TIMEOUT_SECONDS", "60"))
MAX_CACHE_SIZE_MB = int(os.getenv("MAX_CACHE_SIZE_MB", "4096"))
MIN_CACHE_FILE_BYTES = int(os.getenv("MIN_CACHE_FILE_BYTES", "65536"))
STREAM_PREFETCH_LIMIT = int(os.getenv("STREAM_PREFETCH_LIMIT", "8"))
WARMUP_BATCH_SIZE = int(os.getenv("WARMUP_BATCH_SIZE", "48"))

SITE_BASE_URL = os.getenv("MASSTAMILAN_BASE_URL", "https://www.masstamilan.dev")
SITE_LIST_PATH = os.getenv("MASSTAMILAN_LIST_PATH", "/tamil-songs")
SITE_MAX_PAGES = int(os.getenv("MASSTAMILAN_MAX_PAGES", "481"))
SCRAPER_DELAY_SECONDS = float(os.getenv("MASSTAMILAN_DELAY_SECONDS", "0.2"))

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
