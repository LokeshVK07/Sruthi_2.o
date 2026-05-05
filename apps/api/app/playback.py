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
from .repository import album_song_ids, get_song, song_status
from .scraper import site_scraper


download_locks: dict[str, threading.Lock] = {}
refresh_locks: dict[str, threading.Lock] = {}
metadata_cache: dict[str, tuple[float, object]] = {}
resolved_url_cache: dict[str, tuple[float, list[str]]] = {}
failed_attempt_cache: dict[str, float] = {}
queued_song_prefetches: set[str] = set()
active_song_prefetches: set[str] = set()
active_album_prefetches: set[str] = set()
active_album_refreshes: set[str] = set()
interactive_stream_lock = threading.Lock()
interactive_priority_until = 0.0
prefetch_state_lock = threading.Lock()
song_prefetch_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="audio-prefetch")
album_prefetch_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="album-prefetch")
ACCEPTED_TYPES = {"audio/mpeg", "audio/mp3", "audio/aac", "audio/ogg", "audio/wav", "application/octet-stream"}
CHUNK_SIZE = 131072
METADATA_CACHE_TTL_SECONDS = 300.0
RESOLVED_URL_TTL_SECONDS = 1800.0
FAILED_URL_TTL_SECONDS = 90.0
prefetch_runtime_status = {
    "activePrefetches": 0,
    "activeAlbumPrefetches": 0,
    "queuedPrefetches": 0,
    "warmupRunning": False,
    "lastPrefetchError": None,
    "lastStreamFirstByteMs": None,
}
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
    cached = resolved_url_cache.get(song.song_id)
    if cached and cached[0] > time.time():
        return list(cached[1])
    candidates: list[str] = []
    for url in (song.url_320kbps, song.url_128kbps):
        if url and url not in candidates:
            candidates.append(url)
    if candidates:
        resolved_url_cache[song.song_id] = (time.time() + RESOLVED_URL_TTL_SECONDS, list(candidates))
    return candidates


def _is_download_active(song_id: str) -> bool:
    lock = download_locks.get(song_id)
    return bool(lock and lock.locked())


def _is_prefetch_pending(song_id: str) -> bool:
    with prefetch_state_lock:
        return song_id in queued_song_prefetches or song_id in active_song_prefetches


def _valid_local_cache(song_id: str) -> Path | None:
    local_path = cache_path(song_id)
    if validate_cache_file(local_path):
        return local_path
    restored = restore_shared_cache(song_id)
    if restored and validate_cache_file(restored):
        return restored
    return None


def _get_song_cached(song_id: str, force_refresh: bool = False):
    now = time.time()
    if not force_refresh:
        cached = metadata_cache.get(song_id)
        if cached and cached[0] > now:
            return cached[1]
    song = get_song(song_id)
    if song:
        metadata_cache[song_id] = (now + METADATA_CACHE_TTL_SECONDS, song)
    else:
        metadata_cache.pop(song_id, None)
    return song


def _mark_prefetch_error(message: str) -> None:
    with prefetch_state_lock:
        prefetch_runtime_status["lastPrefetchError"] = message


def _set_stream_first_byte(metric_ms: float | None) -> None:
    with prefetch_state_lock:
        prefetch_runtime_status["lastStreamFirstByteMs"] = None if metric_ms is None else round(metric_ms, 2)


def _mark_interactive_priority(window_seconds: float = 3.0) -> None:
    global interactive_priority_until
    with interactive_stream_lock:
        interactive_priority_until = max(interactive_priority_until, time.time() + window_seconds)


def _wait_for_interactive_priority() -> None:
    while True:
        with interactive_stream_lock:
            remaining = interactive_priority_until - time.time()
        if remaining <= 0:
            return
        time.sleep(min(0.2, remaining))


