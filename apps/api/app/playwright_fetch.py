"""Playwright-based audio downloader used when curl_cffi/cloudscraper are blocked.

Some masstamilan albums (e.g. "3 (Moonu)") are gated behind a Cloudflare WAF
challenge that no plain HTTP client can solve. Triggering a real navigation
inside a headless Chrome session does pass the challenge, so we keep one
Chromium instance warm and route blocked downloads through it.

Playwright's sync API is bound to a single thread, but FastAPI dispatches each
request from a different worker thread. We solve this by running Chromium on
one dedicated thread and pushing download requests onto a queue.
"""

from __future__ import annotations

import os
import queue
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import SCRAPER_PLAYWRIGHT_TIMEOUT_MS

CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Per-call download timeout. Cloudflare-blocked URLs that don't actually serve
# a file (e.g. d320 for some albums where only d128 is provisioned) hang the
# `expect_download` listener until the timeout fires, so keep this short — the
# caller will try the next URL candidate quickly.
PLAYWRIGHT_DOWNLOAD_TIMEOUT_MS = 10_000


@dataclass
class _DownloadJob:
    url: str
    referer: Optional[str]
    dest_path: Path
    done: threading.Event
    result: Optional[Path] = None
    error: Optional[BaseException] = None


class PlaywrightDownloader:
    """Single-thread Playwright runner; thread-safe submit().

    All Chromium interactions happen on the dedicated `_worker` thread so the
    sync_playwright API stays on the thread that started it.
    """

    def __init__(self) -> None:
        self._jobs: "queue.Queue[Optional[_DownloadJob]]" = queue.Queue()
        self._worker: threading.Thread | None = None
        self._worker_lock = threading.Lock()
        self._available: bool | None = None

    def available(self) -> bool:
        if self._available is None:
            try:
                from playwright.sync_api import sync_playwright  # noqa: F401
                self._available = True
            except Exception:
                self._available = False
        return self._available

    def _ensure_worker(self) -> None:
        with self._worker_lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._run_worker,
                name="playwright-downloader",
                daemon=True,
            )
            self._worker.start()

    def _run_worker(self) -> None:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright

        runtime = None
        browser = None

        def init_runtime():
            nonlocal runtime, browser
            runtime = sync_playwright().start()
            browser = runtime.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )

        def reset_runtime():
            nonlocal runtime, browser
            try:
                if browser is not None:
                    browser.close()
            except Exception:
                pass
            try:
                if runtime is not None:
                    runtime.stop()
            except Exception:
                pass
            runtime = None
            browser = None

        try:
            while True:
                job = self._jobs.get()
                if job is None:
                    return
                context = None
                page = None
                try:
                    if browser is None:
                        init_runtime()
                    assert browser is not None
                    # A fresh context per download avoids Cloudflare's per-
                    # session rate limiter, which started timing out the
                    # `expect_download` listener after the first hit when we
                    # reused the same context. Browser stays warm; only the
                    # context (cookies/storage) is recycled.
                    context = browser.new_context(
                        user_agent=CHROME_UA,
                        locale="en-US",
                        accept_downloads=True,
                    )
                    page = context.new_page()
                    if job.referer:
                        try:
                            page.goto(
                                job.referer,
                                wait_until="domcontentloaded",
                                timeout=SCRAPER_PLAYWRIGHT_TIMEOUT_MS,
                            )
                        except Exception as exc:
                            print(f"[playwright] referer goto failed for {job.referer}: {exc}")
                    job.dest_path.parent.mkdir(parents=True, exist_ok=True)
                    started = time.perf_counter()
                    try:
                        with page.expect_download(timeout=PLAYWRIGHT_DOWNLOAD_TIMEOUT_MS) as info:
                            page.evaluate(f"window.location.href = {job.url!r}")
                        download = info.value
                    except PlaywrightTimeoutError as exc:
                        job.error = RuntimeError(
                            f"Playwright download timeout after {PLAYWRIGHT_DOWNLOAD_TIMEOUT_MS}ms"
                        )
                        continue
                    temp = download.path()
                    if not temp:
                        job.error = RuntimeError("Playwright download did not produce a file")
                        continue
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    size = os.path.getsize(temp)
                    shutil.move(str(temp), str(job.dest_path))
                    print(
                        f"[playwright] downloaded url={job.url[:80]} size={size} "
                        f"elapsed_ms={elapsed_ms:.0f} dest={job.dest_path.name}"
                    )
                    job.result = job.dest_path
                except Exception as exc:
                    job.error = exc
                    reset_runtime()
                finally:
                    if context is not None:
                        try:
                            context.close()
                        except Exception:
                            pass
                    job.done.set()
        finally:
            reset_runtime()

    def download(self, url: str, *, referer: str | None, dest_path: Path) -> Path:
        if not self.available():
            raise RuntimeError("Playwright is not installed")
        self._ensure_worker()
        job = _DownloadJob(
            url=url,
            referer=referer,
            dest_path=dest_path,
            done=threading.Event(),
        )
        self._jobs.put(job)
        # Generous overall wait — the worker has its own per-call timeout.
        if not job.done.wait(timeout=60):
            raise RuntimeError("Playwright job did not complete within 60 s")
        if job.error is not None:
            raise job.error
        assert job.result is not None
        return job.result


playwright_downloader = PlaywrightDownloader()
