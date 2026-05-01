#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import cloudscraper
from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential


class ChallengeError(Exception):
    pass


BASE_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "upgrade-insecure-requests": "1",
}


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def slugify(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def parse_duration_to_seconds(value: str | None) -> int | None:
    if not value:
      return None
    match = re.match(r"^(\d+):(\d{2})$", value.strip())
    if not match:
      return None
    return int(match.group(1)) * 60 + int(match.group(2))


def is_challenge_page(text: str) -> bool:
    lowered = text.lower()
    return "just a moment" in lowered or "enable javascript and cookies to continue" in lowered


def canonicalize_album_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))


class HttpScraper:
    def __init__(self) -> None:
        self.scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "darwin", "mobile": False}
        )
        self.scraper.headers.update(BASE_HEADERS)
        self.curl_session = curl_requests.Session(impersonate="chrome124")
        self.curl_session.headers.update(BASE_HEADERS)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1.5, min=1, max=12),
        retry=retry_if_exception_type((ChallengeError, OSError, ValueError)),
        reraise=True,
    )
    def fetch_html(self, url: str) -> str:
        response = self.scraper.get(url, timeout=30)
        html = response.text
        if response.status_code >= 400 or is_challenge_page(html):
            curl_response = self.curl_session.get(url, timeout=30)
            html = curl_response.text
            if curl_response.status_code >= 400 or is_challenge_page(html):
                raise ChallengeError(f"Challenge page detected for {url}")
        return html

    def discover_listing(self, url: str) -> dict[str, Any]:
        html = self.fetch_html(url)
        soup = BeautifulSoup(html, "lxml")
        urls: list[str] = []
        seen: set[str] = set()
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            if "-songs" not in href or "/tamil-songs" in href:
                continue
            absolute = canonicalize_album_url(urljoin(url, href))
            if absolute not in seen:
                seen.add(absolute)
                urls.append(absolute)
        return {"urls": urls}

    def parse_album(self, url: str) -> dict[str, Any]:
        html = self.fetch_html(url)
        soup = BeautifulSoup(html, "lxml")
        canonical_url = canonicalize_album_url(url)
        heading = soup.select_one("h1")
        title = normalize_whitespace(heading.get_text() if heading else "")
        if not title:
            title = normalize_whitespace((soup.title.string if soup.title and soup.title.string else "").split("Tamil mp3 songs")[0])
        body_text = normalize_whitespace(soup.get_text(" ", strip=True))
        artist = self.extract_labeled_value(soup, ["Starring", "Cast", "Artist"]) or self.extract_fact(body_text, ["Starring", "Cast", "Artist"]) or "Unknown Artist"
        music_director = self.extract_labeled_value(soup, ["Music", "Music Director", "Composer"]) or self.extract_fact(body_text, ["Music", "Music Director", "Composer"])
        director = self.extract_labeled_value(soup, ["Director"]) or self.extract_fact(body_text, ["Director"])
        lyricists = self.extract_labeled_value(soup, ["Lyricists", "Lyrics"]) or self.extract_fact(body_text, ["Lyricists", "Lyrics"])
        language = self.extract_labeled_value(soup, ["Language"]) or self.extract_fact(body_text, ["Language"])
        year = self.extract_year(self.extract_labeled_value(soup, ["Year", "Released"]) or self.extract_fact(body_text, ["Year", "Released"]))
        image = soup.select_one("img")
        artwork_url = urljoin(url, image.get("src")) if image and image.get("src") else None

        songs: list[dict[str, Any]] = []
        for index, container in enumerate(soup.select('span[itemtype="http://schema.org/MusicRecording"]'), start=1):
            title_node = container.select_one("h2")
            raw_title = normalize_whitespace(title_node.get_text(" ", strip=True) if title_node else "")
            if not raw_title or raw_title.lower().startswith("download "):
                continue
            link_tag = container.select_one('link[itemprop="url"]')
            anchor = container.select_one("a[href]")
            track_detail_url = None
            if link_tag and link_tag.get("href"):
                track_detail_url = urljoin(url, link_tag.get("href"))
            elif anchor and anchor.get("href"):
                track_detail_url = urljoin(url, anchor.get("href"))

            section_text = normalize_whitespace(container.get_text(" ", strip=True))
            singers_node = container.select_one('[itemprop="byArtist"]')
            duration_node = container.select_one('[itemprop="duration"]')
            singers = normalize_whitespace(singers_node.get_text(" ", strip=True)) if singers_node else self.extract_fact(section_text, ["Singer", "Singers"])
            duration = (
                parse_duration_to_seconds(normalize_whitespace(duration_node.get_text(" ", strip=True)))
                if duration_node
                else parse_duration_to_seconds(self.extract_fact(section_text, ["Length", "Duration"]))
            )
            audio_links = self.fetch_track_audio_links(track_detail_url) if track_detail_url else {}
            songs.append(
                {
                    "title": raw_title,
                    "artist": artist,
                    "singers": singers,
                    "composer": music_director,
                    "year": year,
                    "durationSeconds": duration,
                    "trackNumber": index,
                    "sourcePageUrl": canonical_url,
                    "upstreamUrl": audio_links.get("320") or audio_links.get("128") or audio_links.get("default"),
                    "audio128Url": audio_links.get("128"),
                    "audio320Url": audio_links.get("320"),
                    "audioLinksJson": json.dumps(audio_links) if audio_links else None,
                    "artworkUrl": artwork_url,
                    "lyricsBy": lyricists,
                }
            )

        return {
            "slug": slugify(title),
            "title": title,
            "artist": artist,
            "musicDirector": music_director,
            "director": director,
            "lyricists": lyricists,
            "year": year,
            "language": language,
            "sourceUrl": canonical_url,
            "artworkUrl": artwork_url,
            "trackCount": len(songs),
            "songs": songs,
        }

    def fetch_track_audio_links(self, url: str) -> dict[str, str]:
        html = self.fetch_html(url)
        soup = BeautifulSoup(html, "lxml")
        audio_links: dict[str, str] = {}
        for anchor in soup.select("a[href]"):
            href = anchor.get("href")
            if not href:
                continue
            absolute = urljoin(url, href)
            if "/downloader/" not in absolute:
                continue
            text = normalize_whitespace(anchor.get_text()).lower()
            if "zip" in text:
                continue
            if "320" in text and "320" not in audio_links:
                audio_links["320"] = absolute
            elif "128" in text and "128" not in audio_links:
                audio_links["128"] = absolute
            elif "default" not in audio_links:
                audio_links["default"] = absolute
            if "320" in audio_links and "128" in audio_links:
                break
        return audio_links

    def extract_fact(self, text: str, labels: list[str]) -> str | None:
        for label in labels:
            match = re.search(rf"{re.escape(label)}:\s*([^\n|]+)", text, re.IGNORECASE)
            if match:
                return normalize_whitespace(match.group(1))
        return None

    def extract_labeled_value(self, soup: BeautifulSoup, labels: list[str]) -> str | None:
        for bold in soup.select("b"):
            label = normalize_whitespace(bold.get_text())
            for target in labels:
                if label.lower() == f"{target.lower()}:":
                    values: list[str] = []
                    for sibling in bold.next_siblings:
                        if getattr(sibling, "name", None) == "br":
                            break
                        text = (
                            normalize_whitespace(sibling.get_text(" ", strip=True))
                            if hasattr(sibling, "get_text")
                            else normalize_whitespace(str(sibling))
                        )
                        if text:
                            values.append(text)
                    if values:
                        return normalize_whitespace(" ".join(values))
        return None

    def extract_year(self, value: str | None) -> int | None:
        if not value:
            return None
        match = re.search(r"(19|20)\d{2}", value)
        return int(match.group(0)) if match else None


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    discover = sub.add_parser("discover-listing")
    discover.add_argument("--url", required=True)

    album = sub.add_parser("parse-album")
    album.add_argument("--url", required=True)

    args = parser.parse_args()
    scraper = HttpScraper()

    if args.command == "discover-listing":
        payload = scraper.discover_listing(args.url)
    else:
        payload = scraper.parse_album(args.url)

    sys.stdout.write(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