def prefetch_status() -> dict[str, object]:
    with prefetch_state_lock:
        return dict(prefetch_runtime_status)


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
                timeout=(8, 30),
            ),
        ),
        (
            "cloudscraper",
            lambda: cloud_client.get(
                chosen,
                headers=_build_upstream_headers(song, request_headers, None),
                stream=True,
                timeout=(8, 30),
            ),
        ),
        (
            "curl_default",
            lambda: http_client.get(
                chosen,
                headers=_build_upstream_headers(song, request_headers, None),
                stream=True,
                timeout=(8, 30),
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
        stream_iter = response.iter_content(chunk_size=CHUNK_SIZE)
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
            chunk_size = CHUNK_SIZE if remaining is None else min(CHUNK_SIZE, remaining)
            if chunk_size <= 0:
                break
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            if remaining is not None:
                remaining -= len(chunk)
            yield chunk


def _resolve_stream_response(song, request_headers: dict[str, str]):
    failed_until = failed_attempt_cache.get(song.song_id, 0.0)
    if failed_until > time.time():
        return None, "Recent upstream failure still cooling down"
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
            resolved_url_cache[song.song_id] = (time.time() + RESOLVED_URL_TTL_SECONDS, [chosen])
            return response, upstream_iter, first_chunk, source
    failed_attempt_cache[song.song_id] = time.time() + FAILED_URL_TTL_SECONDS
    return None, last_error


def _resolution_failed(resolved) -> bool:
    return isinstance(resolved, tuple) and len(resolved) == 2 and resolved[0] is None


def _refresh_song(song_id: str):
    song = _get_song_cached(song_id)
    if not song:
        return None
    lock = _refresh_lock(song.album_url)
    with lock:
        latest = _get_song_cached(song_id, force_refresh=True)
        if latest and _upstream_candidates(latest):
            song = latest
        print(f"[stream] refresh start {song_id}")
        album = site_scraper.refresh_album(song.album_url)
        from .repository import upsert_album

        upsert_album(album)
        print(f"[stream] refresh success {song_id}")
    failed_attempt_cache.pop(song_id, None)
    return _get_song_cached(song_id, force_refresh=True)


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
    _wait_for_interactive_priority()
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

        song = _get_song_cached(song_id)
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

        response, upstream_iter, first_chunk, source = resolved
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
                print(f"[prefetch] cache write rejected {song_id}")
                part_path.unlink(missing_ok=True)
                return False
            part_path.replace(final_path)
            store_shared_cache(song_id, final_path)
            trim_cache()
            print(f"[prefetch] temp promote {song_id} via {source}")
            return True
        finally:
            response.close()
            part_path.unlink(missing_ok=True)
    except Exception as exc:
        _mark_prefetch_error(f"{song_id}: {exc}")
        print(f"[prefetch] error {song_id}: {exc}")
        return False
    finally:
        lock.release()


def _run_prefetch_job(song_id: str) -> None:
    with prefetch_state_lock:
        queued_song_prefetches.discard(song_id)
        active_song_prefetches.add(song_id)
        prefetch_runtime_status["activePrefetches"] = len(active_song_prefetches)
        prefetch_runtime_status["queuedPrefetches"] = len(queued_song_prefetches)
    try:
        _prefetch_to_cache(song_id)
    finally:
        with prefetch_state_lock:
            active_song_prefetches.discard(song_id)
            prefetch_runtime_status["activePrefetches"] = len(active_song_prefetches)
            prefetch_runtime_status["warmupRunning"] = bool(queued_song_prefetches or active_song_prefetches)


def _enqueue_song_prefetch(song_id: str, label: str) -> bool:
    if _valid_local_cache(song_id):
        return False
    if _is_download_active(song_id) or _is_prefetch_pending(song_id):
        return False
    with prefetch_state_lock:
        if song_id in queued_song_prefetches or song_id in active_song_prefetches:
            return False
        queued_song_prefetches.add(song_id)
        prefetch_runtime_status["queuedPrefetches"] = len(queued_song_prefetches)
        prefetch_runtime_status["warmupRunning"] = bool(queued_song_prefetches or active_song_prefetches)
    print(f"[{label}] queue {song_id}")
    song_prefetch_executor.submit(_run_prefetch_job, song_id)
    return True


def _prefetch_album(album_id: str, lead_limit: int, refresh_links: bool) -> int:
    ordered_song_ids = album_song_ids(album_id)
    if not ordered_song_ids:
        return 0
    if refresh_links:
        try:
            print(f"[album-prefetch] refresh links {album_id}")
            _refresh_song(ordered_song_ids[0])
        except Exception as exc:
            _mark_prefetch_error(f"album {album_id}: refresh failed: {exc}")
            print(f"[album-prefetch] refresh failed {album_id}: {exc}")
    prioritized = ordered_song_ids[:lead_limit]
    queued = 0
    for song_id in prioritized:
        queued += int(_enqueue_song_prefetch(song_id, "album-prefetch"))
    return queued


def _run_album_prefetch(album_id: str, lead_limit: int, refresh_links: bool) -> None:
    with prefetch_state_lock:
        prefetch_runtime_status["activeAlbumPrefetches"] = len(active_album_prefetches)
    try:
        _prefetch_album(album_id, lead_limit, refresh_links)
    except Exception as exc:
        _mark_prefetch_error(f"album {album_id}: {exc}")
        print(f"[album-prefetch] error {album_id}: {exc}")
    finally:
        with prefetch_state_lock:
            active_album_prefetches.discard(album_id)
            prefetch_runtime_status["activeAlbumPrefetches"] = len(active_album_prefetches)


def _run_album_refresh_only(album_id: str) -> None:
    try:
        song_ids = album_song_ids(album_id, 1)
        if not song_ids:
            return
        print(f"[album-prefetch] escalate refresh {album_id}")
        _refresh_song(song_ids[0])
    except Exception as exc:
        _mark_prefetch_error(f"album {album_id}: refresh failed: {exc}")
        print(f"[album-prefetch] escalate refresh failed {album_id}: {exc}")
    finally:
        with prefetch_state_lock:
            active_album_refreshes.discard(album_id)


def warmup_song(song_id: str) -> None:
    _enqueue_song_prefetch(song_id, "warmup")


def queue_prefetch(song_ids: list[str], limit: int) -> int:
    queued = 0
    for song_id in song_ids[:limit]:
        queued += int(_enqueue_song_prefetch(song_id, "prefetch"))
    return queued


def queue_album_prefetch(album_id: str, lead_limit: int = 4, refresh_links: bool = False) -> bool:
    with prefetch_state_lock:
        if album_id in active_album_prefetches:
            if refresh_links and album_id not in active_album_refreshes:
                active_album_refreshes.add(album_id)
                song_prefetch_executor.submit(_run_album_refresh_only, album_id)
            return False
        active_album_prefetches.add(album_id)
        prefetch_runtime_status["activeAlbumPrefetches"] = len(active_album_prefetches)
    print(f"[album-prefetch] queue {album_id}")
    album_prefetch_executor.submit(_run_album_prefetch, album_id, lead_limit, refresh_links)
    return True


def stream_song(song_id: str, request_headers: dict[str, str] | None = None):
    started_at = time.perf_counter()
    _mark_interactive_priority()
    request_headers = {key.lower(): value for key, value in (request_headers or {}).items()}
    song = _get_song_cached(song_id)
    if not song:
        raise FileNotFoundError("Song not found")
    metadata_ms = (time.perf_counter() - started_at) * 1000

    cached = _valid_local_cache(song_id)
    cache_lookup_ms = (time.perf_counter() - started_at) * 1000
    if cached:
        print(f"[stream] song_id={song_id} cache_hit metadata_ms={metadata_ms:.1f} cache_lookup_ms={cache_lookup_ms:.1f}")
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

    print(f"[stream] song_id={song_id} cache_miss metadata_ms={metadata_ms:.1f} cache_lookup_ms={cache_lookup_ms:.1f}")

    if not _upstream_candidates(song):
        song = _refresh_song(song_id)
        if not song or not _upstream_candidates(song):
            raise FileNotFoundError("No upstream audio URL available")

    resolve_started_at = time.perf_counter()
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

    upstream_open_ms = (time.perf_counter() - resolve_started_at) * 1000
    response, upstream_iter, first_chunk, source = resolved
    first_byte_ms = (time.perf_counter() - started_at) * 1000
    _set_stream_first_byte(first_byte_ms)
    headers = _response_headers(response)
    content_type = headers.get("content-type", "audio/mpeg")
    print(
        f"[stream] song_id={song_id} source={source} upstream_open_ms={upstream_open_ms:.1f} "
        f"first_byte_ms={first_byte_ms:.1f} status={response.status_code}"
    )

    def iterator() -> Iterator[bytes]:
        final_path = cache_path(song_id)
        part_path = temp_cache_path(song_id)
        write_cache = response.status_code == 200 and "range" not in request_headers
        lock = _download_lock(song_id)
        handle = None
        lock_acquired = False
        first_yield_logged = False
        iterator_started_at = time.perf_counter()
        try:
            if write_cache:
                lock_acquired = lock.acquire(blocking=False)
                if lock_acquired:
                    cached_now = _valid_local_cache(song_id)
                    if cached_now:
                        print(f"[stream] cache restored during wait {song_id}")
                        with cached_now.open("rb") as cached_handle:
                            while True:
                                chunk = cached_handle.read(CHUNK_SIZE)
                                if not chunk:
                                    break
                                yield chunk
                        return
                    handle = part_path.open("wb")
                else:
                    print(f"[stream] cache writer busy {song_id}, streaming without cache write")

            if handle:
                handle.write(first_chunk)
            if not first_yield_logged:
                first_yield_logged = True
                print(f"[stream] song_id={song_id} first_yield_ms={(time.perf_counter() - started_at) * 1000:.1f}")
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
                    print(
                        f"[stream] song_id={song_id} temp_promote total_stream_ms="
                        f"{(time.perf_counter() - iterator_started_at) * 1000:.1f}"
                    )
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
