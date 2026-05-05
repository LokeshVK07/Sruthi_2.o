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

from .config import SCRAPER_DELAY_SECONDS, SITE_BASE_URL, SITE_LIST_PATH, SITE_MAX_PAGES
from .repository import create_scrape_run, finish_scrape_run, known_album_urls, make_album_id, upsert_album
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
                raise ChallengeError(f"Challenge page detected for {url}")
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
        url = f"{SITE_BASE_URL}/movie-index"
        html = self.fetch_html(url)
        soup = BeautifulSoup(html, "lxml")
        alphabet: list[str] = []
        years: list[str] = []
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            absolute = canonicalize_url(urljoin(url, href))
            if "/tag/" in absolute and absolute not in alphabet:
                alphabet.append(absolute)
            elif "/browse-by-year/" in absolute and absolute not in years:
                years.append(absolute)
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
                except Exception:
                    break
                if not urls:
                    break
                pages_scraped += 1
                known = known_album_urls(urls)
                print(f"[scrape] listing {page_number}: discovered={len(urls)} known={len(known)}")
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
                    print(
                        f"[scrape:index] section {section_label} page={page_number}: "
                        f"discovered={len(urls)} known={len(known)} max_page={max_page}"
                    )
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
