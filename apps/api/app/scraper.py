from __future__ import annotations

from datetime import UTC, datetime
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import cloudscraper
import requests
from bs4 import BeautifulSoup

from .config import (
    DETAIL_DELAY_SECONDS,
    LISTING_DELAY_SECONDS,
    MAX_CHALLENGE_STREAK,
    MOVIE_INDEX_MAX_YEAR,
    MOVIE_INDEX_MIN_YEAR,
    SCRAPER_ABORT_ON_PAGE1_LIMITED,
    SCRAPER_CHALLENGE_COOLDOWN_SECONDS,
    SCRAPER_DELAY_SECONDS,
    SCRAPER_JITTER_SECONDS,
    SCRAPER_LIMITER_MAX_COOLDOWN_SECONDS,
    SCRAPER_MAX_ATTEMPTS,
    SCRAPER_MOVIE_INDEX_STOP_AFTER_KNOWN_PAGES,
    SCRAPER_RETRY_BASE_DELAY_SECONDS,
    SCRAPER_RETRY_MAX_DELAY_SECONDS,
    SCRAPER_STOP_AFTER_KNOWN_PAGES,
    SITE_BASE_URL,
    SITE_LIST_PATH,
    SITE_MAX_PAGES,
)
from .repository import create_scrape_run, finish_scrape_run, known_album_urls, list_album_urls, make_album_id, upsert_album_details
from .schemas import ScrapedAlbum, ScrapedSong, ScrapeSummary
from .utils import canonicalize_url


class ChallengeError(Exception):
    pass


class FetchError(Exception):
    pass


class ChallengeStreakAborted(Exception):
    """Raised when consecutive listing challenges exceed the configured cap.

    Distinct from ChallengeError so the scrape loops can recognise the
    "give up gracefully" signal vs a normal per-page challenge that the
    loop should log and skip past.
    """

    pass


def log_info(message: str = "") -> None:
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S,%f")[:-3]
    print(f"[{stamp}] INFO - {message}")


HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "dnt": "1",
    "pragma": "no-cache",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
}

USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
)

# Cloudflare's anti-bot script is embedded on EVERY page served from a
# CF-fronted origin (including normal album/listing pages), so generic
# tokens like "cf-chl" or "challenge" alone do NOT indicate a real
# interstitial. We split markers into two buckets:
#   STRONG — phrases that virtually never appear in legit catalogue HTML
#            and short-circuit to "blocked" regardless of body size.
#   WEAK   — generic CF infrastructure mentions; only meaningful when the
#            response is also tiny / status-code-suspicious.
STRONG_CHALLENGE_MARKERS = (
    "just a moment",
    "checking your browser",
    "cloudflare",
    "captcha",
    "rate limit",
    "too many requests",
    "temporarily unavailable",
    "verifying you are human",
    "enable javascript and cookies to continue",
    "attention required",
    "ddos protection by cloudflare",
)
WEAK_CHALLENGE_MARKERS = (
    "cf-browser-verification",
    "challenge-platform",
    "cf-chl",
)
# Backwards-compatible alias still imported by tests / log strings.
CHALLENGE_MARKERS = STRONG_CHALLENGE_MARKERS + WEAK_CHALLENGE_MARKERS


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def is_challenge_page(html: str, status_code: int | None = None, headers: dict[str, Any] | None = None) -> bool:
    """Detect a Cloudflare challenge interstitial.

    A real interstitial:
      - returns 403/429/503, or 200 with a very small body
      - contains a short, specific phrase ("just a moment", etc.) — STRONG
      - or contains generic CF infrastructure markup AND a small body — WEAK

    A normal page that merely embeds /cdn-cgi/challenge-platform/ is NOT a
    challenge — the WEAK markers therefore require a small body before we
    treat them as such. STRONG markers are conclusive on their own.
    """
    lower = (html or "").lower()
    body_len = len(lower.strip())
    header_map = {str(key).lower(): str(value).lower() for key, value in (headers or {}).items()}
    content_type = header_map.get("content-type", "")

    if status_code in {403, 429} and ("text/html" in content_type or not content_type):
        return True
    if status_code == 503 and body_len < 4096:
        return True

    if any(marker in lower for marker in STRONG_CHALLENGE_MARKERS):
        return True

    if any(marker in lower for marker in WEAK_CHALLENGE_MARKERS) and body_len < 8192:
        return True

    return False


