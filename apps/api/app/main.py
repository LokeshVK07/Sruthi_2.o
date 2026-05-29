from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .cache import cache_status, trim_cache
from .config import FRONTEND_DIST_DIR, WEB_ORIGIN, WARMUP_BATCH_SIZE, STREAM_PREFETCH_LIMIT
from .db import init_db
from .playback import (
    prefetch_status,
    public_song_status,
    queue_album_prefetch,
    queue_prefetch,
    stream_song,
    warmup_song,
)
from .refresh import get_refresh_status, start_refresh_worker, trigger_refresh
from .repository import (
    album_song_ids,
    composer_songs,
    count_albums,
    count_songs,
    get_album_by_id,
    get_frontend_song,
    get_frontend_songs,
    get_song,
    list_albums,
    list_composers,
    list_favorites,
    list_frontend_library,
    list_library,
    list_playlists,
    list_recently_played,
    next_songs_for_prefetch,
    recent_for_warmup,
    record_recently_played,
    reset_scraped_catalog,
    search_albums,
    search_artists,
    search_composers,
    search_frontend_songs,
    search_songs,
    toggle_favorite,
    list_processed_album_urls,
    upsert_direct_export_albums,
)
from .scraper import site_scraper


app = FastAPI(title="Vibe 2.o API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        WEB_ORIGIN,
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://www.masstamilan.dev",
        "https://masstamilan.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_index = FRONTEND_DIST_DIR / "index.html"
frontend_assets = FRONTEND_DIST_DIR / "assets"
if frontend_assets.exists():
    app.mount("/assets", StaticFiles(directory=frontend_assets), name="assets")


@app.on_event("startup")
def startup():
    init_db()
    start_refresh_worker()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "cache": cache_status(),
        "libraryCount": count_songs(),
        "albumCount": count_albums(),
        "prefetch": prefetch_status(),
    }


@app.get("/api/library")
def library():
    return {"items": [song.model_dump() for song in list_library(count_songs())]}


@app.get("/api/library/home")
def library_home():
    library_items = list_frontend_library(18)
    favorites = list_favorites(12)
    recently_played = list_recently_played(8)
    artists: dict[str, int] = {}
    for song in library_items:
        artists[song.artist] = artists.get(song.artist, 0) + 1
    artist_list = [{"artist": artist, "songCount": count} for artist, count in sorted(artists.items(), key=lambda item: (-item[1], item[0]))[:8]]
    return {
        "heroGreeting": "Good afternoon.",
        "recentlyPlayed": [song.model_dump() for song in recently_played],
        "library": [song.model_dump() for song in library_items],
        "favorites": [song.model_dump() for song in favorites],
        "artists": artist_list,
        "stats": {
            "songCount": count_songs(),
            "albumCount": count_albums(),
        },
    }


@app.get("/api/library/songs")
def library_songs(limit: int = 800):
    bounded = max(1, min(limit, 5000))
    return {"items": [song.model_dump() for song in list_frontend_library(bounded)]}


@app.get("/api/albums")
def albums():
    return {"items": [album.model_dump() for album in list_albums(count_albums())]}


@app.get("/api/albums/{album_id}")
def album(album_id: str):
    payload = get_album_by_id(album_id)
    if not payload:
        raise HTTPException(404, "Album not found")
    queue_album_prefetch(album_id, 6, refresh_links=True)
    return payload


@app.get("/api/song/{song_id}")
def song(song_id: str):
    row = get_frontend_song(song_id)
    if not row:
        raise HTTPException(404, "Song not found")
    return row.model_dump()


@app.get("/api/search")
def search(q: str):
    return {"items": [song.model_dump() for song in search_frontend_songs(q)]}


@app.get("/api/search/all")
def search_all(q: str, limit: int = 20):
    """Grouped search across tracks, albums, artists, and composers.

    The frontend uses this to drive its global search UI in one round-trip;
    each section is independently capped so a noisy track match can't crowd
    out album/artist hits.
    """
    bounded = max(1, min(limit, 50))
    tracks = search_frontend_songs(q, limit=bounded)
    albums = search_albums(q, limit=min(bounded, 20))
    artists = search_artists(q, limit=12)
    composers = search_composers(q, limit=12)
    return {
        "query": q,
        "tracks": [song.model_dump() for song in tracks],
        "albums": [album.model_dump() for album in albums],
        "artists": artists,
        "composers": composers,
    }


