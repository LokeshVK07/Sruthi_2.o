#!/usr/bin/env python3
"""
Verify that a rendered wrangler config points at real files.

We have hit "entry-point file at 'src/worker.js' was not found" before because
a rendered config lived in a different directory than the one wrangler used
to resolve relative paths. This script catches that class of error early.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path


def strip_jsonc_comments(text: str) -> str:
    no_block = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    no_line = re.sub(r"(?m)^\s*//.*$", "", no_block)
    return re.sub(r"\s+//[^\n]*", "", no_line)


def fail(messages: list[str]) -> int:
    print("Wrangler config validation FAILED:")
    for line in messages:
        print(f"  - {line}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", help="Path to the (rendered) wrangler.jsonc")
    parser.add_argument(
        "--require-database-id",
        action="store_true",
        help="Fail if d1_databases[0].database_id is missing or a placeholder",
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    if not config_path.exists():
        return fail([f"config not found: {config_path}"])

    raw = config_path.read_text(encoding="utf-8")
    try:
        config = json.loads(strip_jsonc_comments(raw))
    except json.JSONDecodeError as exc:
        return fail([f"could not parse {config_path}: {exc}"])

    problems: list[str] = []

    main_path_str = config.get("main")
    if not main_path_str:
        problems.append("missing 'main' field")
    else:
        main_path = Path(main_path_str)
        if not main_path.is_absolute():
            main_path = (config_path.parent / main_path).resolve()
        if not main_path.is_file():
            problems.append(f"main file not found: {main_path}")

    assets = config.get("assets") or {}
    assets_dir_str = assets.get("directory")
    if not assets_dir_str:
        problems.append("missing assets.directory")
    else:
        assets_dir = Path(assets_dir_str)
        if not assets_dir.is_absolute():
            assets_dir = (config_path.parent / assets_dir).resolve()
        if not assets_dir.is_dir():
            problems.append(f"assets.directory not found: {assets_dir}")
        elif not any(assets_dir.iterdir()):
            problems.append(f"assets.directory is empty: {assets_dir}")

    bindings = config.get("d1_databases") or []
    if not bindings:
        problems.append("d1_databases is missing or empty")
    else:
        first = bindings[0]
        if not first.get("binding"):
            problems.append("d1_databases[0].binding is missing")
        if args.require_database_id:
            db_id = (first.get("database_id") or "").strip()
            if not db_id or "REPLACE" in db_id.upper():
                problems.append("d1_databases[0].database_id is missing or a placeholder")
            else:
                try:
                    uuid.UUID(db_id)
                except ValueError:
                    problems.append(f"d1_databases[0].database_id is not a UUID: {db_id}")

    if not config.get("name"):
        problems.append("Worker name (top-level 'name') is missing")

    if problems:
        return fail(problems)

    print(f"OK: {config_path}")
    print(f"  name={config.get('name')}")
    print(f"  main={config.get('main')}")
    print(f"  assets.directory={assets.get('directory')}")
    if bindings:
        b = bindings[0]
        print(f"  d1.database_id={b.get('database_id')}")
        print(f"  d1.database_name={b.get('database_name')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
