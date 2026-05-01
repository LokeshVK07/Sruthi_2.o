from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def deterministic_id(*parts: str) -> str:
    return hashlib.sha1("::".join(parts).encode()).hexdigest()


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))


def slugify(value: str) -> str:
    clean = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in clean:
        clean = clean.replace("--", "-")
    return clean.strip("-")
