#!/usr/bin/env python3
"""Small JSONC helpers for Wrangler config scripts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def strip_jsonc_comments(text: str) -> str:
    """Strip JSONC comments without touching comment markers inside strings."""
    out: list[str] = []
    in_string = False
    escaped = False
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            i += 2
            while i < len(text) and text[i] not in "\r\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < len(text) and not (text[i] == "*" and text[i + 1] == "/"):
                if text[i] in "\r\n":
                    out.append(text[i])
                i += 1
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def load_jsonc(path: Path) -> Any:
    return json.loads(strip_jsonc_comments(path.read_text(encoding="utf-8")))
