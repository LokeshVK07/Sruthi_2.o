from __future__ import annotations

import json
import re
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import cloudscraper
from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import (
    MOVIE_INDEX_MAX_YEAR,
    MOVIE_INDEX_MIN_YEAR,
    SCRAPER_DELAY_SECONDS,
    SCRAPER_PLAYWRIGHT_ENABLED,
    SCRAPER_PLAYWRIGHT_TIMEOUT_MS,
    SITE_BASE_URL,
    SITE_LIST_PATH,
    SITE_MAX_PAGES,
)
from .repository import (
    create_scrape_run,
    finish_scrape_run,
    known_album_urls,
    list_album_urls,
    make_album_id,
    upsert_album,
)
from .schemas import ScrapedAlbum, ScrapedSong, ScrapeSummary
from .utils import canonicalize_url


class ChallengeError(Exception):
    pass


HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_duration(value: str | None) -> int | None:
    if not value:
        return None
    match = re.match(r"^(\d+):(\d{2})$", value.strip())
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def is_challenge_page(text: str) -> bool:
    lower = text.lower()
    return (
        "just a moment" in lower
        or "enable javascript and cookies to continue" in lower
        or "attention required" in lower
        or "cloudflare" in lower and "verify you are human" in lower
        or "access denied" in lower
    )