class SiteScraper:
    def __init__(self) -> None:
        self.client_local = threading.local()
        self.refresh_locks: dict[str, threading.Lock] = {}
        # Listing-page challenge streak. Reset on every successful fetch_html;
        # incremented when fetch_html exhausts retries on a listing-kind URL.
        # `_check_listing_streak` is called by the listing/index loops after
        # they handle a ChallengeError so they can break gracefully instead
        # of walking dozens more guaranteed-to-be-blocked pages.
        self.listing_challenge_streak = 0
        self.max_listing_challenge_streak = MAX_CHALLENGE_STREAK
        self.abort_on_page1_limited = SCRAPER_ABORT_ON_PAGE1_LIMITED
        self.listing_delay_seconds = LISTING_DELAY_SECONDS
        self.detail_delay_seconds = DETAIL_DELAY_SECONDS
        self.stop_after_known_pages = SCRAPER_STOP_AFTER_KNOWN_PAGES
        self.movie_index_stop_after_known_pages = SCRAPER_MOVIE_INDEX_STOP_AFTER_KNOWN_PAGES
        self.movie_index_path = "/movie-index"
        self.jitter_seconds = SCRAPER_JITTER_SECONDS
        self.max_attempts = SCRAPER_MAX_ATTEMPTS
        self.retry_base_delay_seconds = SCRAPER_RETRY_BASE_DELAY_SECONDS
        self.retry_max_delay_seconds = SCRAPER_RETRY_MAX_DELAY_SECONDS
        self.limiter_cooldown_seconds = SCRAPER_CHALLENGE_COOLDOWN_SECONDS
        self.limiter_max_cooldown_seconds = SCRAPER_LIMITER_MAX_COOLDOWN_SECONDS
        self.cooldown_lock = threading.Lock()
        self.cooldown_until = 0.0
        self.limiter_hit_count = 0

    def _rotated_headers(self, referer: str | None = None) -> dict[str, str]:
        headers = HEADERS.copy()
        headers["user-agent"] = random.choice(USER_AGENTS)
        if referer:
            headers["referer"] = referer
            headers["sec-fetch-site"] = "same-origin"
        else:
            headers["sec-fetch-site"] = "none"
        return headers

    def _new_cloudscraper(self) -> Any:
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False}
        )
        scraper.headers.update(self._rotated_headers())
        return scraper

    def _new_requests_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(self._rotated_headers())
        return session

    def _clients(self) -> tuple[Any, requests.Session]:
        scraper = getattr(self.client_local, "scraper", None)
        session = getattr(self.client_local, "requests_session", None)
        if scraper is None:
            scraper = self._new_cloudscraper()
            self.client_local.scraper = scraper
        if session is None:
            session = self._new_requests_session()
            self.client_local.requests_session = session
        return scraper, session

    def reset_session(self) -> None:
        """Reset per-thread HTTP sessions after limiter responses."""
        for attr in ("scraper", "requests_session"):
            client = getattr(self.client_local, attr, None)
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass
                setattr(self.client_local, attr, None)

    def _wait_for_cooldown(self) -> None:
        with self.cooldown_lock:
            remaining = self.cooldown_until - time.monotonic()
        if remaining <= 0:
            return
        print(f"[scrape] shared cooldown active for {remaining:.1f}s")
        time.sleep(remaining)

    def _trigger_cooldown(self, *, kind: str, attempt: int, reason: str) -> None:
        if self.limiter_cooldown_seconds <= 0:
            return
        with self.cooldown_lock:
            self.limiter_hit_count += 1
            limiter_hit_count = self.limiter_hit_count
        multiplier = 1
        if limiter_hit_count >= 2:
            multiplier = 2
        if limiter_hit_count >= max(3, self.max_listing_challenge_streak):
            multiplier = 5
        cooldown = min(
            self.limiter_max_cooldown_seconds,
            self.limiter_cooldown_seconds * multiplier,
        )
        cooldown += random.uniform(0, min(self.jitter_seconds, max(0.0, cooldown * 0.1)))
        until = time.monotonic() + cooldown
        with self.cooldown_lock:
            if until <= self.cooldown_until:
                return
            self.cooldown_until = until
        print(
            f"[scrape] upstream limiter hit during {kind}; "
            f"streak={limiter_hit_count}; cooling down for {cooldown:.1f}s ({reason})"
        )

    def _sleep_with_backoff(
        self,
        attempt: int,
        base: float | None = None,
        ceiling: float | None = None,
    ) -> None:
        base_delay = self.retry_base_delay_seconds if base is None else base
        max_delay = self.retry_max_delay_seconds if ceiling is None else ceiling
        delay = min(max_delay, base_delay * (2 ** max(0, attempt - 1)))
        delay += random.uniform(0, min(self.jitter_seconds, delay / 4))
        time.sleep(delay)

    def _request_once(self, url: str, referer: str | None = None) -> str:
        headers = self._rotated_headers(referer)
        scraper, session = self._clients()
        errors: list[str] = []
        challenge_count = 0
        # Keep this path HTTP-only: cloudscraper first, then a plain requests
        # session with the same browser-like headers. On limiter responses the
        # caller resets sessions and backs off before the next attempt.
        for client_name, getter in (
            ("cloudscraper", lambda: scraper.get(url, timeout=30, headers=headers)),
            ("requests", lambda: session.get(url, timeout=30, headers=headers)),
        ):
            try:
                response = getter()
            except Exception as exc:
                errors.append(f"{client_name}: {exc}")
                continue
            html = response.text
            if is_challenge_page(html, response.status_code, dict(response.headers)):
                challenge_count += 1
                errors.append(f"{client_name}: upstream limiter response")
                continue
            if response.status_code >= 500:
                errors.append(f"{client_name}: upstream {response.status_code}")
                continue
            if response.status_code in {403, 429}:
                challenge_count += 1
                errors.append(f"{client_name}: upstream limiter response")
                continue
            if response.status_code >= 400:
                raise FetchError(f"HTTP {response.status_code} for {url}")
            if not html.strip():
                errors.append(f"{client_name}: empty response body")
                continue
            return html
        if challenge_count and challenge_count == len([1 for _ in errors]):
            raise ChallengeError(f"Upstream limiter response for {url} ({'; '.join(errors)})")
        raise FetchError("; ".join(errors) if errors else f"Failed to fetch {url}")

    def fetch_html(
        self,
        url: str,
        referer: str | None = None,
        *,
        max_attempts: int | None = None,
        polite_delay: bool = True,
        kind: str = "detail",
    ) -> str:
        """Fetch `url` with retries.

        `kind` selects between LISTING_DELAY_SECONDS and DETAIL_DELAY_SECONDS
        for the post-success polite delay. It also drives the listing-only
        challenge streak counter — listing pages are the ones the workflow
        should bail out on if Cloudflare's flagging the whole crawl.
        """
        listing_kind = kind == "listing"
        max_attempts = self.max_attempts if max_attempts is None else max(1, max_attempts)
        delay = self.listing_delay_seconds if listing_kind else self.detail_delay_seconds
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                self._wait_for_cooldown()
                html = self._request_once(url, referer=referer)
                if polite_delay and delay > 0:
                    time.sleep(delay + random.uniform(0, min(self.jitter_seconds, delay * 0.25)))
                # Any successful fetch (listing OR detail) clears the streak —
                # if even one page came through, the IP isn't fully blocked.
                if self.listing_challenge_streak:
                    print(
                        f"[scrape] challenge streak cleared after "
                        f"{self.listing_challenge_streak} block(s)"
                    )
                    self.listing_challenge_streak = 0
                with self.cooldown_lock:
                    self.limiter_hit_count = 0
                return html
            except ChallengeError as exc:
                last_error = exc
                self.reset_session()
                self._trigger_cooldown(kind=kind, attempt=attempt, reason=str(exc))
                if attempt >= max_attempts:
                    break
                self._sleep_with_backoff(attempt, base=max(4.0, self.retry_base_delay_seconds), ceiling=self.retry_max_delay_seconds)
            except FetchError as exc:
                last_error = exc
                self.reset_session()
                if attempt >= max_attempts:
                    break
                self._sleep_with_backoff(attempt, base=1.5, ceiling=12.0)
            except Exception as exc:
                last_error = exc
                self.reset_session()
                if attempt >= max_attempts:
                    break
                self._sleep_with_backoff(attempt, base=1.5, ceiling=12.0)

        if isinstance(last_error, ChallengeError) and listing_kind:
            self.listing_challenge_streak += 1

        if last_error is None:
            raise FetchError(f"Failed to fetch {url}")
        raise last_error

    def _check_listing_streak(self) -> bool:
        """Return True if the listing crawl should stop now."""
        if self.max_listing_challenge_streak <= 0:
            return False
        return self.listing_challenge_streak >= self.max_listing_challenge_streak

    def _record_issue(
        self,
        report: dict[str, Any] | None,
        key: str,
        *,
        phase: str,
        url: str,
        reason: str,
        page: int | None = None,
        section: str | None = None,
    ) -> None:
        if report is None:
            return
        entry = {"phase": phase, "url": url, "reason": reason}
        if page is not None:
            entry["page"] = page
        if section:
            entry["section"] = section
        report.setdefault(key, []).append(entry)

    def _phase_report(self, report: dict[str, Any] | None, phase: str) -> dict[str, Any] | None:
        if report is None:
            return None
        phases = report.setdefault("phases", {})
        return phases.setdefault(
            phase,
            {
                "pages_scanned": 0,
                "albums_discovered": 0,
                "albums_added": 0,
                "albums_updated": 0,
                "albums_failed": 0,
                "albums_skipped": 0,
                "tracks_added": 0,
                "tracks_updated": 0,
                "tracks_skipped": 0,
                "songs_total": 0,
            },
        )

    def discover_listing_page(self, page_number: int) -> tuple[list[str], int, bool]:
        url = f"{SITE_BASE_URL}{SITE_LIST_PATH}?page={page_number}"
        html = self.fetch_html(url, kind="listing")
        soup = BeautifulSoup(html, "lxml")
        urls = self._album_urls_from_soup(soup, url)
        max_page = page_number
        has_next = False
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            absolute = urljoin(url, href)
            parsed = urlparse(absolute)
            if parsed.path.rstrip("/") != SITE_LIST_PATH.rstrip("/"):
                continue
            page_value = parse_qs(parsed.query).get("page", [None])[0]
            if page_value and page_value.isdigit():
                numeric = int(page_value)
                max_page = max(max_page, numeric)
                if numeric > page_number:
                    has_next = True
        return urls, max_page, has_next

    def _album_urls_from_soup(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        candidate_selectors = (
            "article a[href]",
            ".entry-content a[href]",
            ".entry-title a[href]",
            ".inside-article a[href]",
            ".post a[href]",
            ".card a[href]",
            "main a[href]",
            "h1 a[href], h2 a[href], h3 a[href]",
            "a[href]",
        )
        urls: list[str] = []
        seen: set[str] = set()
        for selector in candidate_selectors:
            for anchor in soup.select(selector):
                href = anchor.get("href", "")
                absolute = canonicalize_url(urljoin(base_url, href))
                parsed = urlparse(absolute)
                path = parsed.path.lower()
                if parsed.netloc and urlparse(SITE_BASE_URL).netloc not in parsed.netloc:
                    continue
                if "-songs" not in path:
                    continue
                if any(fragment in path for fragment in ("/tamil-songs", "/movie-index", "/tag/", "/browse-by-year/", "/search", "/playlists", "-mp3-song", "/downloader/")):
                    continue
                if absolute not in seen:
                    seen.add(absolute)
                    urls.append(absolute)
        return urls

    def discover_movie_index_sections(self, report: dict[str, Any] | None = None) -> dict[str, list[str]]:
        movie_index_url = f"{SITE_BASE_URL}{self.movie_index_path}"
        alphabet = [f"{SITE_BASE_URL}/tag/0-9"]
        alphabet.extend(f"{SITE_BASE_URL}/tag/{character}" for character in "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        years = [f"{SITE_BASE_URL}/browse-by-year/{year}" for year in range(MOVIE_INDEX_MAX_YEAR, MOVIE_INDEX_MIN_YEAR - 1, -1)]

        try:
            html = self.fetch_html(movie_index_url, kind="listing")
            soup = BeautifulSoup(html, "lxml")
            for anchor in soup.select("a[href]"):
                href = anchor.get("href", "")
                absolute = canonicalize_url(urljoin(movie_index_url, href))
                if "/tag/" in absolute and absolute not in alphabet:
                    alphabet.append(absolute)
                elif "/browse-by-year/" in absolute and absolute not in years:
                    years.append(absolute)
        except ChallengeError as exc:
            print("[scrape:index] movie-index landing page limited; falling back to generated sections")
            self._record_issue(report, "challenged_pages", phase="movie-index", url=movie_index_url, reason=str(exc))
        except Exception as exc:
            print(f"[scrape:index] movie-index landing page failed: {exc}")
            self._record_issue(report, "failed_pages", phase="movie-index", url=movie_index_url, reason=str(exc))

        return {"landing": [movie_index_url], "alphabet": alphabet, "years": years}

    def _section_page_url(self, section_url: str, page_number: int) -> str:
        parsed = urlparse(section_url)
        query = parse_qs(parsed.query)
        if "/tag/" in parsed.path:
            query["page"] = [str(page_number)]
        elif page_number <= 1:
            query.pop("page", None)
        else:
            query["page"] = [str(page_number)]
        return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))

    def _section_pattern(self, section_url: str) -> str:
        parsed = urlparse(section_url)
        return f"{parsed.path}?page={{page}}"

    def discover_index_section_page(self, section_url: str, page_number: int = 1) -> tuple[list[str], int]:
        page_url = self._section_page_url(section_url, page_number)
        html = self.fetch_html(page_url, referer=f"{SITE_BASE_URL}{self.movie_index_path}", kind="listing")
        soup = BeautifulSoup(html, "lxml")
        urls = self._album_urls_from_soup(soup, page_url)
        max_page = page_number
        prefix = section_url.split("?", 1)[0]
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            absolute = urljoin(page_url, href)
            if not absolute.startswith(prefix):
                continue
            parsed = urlparse(absolute)
            page_value = parse_qs(parsed.query).get("page", [None])[0]
            if page_value and page_value.isdigit():
                max_page = max(max_page, int(page_value))
        return urls, max_page

    def _labeled_value(self, soup: BeautifulSoup, labels: list[str]) -> str | None:
        for bold in soup.select("b"):
            label = normalize(bold.get_text())
            for wanted in labels:
                if label.lower() == f"{wanted.lower()}:":
                    values: list[str] = []
                    for sibling in bold.next_siblings:
                        if getattr(sibling, "name", None) == "br":
                            break
                        text = normalize(sibling.get_text(" ", strip=True) if hasattr(sibling, "get_text") else str(sibling))
                        if text:
                            values.append(text)
                    if values:
                        return normalize(" ".join(values))
        return None

    def _year(self, value: str | None) -> int | None:
        if not value:
            return None
        match = re.search(r"(19|20)\d{2}", value)
        return int(match.group(0)) if match else None

    def _track_links(self, track_detail_url: str, referer: str | None = None) -> dict[str, str]:
        html = self.fetch_html(track_detail_url, referer=referer)
        soup = BeautifulSoup(html, "lxml")
        links: dict[str, str] = {}
        for anchor in soup.select("a[href]"):
            href = anchor.get("href")
            if not href:
                continue
            absolute = urljoin(track_detail_url, href)
            if "/downloader/" not in absolute:
                continue
            text = normalize(anchor.get_text()).lower()
            if "zip" in text:
                continue
            if "320" in text and "320" not in links:
                links["320"] = absolute
            elif "128" in text and "128" not in links:
                links["128"] = absolute
            elif "default" not in links:
                links["default"] = absolute
            if "320" in links and "128" in links:
                break
        return links

    def _song_image(self, block: Any, album_url: str, album_image: str | None) -> str | None:
        image = block.select_one("img[src], source[srcset]")
        if image:
            candidate = image.get("src") or image.get("srcset", "").split(" ")[0]
            if candidate:
                return urljoin(album_url, candidate)
        return album_image

    def _row_track_links(self, row: Any, album_url: str) -> dict[str, str]:
        links: dict[str, str] = {}
        for anchor in row.select("a.dlink[href]"):
            href = anchor.get("href")
            if not href:
                continue
            absolute = urljoin(album_url, href)
            text = normalize(anchor.get_text(" ", strip=True)).lower()
            title = normalize(anchor.get("title", "")).lower()
            combined = f"{text} {title}"
            if "zip" in combined:
                continue
            if "320" in combined and "320" not in links:
                links["320"] = absolute
            elif "128" in combined and "128" not in links:
                links["128"] = absolute
            elif "default" not in links:
                links["default"] = absolute
        return links

    def _track_name_from_text(self, block: Any) -> str:
        for selector in ("h2", "h3", "[itemprop='name']", ".track-title", "a[title]"):
            node = block.select_one(selector)
            if node:
                text = normalize(node.get_text(" ", strip=True) or node.get("title", ""))
                if text and not text.lower().startswith("download "):
                    return text
        text = normalize(block.get_text(" ", strip=True))
        text = re.sub(r"\b(128kbps|320kbps|download song|free download)\b", "", text, flags=re.I)
        return normalize(text)

    def _heading_track_blocks(self, soup: BeautifulSoup) -> list[Any]:
        candidates = soup.select(".entry-content h2, .entry-content h3, article h2, article h3, main h2, main h3")
        blocks: list[Any] = []
        for node in candidates:
            text = normalize(node.get_text(" ", strip=True))
            lowered = text.lower()
            if not text:
                continue
            if lowered.startswith("download "):
                continue
            if "songs download masstamilan.com" in lowered:
                continue
            if lowered in {"movie information", "incoming search terms", "latest from masstamilan.com", "trending at masstamilan.com"}:
                continue
            blocks.append(node)
        return blocks

    def _adjacent_text(self, node: Any) -> str:
        values: list[str] = []
        for sibling in node.next_siblings:
            name = getattr(sibling, "name", None)
            if name in {"h1", "h2", "h3", "h4"}:
                break
            text = normalize(sibling.get_text(" ", strip=True) if hasattr(sibling, "get_text") else str(sibling))
            if text:
                values.append(text)
            if len(values) >= 6:
                break
        return normalize(" ".join(values))

    def _extract_inline_label(self, text: str, label: str) -> str | None:
        match = re.search(rf"{re.escape(label)}\s*:\s*(.+?)(?:\s+(?:Length|Downloads)\s*:|$)", text, flags=re.I)
        if not match:
            return None
        return normalize(match.group(1))

    def _album_title(self, soup: BeautifulSoup) -> str:
        selectors = (
            "h1",
            "meta[property='og:title']",
            "meta[name='title']",
            "title",
        )
        for selector in selectors:
            node = soup.select_one(selector)
            if not node:
                continue
            if node.name == "meta":
                candidate = normalize(node.get("content", ""))
            else:
                candidate = normalize(node.get_text(" ", strip=True))
            candidate = re.sub(r"\s+tamil mp3 songs.*$", "", candidate, flags=re.I).strip(" -|")
            if candidate:
                return candidate
        return ""

    def parse_album(self, album_url: str, *, polite_delay: bool = True) -> ScrapedAlbum:
        html = self.fetch_html(album_url, referer=f"{SITE_BASE_URL}{SITE_LIST_PATH}", polite_delay=polite_delay)
        soup = BeautifulSoup(html, "lxml")
        album_url = canonicalize_url(album_url)
        album_name = self._album_title(soup)
        image = soup.select_one("meta[property='og:image']")
        album_image = urljoin(album_url, image.get("content")) if image and image.get("content") else None
        if not album_image:
            image_node = soup.select_one(".entry-content img[src], article img[src], .post img[src]")
            if image_node and image_node.get("src"):
                album_image = urljoin(album_url, image_node.get("src"))
        artist = self._labeled_value(soup, ["Starring", "Cast", "Artist"])
        music_director = self._labeled_value(soup, ["Music", "Music Director", "Composer", "Director", "Artists"])
        year = self._year(self._labeled_value(soup, ["Year", "Released", "Release Date"]))
        language = self._labeled_value(soup, ["Language", "Category"])

        songs: list[ScrapedSong] = []
        row_blocks = soup.select('table#tl tr[itemprop="itemListElement"], table tr[itemprop="itemListElement"]')
        music_blocks = row_blocks if row_blocks else soup.select(
            'span[itemtype="http://schema.org/MusicRecording"], li[itemprop="itemListElement"], .tracklist li, .entry-content li'
        )
        if not music_blocks:
            music_blocks = self._heading_track_blocks(soup)
        for idx, block in enumerate(music_blocks, start=1):
            block_scope = block.select_one('span[itemtype="http://schema.org/MusicRecording"]') if row_blocks else block
            block_scope = block_scope or block
            track_name = self._track_name_from_text(block_scope)
            if not track_name or track_name.lower().startswith("download "):
                continue
            if len(track_name) < 2:
                continue
            detail_link = block_scope.select_one('link[itemprop="url"]')
            anchor = block_scope.select_one("a[href]")
            track_detail_url = None
            if detail_link and detail_link.get("href"):
                track_detail_url = urljoin(album_url, detail_link.get("href"))
            elif anchor and anchor.get("href"):
                track_detail_url = urljoin(album_url, anchor.get("href"))
            singers_node = block_scope.select_one('[itemprop="byArtist"]')
            adjacent_text = self._adjacent_text(block_scope)
            links = self._row_track_links(block, album_url) if row_blocks else {}
            if not links and track_detail_url:
                links = self._track_links(track_detail_url, referer=album_url)
            inline_image = self._song_image(block_scope, album_url, album_image)
            songs.append(
                ScrapedSong(
                    track_name=track_name,
                    track_number=idx,
                    singers=normalize(singers_node.get_text(" ", strip=True)) if singers_node else self._extract_inline_label(adjacent_text, "Singers") or artist,
                    image_url=inline_image,
                    url_128kbps=links.get("128"),
                    url_320kbps=links.get("320") or links.get("default"),
                )
            )

        if not album_name or not songs:
            raise ValueError(f"Album page did not contain expected metadata for {album_url}")

        return ScrapedAlbum(
            album_url=album_url,
            album_id=make_album_id(album_url, album_name),
            album_name=album_name,
            year=year,
            music_director=music_director,
            singers_summary=artist,
            image_url=album_image,
            language=language,
            songs=songs,
        )

    def _process_album_urls(
        self,
        album_urls: list[str],
        *,
        phase: str,
        report: dict[str, Any] | None = None,
        workers: int = 4,
        batch_size: int = 16,
        dry_run: bool = False,
    ) -> dict[str, int]:
        phase_report = self._phase_report(report, phase)
        unique_urls = list(dict.fromkeys(canonicalize_url(url) for url in album_urls))
        counts = {
            "albums_discovered": len(unique_urls),
            "albums_added": 0,
            "albums_updated": 0,
            "albums_failed": 0,
            "albums_skipped": 0,
            "tracks_added": 0,
            "tracks_updated": 0,
            "tracks_skipped": 0,
            "songs_total": 0,
        }
        if not unique_urls:
            return counts

        worker_count = max(1, min(workers, len(unique_urls)))
        bounded_batch_size = max(1, batch_size)
        for batch_start in range(0, len(unique_urls), bounded_batch_size):
            batch = unique_urls[batch_start : batch_start + bounded_batch_size]
            with ThreadPoolExecutor(max_workers=min(worker_count, len(batch)), thread_name_prefix=f"{phase}-album") as executor:
                future_map = {executor.submit(self.parse_album, album_url): album_url for album_url in batch}
                for future in as_completed(future_map):
                    album_url = future_map[future]
                    try:
                        album = future.result()
                    except ChallengeError as exc:
                        counts["albums_failed"] += 1
                        self._record_issue(report, "challenged_albums", phase=phase, url=album_url, reason=str(exc))
                        print(f"[scrape:{phase}] album limited {album_url}: {exc}")
                        continue
                    except Exception as exc:
                        counts["albums_failed"] += 1
                        self._record_issue(report, "failed_albums", phase=phase, url=album_url, reason=str(exc))
                        print(f"[scrape:{phase}] album failed {album_url}: {exc}")
                        continue

                    if dry_run:
                        counts["albums_skipped"] += 1
                        counts["tracks_skipped"] += len(album.songs)
                        print(f"[scrape:{phase}] album parsed (dry-run): {album.album_name} ({len(album.songs)} songs)")
                        continue

                    result = upsert_album_details(album)
                    if result.album_is_new:
                        counts["albums_added"] += 1
                    else:
                        counts["albums_updated"] += 1
                    counts["tracks_added"] += result.songs_added
                    counts["tracks_updated"] += result.songs_updated
                    counts["songs_total"] += result.songs_seen
                    print(
                        f"[scrape:{phase}] album parsed: {album.album_name} "
                        f"(songs={result.songs_seen}, added={result.songs_added}, updated={result.songs_updated})"
                    )

        if phase_report is not None:
            for key, value in counts.items():
                phase_report[key] = phase_report.get(key, 0) + value
        return counts

    def refresh_album(self, album_url: str, *, polite_delay: bool = True) -> ScrapedAlbum:
        lock = self.refresh_locks.setdefault(album_url, threading.Lock())
        with lock:
            return self.parse_album(album_url, polite_delay=polite_delay)

    def scrape_album_url(self, album_url: str) -> ScrapedAlbum:
        return self.parse_album(album_url)

    def refresh_album_urls(
        self,
        album_urls: list[str],
        *,
        phase: str = "retry",
        workers: int = 4,
        batch_size: int = 16,
        report: dict[str, Any] | None = None,
        dry_run: bool = False,
    ) -> dict[str, int]:
        return self._process_album_urls(
            album_urls,
            phase=phase,
            report=report,
            workers=workers,
            batch_size=batch_size,
            dry_run=dry_run,
        )

    def rescrape_catalog(
        self,
        batch_size: int = 20,
        *,
        workers: int = 4,
        report: dict[str, Any] | None = None,
        dry_run: bool = False,
        max_count: int | None = None,
    ) -> ScrapeSummary:
        run_id = create_scrape_run()
        if max_count and max_count > 0:
            from .repository import list_album_urls_for_rescrape
            album_urls = list_album_urls_for_rescrape(max_count)
            if not album_urls:
                # Fallback: no metadata to prioritise on (fresh DB?). Use the
                # oldest-first ordering capped at max_count.
                album_urls = list_album_urls()[:max_count]
        else:
            album_urls = list_album_urls()
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        phase_report = self._phase_report(report, "catalog_rescrape")
        try:
            total = len(album_urls)
            if total == 0:
                raise RuntimeError("No existing album URLs are available for full catalog rescrape")

            if phase_report is not None:
                phase_report["albums_targeted"] = total

            cap_note = f" (capped at {max_count})" if max_count and max_count > 0 else ""
            print(f"INFO - Catalog rescrape: refreshing {total} known albums{cap_note}")
            counts = self._process_album_urls(
                album_urls,
                phase="catalog_rescrape",
                report=report,
                workers=workers,
                batch_size=batch_size,
                dry_run=dry_run,
            )
            albums_new = counts["albums_added"]
            albums_updated = counts["albums_updated"]
            albums_failed = counts["albums_failed"]
            songs_total = counts["songs_total"]
            if albums_new + albums_updated == 0 and not dry_run:
                raise RuntimeError("Full catalog rescrape did not refresh any albums")
            if albums_failed > 0 and (albums_new + albums_updated) > 0:
                status = "warning"
            return ScrapeSummary(
                run_id=run_id,
                pages_scraped=0,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )
        except Exception:
            status = "failed"
            raise
        finally:
            finish_scrape_run(
                run_id,
                pages_scraped=0,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )

    def scrape_site(
        self,
        page_from: int = 1,
        page_to: int | None = None,
        *,
        incremental: bool = False,
        full_scan: bool = False,
        workers: int = 4,
        batch_size: int = 16,
        report: dict[str, Any] | None = None,
        dry_run: bool = False,
    ) -> ScrapeSummary:
        configured_last_page = page_to or SITE_MAX_PAGES
        run_id = create_scrape_run()
        pages_scraped = 0
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        phase_report = self._phase_report(report, "pagewise")
        consecutive_empty_pages = 0
        consecutive_known_pages = 0
        page_number = page_from
        discovered_last_page = configured_last_page
        reached_any_page = False
        try:
            while page_number <= discovered_last_page:
                page_url = f"{SITE_BASE_URL}{SITE_LIST_PATH}?page={page_number}"
                try:
                    urls, max_page, has_next = self.discover_listing_page(page_number)
                    reached_any_page = True
                except ChallengeError as exc:
                    self._record_issue(report, "challenged_pages", phase="listing", url=page_url, reason=str(exc), page=page_number)
                    print(f"[scrape:listing] page limited page={page_number}: {exc}")
                    if page_number == page_from == 1 and not reached_any_page and self.abort_on_page1_limited:
                        message = "Listing crawl aborted: page 1 remained limited after bounded retries"
                        print(f"[scrape:listing] {message}")
                        if report is not None:
                            report.setdefault("warnings", []).append(message)
                            report["blocked"] = True
                            report["partial"] = True
                        raise RuntimeError(message)
                    if self._check_listing_streak():
                        message = (
                            f"Listing crawl aborted: {self.listing_challenge_streak} "
                            f"consecutive limited pages (limit "
                            f"{self.max_listing_challenge_streak})"
                        )
                        print(f"[scrape:listing] {message}")
                        if report is not None:
                            report.setdefault("warnings", []).append(message)
                            report["blocked"] = True
                            report["partial"] = True
                        status = "warning"
                        break
                    page_number += 1
                    continue
                except Exception as exc:
                    self._record_issue(report, "failed_pages", phase="listing", url=page_url, reason=str(exc), page=page_number)
                    print(f"[scrape:listing] page failed page={page_number}: {exc}")
                    page_number += 1
                    continue

                discovered_last_page = min(configured_last_page, max(discovered_last_page, max_page))
                if not urls:
                    consecutive_empty_pages += 1
                    if not has_next or consecutive_empty_pages >= 2:
                        break
                    page_number += 1
                    continue

                consecutive_empty_pages = 0
                pages_scraped += 1
                known = known_album_urls(urls)
                new_on_page = max(len(urls) - len(known), 0)
                print(f"INFO - Listing page {page_number}: {len(urls)} albums, {new_on_page} new")
                if phase_report is not None:
                    phase_report["pages_scanned"] = phase_report.get("pages_scanned", 0) + 1
                if incremental and not full_scan:
                    if new_on_page == 0:
                        consecutive_known_pages += 1
                    else:
                        consecutive_known_pages = 0
                    if consecutive_known_pages >= max(1, self.stop_after_known_pages):
                        print(
                            "[scrape:listing] stopping early after "
                            f"{consecutive_known_pages} consecutive known page(s)"
                        )
                        break

                process_urls = urls if full_scan else [url for url in urls if canonicalize_url(url) not in known]
                counts = self._process_album_urls(
                    process_urls,
                    phase="pagewise",
                    report=report,
                    workers=workers,
                    batch_size=batch_size,
                    dry_run=dry_run,
                )
                albums_new += counts["albums_added"]
                albums_updated += counts["albums_updated"]
                albums_failed += counts["albums_failed"]
                songs_total += counts["songs_total"]

                if not has_next and page_number >= max_page:
                    break
                page_number += 1

            if not reached_any_page:
                raise RuntimeError("Listing discovery could not reach any pages")
            if full_scan and pages_scraped == 0:
                raise RuntimeError("Full listing scan completed without scraping any pages")
            if albums_failed > 0 and (albums_new + albums_updated) > 0:
                status = "warning"
            return ScrapeSummary(
                run_id=run_id,
                pages_scraped=pages_scraped,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )
        except Exception:
            status = "failed"
            raise
        finally:
            finish_scrape_run(
                run_id,
                pages_scraped=pages_scraped,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )

    def scrape_movie_index(
        self,
        *,
        include_alphabet: bool = True,
        include_years: bool = True,
        incremental: bool = False,
        full_scan: bool = False,
        max_section_pages: int | None = None,
        workers: int = 4,
        batch_size: int = 16,
        report: dict[str, Any] | None = None,
        dry_run: bool = False,
    ) -> ScrapeSummary:
        run_id = create_scrape_run()
        pages_scraped = 0
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        phase_report = self._phase_report(report, "movie_index")
        reached_any_page = False
        challenge_aborted = False
        consecutive_known_pages = 0
        try:
            sections = self.discover_movie_index_sections(report=report)
            targets: list[tuple[str, str]] = []
            if include_alphabet:
                targets.extend(("section", url) for url in sections["alphabet"])
            if include_years:
                targets.extend(("year", url) for url in sections["years"])
            targets.extend(("landing", url) for url in sections["landing"])

            for section_type, section_url in targets:
                if challenge_aborted:
                    break
                page_number = 1
                discovered_max_page = 1
                section_new_total = 0
                section_label = urlparse(section_url).path
                if section_type == "section":
                    log_info(f"Starting discovery on pattern: {self._section_pattern(section_url)}...")
                while True:
                    if max_section_pages and page_number > max_section_pages:
                        break
                    page_url = self._section_page_url(section_url, page_number)
                    if section_type == "section":
                        log_info(f"  Fetching listing page {page_number}: {page_url}")
                    try:
                        urls, max_page = self.discover_index_section_page(section_url, page_number)
                        reached_any_page = True
                        discovered_max_page = max(discovered_max_page, max_page)
                    except ChallengeError as exc:
                        self._record_issue(
                            report,
                            "challenged_pages",
                            phase=section_type,
                            url=page_url,
                            reason=str(exc),
                            page=page_number,
                            section=section_label,
                        )
                        print(f"[scrape:index] section limited {section_url} page={page_number}: {exc}")
                        if self._check_listing_streak():
                            message = (
                                f"Movie-index crawl aborted: "
                                f"{self.listing_challenge_streak} consecutive "
                                f"limited pages (limit "
                                f"{self.max_listing_challenge_streak})"
                            )
                            print(f"[scrape:index] {message}")
                            if report is not None:
                                report.setdefault("warnings", []).append(message)
                            status = "warning"
                            challenge_aborted = True
                            break
                        if page_number >= discovered_max_page:
                            break
                        page_number += 1
                        continue
                    except Exception as exc:
                        if section_type == "section" and "HTTP 404" in str(exc):
                            log_info(f"  -> Page {page_number} returned 404. Reached end of category.")
                            break
                        self._record_issue(
                            report,
                            "failed_pages",
                            phase=section_type,
                            url=page_url,
                            reason=str(exc),
                            page=page_number,
                            section=section_label,
                        )
                        print(f"[scrape:index] section failed {section_url} page={page_number}: {exc}")
                        if page_number >= discovered_max_page:
                            break
                        page_number += 1
                        continue

                    if not urls:
                        break

                    pages_scraped += 1
                    known = known_album_urls(urls)
                    if phase_report is not None:
                        phase_report["pages_scanned"] = phase_report.get("pages_scanned", 0) + 1
                        page_key = {
                            "landing": "movie_index_pages_scanned",
                            "section": "section_pages_scanned",
                            "year": "year_pages_scanned",
                        }[section_type]
                        phase_report[page_key] = phase_report.get(page_key, 0) + 1

                    new_on_page = max(len(urls) - len(known), 0)
                    if section_type == "section":
                        section_new_total += new_on_page
                    if section_type == "landing":
                        log_info(f"Movie index page {page_number}: {len(urls)} albums, {new_on_page} new")
                    elif section_type == "section":
                        log_info(f"  Page {page_number}: {new_on_page} new / {len(urls)} total")
                    else:
                        year_name = section_label.rsplit("/", 1)[-1]
                        log_info(f"Year {year_name} page {page_number}: {len(urls)} albums, {new_on_page} new")

                    if incremental and not full_scan:
                        if new_on_page == 0:
                            consecutive_known_pages += 1
                        else:
                            consecutive_known_pages = 0
                        if consecutive_known_pages >= max(1, self.movie_index_stop_after_known_pages):
                            print(
                                "[scrape:index] movie-index crawl stopped after "
                                f"{consecutive_known_pages} consecutive pages with no new albums."
                            )
                            challenge_aborted = True
                            break

                    process_urls = urls if full_scan else [url for url in urls if canonicalize_url(url) not in known]
                    counts = self._process_album_urls(
                        process_urls,
                        phase="movie_index",
                        report=report,
                        workers=workers,
                        batch_size=batch_size,
                        dry_run=dry_run,
                    )
                    albums_new += counts["albums_added"]
                    albums_updated += counts["albums_updated"]
                    albums_failed += counts["albums_failed"]
                    songs_total += counts["songs_total"]

                    if page_number >= discovered_max_page:
                        break
                    page_number += 1

                if section_type == "section":
                    log_info(f"Discovery done: {section_new_total} total new album(s) discovered.")

            if not reached_any_page and full_scan:
                raise RuntimeError("Full movie-index scan completed without scraping any pages")
            if albums_failed > 0 and (albums_new + albums_updated) > 0:
                status = "warning"
            return ScrapeSummary(
                run_id=run_id,
                pages_scraped=pages_scraped,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )
        except Exception:
            status = "failed"
            raise
        finally:
            finish_scrape_run(
                run_id,
                pages_scraped=pages_scraped,
                albums_new=albums_new,
                albums_updated=albums_updated,
                albums_failed=albums_failed,
                songs_total=songs_total,
                status=status,
            )


site_scraper = SiteScraper()
