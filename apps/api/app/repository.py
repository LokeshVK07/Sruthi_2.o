from __future__ import annotations

from dataclasses import dataclass
import sqlite3
from typing import Any

from .config import DATABASE_PATH
from .db import ensure_database_ready, get_connection, transaction
from .schemas import AlbumRecord, ComposerSummary, FrontendSong, PlaylistSummary, PublicSong, ScrapedAlbum, SongRecord, SongStatus
from .utils import canonicalize_url, deterministic_id, now_utc, slugify


DEFAULT_USER_ID = "local-user"


@dataclass(frozen=True)
class AlbumUpsertResult:
    album_is_new: bool
    songs_seen: int
    songs_added: int
    songs_updated: int


def make_album_id(album_url: str, album_name: str) -> str:
    return deterministic_id("album", canonicalize_url(album_url), slugify(album_name))


def make_song_id(album_url: str, track_number: int) -> str:
    return deterministic_id("song", canonicalize_url(album_url), str(track_number))


def create_scrape_run() -> str:
    run_id = deterministic_id("scrape-run", str(now_utc().timestamp()))
    get_connection().execute(
        "INSERT INTO scrape_runs (run_id, started_at, status) VALUES (?, ?, ?)",
        [run_id, now_utc(), "running"],
    )
    return run_id


def finish_scrape_run(run_id: str, **updates: Any) -> None:
    conn = get_connection()
    conn.execute(
        """
        UPDATE scrape_runs
        SET finished_at = ?, pages_scraped = ?, albums_new = ?, albums_updated = ?, albums_failed = ?, songs_total = ?, status = ?
        WHERE run_id = ?
        """,
        [
            now_utc(),
            updates.get("pages_scraped", 0),
            updates.get("albums_new", 0),
            updates.get("albums_updated", 0),
            updates.get("albums_failed", 0),
            updates.get("songs_total", 0),
            updates.get("status", "success"),
            run_id,
        ],
    )


def known_album_urls(urls: list[str]) -> set[str]:
    if not urls:
        return set()
    conn = get_connection()
    placeholders = ",".join("?" for _ in urls)
    rows = conn.execute(
        f"SELECT album_url FROM albums WHERE album_url IN ({placeholders})",
        [canonicalize_url(url) for url in urls],
    ).fetchall()
    return {row[0] for row in rows}


def list_album_urls() -> list[str]:
    rows = get_connection().execute(
        """
        SELECT album_url
        FROM albums
        ORDER BY updated_at DESC, album_name ASC
        """
    ).fetchall()
    return [str(row[0]) for row in rows]


