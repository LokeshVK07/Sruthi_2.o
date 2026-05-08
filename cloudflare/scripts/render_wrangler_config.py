#!/usr/bin/env python3
"""
Render a deploy-time copy of cloudflare/wrangler.jsonc with overrides.

Why this exists:
    Wrangler resolves `main` and `assets.directory` relative to the config
    file's location. The CI workflow renders configs into a temporary
    `.release/` folder (so we can have one config-per-slot without cluttering
    the repo), and that breaks the relative paths. This script fixes the
    paths *before* writing the rendered file so wrangler always sees real
    files no matter where the rendered config lives.

Usage:
    python cloudflare/scripts/render_wrangler_config.py \\
        --base cloudflare/wrangler.jsonc \\
        --output .release/wrangler.staging.jsonc \\
        --database-id <uuid> \\
        --database-name sruthi-catalog-blue \\
        --worker-name sruthi-2o
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def strip_jsonc_comments(text: str) -> str:
    """Remove `//` and `/* */` comments so the file parses with json.loads.

    Wrangler accepts JSONC (JSON with comments); Python's json module does
    not. This is a deliberately conservative stripper — it does not try to
    handle comment markers inside strings, but our wrangler.jsonc never has
    those.
    """
    no_block = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    no_line = re.sub(r"(?m)^\s*//.*$", "", no_block)
    no_inline = re.sub(r"\s+//[^\n]*", "", no_line)
    return no_inline


def absolutise(path_str: str, base_dir: Path) -> str:
    """Resolve a wrangler-relative path to an absolute path string."""
    candidate = Path(path_str)
    if not candidate.is_absolute():
        candidate = (base_dir / candidate).resolve()
    return str(candidate)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a wrangler config with overrides")
    # `--base` is the historical flag; `--input` is the alias used by the
    # background-refresh workflow. They're interchangeable.
    parser.add_argument("--base", "--input", dest="base", default="cloudflare/wrangler.jsonc")
    parser.add_argument("--output", required=True, help="Where to write the rendered config")
    parser.add_argument("--database-id", help="Override d1_databases[0].database_id")
    parser.add_argument("--database-name", help="Override d1_databases[0].database_name")
    parser.add_argument("--worker-name", help="Override the Worker name (top-level `name`)")
    parser.add_argument("--account-id", help="Set top-level account_id (CI uses this so wrangler doesn't prompt)")
    parser.add_argument("--main", help="Override `main` (defaults to absolute version of base)")
    parser.add_argument("--assets-directory", help="Override assets.directory")
    args = parser.parse_args()

    base_path = Path(args.base).resolve()
    if not base_path.exists():
        print(f"error: base config not found at {base_path}", file=sys.stderr)
        return 2

    base_dir = base_path.parent
    raw = base_path.read_text(encoding="utf-8")
    try:
        config = json.loads(strip_jsonc_comments(raw))
    except json.JSONDecodeError as exc:
        print(f"error: failed to parse {base_path} as JSONC: {exc}", file=sys.stderr)
        return 2

    # Always pin paths to absolute so the rendered config can live anywhere.
    config["main"] = absolutise(args.main or config.get("main", "src/worker.js"), base_dir)
    if "assets" not in config:
        config["assets"] = {}
    asset_dir = args.assets_directory or config["assets"].get("directory", "./public")
    config["assets"]["directory"] = absolutise(asset_dir, base_dir)

    if args.worker_name:
        config["name"] = args.worker_name

    if args.account_id:
        config["account_id"] = args.account_id

    if args.database_id or args.database_name:
        if not config.get("d1_databases"):
            config["d1_databases"] = [{"binding": "DB"}]
        binding = config["d1_databases"][0]
        if args.database_id:
            binding["database_id"] = args.database_id
        if args.database_name:
            binding["database_name"] = args.database_name

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Rendered configs are pure JSON (no comments) so wrangler parses them
    # the same way regardless of which CI runner version we land on.
    output_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"rendered {output_path}")
    print(f"  name           = {config.get('name')}")
    print(f"  main           = {config.get('main')}")
    print(f"  assets.dir     = {config['assets']['directory']}")
    if config.get("d1_databases"):
        b = config["d1_databases"][0]
        print(f"  d1.database_id = {b.get('database_id')}")
        print(f"  d1.name        = {b.get('database_name')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
