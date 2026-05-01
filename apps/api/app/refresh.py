from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from .config import (
    DATABASE_PATH,
    LOCAL_REFRESH_MANIFEST_PATH,
    PUBLISHED_MANIFEST_PATH,
    REFRESH_ENABLED,
    REFRESH_INTERVAL_SECONDS,
    REFRESH_MANIFEST_URL,
    REFRESH_STATE_DIR,
    REFRESH_TIMEOUT_SECONDS,
    SNAPSHOT_CACHE_PATH,
)
from .db import close_connection, init_db, init_db_path
from .utils import now_utc


REQUIRED_MANIFEST_FIELDS = ("version", "updated_at", "size", "sha256", "download_url")
SHARED_TABLES = ("albums", "songs", "scrape_runs")

_state_lock = threading.Lock()
_refresh_lock = threading.Lock()
_worker_started = False
_state: dict[str, Any] = {
    "enabled": REFRESH_ENABLED and bool(REFRESH_MANIFEST_URL),
    "status": "idle",
    "message": "Background refresh is idle.",
    "manifestUrl": REFRESH_MANIFEST_URL,
    "currentVersion": "",
    "remoteVersion": "",
    "checkedAt": "",
    "updatedAt": "",
    "downloadedBytes": 0,
    "totalBytes": 0,
    "error": "",
}


def iso_now() -> str:
    return now_utc().replace(microsecond=0).isoformat()


def _set_state(**updates: Any) -> dict[str, Any]:
    with _state_lock:
        _state.update(updates)
        return dict(_state)


