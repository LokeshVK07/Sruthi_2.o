import httpx

base = "http://127.0.0.1:4000"
health = httpx.get(f"{base}/api/health", timeout=30)
health.raise_for_status()
refresh_status = httpx.get(f"{base}/api/refresh/status", timeout=30)
refresh_status.raise_for_status()
library = httpx.get(f"{base}/api/library", timeout=30)
library.raise_for_status()
items = library.json().get("items", [])
if not items:
    raise SystemExit("Smoke test failed: no songs in library")
if not items[0]["audioUrl"].startswith("/api/stream/"):
    raise SystemExit("Smoke test failed: audioUrl is not backend-controlled")
if "status" not in refresh_status.json():
    raise SystemExit("Smoke test failed: refresh status payload missing status")
print("Smoke test passed.")
