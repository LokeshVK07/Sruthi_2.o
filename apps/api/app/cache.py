from __future__ import annotations

import shutil
from pathlib import Path

from .config import CACHE_DIR, MAX_CACHE_SIZE_MB, MIN_CACHE_FILE_BYTES, SHARED_CACHE_DIR, TEMP_CACHE_DIR


INVALID_PREFIX_MARKERS = (
    b"<!doctype html",
    b"<html",
    b"<?xml",
    b"{\"detail\":",
    b"{\"ok\":false",
)


def cache_path(song_id: str) -> Path:
    return CACHE_DIR / f"{song_id}.mp3"


def shared_cache_path(song_id: str) -> Path | None:
    if SHARED_CACHE_DIR is None:
        return None
    return SHARED_CACHE_DIR / f"{song_id}.mp3"


def temp_cache_path(song_id: str) -> Path:
    return TEMP_CACHE_DIR / f"{song_id}.part"


def validate_cache_file(file_path: Path, min_bytes: int = MIN_CACHE_FILE_BYTES) -> bool:
    if not file_path.exists() or not file_path.is_file():
        return False
    try:
        if file_path.stat().st_size < min_bytes:
            print(f"[cache] delete invalid tiny {file_path.name}")
            file_path.unlink(missing_ok=True)
            return False
        with file_path.open("rb") as handle:
            prefix = handle.read(512).lower()
    except OSError:
        print(f"[cache] delete invalid unreadable {file_path.name}")
        file_path.unlink(missing_ok=True)
        return False
    if any(marker in prefix for marker in INVALID_PREFIX_MARKERS):
        print(f"[cache] delete invalid content {file_path.name}")
        file_path.unlink(missing_ok=True)
        return False
    return True


def local_cache_status(song_id: str) -> dict[str, int | float | str]:
    file_path = cache_path(song_id)
    if not file_path.exists():
        return {"status": "missing"}
    if not validate_cache_file(file_path):
        return {"status": "invalid"}
    return {"status": "valid", "size": file_path.stat().st_size, "path": str(file_path)}


def restore_shared_cache(song_id: str) -> Path | None:
    shared_path = shared_cache_path(song_id)
    if shared_path is None or not validate_cache_file(shared_path):
        return None

    local_path = cache_path(song_id)
    part_path = temp_cache_path(song_id)
    try:
        shutil.copyfile(shared_path, part_path)
        if not validate_cache_file(part_path):
            return None
        part_path.replace(local_path)
        print(f"[cache] shared restore {song_id}")
        return local_path
    finally:
        part_path.unlink(missing_ok=True)


def store_shared_cache(song_id: str, local_path: Path) -> None:
    shared_path = shared_cache_path(song_id)
    if shared_path is None or not validate_cache_file(local_path):
        return
    part_path = shared_path.with_suffix(".part")
    try:
        shutil.copyfile(local_path, part_path)
        if validate_cache_file(part_path):
            part_path.replace(shared_path)
            print(f"[cache] shared store {song_id}")
    finally:
        part_path.unlink(missing_ok=True)


def cache_response_headers(file_path: Path) -> dict[str, str]:
    stat = file_path.stat()
    return {
        "accept-ranges": "bytes",
        "content-length": str(stat.st_size),
        "etag": f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
        "last-modified": str(int(stat.st_mtime)),
    }


def cache_status(song_id: str | None = None) -> dict[str, int | float | str | bool]:
    if song_id:
        status = local_cache_status(song_id)
        shared_path = shared_cache_path(song_id)
        return {
            **status,
            "sharedConfigured": SHARED_CACHE_DIR is not None,
            "sharedAvailable": bool(shared_path and validate_cache_file(shared_path)),
        }

    files = [entry for entry in CACHE_DIR.glob("*.mp3") if validate_cache_file(entry)]
    total = sum(item.stat().st_size for item in files)
    shared_files = 0
    if SHARED_CACHE_DIR is not None:
        shared_files = len([entry for entry in SHARED_CACHE_DIR.glob("*.mp3") if validate_cache_file(entry)])
    return {
        "fileCount": len(files),
        "totalBytes": total,
        "totalMegabytes": round(total / 1024 / 1024, 2),
        "limitMegabytes": MAX_CACHE_SIZE_MB,
        "sharedConfigured": SHARED_CACHE_DIR is not None,
        "sharedFileCount": shared_files,
    }


def trim_cache() -> dict[str, int]:
    files = sorted([entry for entry in CACHE_DIR.glob("*.mp3") if entry.is_file()], key=lambda item: item.stat().st_mtime)
    limit = MAX_CACHE_SIZE_MB * 1024 * 1024
    total = sum(item.stat().st_size for item in files if validate_cache_file(item))
    trimmed = 0
    for file_path in files:
        if total <= limit:
            break
        if not file_path.exists():
            continue
        size = file_path.stat().st_size
        file_path.unlink(missing_ok=True)
        total -= size
        trimmed += 1
    return {"trimmedFiles": trimmed, "remainingBytes": max(total, 0)}