class SiteScraper:
    def __init__(self) -> None:
        self.scraper = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "darwin", "mobile": False})
        self.scraper.headers.update(HEADERS)
        self.curl = curl_requests.Session(impersonate="chrome124")
        self.curl.headers.update(HEADERS)
        self.refresh_locks: dict[str, threading.Lock] = {}
        self.playwright_lock = threading.Lock()
        self.playwright_runtime = None
        self.playwright_browser = None
        self.playwright_context = None
        self.playwright_page = None

    def _playwright_fetch(self, url: str, referer: str | None = None) -> str:
        if not SCRAPER_PLAYWRIGHT_ENABLED:
            raise ChallengeError(f"Challenge page detected for {url}")

        with self.playwright_lock:
            try:
                from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
                from playwright.sync_api import sync_playwright
            except Exception as exc:  # pragma: no cover - optional dependency path
                raise ChallengeError(f"Playwright is not available for {url}: {exc}") from exc

            if self.playwright_runtime is None:
                self.playwright_runtime = sync_playwright().start()
                self.playwright_browser = self.playwright_runtime.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                self.playwright_context = self.playwright_browser.new_context(
                    user_agent=HEADERS["user-agent"],
                    locale="en-US",
                )
                self.playwright_page = self.playwright_context.new_page()

            assert self.playwright_context is not None
            assert self.playwright_page is not None

            headers = {}
            if referer:
                headers["referer"] = referer
            self.playwright_context.set_extra_http_headers(headers)

            try:
                self.playwright_page.goto(url, wait_until="domcontentloaded", timeout=SCRAPER_PLAYWRIGHT_TIMEOUT_MS)
                try:
                    self.playwright_page.wait_for_load_state("networkidle", timeout=5000)
                except PlaywrightTimeoutError:
                    pass
                try:
                    self.playwright_page.wait_for_function(
                        """
                        () => {
                          const body = document.body ? document.body.innerText.toLowerCase() : "";
                          return !body.includes("just a moment") &&
                                 !body.includes("verify you are human") &&
                                 !body.includes("attention required");
                        }
                        """,
                        timeout=SCRAPER_PLAYWRIGHT_TIMEOUT_MS,
                    )
                except PlaywrightTimeoutError:
                    pass
                html = self.playwright_page.content()
            except Exception as exc:
                raise ChallengeError(f"Playwright fetch failed for {url}: {exc}") from exc

        if is_challenge_page(html):
            raise ChallengeError(f"Challenge page detected for {url}")
        return html

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1.5, min=1, max=12),
        retry=retry_if_exception_type((ChallengeError, OSError, ValueError)),
        reraise=True,
    )
    def fetch_html(self, url: str, referer: str | None = None) -> str:
        headers = HEADERS.copy()
        if referer:
            headers["referer"] = referer
        response = self.scraper.get(url, timeout=30, headers=headers)
        html = response.text
        if response.status_code >= 400 or is_challenge_page(html):
            curl_response = self.curl.get(url, timeout=30, headers=headers)
            html = curl_response.text
            if curl_response.status_code >= 400 or is_challenge_page(html):
                html = self._playwright_fetch(url, referer=referer)
        if SCRAPER_DELAY_SECONDS > 0:
            time.sleep(SCRAPER_DELAY_SECONDS)
        return html

    def discover_listing(self, page_number: int) -> list[str]:
        url = f"{SITE_BASE_URL}{SITE_LIST_PATH}?page={page_number}"
        html = self.fetch_html(url)
        soup = BeautifulSoup(html, "lxml")
        return self._album_urls_from_soup(soup, url)

    def _album_urls_from_soup(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        urls: list[str] = []
        seen: set[str] = set()
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            if "-songs" not in href or "/tamil-songs" in href:
                continue
            absolute = canonicalize_url(urljoin(base_url, href))
            if absolute not in seen:
                seen.add(absolute)
                urls.append(absolute)
        return urls

    def discover_movie_index_sections(self) -> dict[str, list[str]]:
        alphabet = [f"{SITE_BASE_URL}/tag/0-9"]
        alphabet.extend(f"{SITE_BASE_URL}/tag/{character}" for character in "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        years = [f"{SITE_BASE_URL}/browse-by-year/{year}" for year in range(MOVIE_INDEX_MAX_YEAR, MOVIE_INDEX_MIN_YEAR - 1, -1)]

        url = f"{SITE_BASE_URL}/movie-index"
        try:
            html = self.fetch_html(url)
            soup = BeautifulSoup(html, "lxml")
            for anchor in soup.select("a[href]"):
                href = anchor.get("href", "")
                absolute = canonicalize_url(urljoin(url, href))
                if "/tag/" in absolute and absolute not in alphabet:
                    alphabet.append(absolute)
                elif "/browse-by-year/" in absolute and absolute not in years:
                    years.append(absolute)
        except ChallengeError:
            print("[scrape:index] movie-index landing page challenged; falling back to generated sections")

        return {"alphabet": alphabet, "years": years}

    def _section_page_url(self, section_url: str, page_number: int) -> str:
        parsed = urlparse(section_url)
        query = parse_qs(parsed.query)
        if page_number <= 1:
            query.pop("page", None)
        else:
            query["page"] = [str(page_number)]
        return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))

    def discover_index_section_page(self, section_url: str, page_number: int = 1) -> tuple[list[str], int]:
        page_url = self._section_page_url(section_url, page_number)
        html = self.fetch_html(page_url, referer=f"{SITE_BASE_URL}/movie-index")
        soup = BeautifulSoup(html, "lxml")
        urls = self._album_urls_from_soup(soup, page_url)
        max_page = page_number
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            absolute = urljoin(page_url, href)
            if absolute.startswith(section_url.split("?", 1)[0]):
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

    def parse_album(self, album_url: str) -> ScrapedAlbum:
        html = self.fetch_html(album_url, referer=f"{SITE_BASE_URL}{SITE_LIST_PATH}")
        soup = BeautifulSoup(html, "lxml")
        album_url = canonicalize_url(album_url)
        album_name = normalize((soup.select_one("h1").get_text() if soup.select_one("h1") else ""))
        image = soup.select_one("meta[property='og:image']")
        album_image = urljoin(album_url, image.get("content")) if image and image.get("content") else None
        if not album_image:
            image_node = soup.select_one(".entry-content img[src], article img[src], .post img[src]")
            if image_node and image_node.get("src"):
                album_image = urljoin(album_url, image_node.get("src"))
        artist = self._labeled_value(soup, ["Starring", "Cast", "Artist"])
        music_director = self._labeled_value(soup, ["Music", "Music Director", "Composer"])
        year = self._year(self._labeled_value(soup, ["Year", "Released"]))
        language = self._labeled_value(soup, ["Language"])

        songs: list[ScrapedSong] = []
        row_blocks = soup.select('table#tl tr[itemprop="itemListElement"]')
        music_blocks = row_blocks if row_blocks else soup.select('span[itemtype="http://schema.org/MusicRecording"]')
        for idx, block in enumerate(music_blocks, start=1):
            block_scope = block.select_one('span[itemtype="http://schema.org/MusicRecording"]') if row_blocks else block
            block_scope = block_scope or block
            track_name = self._track_name_from_text(block_scope)
            if not track_name or track_name.lower().startswith("download "):
                continue
            detail_link = block_scope.select_one('link[itemprop="url"]')
            anchor = block_scope.select_one("a[href]")
            track_detail_url = None
            if detail_link and detail_link.get("href"):
                track_detail_url = urljoin(album_url, detail_link.get("href"))
            elif anchor and anchor.get("href"):
                track_detail_url = urljoin(album_url, anchor.get("href"))
            singers_node = block_scope.select_one('[itemprop="byArtist"]')
            links = self._row_track_links(block, album_url) if row_blocks else {}
            if not links and track_detail_url:
                links = self._track_links(track_detail_url, referer=album_url)
            inline_image = self._song_image(block_scope, album_url, album_image)
            songs.append(
                ScrapedSong(
                    track_name=track_name,
                    track_number=idx,
                    singers=normalize(singers_node.get_text(" ", strip=True)) if singers_node else artist,
                    image_url=inline_image,
                    url_128kbps=links.get("128"),
                    url_320kbps=links.get("320") or links.get("default"),
                )
            )

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

    def refresh_album(self, album_url: str) -> ScrapedAlbum:
        lock = self.refresh_locks.setdefault(album_url, threading.Lock())
        with lock:
            return self.parse_album(album_url)

    def scrape_album_url(self, album_url: str) -> ScrapedAlbum:
        return self.parse_album(album_url)

    def rescrape_catalog(self, batch_size: int = 20) -> ScrapeSummary:
        run_id = create_scrape_run()
        album_urls = list_album_urls()
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        try:
            total = len(album_urls)
            if total == 0:
                raise RuntimeError("No existing album URLs are available for full catalog rescrape")

            for batch_start in range(0, total, batch_size):
                batch = album_urls[batch_start : batch_start + batch_size]
                batch_number = batch_start // batch_size + 1
                print(f"INFO - Batch {batch_number} (refresh): Processing {len(batch)} albums...")
                for index, album_url in enumerate(batch, start=1):
                    print(f"INFO - [{index}/{len(batch)}] {album_url}")
                    try:
                        album = self.parse_album(album_url)
                        is_new, songs = upsert_album(album)
                        if is_new:
                            albums_new += 1
                        else:
                            albums_updated += 1
                        songs_total += songs
                        print(f"INFO - -> {album.album_name} | {songs} track(s)")
                    except Exception as exc:
                        albums_failed += 1
                        print(f"INFO - -> failed {album_url}: {exc}")

            if albums_new + albums_updated == 0:
                raise RuntimeError("Full catalog rescrape did not refresh any albums")

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

    def scrape_site(self, page_from: int = 1, page_to: int | None = None, incremental: bool = False, full_scan: bool = False) -> ScrapeSummary:
        page_to = page_to or SITE_MAX_PAGES
        run_id = create_scrape_run()
        pages_scraped = 0
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        try:
            for page_number in range(page_from, page_to + 1):
                try:
                    urls = self.discover_listing(page_number)
                except Exception as exc:
                    if full_scan:
                        raise RuntimeError(f"Listing discovery failed at page {page_number}: {exc}") from exc
                    break
                if not urls:
                    if full_scan and page_number == page_from:
                        raise RuntimeError("Listing discovery returned no albums on the first page during full scan")
                    break
                pages_scraped += 1
                known = known_album_urls(urls)
                print(f"INFO - Listing page {page_number}: {len(urls)} albums, {max(len(urls) - len(known), 0)} new")
                if incremental and not full_scan and len(urls) == len(known):
                    print(f"[scrape] stopping early at listing {page_number} because the full page is already known")
                    break
                for album_url in urls:
                    if incremental and not full_scan and canonicalize_url(album_url) in known:
                        continue
                    try:
                        album = self.parse_album(album_url)
                        is_new, songs = upsert_album(album)
                        if is_new:
                            albums_new += 1
                        else:
                            albums_updated += 1
                        songs_total += songs
                        print(f"[scrape] album parsed: {album.album_name} ({songs} songs)")
                    except Exception as exc:
                        albums_failed += 1
                        print(f"[scrape] album failed {album_url}: {exc}")
            if full_scan and pages_scraped == 0:
                raise RuntimeError("Full listing scan completed without scraping any pages")
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
        include_alphabet: bool = True,
        include_years: bool = True,
        incremental: bool = False,
        full_scan: bool = False,
        max_section_pages: int | None = None,
    ) -> ScrapeSummary:
        run_id = create_scrape_run()
        pages_scraped = 0
        albums_new = 0
        albums_updated = 0
        albums_failed = 0
        songs_total = 0
        status = "success"
        try:
            sections = self.discover_movie_index_sections()
            targets: list[str] = []
            if include_alphabet:
                targets.extend(sections["alphabet"])
            if include_years:
                targets.extend(sections["years"])

            for section_url in targets:
                page_number = 1
                section_label = urlparse(section_url).path
                while True:
                    if max_section_pages and page_number > max_section_pages:
                        break
                    try:
                        urls, max_page = self.discover_index_section_page(section_url, page_number)
                    except Exception as exc:
                        print(f"[scrape:index] section failed {section_url} page={page_number}: {exc}")
                        break
                    if not urls:
                        break
                    pages_scraped += 1
                    known = known_album_urls(urls)
                    print(f"INFO - Movie index page {page_number}: {len(urls)} albums, {max(len(urls) - len(known), 0)} new")
                    if incremental and not full_scan and len(urls) == len(known):
                        print(f"[scrape:index] stopping early for {section_label} page={page_number} because the full page is already known")
                        break
                    for album_url in urls:
                        if incremental and not full_scan and canonicalize_url(album_url) in known:
                            continue
                        try:
                            album = self.parse_album(album_url)
                            is_new, songs = upsert_album(album)
                            if is_new:
                                albums_new += 1
                            else:
                                albums_updated += 1
                            songs_total += songs
                            print(f"[scrape:index] album parsed: {album.album_name} ({songs} songs)")
                        except Exception as exc:
                            albums_failed += 1
                            print(f"[scrape:index] album failed {album_url}: {exc}")
                    if page_number >= max_page:
                        break
                    page_number += 1

            if full_scan and pages_scraped == 0:
                raise RuntimeError("Full movie-index scan completed without scraping any pages")

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
