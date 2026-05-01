from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterator
import wave
import io

import cloudscraper
from curl_cffi import requests as curl_requests

from .cache import (
    cache_path,
    cache_response_headers,
    cache_status,
    restore_shared_cache,
    store_shared_cache,
    temp_cache_path,
    trim_cache,
    validate_cache_file,
)
from .config import MIN_CACHE_FILE_BYTES
from .repository import get_song, song_status
from .scraper import site_scraper


download_locks: dict[str, threading.Lock] = {}
refresh_locks: dict[str, threading.Lock] = {}
executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="playback-cache")
ACCEPTED_TYPES = {"audio/mpeg", "audio/mp3", "audio/aac", "audio/ogg", "audio/wav", "application/octet-stream"}
http_client = curl_requests.Session(impersonate="chrome124")
cloud_client = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "darwin", "mobile": False})


def unavailable_silence_bytes(duration_seconds: float = 0.35, sample_rate: int = 8000) -> bytes:
    frame_count = max(1, int(sample_rate * duration_seconds))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


def _download_lock(song_id: str) -> threading.Lock:
    return download_locks.setdefault(song_id, threading.Lock())


def _refresh_lock(album_url: str) -> threading.Lock:
    return refresh_locks.setdefault(album_url, threading.Lock())


def _upstream_candidates(song) -> list[str]:
    candidates: list[str] = []
    for url in (song.url_320kbps, song.url_128kbps):
        if url and url not in candidates:
            candidates.append(url)
    return candidates


def _is_download_active(song_id: str) -> bool:
    lock = download_locks.get(song_id)
    return bool(lock and lock.locked())


def _valid_local_cache(song_id: str) -> Path | None:
    local_path = cache_path(song_id)
    if validate_cache_file(local_path):
        return local_path
    restored = restore_shared_cache(song_id)
    if restored and validate_cache_file(restored):
        return restored
    return None


def _build_upstream_headers(song, request_headers: dict[str, str], accept_encoding: str | None = "identity") -> dict[str, str]:
    headers = {
        "user-agent": "Mozilla/5.0 Vibe2o/1.0",
        "accept": "audio/*,*/*;q=0.8",
        "referer": song.album_url,
    }
    if accept_encoding:
        headers["accept-encoding"] = accept_encoding
    for key in ("range", "if-range", "if-modified-since", "if-none-match"):
        value = request_headers.get(key)
        if value:
            headers[key] = value
    return headers


def _open_upstream_candidates(song, chosen: str, request_headers: dict[str, str]):
    clients = [
        (
            "curl_identity",
            lambda: http_client.get(
                chosen,
                headers=_build_upstream_headers(song, request_headers, "identity"),
                stream=True,
                timeout=45,
            ),
        ),
        (
            "cloudscraper",
            lambda: cloud_client.get(
                chosen,
                headers=_build_upstream_headers(song, request_headers, None),
                stream=True,
                timeout=45,
            ),
        ),
        (
            "curl_default",
            lambda: http_client.get(
                chosen,
                headers=_build_upstream_headers(song, request_headers, None),
                stream=True,
                timeout=45,
            ),
        ),
    ]
    for source, opener in clients:
        try:
            yield source, opener()
        except Exception as exc:
            print(f"[stream] upstream client failed {song.song_id} via {source}: {exc}")


def _is_valid_audio_response(response) -> bool:
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    return response.status_code in (200, 206) and content_type in ACCEPTED_TYPES


def _looks_like_block_page(chunk: bytes) -> bool:
    prefix = chunk[:512].lower()
    invalid_markers = (
        b"<!doctype html",
        b"<html",
        b"<?xml",
        b"{\"detail\":",
        b"{\"ok\":false",
        b"just a moment",
        b"cloudflare",
    )
    return any(marker in prefix for marker in invalid_markers)


def _prime_audio_response(response):
    try:
        stream_iter = response.iter_content(chunk_size=65536)
        first_chunk = next((chunk for chunk in stream_iter if chunk), b"")
    except Exception as exc:
        response.close()
        raise RuntimeError(f"Failed reading upstream stream: {exc}") from exc

    if not first_chunk:
        response.close()
        raise RuntimeError("Upstream returned empty audio body")
    if _looks_like_block_page(first_chunk):
        response.close()
        raise RuntimeError("Blocked/challenge page masquerading as audio")
    return stream_iter, first_chunk


def _response_headers(response) -> dict[str, str]:
    headers: dict[str, str] = {"accept-ranges": response.headers.get("accept-ranges", "bytes")}
    for key in ("content-type", "content-length", "content-range", "etag", "last-modified"):
        value = response.headers.get(key)
        if value:
            headers[key] = value
    return headers


