#!/usr/bin/env python3
"""
Convenience launcher for the local Vibe 2.o FastAPI server.

This file mirrors `npm --workspace @melodify/api run dev` so anyone (or any
CI step) running `python server.py` from the repo root gets the same API
that's running on http://localhost:4000 during development.

The background-refresh workflow lists this file under "required_files" so
its presence indicates a sane checkout; the workflow itself doesn't invoke
it (CI doesn't need a local web server to deploy the Cloudflare Worker).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
API_DIR = REPO_ROOT / "apps/api"


def main() -> int:
    if not API_DIR.exists():
        print(f"error: apps/api not found at {API_DIR}", file=sys.stderr)
        return 1

    env = dict(os.environ)
    # Make `app.*` resolvable regardless of where this is launched from.
    pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(API_DIR) + (os.pathsep + pythonpath if pythonpath else "")

    cmd = [sys.executable, "-m", "app.scripts.run_server", *sys.argv[1:]]
    print("$ " + " ".join(cmd))
    completed = subprocess.run(cmd, cwd=str(API_DIR), env=env)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