def list_album_urls_for_rescrape(limit: int) -> list[str]:
    """Return a prioritised, capped slice of album URLs to rescrape.

    Priority order (highest first):
        1. Albums where one or more songs are missing both 320 and 128 URLs
           (broken/expired playable links — the most user-visible problem).
        2. Albums with zero songs registered (likely a scrape that bailed
           halfway).
        3. Albums whose updated_at is oldest (oldest stale metadata).

    Used by --max-rescrape so a manual full refresh doesn't try to walk
    every single one of the ~4 700 known albums each run — pick the top N
    that most need attention.
    """
    if limit <= 0:
        return []
    rows = get_connection().execute(
        """
        SELECT a.album_url
        FROM albums a
        LEFT JOIN (
            SELECT album_url,
                   COUNT(*) AS song_count,
                   SUM(CASE
                         WHEN coalesce(url_320kbps,'') = ''
                          AND coalesce(url_128kbps,'') = '' THEN 1 ELSE 0 END
                   ) AS missing_url_count
            FROM songs
            GROUP BY album_url
        ) s ON s.album_url = a.album_url
        ORDER BY
            CASE WHEN coalesce(s.missing_url_count, 0) > 0 THEN 0 ELSE 1 END,
            CASE WHEN coalesce(s.song_count, 0) = 0 THEN 0 ELSE 1 END,
            datetime(a.updated_at) ASC,
            a.album_name ASC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    return [str(row[0]) for row in rows]


def upsert_album_details(album: ScrapedAlbum) -> AlbumUpsertResult:
    conn = get_connection()
    album_url = canonicalize_url(album.album_url)
    existing = conn.execute(
        "SELECT album_url, album_id, first_seen_at FROM albums WHERE album_url = ? OR album_id = ?",
        [album_url, album.album_id],
    ).fetchone()
    now = now_utc()
    stored_album_url = existing[0] if existing else album_url
    album_id = existing[1] if existing else album.album_id
    first_seen = existing[2] if existing else now
    is_new = existing is None
    songs_added = 0
    songs_updated = 0

    with transaction() as tx:
        tx.execute(
            """
            INSERT INTO albums (
              album_url, album_id, album_name, year, music_director, singers_summary,
              image_url, language, track_count, scrape_ok, first_seen_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(album_url) DO UPDATE SET
              album_id = excluded.album_id,
              album_name = excluded.album_name,
              year = COALESCE(excluded.year, albums.year),
              music_director = COALESCE(excluded.music_director, albums.music_director),
              singers_summary = COALESCE(excluded.singers_summary, albums.singers_summary),
              image_url = COALESCE(excluded.image_url, albums.image_url),
              language = COALESCE(excluded.language, albums.language),
              track_count = excluded.track_count,
              scrape_ok = excluded.scrape_ok,
              updated_at = excluded.updated_at
            """,
            [
                stored_album_url,
                album_id,
                album.album_name,
                album.year,
                album.music_director,
                album.singers_summary,
                album.image_url,
                album.language,
                len(album.songs),
                True,
                first_seen,
                now,
            ],
        )

        for song in album.songs:
            song_id = make_song_id(stored_album_url, song.track_number)
            existing_song = conn.execute("SELECT first_seen_at FROM songs WHERE song_id = ?", [song_id]).fetchone()
            song_first_seen = existing_song[0] if existing_song else now
            if existing_song:
                songs_updated += 1
            else:
                songs_added += 1
            tx.execute(
                """
                INSERT INTO songs (
                  song_id, album_url, album_id, album_name, year, music_director, singers,
                  track_number, track_name, image_url, url_128kbps, url_320kbps, first_seen_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(song_id) DO UPDATE SET
                  album_url = excluded.album_url,
                  album_id = excluded.album_id,
                  album_name = excluded.album_name,
                  year = COALESCE(excluded.year, songs.year),
                  music_director = COALESCE(excluded.music_director, songs.music_director),
                  singers = COALESCE(excluded.singers, songs.singers),
                  track_number = excluded.track_number,
                  track_name = excluded.track_name,
                  image_url = COALESCE(excluded.image_url, songs.image_url),
                  url_128kbps = COALESCE(excluded.url_128kbps, songs.url_128kbps),
                  url_320kbps = COALESCE(excluded.url_320kbps, songs.url_320kbps),
                  updated_at = excluded.updated_at
                """,
                [
                    song_id,
                    stored_album_url,
                    album_id,
                    album.album_name,
                    album.year,
                    album.music_director,
                    song.singers,
                    song.track_number,
                    song.track_name,
                    song.image_url or album.image_url,
                    song.url_128kbps,
                    song.url_320kbps,
                    song_first_seen,
                    now,
                ],
            )

    return AlbumUpsertResult(
        album_is_new=is_new,
        songs_seen=len(album.songs),
        songs_added=songs_added,
        songs_updated=songs_updated,
    )


def upsert_album(album: ScrapedAlbum) -> tuple[bool, int]:
    result = upsert_album_details(album)
    return result.album_is_new, result.songs_seen


def _favorite_song_ids(user_id: str = DEFAULT_USER_ID) -> set[str]:
    rows = get_connection().execute("SELECT song_id FROM favorites WHERE user_id = ?", [user_id]).fetchall()
    return {row[0] for row in rows}


def _backup_database_path() -> Any:
    return DATABASE_PATH.with_suffix(".snapshot-backup.sqlite3")


def _read_backup_rows(query: str, params: list[Any]) -> list[sqlite3.Row]:
    backup_path = _backup_database_path()
    if not backup_path.exists():
        return []
    connection = sqlite3.connect(f"file:{backup_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(query, params).fetchall()
    except Exception:
        return []
    finally:
        connection.close()


def _song_projection_query(where_clause: str) -> str:
    return f"""
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs
        WHERE {where_clause}
    """


def _song_row_by_id(song_id: str) -> sqlite3.Row | None:
    row = get_connection().execute(_song_projection_query("song_id = ?"), [song_id]).fetchone()
    if row:
        return row
    rows = _read_backup_rows(_song_projection_query("song_id = ?"), [song_id])
    return rows[0] if rows else None


def _song_rows_by_ids(song_ids: list[str]) -> dict[str, Any]:
    if not song_ids:
        return {}
    placeholders = ",".join("?" for _ in song_ids)
    rows = get_connection().execute(
        _song_projection_query(f"song_id IN ({placeholders})"),
        song_ids,
    ).fetchall()
    mapped = {str(row[0]): row for row in rows}
    missing = [song_id for song_id in song_ids if song_id not in mapped]
    if missing:
        backup_rows = _read_backup_rows(
            _song_projection_query(f"song_id IN ({','.join('?' for _ in missing)})"),
            missing,
        )
        for row in backup_rows:
            mapped.setdefault(str(row[0]), row)
    return mapped


def _map_public_song(row, favorite_ids: set[str] | None = None) -> FrontendSong:
    favorite_ids = favorite_ids or set()
    public = PublicSong(
        song_id=row[0],
        album_id=row[1],
        album_name=row[2],
        year=row[3],
        music_director=row[4],
        singers=row[5],
        track_number=row[6],
        track_name=row[7],
        image_url=row[8],
        audioUrl=f"/api/stream/{row[0]}",
        updated_at=row[9],
    )
    return FrontendSong(
        id=public.song_id,
        title=public.track_name,
        artist=public.singers or public.music_director or public.album_name,
        albumTitle=public.album_name,
        albumId=public.album_id,
        artworkUrl=public.image_url,
        audioUrl=public.audioUrl,
        streamUrl=public.audioUrl,
        favorite=public.song_id in favorite_ids,
        year=public.year,
        composer=public.music_director,
        trackNumber=public.track_number,
        updatedAt=public.updated_at,
    )


def list_library(limit: int = 1000) -> list[PublicSong]:
    rows = get_connection().execute(
        """
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs
        ORDER BY updated_at DESC, album_name ASC, track_number ASC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    return [
        PublicSong(
            song_id=row[0],
            album_id=row[1],
            album_name=row[2],
            year=row[3],
            music_director=row[4],
            singers=row[5],
            track_number=row[6],
            track_name=row[7],
            image_url=row[8],
            audioUrl=f"/api/stream/{row[0]}",
            updated_at=row[9],
        )
        for row in rows
    ]


def count_songs() -> int:
    row = get_connection().execute("SELECT COUNT(*) FROM songs").fetchone()
    return int(row[0]) if row else 0


def count_albums() -> int:
    row = get_connection().execute("SELECT COUNT(*) FROM albums").fetchone()
    return int(row[0]) if row else 0


def list_frontend_library(limit: int = 1000, user_id: str = DEFAULT_USER_ID) -> list[FrontendSong]:
    rows = get_connection().execute(
        """
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs
        ORDER BY updated_at DESC, album_name ASC, track_number ASC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    favorite_ids = _favorite_song_ids(user_id)
    return [_map_public_song(row, favorite_ids) for row in rows]


def list_albums(limit: int = 1000) -> list[AlbumRecord]:
    cursor = get_connection().execute(
        "SELECT * FROM albums ORDER BY updated_at DESC LIMIT ?",
        [limit],
    )
    rows = cursor.fetchall()
    return [AlbumRecord(**dict(row)) for row in rows]


def get_album_by_id(album_id: str) -> dict[str, Any] | None:
    conn = get_connection()
    album = conn.execute("SELECT * FROM albums WHERE album_id = ?", [album_id]).fetchone()
    if not album:
        return None
    songs = conn.execute(
        """
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs WHERE album_id = ? ORDER BY track_number ASC
        """,
        [album_id],
    ).fetchall()
    return {
        **dict(album),
        "songs": [
            PublicSong(
                song_id=row[0],
                album_id=row[1],
                album_name=row[2],
                year=row[3],
                music_director=row[4],
                singers=row[5],
                track_number=row[6],
                track_name=row[7],
                image_url=row[8],
                audioUrl=f"/api/stream/{row[0]}",
                updated_at=row[9],
            ).model_dump()
            for row in songs
        ],
    }


def album_song_ids(album_id: str, limit: int | None = None) -> list[str]:
    query = "SELECT song_id FROM songs WHERE album_id = ? ORDER BY track_number ASC"
    params: list[Any] = [album_id]
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    rows = get_connection().execute(query, params).fetchall()
    return [row[0] for row in rows]


def album_song_ids_by_url(album_url: str, limit: int | None = None) -> list[str]:
    canonical = canonicalize_url(album_url)
    query = "SELECT song_id FROM songs WHERE album_url = ? ORDER BY track_number ASC"
    params: list[Any] = [canonical]
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    rows = get_connection().execute(query, params).fetchall()
    return [row[0] for row in rows]


def get_song(song_id: str) -> SongRecord | None:
    ensure_database_ready()
    conn = get_connection()
    row = conn.execute("SELECT * FROM songs WHERE song_id = ?", [song_id]).fetchone()
    if not row:
        backup_rows = _read_backup_rows("SELECT * FROM songs WHERE song_id = ?", [song_id])
        row = backup_rows[0] if backup_rows else None
    if not row:
        return None
    return SongRecord(**dict(row))


def get_frontend_song(song_id: str, user_id: str = DEFAULT_USER_ID) -> FrontendSong | None:
    ensure_database_ready()
    row = _song_row_by_id(song_id)
    if not row:
        return None
    return _map_public_song(row, _favorite_song_ids(user_id))


def get_frontend_songs(song_ids: list[str], user_id: str = DEFAULT_USER_ID) -> list[FrontendSong]:
    ensure_database_ready()
    ordered_ids = [str(song_id) for song_id in song_ids if str(song_id).strip()]
    rows_by_id = _song_rows_by_ids(ordered_ids)
    favorite_ids = _favorite_song_ids(user_id)
    return [_map_public_song(rows_by_id[song_id], favorite_ids) for song_id in ordered_ids if song_id in rows_by_id]


def search_songs(query: str, limit: int = 100) -> list[PublicSong]:
    normalized = query.strip().lower()
    q = f"%{normalized}%"
    prefix = f"{normalized}%"
    rows = get_connection().execute(
        """
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs
        WHERE lower(track_name) LIKE ? OR lower(album_name) LIKE ? OR lower(coalesce(singers,'')) LIKE ? OR lower(coalesce(music_director,'')) LIKE ?
        ORDER BY
          CASE
            WHEN lower(track_name) = ? THEN 0
            WHEN lower(track_name) LIKE ? THEN 1
            WHEN lower(album_name) = ? THEN 2
            WHEN lower(album_name) LIKE ? THEN 3
            WHEN lower(coalesce(singers,'')) LIKE ? THEN 4
            WHEN lower(coalesce(music_director,'')) LIKE ? THEN 5
            ELSE 6
          END,
          updated_at DESC,
          album_name ASC,
          track_number ASC
        LIMIT ?
        """,
        [q, q, q, q, normalized, prefix, normalized, prefix, prefix, prefix, limit],
    ).fetchall()
    return [
        PublicSong(
            song_id=row[0],
            album_id=row[1],
            album_name=row[2],
            year=row[3],
            music_director=row[4],
            singers=row[5],
            track_number=row[6],
            track_name=row[7],
            image_url=row[8],
            audioUrl=f"/api/stream/{row[0]}",
            updated_at=row[9],
        )
        for row in rows
    ]


def _fts_query(query: str) -> str:
    """Build an FTS5 MATCH expression that ranks prefix matches per token.

    'oorum blood' → 'oorum* OR blood* OR (oorum* AND blood*)' style
    Sanitises punctuation that FTS5 treats as syntax.
    """
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in query)
    tokens = [tok for tok in cleaned.split() if tok]
    if not tokens:
        return ""
    quoted = [f'"{tok}"*' for tok in tokens]
    if len(tokens) == 1:
        return quoted[0]
    return " AND ".join(quoted)


def search_frontend_songs(query: str, limit: int = 100, user_id: str = DEFAULT_USER_ID) -> list[FrontendSong]:
    ensure_database_ready()
    normalized = query.strip()
    if not normalized:
        return []
    conn = get_connection()
    fts_expression = _fts_query(normalized.lower())
    rows: list[Any] = []
    if fts_expression:
        try:
            rows = conn.execute(
                """
                SELECT s.song_id, s.album_id, s.album_name, s.year, s.music_director, s.singers,
                       s.track_number, s.track_name, s.image_url, s.updated_at
                FROM songs_fts f
                JOIN songs s ON s.song_id = f.song_id
                WHERE f.songs_fts MATCH ?
                ORDER BY
                  CASE WHEN lower(s.track_name) = lower(?) THEN 0 ELSE 1 END,
                  bm25(f.songs_fts, 0.0, 4.0, 2.0, 1.5, 1.0),
                  s.updated_at DESC,
                  s.album_name ASC,
                  s.track_number ASC
                LIMIT ?
                """,
                [fts_expression, normalized, limit],
            ).fetchall()
        except sqlite3.OperationalError as exc:
            print(f"[search] FTS5 query failed for {normalized!r}: {exc}; falling back to LIKE")
            rows = []

    if not rows:
        like_pattern = f"%{normalized.lower()}%"
        prefix = f"{normalized.lower()}%"
        rows = conn.execute(
            """
            SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
            FROM songs
            WHERE lower(track_name) LIKE ? OR lower(album_name) LIKE ?
                  OR lower(coalesce(singers,'')) LIKE ? OR lower(coalesce(music_director,'')) LIKE ?
            ORDER BY
              CASE
                WHEN lower(track_name) = ? THEN 0
                WHEN lower(track_name) LIKE ? THEN 1
                WHEN lower(album_name) = ? THEN 2
                WHEN lower(album_name) LIKE ? THEN 3
                WHEN lower(coalesce(singers,'')) LIKE ? THEN 4
                WHEN lower(coalesce(music_director,'')) LIKE ? THEN 5
                ELSE 6
              END,
              updated_at DESC,
              album_name ASC,
              track_number ASC
            LIMIT ?
            """,
            [like_pattern, like_pattern, like_pattern, like_pattern,
             normalized.lower(), prefix, normalized.lower(), prefix, prefix, prefix, limit],
        ).fetchall()

    favorite_ids = _favorite_song_ids(user_id)
    return [_map_public_song(row, favorite_ids) for row in rows]


def search_albums(query: str, limit: int = 12) -> list[AlbumRecord]:
    """Search albums by name and music director with simple ranking."""
    normalized = query.strip().lower()
    if not normalized:
        return []
    pattern = f"%{normalized}%"
    prefix = f"{normalized}%"
    rows = get_connection().execute(
        """
        SELECT * FROM albums
        WHERE lower(album_name) LIKE ? OR lower(coalesce(music_director,'')) LIKE ?
        ORDER BY
          CASE
            WHEN lower(album_name) = ? THEN 0
            WHEN lower(album_name) LIKE ? THEN 1
            WHEN lower(coalesce(music_director,'')) LIKE ? THEN 2
            ELSE 3
          END,
          updated_at DESC
        LIMIT ?
        """,
        [pattern, pattern, normalized, prefix, prefix, limit],
    ).fetchall()
    return [AlbumRecord(**dict(row)) for row in rows]


def search_artists(query: str, limit: int = 12) -> list[dict[str, Any]]:
    """Distinct singers/artists matching `query`, ranked by occurrence count."""
    normalized = query.strip().lower()
    if not normalized:
        return []
    pattern = f"%{normalized}%"
    rows = get_connection().execute(
        """
        SELECT singers AS artist, COUNT(*) AS song_count
        FROM songs
        WHERE singers IS NOT NULL AND singers != ''
              AND lower(singers) LIKE ?
        GROUP BY singers
        ORDER BY
          CASE WHEN lower(singers) = ? THEN 0
               WHEN lower(singers) LIKE ? THEN 1
               ELSE 2 END,
          song_count DESC
        LIMIT ?
        """,
        [pattern, normalized, f"{normalized}%", limit],
    ).fetchall()
    return [{"artist": row[0], "songCount": int(row[1])} for row in rows]


def search_composers(query: str, limit: int = 12) -> list[dict[str, Any]]:
    """Composers/music directors matching `query`."""
    normalized = query.strip().lower()
    if not normalized:
        return []
    pattern = f"%{normalized}%"
    rows = get_connection().execute(
        """
        SELECT music_director AS name, COUNT(*) AS song_count, COUNT(DISTINCT album_id) AS album_count
        FROM songs
        WHERE music_director IS NOT NULL AND music_director != ''
              AND lower(music_director) LIKE ?
        GROUP BY music_director
        ORDER BY
          CASE WHEN lower(music_director) = ? THEN 0
               WHEN lower(music_director) LIKE ? THEN 1
               ELSE 2 END,
          song_count DESC
        LIMIT ?
        """,
        [pattern, normalized, f"{normalized}%", limit],
    ).fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        name = row[0]
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-") or name.lower()
        results.append({
            "slug": slug,
            "name": name,
            "songCount": int(row[1]),
            "albumCount": int(row[2]),
            "coverUrl": None,
            "sampleSongIds": [],
        })
    return results


def song_status(song_id: str, cache_status: str) -> SongStatus | None:
    song = get_song(song_id)
    if not song:
        return None
    return SongStatus(
        song_id=song.song_id,
        album_url=song.album_url,
        has_128kbps=bool(song.url_128kbps),
        has_320kbps=bool(song.url_320kbps),
        cache_status=cache_status,
        updated_at=song.updated_at,
    )


def recent_for_warmup(limit: int) -> list[str]:
    rows = get_connection().execute(
        "SELECT song_id FROM songs ORDER BY updated_at DESC LIMIT ?",
        [limit],
    ).fetchall()
    return [row[0] for row in rows]


def list_recently_played(limit: int = 12, user_id: str = DEFAULT_USER_ID) -> list[FrontendSong]:
    rows = get_connection().execute(
        """
        SELECT s.song_id, s.album_id, s.album_name, s.year, s.music_director, s.singers, s.track_number, s.track_name, s.image_url, rp.played_at
        FROM recently_played rp
        JOIN songs s ON s.song_id = rp.song_id
        WHERE rp.user_id = ?
        ORDER BY rp.played_at DESC
        LIMIT ?
        """,
        [user_id, limit],
    ).fetchall()
    favorite_ids = _favorite_song_ids(user_id)
    return [_map_public_song(row, favorite_ids) for row in rows]


def record_recently_played(song_id: str, user_id: str = DEFAULT_USER_ID) -> bool:
    if not get_song(song_id):
        return False
    now = now_utc()
    get_connection().execute(
        """
        INSERT INTO recently_played (user_id, song_id, played_at)
        VALUES (?, ?, ?)
        ON CONFLICT (user_id, song_id) DO UPDATE SET played_at = excluded.played_at
        """,
        [user_id, song_id, now],
    )
    return True


def list_favorites(limit: int = 200, user_id: str = DEFAULT_USER_ID) -> list[FrontendSong]:
    ensure_database_ready()
    favorite_rows = get_connection().execute(
        """
        SELECT song_id
        FROM favorites
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        [user_id, limit],
    ).fetchall()
    ordered_ids = [str(row[0]) for row in favorite_rows]
    if not ordered_ids:
        return []
    song_rows = _song_rows_by_ids(ordered_ids)
    favorite_ids = set(ordered_ids)
    return [_map_public_song(song_rows[song_id], favorite_ids) for song_id in ordered_ids if song_id in song_rows]


def toggle_favorite(song_id: str, user_id: str = DEFAULT_USER_ID) -> bool:
    conn = get_connection()
    if not get_song(song_id):
        return False
    existing = conn.execute("SELECT 1 FROM favorites WHERE user_id = ? AND song_id = ?", [user_id, song_id]).fetchone()
    if existing:
        conn.execute("DELETE FROM favorites WHERE user_id = ? AND song_id = ?", [user_id, song_id])
        return False
    conn.execute(
        "INSERT INTO favorites (user_id, song_id, created_at) VALUES (?, ?, ?)",
        [user_id, song_id, now_utc()],
    )
    return True


def list_playlists(limit: int = 50, user_id: str = DEFAULT_USER_ID) -> list[PlaylistSummary]:
    rows = get_connection().execute(
        """
        SELECT p.playlist_id, p.name, COUNT(ps.song_id) AS song_count
        FROM playlists p
        LEFT JOIN playlist_songs ps ON ps.playlist_id = p.playlist_id
        WHERE p.user_id = ?
        GROUP BY p.playlist_id, p.name
        ORDER BY p.updated_at DESC
        LIMIT ?
        """,
        [user_id, limit],
    ).fetchall()
    base = [
        PlaylistSummary(id=row[0], name=row[1], songCount=row[2] or 0)
        for row in rows
    ]
    base.insert(0, PlaylistSummary(id="favorites", name="Favorites", description="Tracks you liked", songCount=len(list_favorites(500, user_id))))
    return base


_composer_lookup_cache: dict[str, str] = {}


def _composer_slug(name: str) -> str:
    return slugify(name) or "unknown"


def list_composers(limit: int = 60, min_songs: int = 8) -> list[ComposerSummary]:
    rows = get_connection().execute(
        """
        SELECT
          music_director AS name,
          COUNT(*) AS song_count,
          COUNT(DISTINCT album_id) AS album_count
        FROM songs
        WHERE music_director IS NOT NULL AND music_director != ''
        GROUP BY music_director
        HAVING song_count >= ?
        ORDER BY song_count DESC
        LIMIT ?
        """,
        [min_songs, limit],
    ).fetchall()
    summaries: list[ComposerSummary] = []
    conn = get_connection()
    for row in rows:
        name = str(row[0])
        slug = _composer_slug(name)
        _composer_lookup_cache[slug] = name
        sample = conn.execute(
            """
            SELECT song_id, image_url
            FROM songs
            WHERE music_director = ? AND image_url IS NOT NULL AND image_url != ''
            ORDER BY updated_at DESC
            LIMIT 4
            """,
            [name],
        ).fetchall()
        sample_ids = [str(r[0]) for r in sample]
        cover = next((str(r[1]) for r in sample if r[1]), None)
        summaries.append(
            ComposerSummary(
                slug=slug,
                name=name,
                songCount=int(row[1]),
                albumCount=int(row[2]),
                coverUrl=cover,
                sampleSongIds=sample_ids,
            )
        )
    return summaries


def _resolve_composer_name(slug: str) -> str | None:
    if slug in _composer_lookup_cache:
        return _composer_lookup_cache[slug]
    rows = get_connection().execute(
        """
        SELECT DISTINCT music_director
        FROM songs
        WHERE music_director IS NOT NULL AND music_director != ''
        """
    ).fetchall()
    for row in rows:
        name = str(row[0])
        if _composer_slug(name) == slug:
            _composer_lookup_cache[slug] = name
            return name
    return None


def composer_songs(slug: str, limit: int = 200, user_id: str = DEFAULT_USER_ID) -> tuple[str | None, list[FrontendSong]]:
    name = _resolve_composer_name(slug)
    if not name:
        return None, []
    rows = get_connection().execute(
        """
        SELECT song_id, album_id, album_name, year, music_director, singers, track_number, track_name, image_url, updated_at
        FROM songs
        WHERE music_director = ?
        ORDER BY updated_at DESC, album_name ASC, track_number ASC
        LIMIT ?
        """,
        [name, limit],
    ).fetchall()
    favorite_ids = _favorite_song_ids(user_id)
    return name, [_map_public_song(row, favorite_ids) for row in rows]


def next_songs_for_prefetch(song_id: str, limit: int) -> list[str]:
    song = get_song(song_id)
    if not song:
        return []
    rows = get_connection().execute(
        """
        SELECT song_id FROM songs
        WHERE album_url = ? AND track_number > ?
        ORDER BY track_number ASC
        LIMIT ?
        """,
        [song.album_url, song.track_number, limit],
    ).fetchall()
    return [row[0] for row in rows]
