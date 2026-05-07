#!/usr/bin/env python3
"""
Run a full or incremental masstamilan.dev catalog refresh.

This is a thin wrapper around `app.scripts.refresh_catalog` so the standard
CLI shape requested by the spec works:

    python3 tools/masstamilan_refresh.py --full --workers 4 --batch-size 16
    python3 tools/masstamilan_refresh.py --workers 2  # incremental
    python3 tools/masstamilan_refresh.py --full --report-path /tmp/refresh.json

All arguments are passed through to refresh_catalog. See
apps/api/app/scripts/refresh_catalog.py for the full list.

Notes on safety:

- This wrapper does NOT bypass any anti-bot system. If the upstream returns a
  Cloudflare challenge page, the page is logged, marked as challenged in the
  report JSON, and the run continues with the rest of the work.
- Per-album and per-page failures are isolated; one failure never cancels the
  full run.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "apps/api"

# Make `app.*` imports resolve.
sys.path.insert(0, str(API_DIR))

from app.scripts.refresh_catalog import main as refresh_main  # noqa: E402


if __name__ == "__main__":
    # Default DATABASE_PATH if user hasn't set it; matches apps/api defaults.
    os.environ.setdefault("DATABASE_PATH", str(API_DIR / "data/melodify.sqlite3"))
    refresh_main()