@app.get("/api/favorites")
def favorites():
    return {"items": [song.model_dump() for song in list_favorites(500)]}


@app.post("/api/favorites/{song_id}/toggle")
def favorites_toggle(song_id: str):
    if not get_song(song_id):
        raise HTTPException(404, "Song not found")
    return {"active": toggle_favorite(song_id)}


@app.get("/api/playlists")
def playlists():
    return {"items": [playlist.model_dump() for playlist in list_playlists()]}


@app.get("/api/composers")
def composers(limit: int = 40, min_songs: int = 8):
    items = list_composers(limit=max(1, min(limit, 200)), min_songs=max(1, min_songs))
    return {"items": [item.model_dump() for item in items]}


@app.get("/api/composers/{slug}/songs")
def composer_detail(slug: str, limit: int = 200):
    name, items = composer_songs(slug, limit=max(1, min(limit, 500)))
    if not name:
        raise HTTPException(404, "Composer not found")
    return {
        "slug": slug,
        "name": name,
        "songCount": len(items),
        "items": [song.model_dump() for song in items],
    }


@app.post("/api/recently-played/{song_id}")
def recently_played(song_id: str):
    if not record_recently_played(song_id):
        raise HTTPException(404, "Song not found")
    return {"ok": True}


@app.get("/api/processed")
def processed_album_urls():
    return {"processedUrls": list_processed_album_urls()}


@app.post("/api/catalog/batch")
async def catalog_batch(request: Request):
    payload = await request.json()
    albums = payload.get("albums") if isinstance(payload, dict) else None
    if not isinstance(albums, list):
        raise HTTPException(400, "albums must be an array")
    return upsert_direct_export_albums(albums)


@app.post("/api/catalog/reset")
def catalog_reset():
    return reset_scraped_catalog()


@app.post("/api/admin/scrape")
def admin_scrape(page: int = 1, limit: int = 1, incremental: bool = False, full_scan: bool = False):
    summary = site_scraper.scrape_site(page_from=page, page_to=page + limit - 1, incremental=incremental, full_scan=full_scan)
    return summary.model_dump()


@app.post("/api/admin/scrape-album")
def admin_scrape_album(album_url: str):
    album = site_scraper.scrape_album_url(album_url)
    from .repository import upsert_album

    is_new, songs = upsert_album(album)
    return {"ok": True, "album": album.album_name, "isNew": is_new, "songs": songs}


@app.post("/api/warmup")
async def warmup(request: Request):
    limit = WARMUP_BATCH_SIZE
    try:
        payload = await request.json()
        if isinstance(payload, dict) and payload.get("limit") is not None:
            limit = max(1, min(int(payload["limit"]), 96))
    except Exception:
        payload = None
    queued = 0
    for song_id in recent_for_warmup(limit):
        warmup_song(song_id)
        queued += 1
    return {"ok": True, "queued": queued}


@app.post("/api/media/reindex")
def media_reindex():
    init_db()
    return {
        "summary": {
            "albumCount": count_albums(),
            "songCount": count_songs(),
        },
        "refresh": get_refresh_status(),
    }


@app.post("/api/prefetch")
async def prefetch(request: Request):
    payload = await request.json()
    song_ids = payload.get("songIds") or payload.get("ids") or []
    if not isinstance(song_ids, list):
        raise HTTPException(400, "songIds/ids must be a list")
    queued = queue_prefetch([str(song_id) for song_id in song_ids], STREAM_PREFETCH_LIMIT)
    return {"ok": True, "queued": queued}


@app.post("/api/songs-batch")
async def songs_batch(request: Request):
    payload = await request.json()
    song_ids = payload.get("ids") or payload.get("songIds") or []
    if not isinstance(song_ids, list):
        raise HTTPException(400, "ids must be a list")
    songs = [song.model_dump() for song in get_frontend_songs([str(song_id) for song_id in song_ids])]
    return {"songs": songs}


