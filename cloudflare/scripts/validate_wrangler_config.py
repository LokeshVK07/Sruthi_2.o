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

from jsonc_utils import load_jsonc


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
    parser.add_argument(
        "--require-account-id",
        action="store_true",
        help="Fail if top-level account_id is missing",
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    if not config_path.exists():
        return fail([f"config not found: {config_path}"])

    try:
        config = load_jsonc(config_path)
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
        elif not (assets_dir / "index.html").is_file():
            problems.append(f"assets.directory is missing index.html: {assets_dir}")
        else:
            index_html = assets_dir / "index.html"
            try:
                html = index_html.read_text(encoding="utf-8")
            except OSError as exc:
                problems.append(f"could not read assets index.html: {exc}")
            else:
                # Wrangler only checks that the asset directory exists. This
                # catches stale/partial frontend builds where index.html points
                # at hashed Vite files that were not uploaded with the Worker.
                refs = re.findall(r"""(?:src|href)=["']/?(assets/[^"']+)["']""", html)
                missing_refs = [ref for ref in refs if not (assets_dir / ref).is_file()]
                if missing_refs:
                    problems.append("index.html references missing asset files: " + ", ".join(missing_refs))
                if (assets_dir / "assets").is_dir():
                    vite_js = list((assets_dir / "assets").glob("index-*.js"))
                    vite_css = list((assets_dir / "assets").glob("index-*.css"))
                    if not vite_js:
                        problems.append(f"Vite JS bundle is missing under {assets_dir / 'assets'}")
                    if not vite_css:
                        problems.append(f"Vite CSS bundle is missing under {assets_dir / 'assets'}")

    bindings = config.get("d1_databases") or []
    if not bindings:
        problems.append("d1_databases is missing or empty")
    else:
        first = bindings[0]
        if not first.get("binding"):
            problems.append("d1_databases[0].binding is missing")
        if not first.get("database_name"):
            problems.append("d1_databases[0].database_name is missing")
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
    if args.require_account_id and not config.get("account_id"):
        problems.append("account_id is missing")

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
