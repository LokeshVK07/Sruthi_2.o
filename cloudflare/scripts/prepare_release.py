#!/usr/bin/env python3
"""
Read .release/active-slot.json (the slot-state marker) and emit shell-style
key=value lines describing which slot we should write to next.

The workflow does:
    eval "$(python cloudflare/scripts/prepare_release.py --emit-env)"
…to populate INACTIVE_SLOT, INACTIVE_DB_ID, INACTIVE_DB_NAME, ACTIVE_SLOT,
ACTIVE_DB_ID, ACTIVE_DB_NAME for the rest of the workflow steps.

Slot bookkeeping:
    .release/active-slot.json holds the *currently live* slot identifier.
    The "inactive" slot is whichever one isn't live. This script reads the
    file, looks up the matching env var for the inactive slot's database id
    (CLOUDFLARE_D1_<SLOT>_DATABASE_ID — uppercased) and emits the next-state
    plan.

When promoting (after a successful deploy), use --promote to write the
updated marker file flipping the active/inactive labels.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

DEFAULT_MARKER = Path(".release/active-slot.json")
DEFAULT_SLOTS = ("primary", "secondary")


def env_var_for_slot(slot: str) -> str:
    return f"CLOUDFLARE_D1_{slot.upper()}_DATABASE_ID"


def load_marker(path: Path) -> dict:
    if not path.exists():
        # Bootstrap default: "primary" is live, secondary is the inactive one
        # that the next refresh will write to.
        return {
            "active": DEFAULT_SLOTS[0],
            "inactive": DEFAULT_SLOTS[1],
            "updated_at": None,
            "deployment_id": None,
        }
    return json.loads(path.read_text(encoding="utf-8"))


def shell_quote(value: str) -> str:
    # Single-quote and escape any embedded single quote.
    return "'" + value.replace("'", "'\\''") + "'"


def emit_env(state: dict, slots: tuple[str, ...]) -> int:
    active = state.get("active") or slots[0]
    inactive = state.get("inactive") or (slots[1] if active == slots[0] else slots[0])

    active_id = os.environ.get(env_var_for_slot(active), "").strip()
    inactive_id = os.environ.get(env_var_for_slot(inactive), "").strip()
    if not active_id:
        print(f"error: env var {env_var_for_slot(active)} is empty", file=sys.stderr)
        return 2
    if not inactive_id:
        print(f"error: env var {env_var_for_slot(inactive)} is empty", file=sys.stderr)
        return 2
    if active_id == inactive_id:
        print("error: active and inactive slots resolve to the same database id",
              file=sys.stderr)
        return 2

    base_name = os.environ.get("WRANGLER_DATABASE_BASENAME", "sruthi-catalog")

    pairs = [
        ("ACTIVE_SLOT", active),
        ("ACTIVE_DB_ID", active_id),
        ("ACTIVE_DB_NAME", f"{base_name}-{active}"),
        ("INACTIVE_SLOT", inactive),
        ("INACTIVE_DB_ID", inactive_id),
        ("INACTIVE_DB_NAME", f"{base_name}-{inactive}"),
    ]
    for key, value in pairs:
        print(f"export {key}={shell_quote(value)}")
    return 0


def promote(marker_path: Path, deployment_id: str | None) -> int:
    state = load_marker(marker_path)
    new_active = state.get("inactive") or DEFAULT_SLOTS[1]
    new_inactive = state.get("active") or DEFAULT_SLOTS[0]
    next_state = {
        "active": new_active,
        "inactive": new_inactive,
        "updated_at": datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat(),
        "deployment_id": deployment_id,
    }
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(json.dumps(next_state, indent=2) + "\n", encoding="utf-8")
    print(f"promoted: active={new_active}, inactive={new_inactive}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--marker", type=Path, default=DEFAULT_MARKER)
    parser.add_argument("--emit-env", action="store_true",
                        help="Print export lines for the next refresh")
    parser.add_argument("--promote", action="store_true",
                        help="Flip the marker file so the previous inactive slot is now active")
    parser.add_argument("--deployment-id", default=os.environ.get("GITHUB_RUN_ID", ""))
    args = parser.parse_args()

    if args.emit_env == args.promote:
        print("error: pass exactly one of --emit-env or --promote", file=sys.stderr)
        return 2

    state = load_marker(args.marker)
    if args.promote:
        return promote(args.marker, args.deployment_id or None)
    return emit_env(state, DEFAULT_SLOTS)


if __name__ == "__main__":
    raise SystemExit(main())
