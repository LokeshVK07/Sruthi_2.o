#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_stats(path: Path) -> dict[str, int]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        songs = int(connection.execute("SELECT COUNT(*) FROM songs").fetchone()[0] or 0)
        albums = int(connection.execute("SELECT COUNT(*) FROM albums").fetchone()[0] or 0)
    finally:
        connection.close()
    return {"songs": songs, "albums": albums}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument("--download-url", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--updated-at", required=False)
    args = parser.parse_args()

    db_path = Path(args.db_path)
    manifest_path = Path(args.manifest_path)
    updated_at = args.updated_at or args.version
    stats = snapshot_stats(db_path)
    manifest = {
        "version": args.version,
        "updated_at": updated_at,
        "size": db_path.stat().st_size,
        "sha256": sha256_file(db_path),
        "download_url": args.download_url,
        "songs": stats["songs"],
        "albums": stats["albums"],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