def _normalize_manifest(payload: dict[str, Any]) -> dict[str, Any]:
    for field in REQUIRED_MANIFEST_FIELDS:
        if field not in payload:
            raise ValueError(f"Refresh manifest missing required field: {field}")
    size = int(payload.get("size") or 0)
    if size <= 0:
        raise ValueError("Refresh manifest size must be a positive integer")
    sha256 = str(payload["sha256"]).strip().lower()
    if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise ValueError("Refresh manifest sha256 is not a valid lowercase hex digest")
    download_url = str(payload["download_url"]).strip()
    if not download_url.startswith(("https://", "http://")):
        raise ValueError("Refresh manifest download_url must be absolute")
    return {
        "version": str(payload["version"]).strip(),
        "updated_at": str(payload["updated_at"]).strip(),
        "size": size,
        "sha256": sha256,
        "download_url": download_url,
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _table_columns(connection: sqlite3.Connection, table: str, schema: str | None = None) -> list[str]:
    pragma_target = f"{schema + '.' if schema else ''}{table}"
    rows = connection.execute(f"PRAGMA table_info('{pragma_target}')").fetchall()
    return [str(row[1]) for row in rows]


def _validate_snapshot_file(path: Path) -> dict[str, int]:
    if not path.exists() or path.stat().st_size <= 0:
        raise ValueError("Downloaded snapshot file is missing or empty")
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or str(integrity[0]).lower() != "ok":
            raise ValueError("Snapshot database failed integrity check")
        existing_tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        missing = [table for table in SHARED_TABLES if table not in existing_tables]
        if missing:
            raise ValueError(f"Snapshot missing required tables: {', '.join(missing)}")
        songs = int(connection.execute("SELECT COUNT(*) FROM songs").fetchone()[0] or 0)
        albums = int(connection.execute("SELECT COUNT(*) FROM albums").fetchone()[0] or 0)
        if songs <= 0 or albums <= 0:
            raise ValueError("Snapshot database does not contain any shared catalog rows")
        return {"songs": songs, "albums": albums}
    finally:
        connection.close()


def _read_manifest_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    try:
        return _normalize_manifest(payload)
    except Exception:
        return {}


def read_local_manifest() -> dict[str, Any]:
    local_manifest = _read_manifest_file(LOCAL_REFRESH_MANIFEST_PATH)
    if local_manifest:
        return local_manifest
    return _read_manifest_file(PUBLISHED_MANIFEST_PATH)


def _write_local_manifest(manifest: dict[str, Any]) -> None:
    manifest_path = LOCAL_REFRESH_MANIFEST_PATH
    tmp_path = manifest_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    os.replace(tmp_path, manifest_path)


def _backup_sqlite(source_path: Path, backup_path: Path) -> None:
    if not source_path.exists():
        return
    source = sqlite3.connect(str(source_path))
    backup = sqlite3.connect(str(backup_path))
    try:
        source.backup(backup)
    finally:
        source.close()
        backup.close()


def _replace_local_snapshot(download_path: Path) -> None:
    backup_path = SNAPSHOT_CACHE_PATH.with_suffix(".sqlite3.bak")
    if SNAPSHOT_CACHE_PATH.exists():
        shutil.copy2(SNAPSHOT_CACHE_PATH, backup_path)
    os.replace(download_path, SNAPSHOT_CACHE_PATH)


def _merge_snapshot_into_live(snapshot_path: Path) -> dict[str, int]:
    init_db()
    init_db_path(snapshot_path)
    backup_path = DATABASE_PATH.with_suffix(".snapshot-backup.sqlite3")
    _backup_sqlite(DATABASE_PATH, backup_path)

    close_connection()
    live = sqlite3.connect(str(DATABASE_PATH), isolation_level=None)
    live.row_factory = sqlite3.Row
    try:
        live.execute("PRAGMA foreign_keys=OFF")
        live.execute("ATTACH DATABASE ? AS snapshot", [str(snapshot_path)])

        live.execute("BEGIN IMMEDIATE")
        live.execute("DELETE FROM songs")
        live.execute("DELETE FROM albums")
        live.execute("DELETE FROM scrape_runs")

        album_columns = _table_columns(live, "albums")
        song_columns = _table_columns(live, "songs")
        scrape_columns = _table_columns(live, "scrape_runs")

        live.execute(
            f"INSERT INTO albums ({', '.join(album_columns)}) SELECT {', '.join(album_columns)} FROM snapshot.albums"
        )
        live.execute(
            f"INSERT INTO songs ({', '.join(song_columns)}) SELECT {', '.join(song_columns)} FROM snapshot.songs"
        )
        live.execute(
            f"INSERT INTO scrape_runs ({', '.join(scrape_columns)}) SELECT {', '.join(scrape_columns)} FROM snapshot.scrape_runs"
        )
        live.commit()

        albums = int(live.execute("SELECT COUNT(*) FROM albums").fetchone()[0] or 0)
        songs = int(live.execute("SELECT COUNT(*) FROM songs").fetchone()[0] or 0)
        return {"albums": albums, "songs": songs}
    except Exception:
        live.rollback()
        raise
    finally:
        try:
            live.execute("DETACH DATABASE snapshot")
        except Exception:
            pass
        live.execute("PRAGMA foreign_keys=ON")
        live.close()


def refresh_state_from_local_manifest() -> dict[str, Any]:
    manifest = read_local_manifest()
    if manifest:
        return _set_state(
            currentVersion=manifest.get("version", ""),
            updatedAt=manifest.get("updated_at", ""),
            manifestUrl=REFRESH_MANIFEST_URL,
            enabled=REFRESH_ENABLED and bool(REFRESH_MANIFEST_URL),
        )
    return _set_state(manifestUrl=REFRESH_MANIFEST_URL, enabled=REFRESH_ENABLED and bool(REFRESH_MANIFEST_URL))


def get_refresh_status() -> dict[str, Any]:
    with _state_lock:
        return dict(_state)


def _fetch_remote_manifest() -> dict[str, Any]:
    if not REFRESH_MANIFEST_URL:
        raise ValueError("Refresh manifest URL is not configured")
    with httpx.Client(timeout=REFRESH_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = client.get(REFRESH_MANIFEST_URL)
        response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Refresh manifest payload must be a JSON object")
    return _normalize_manifest(payload)


def refresh_snapshot(force: bool = False) -> dict[str, Any]:
    if not REFRESH_ENABLED or not REFRESH_MANIFEST_URL:
        return _set_state(enabled=False, status="idle", message="Background refresh is disabled.")

    if not _refresh_lock.acquire(blocking=False):
        return get_refresh_status()

    download_tmp = REFRESH_STATE_DIR / "library-snapshot.download.tmp"
    try:
        local_manifest = read_local_manifest()
        _set_state(
            enabled=True,
            status="checking",
            message="Checking refresh manifest…",
            checkedAt=iso_now(),
            currentVersion=local_manifest.get("version", ""),
            error="",
            downloadedBytes=0,
            totalBytes=0,
        )

        remote_manifest = _fetch_remote_manifest()
        _set_state(
            remoteVersion=remote_manifest["version"],
            totalBytes=remote_manifest["size"],
            message="Manifest fetched.",
        )

        if not force and remote_manifest["version"] == local_manifest.get("version", ""):
            return _set_state(status="idle", message="Library snapshot already up to date.")

        _set_state(status="downloading", message="Downloading library snapshot…", downloadedBytes=0)
        hasher = hashlib.sha256()
        downloaded_bytes = 0
        with httpx.stream("GET", remote_manifest["download_url"], timeout=REFRESH_TIMEOUT_SECONDS, follow_redirects=True) as response:
            response.raise_for_status()
            with download_tmp.open("wb") as handle:
                for chunk in response.iter_bytes():
                    if not chunk:
                        continue
                    handle.write(chunk)
                    hasher.update(chunk)
                    downloaded_bytes += len(chunk)
                    _set_state(downloadedBytes=downloaded_bytes)

        if downloaded_bytes != remote_manifest["size"]:
            raise ValueError("Downloaded snapshot size did not match manifest")
        if hasher.hexdigest().lower() != remote_manifest["sha256"]:
            raise ValueError("Downloaded snapshot checksum did not match manifest")

        validation_stats = _validate_snapshot_file(download_tmp)
        _set_state(status="applying", message="Applying library snapshot…")
        _replace_local_snapshot(download_tmp)
        live_stats = _merge_snapshot_into_live(SNAPSHOT_CACHE_PATH)
        _write_local_manifest(remote_manifest)
        return _set_state(
            status="updated",
            message=f"Library updated to {remote_manifest['version']}.",
            currentVersion=remote_manifest["version"],
            remoteVersion=remote_manifest["version"],
            updatedAt=remote_manifest["updated_at"],
            checkedAt=iso_now(),
            downloadedBytes=remote_manifest["size"],
            totalBytes=remote_manifest["size"],
            error="",
            snapshotSongs=validation_stats["songs"],
            snapshotAlbums=validation_stats["albums"],
            liveSongs=live_stats["songs"],
            liveAlbums=live_stats["albums"],
        )
    except Exception as exc:
        return _set_state(status="error", message="Library refresh failed.", error=str(exc), checkedAt=iso_now())
    finally:
        download_tmp.unlink(missing_ok=True)
        _refresh_lock.release()


def trigger_refresh(force: bool = False) -> dict[str, Any]:
    if not REFRESH_ENABLED or not REFRESH_MANIFEST_URL:
        return _set_state(enabled=False, status="idle", message="Background refresh is disabled.")
    if _refresh_lock.locked():
        return get_refresh_status()
    thread = threading.Thread(target=refresh_snapshot, kwargs={"force": force}, daemon=True, name="snapshot-refresh")
    thread.start()
    return _set_state(status="checking", message="Refresh check queued.")


def start_refresh_worker() -> None:
    global _worker_started
    refresh_state_from_local_manifest()
    if not REFRESH_ENABLED or not REFRESH_MANIFEST_URL or _worker_started:
        return
    _worker_started = True

    def _worker() -> None:
        while True:
            refresh_snapshot(force=False)
            time.sleep(max(60, REFRESH_INTERVAL_SECONDS))

    threading.Thread(target=_worker, daemon=True, name="snapshot-refresh-worker").start()