def _parse_range_header(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    if not range_header or not range_header.startswith("bytes="):
        return None
    raw = range_header.removeprefix("bytes=").split(",", 1)[0]
    start_raw, _, end_raw = raw.partition("-")
    if not start_raw and not end_raw:
        return None
    if start_raw:
        start = int(start_raw)
        end = int(end_raw) if end_raw else file_size - 1
    else:
        suffix = int(end_raw)
        start = max(file_size - suffix, 0)
        end = file_size - 1
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return start, end


def _file_iterator(file_path: Path, start: int = 0, end: int | None = None) -> Iterator[bytes]:
    with file_path.open("rb") as handle:
        handle.seek(start)
        remaining = None if end is None else end - start + 1
        while True:
            chunk_size = 65536 if remaining is None else min(65536, remaining)
            if chunk_size <= 0:
                break
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            if remaining is not None:
                remaining -= len(chunk)
            yield chunk


def _resolve_stream_response(song, request_headers: dict[str, str]):
    last_error = "No upstream audio URL available"
    for chosen in _upstream_candidates(song):
        for source, response in _open_upstream_candidates(song, chosen, request_headers):
            if not _is_valid_audio_response(response):
                last_error = f"Rejected upstream response via {source} status={response.status_code} type={response.headers.get('content-type', '')}"
                print(f"[stream] upstream rejection {song.song_id}: {last_error}")
                response.close()
                continue
            try:
                upstream_iter, first_chunk = _prime_audio_response(response)
            except Exception as exc:
                last_error = f"Rejected upstream response via {source}: {exc}"
                print(f"[stream] upstream rejection {song.song_id}: {last_error}")
                continue
            print(f"[stream] upstream ok {song.song_id} via {source}")
            return response, upstream_iter, first_chunk
    return None, last_error


def _resolution_failed(resolved) -> bool:
    return isinstance(resolved, tuple) and len(resolved) == 2 and resolved[0] is None


def _refresh_song(song_id: str):
    song = get_song(song_id)
    if not song:
        return None
    lock = _refresh_lock(song.album_url)
    with lock:
        latest = get_song(song_id)
        if latest and _upstream_candidates(latest):
            song = latest
        print(f"[stream] refresh start {song_id}")
        album = site_scraper.refresh_album(song.album_url)
        from .repository import upsert_album

        upsert_album(album)
        print(f"[stream] refresh success {song_id}")
    return get_song(song_id)


def _cache_download(song_id: str, song, response) -> Path | None:
    final_path = cache_path(song_id)
    part_path = temp_cache_path(song_id)
    try:
        with part_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=65536):
                if chunk:
                    handle.write(chunk)
        if not validate_cache_file(part_path):
            print(f"[stream] cache write rejected {song_id}")
            return None
        part_path.replace(final_path)
        store_shared_cache(song_id, final_path)
        trim_cache()
        print(f"[stream] cache write success {song_id}")
        return final_path
    finally:
        response.close()
        part_path.unlink(missing_ok=True)


def _prefetch_to_cache(song_id: str) -> bool:
    cached = _valid_local_cache(song_id)
    if cached:
        return True

    lock = _download_lock(song_id)
    if not lock.acquire(blocking=False):
        print(f"[prefetch] skip active download {song_id}")
        return False
    try:
        cached = _valid_local_cache(song_id)
        if cached:
            return True

        song = get_song(song_id)
        if not song:
            return False
        if not _upstream_candidates(song):
            song = _refresh_song(song_id)
            if not song:
                return False

        resolved = _resolve_stream_response(song, {})
        if _resolution_failed(resolved):
            song = _refresh_song(song_id)
            if not song:
                return False
            print(f"[stream] refresh retry {song_id}")
            resolved = _resolve_stream_response(song, {})
            if _resolution_failed(resolved):
                return False

        response, upstream_iter, first_chunk = resolved
        if response.status_code != 200:
            response.close()
            return False
        final_path = cache_path(song_id)
        part_path = temp_cache_path(song_id)
        try:
            with part_path.open("wb") as handle:
                handle.write(first_chunk)
                for chunk in upstream_iter:
                    if chunk:
                        handle.write(chunk)
            if not validate_cache_file(part_path):
                print(f"[stream] cache write rejected {song_id}")
                part_path.unlink(missing_ok=True)
                return False
            part_path.replace(final_path)
            store_shared_cache(song_id, final_path)
            trim_cache()
            print(f"[stream] temp promote {song_id}")
            return True
        finally:
            response.close()
            part_path.unlink(missing_ok=True)
    finally:
        lock.release()