@app.post("/api/prefetch/album")
async def prefetch_album(request: Request):
    payload = await request.json()
    album_id = payload.get("albumId")
    song_id = payload.get("songId")
    lead_limit = int(payload.get("leadLimit") or payload.get("limit") or 4)
    refresh_links = bool(payload.get("refreshLinks"))
    if not album_id and song_id:
        song = get_song(str(song_id))
        album_id = song.album_id if song else None
    if not album_id:
        raise HTTPException(400, "albumId or songId is required")
    song_ids = album_song_ids(str(album_id))
    if not song_ids:
        raise HTTPException(404, "Album not found")
    queued = queue_album_prefetch(str(album_id), max(1, min(lead_limit, 8)), refresh_links=refresh_links)
    return {"ok": True, "queued": int(queued), "queuedAlbums": int(queued), "queuedSongs": 0, "songCount": len(song_ids), "albumSongCount": len(song_ids)}


@app.post("/api/refresh/request")
async def refresh_request(request: Request):
    payload = await request.json()
    song_id = str(payload.get("id") or payload.get("songId") or "").strip()
    if not song_id:
        raise HTTPException(400, "Song id is required")
    song = get_song(song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    queued = queue_album_prefetch(song.album_id, 4, refresh_links=True)
    return {
        "queued": bool(queued),
        "workerActive": True,
        "queueLength": 1 if queued else 0,
    }


@app.post("/api/refresh/result")
async def refresh_result(request: Request):
    payload = await request.json()
    return {
        "ok": bool(payload.get("ok")),
        "status": {
            "songId": payload.get("id") or payload.get("songId"),
            "message": payload.get("message") or "Refresh result accepted.",
        },
    }


@app.post("/api/refresh/heartbeat")
def refresh_heartbeat():
    status = get_refresh_status()
    return {"ok": True, "workerActive": status.get("status") not in {"idle", "error"}, "queueLength": 0}


@app.post("/api/playback/prefetch")
async def playback_prefetch(request: Request):
    payload = await request.json()
    song_id = payload.get("songId")
    if not song_id:
        raise HTTPException(400, "songId is required")
    next_song_ids = next_songs_for_prefetch(song_id, STREAM_PREFETCH_LIMIT)
    return {"queued": queue_prefetch(next_song_ids, STREAM_PREFETCH_LIMIT)}


@app.get("/api/cache/status")
def cache_status_route():
    payload = cache_status()
    payload.update(prefetch_status())
    return payload


@app.get("/api/refresh/status")
def refresh_status_route():
    return get_refresh_status()


@app.post("/api/refresh/check")
def refresh_check_route():
    return trigger_refresh(force=False)


@app.post("/api/cache/trim")
def cache_trim():
    return trim_cache()


@app.get("/api/song-status/{song_id}")
def song_status_route(song_id: str):
    payload = public_song_status(song_id)
    if not payload:
        raise HTTPException(404, "Song not found")
    return payload.model_dump()


@app.get("/api/stream/{song_id}")
def stream(song_id: str, request: Request):
    try:
        result = stream_song(song_id, dict(request.headers))
    except FileNotFoundError as exc:
        print(f"[stream] not-found {song_id}: {exc}")
        return JSONResponse(
            {"ok": False, "songId": song_id, "reason": "missing", "detail": str(exc)},
            status_code=404,
            headers={"x-melodify-error": "missing"},
        )
    except Exception as exc:
        print(f"[stream] upstream-fail {song_id}: {exc}")
        return JSONResponse(
            {"ok": False, "songId": song_id, "reason": "unavailable", "detail": str(exc)},
            status_code=502,
            headers={"x-melodify-error": "unavailable"},
        )

    if result["type"] == "cache":
        return FileResponse(result["path"], media_type=result["content_type"], headers=result.get("headers"))

    if result["type"] == "cache-stream":
        return StreamingResponse(
            result["iterator"],
            status_code=result["status_code"],
            media_type=result["content_type"],
            headers=result.get("headers"),
        )

    return StreamingResponse(result["iterator"], status_code=result["status_code"], media_type=result["content_type"], headers=result.get("headers"))


@app.get("/", include_in_schema=False)
def frontend_root():
    if frontend_index.exists():
        return FileResponse(frontend_index)
    return JSONResponse({"ok": True, "message": "Frontend build not found. Run the web build first."}, status_code=503)


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_catchall(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not found")

    target = FRONTEND_DIST_DIR / full_path
    if target.is_file():
        return FileResponse(target)

    if frontend_index.exists():
        return FileResponse(frontend_index)

    return JSONResponse({"ok": True, "message": "Frontend build not found. Run the web build first."}, status_code=503)