def warmup_song(song_id: str) -> None:
    if _valid_local_cache(song_id):
        return
    if _is_download_active(song_id):
        return
    print(f"[warmup] queue {song_id}")
    executor.submit(_prefetch_to_cache, song_id)


def queue_prefetch(song_ids: list[str], limit: int) -> int:
    queued = 0
    for song_id in song_ids[:limit]:
        if _valid_local_cache(song_id):
            continue
        if _is_download_active(song_id):
            continue
        print(f"[prefetch] queue {song_id}")
        executor.submit(_prefetch_to_cache, song_id)
        queued += 1
    return queued


def stream_song(song_id: str, request_headers: dict[str, str] | None = None):
    request_headers = {key.lower(): value for key, value in (request_headers or {}).items()}
    song = get_song(song_id)
    if not song:
        raise FileNotFoundError("Song not found")

    cached = _valid_local_cache(song_id)
    if cached:
        print(f"[stream] cache hit {song_id}")
        file_size = cached.stat().st_size
        parsed_range = _parse_range_header(request_headers.get("range"), file_size)
        headers = cache_response_headers(cached)
        if parsed_range:
            start, end = parsed_range
            headers["content-range"] = f"bytes {start}-{end}/{file_size}"
            headers["content-length"] = str(end - start + 1)
            return {
                "type": "cache-stream",
                "iterator": _file_iterator(cached, start, end),
                "content_type": "audio/mpeg",
                "status_code": 206,
                "headers": headers,
            }
        return {
            "type": "cache",
            "path": cached,
            "content_type": "audio/mpeg",
            "status_code": 200,
            "headers": headers,
        }

    print(f"[stream] cache miss {song_id}")

    if not _upstream_candidates(song):
        song = _refresh_song(song_id)
        if not song or not _upstream_candidates(song):
            raise FileNotFoundError("No upstream audio URL available")

    resolved = _resolve_stream_response(song, request_headers)
    if _resolution_failed(resolved):
        _, last_error = resolved
        song = _refresh_song(song_id)
        if not song:
            raise RuntimeError("Invalid upstream response and refresh failed")
        print(f"[stream] refresh retry {song_id}")
        resolved = _resolve_stream_response(song, request_headers)
        if _resolution_failed(resolved):
            _, refreshed_error = resolved
            raise RuntimeError(f"Invalid upstream response after refresh: {refreshed_error or last_error}")

    response, upstream_iter, first_chunk = resolved
    headers = _response_headers(response)
    content_type = headers.get("content-type", "audio/mpeg")

    def iterator() -> Iterator[bytes]:
        final_path = cache_path(song_id)
        part_path = temp_cache_path(song_id)
        write_cache = response.status_code == 200 and "range" not in request_headers
        lock = _download_lock(song_id)
        handle = None
        lock_acquired = False
        try:
            if write_cache:
                lock.acquire()
                lock_acquired = True
                cached_now = _valid_local_cache(song_id)
                if cached_now:
                    print(f"[stream] cache restored during wait {song_id}")
                    with cached_now.open("rb") as cached_handle:
                        while True:
                            chunk = cached_handle.read(65536)
                            if not chunk:
                                break
                            yield chunk
                    return
                handle = part_path.open("wb")

            if handle:
                handle.write(first_chunk)
            yield first_chunk

            for chunk in upstream_iter:
                if not chunk:
                    continue
                if handle:
                    handle.write(chunk)
                yield chunk
        finally:
            if handle:
                handle.close()
                if validate_cache_file(part_path):
                    part_path.replace(final_path)
                    store_shared_cache(song_id, final_path)
                    trim_cache()
                    print(f"[stream] temp promote {song_id}")
                else:
                    print(f"[stream] cache write failure {song_id}")
                    part_path.unlink(missing_ok=True)
            if lock_acquired:
                lock.release()
            response.close()

    return {
        "type": "upstream",
        "iterator": iterator(),
        "content_type": content_type,
        "status_code": response.status_code,
        "headers": headers,
    }


def public_song_status(song_id: str):
    status = cache_status(song_id)
    song = get_song(song_id)
    if not song:
        return None

    if status.get("status") == "valid":
        resolved_status = "cached"
    elif _upstream_candidates(song):
        resolved_status = "healthy"
    else:
        resolved_status = "unavailable"

    payload = song_status(song_id, str(resolved_status))
    if not payload:
        return None
    return payload.model_copy(update={"cache_status": resolved_status})
