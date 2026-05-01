import { db } from "../db.js";
import type {
  Album,
  Playlist,
  PublicSong,
  ScrapedAlbum,
  SearchIndexRecord,
  Song,
  SongStatus,
  SongStreamRecord,
  StationMode
} from "../types.js";
import { deterministicId, nowIso, safeJsonParse } from "../utils.js";

type PublicSongRow = SongStreamRecord & {
  favorite: number;
};

const songColumns = `
  s.id,
  s.album_id as albumId,
  s.title,
  s.artist,
  s.singers,
  s.composer,
  s.year,
  s.duration_seconds as durationSeconds,
  s.track_number as trackNumber,
  s.source_page_url as sourcePageUrl,
  s.upstream_url as upstreamUrl,
  s.audio_128_url as audio128Url,
  s.audio_320_url as audio320Url,
  s.audio_links_json as audioLinksJson,
  s.artwork_url as artworkUrl,
  s.lyrics_by as lyricsBy,
  s.first_seen_at as firstSeenAt,
  s.updated_at as updatedAt,
  s.last_verified_at as lastVerifiedAt,
  s.last_playback_error_at as lastPlaybackErrorAt,
  a.title as albumTitle,
  a.artist as albumArtist,
  a.music_director as musicDirector,
  a.source_url as albumSourceUrl,
  a.slug as albumSlug
`;

function toPublicSong(row: PublicSongRow): PublicSong {
  const audioUrl = `/api/stream/${row.id}`;
  return {
    id: row.id,
    albumId: row.albumId,
    movie: row.albumTitle,
    album: row.albumTitle,
    albumTitle: row.albumTitle,
    track: row.title,
    title: row.title,
    artists: row.artist,
    artist: row.artist,
    singers: row.singers,
    composer: row.composer,
    musicDirector: row.musicDirector,
    year: row.year,
    trackNumber: row.trackNumber,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt,
    artworkProxyUrl: row.artworkUrl ? `/api/artwork/${row.id}` : null,
    audioUrl,
    streamUrl: audioUrl,
    favorite: Boolean(row.favorite)
  };
}

export function makeSongId(albumUrl: string, trackNumber: number | null) {
  return deterministicId("song", albumUrl, String(trackNumber ?? 0));
}

export function makeAlbumId(albumUrl: string) {
  return deterministicId("album", albumUrl);
}

export function upsertAlbumGraph(album: ScrapedAlbum) {
  const now = nowIso();
  const albumId = makeAlbumId(album.sourceUrl);
  const existingAlbum = db
    .prepare("SELECT id, source_url as sourceUrl, first_seen_at as firstSeenAt FROM albums WHERE source_url = ? OR slug = ?")
    .get(album.sourceUrl, album.slug) as { id?: string; sourceUrl?: string; firstSeenAt?: string } | undefined;
  const persistedAlbumId = existingAlbum?.id ?? albumId;
  const persistedSourceUrl = existingAlbum?.sourceUrl ?? album.sourceUrl;

  db.prepare(
    `
    INSERT INTO albums (
      id, slug, title, artist, music_director, director, lyricists, year, language,
      source_url, artwork_url, track_count, first_seen_at, updated_at, last_scraped_at
    ) VALUES (
      @id, @slug, @title, @artist, @musicDirector, @director, @lyricists, @year, @language,
      @sourceUrl, @artworkUrl, @trackCount, @firstSeenAt, @updatedAt, @lastScrapedAt
    )
    ON CONFLICT(source_url) DO UPDATE SET
      slug=excluded.slug,
      title=excluded.title,
      artist=excluded.artist,
      music_director=excluded.music_director,
      director=excluded.director,
      lyricists=excluded.lyricists,
      year=excluded.year,
      language=excluded.language,
      artwork_url=excluded.artwork_url,
      track_count=excluded.track_count,
      updated_at=excluded.updated_at,
      last_scraped_at=excluded.last_scraped_at
  `
  ).run({
    id: persistedAlbumId,
    slug: album.slug,
    title: album.title,
    artist: album.artist,
    musicDirector: album.musicDirector,
    director: album.director,
    lyricists: album.lyricists,
    year: album.year,
    language: album.language,
    sourceUrl: persistedSourceUrl,
    artworkUrl: album.artworkUrl,
    trackCount: album.trackCount,
    firstSeenAt: existingAlbum?.firstSeenAt ?? now,
    updatedAt: now,
    lastScrapedAt: now
  });

  const existingSongStmt = db.prepare("SELECT first_seen_at as firstSeenAt FROM songs WHERE id = ?");
  const songStmt = db.prepare(
    `
    INSERT INTO songs (
      id, album_id, title, artist, singers, composer, year, duration_seconds, track_number,
      source_page_url, upstream_url, audio_128_url, audio_320_url, audio_links_json, artwork_url,
      lyrics_by, first_seen_at, updated_at, last_verified_at, last_playback_error_at
    ) VALUES (
      @id, @albumId, @title, @artist, @singers, @composer, @year, @durationSeconds, @trackNumber,
      @sourcePageUrl, @upstreamUrl, @audio128Url, @audio320Url, @audioLinksJson, @artworkUrl,
      @lyricsBy, @firstSeenAt, @updatedAt, @lastVerifiedAt, @lastPlaybackErrorAt
    )
    ON CONFLICT(id) DO UPDATE SET
      album_id=excluded.album_id,
      title=excluded.title,
      artist=excluded.artist,
      singers=excluded.singers,
      composer=excluded.composer,
      year=excluded.year,
      duration_seconds=excluded.duration_seconds,
      track_number=excluded.track_number,
      source_page_url=excluded.source_page_url,
      upstream_url=excluded.upstream_url,
      audio_128_url=excluded.audio_128_url,
      audio_320_url=excluded.audio_320_url,
      audio_links_json=excluded.audio_links_json,
      artwork_url=excluded.artwork_url,
      lyrics_by=excluded.lyrics_by,
      updated_at=excluded.updated_at,
      last_verified_at=excluded.last_verified_at
  `
  );

  const tx = db.transaction(() => {
    const retainedSongIds: string[] = [];
    for (const song of album.songs) {
      const songId = makeSongId(persistedSourceUrl, song.trackNumber);
      retainedSongIds.push(songId);
      const existing = existingSongStmt.get(songId) as { firstSeenAt?: string } | undefined;
      songStmt.run({
        id: songId,
        albumId: persistedAlbumId,
        title: song.title,
        artist: song.artist,
        singers: song.singers,
        composer: song.composer,
        year: song.year,
        durationSeconds: song.durationSeconds,
        trackNumber: song.trackNumber,
        sourcePageUrl: persistedSourceUrl,
        upstreamUrl: song.upstreamUrl,
        audio128Url: song.audio128Url,
        audio320Url: song.audio320Url,
        audioLinksJson: song.audioLinksJson,
        artworkUrl: song.artworkUrl,
        lyricsBy: song.lyricsBy,
        firstSeenAt: existing?.firstSeenAt ?? now,
        updatedAt: now,
        lastVerifiedAt: song.upstreamUrl ? now : null,
        lastPlaybackErrorAt: null
      });
    }
    if (retainedSongIds.length > 0) {
      const placeholders = retainedSongIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM songs WHERE album_id = ? AND id NOT IN (${placeholders})`).run(persistedAlbumId, ...retainedSongIds);
    } else {
      db.prepare("DELETE FROM songs WHERE album_id = ?").run(persistedAlbumId);
    }
  });
  tx();
  return {
    albumId: persistedAlbumId,
    songsUpserted: album.songs.length
  };
}

export function getKnownAlbumUrls(urls: string[]) {
  if (urls.length === 0) return new Set<string>();
  const placeholders = urls.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT source_url as sourceUrl FROM albums WHERE source_url IN (${placeholders})`)
    .all(...urls) as Array<{ sourceUrl: string }>;
  return new Set(rows.map((row) => row.sourceUrl));
}

export function isAlbumKnown(albumUrl: string) {
  const row = db.prepare("SELECT 1 FROM albums WHERE source_url = ?").get(albumUrl);
  return Boolean(row);
}

export function createScrapeRun(params: { mode: string; pageFrom?: number; pageTo?: number }) {
  const id = deterministicId("scrape-run", params.mode, String(Date.now()));
  db.prepare(
    `
    INSERT INTO scrape_runs (id, started_at, status, page_from, page_to, mode, albums_found, songs_found)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `
  ).run(id, nowIso(), "running", params.pageFrom ?? null, params.pageTo ?? null, params.mode);
  return id;
}

export function finishScrapeRun(
  id: string,
  payload: { status: "success" | "failed"; albumsFound: number; songsFound: number; errorMessage?: string | null }
) {
  db.prepare(
    `
    UPDATE scrape_runs
    SET finished_at = ?, status = ?, albums_found = ?, songs_found = ?, error_message = ?
    WHERE id = ?
  `
  ).run(nowIso(), payload.status, payload.albumsFound, payload.songsFound, payload.errorMessage ?? null, id);
}

export function listLibrary(userId: string, limit = 120) {
  const rows = db
    .prepare(
      `
      SELECT
        ${songColumns},
        CASE WHEN f.song_id IS NULL THEN 0 ELSE 1 END as favorite
      FROM songs s
      JOIN albums a ON a.id = s.album_id
      LEFT JOIN favorites f ON f.song_id = s.id AND f.user_id = ?
      ORDER BY a.updated_at DESC, s.track_number ASC
      LIMIT ?
    `
    )
    .all(userId, limit) as PublicSongRow[];

  return rows.map(toPublicSong);
}

export function getSongById(songId: string) {
  return db
    .prepare(
      `
      SELECT
        id,
        album_id as albumId,
        title,
        artist,
        singers,
        composer,
        year,
        duration_seconds as durationSeconds,
        track_number as trackNumber,
        source_page_url as sourcePageUrl,
        upstream_url as upstreamUrl,
        audio_128_url as audio128Url,
        audio_320_url as audio320Url,
        audio_links_json as audioLinksJson,
        artwork_url as artworkUrl,
        lyrics_by as lyricsBy,
        first_seen_at as firstSeenAt,
        updated_at as updatedAt,
        last_verified_at as lastVerifiedAt,
        last_playback_error_at as lastPlaybackErrorAt
      FROM songs
      WHERE id = ?
    `
    )
    .get(songId) as Song | undefined;
}

export function getSongStreamRecord(songId: string) {
  return db
    .prepare(
      `
      SELECT
        ${songColumns}
      FROM songs s
      JOIN albums a ON a.id = s.album_id
      WHERE s.id = ?
    `
    )
    .get(songId) as SongStreamRecord | undefined;
}

export function getAlbumBySongId(songId: string) {
  return db
    .prepare(
      `
      SELECT
        a.id,
        a.slug,
        a.title,
        a.artist,
        a.music_director as musicDirector,
        a.director,
        a.year,
        a.language,
        a.source_url as sourceUrl,
        a.artwork_url as artworkUrl,
        a.track_count as trackCount,
        a.first_seen_at as firstSeenAt,
        a.updated_at as updatedAt,
        a.last_scraped_at as lastScrapedAt
      FROM albums a
      JOIN songs s ON s.album_id = a.id
      WHERE s.id = ?
    `
    )
    .get(songId) as Album | undefined;
}

export function getLibrarySong(userId: string, songId: string) {
  const row = db
    .prepare(
      `
      SELECT
        ${songColumns},
        CASE WHEN f.song_id IS NULL THEN 0 ELSE 1 END as favorite
      FROM songs s
      JOIN albums a ON a.id = s.album_id
      LEFT JOIN favorites f ON f.song_id = s.id AND f.user_id = ?
      WHERE s.id = ?
    `
    )
    .get(userId, songId) as PublicSongRow | undefined;
  return row ? toPublicSong(row) : null;
}

export function listAlbums(limit = 120) {
  return db
    .prepare(
      `
      SELECT
        a.id,
        a.slug,
        a.title,
        a.artist,
        a.music_director as musicDirector,
        a.director,
        a.year,
        a.language,
        a.source_url as sourceUrl,
        a.artwork_url as artworkUrl,
        a.track_count as trackCount,
        a.first_seen_at as firstSeenAt,
        a.updated_at as updatedAt,
        a.last_scraped_at as lastScrapedAt
      FROM albums a
      ORDER BY a.updated_at DESC
      LIMIT ?
    `
    )
    .all(limit) as Album[];
}

export function getAlbum(albumId: string) {
  const album = db
    .prepare(
      `
      SELECT
        id, slug, title, artist, music_director as musicDirector, director, year, language,
        source_url as sourceUrl, artwork_url as artworkUrl, track_count as trackCount,
        first_seen_at as firstSeenAt, updated_at as updatedAt, last_scraped_at as lastScrapedAt
      FROM albums WHERE id = ?
    `
    )
    .get(albumId) as Album | undefined;
  if (!album) return null;
  const songs = db
    .prepare(
      `
      SELECT
        id, title, artist, singers, composer, year,
        duration_seconds as durationSeconds,
        track_number as trackNumber,
        updated_at as updatedAt
      FROM songs
      WHERE album_id = ?
      ORDER BY track_number ASC, title ASC
    `
    )
    .all(albumId);
  return { ...album, songs };
}

export function listArtists(limit = 120) {
  return db
    .prepare(
      `
      SELECT artist, COUNT(*) as songCount, MIN(year) as firstYear, MAX(year) as lastYear
      FROM songs
      GROUP BY artist
      ORDER BY songCount DESC, artist ASC
      LIMIT ?
    `
    )
    .all(limit);
}

export function searchLibrary(userId: string, query: string, limit = 40) {
  const q = `%${query.toLowerCase()}%`;
  const rows = db
    .prepare(
      `
      SELECT
        ${songColumns},
        CASE WHEN f.song_id IS NULL THEN 0 ELSE 1 END as favorite
      FROM songs s
      JOIN albums a ON a.id = s.album_id
      LEFT JOIN favorites f ON f.song_id = s.id AND f.user_id = ?
      WHERE
        lower(s.title) LIKE ?
        OR lower(a.title) LIKE ?
        OR lower(s.artist) LIKE ?
        OR lower(COALESCE(s.singers, '')) LIKE ?
        OR lower(COALESCE(s.composer, '')) LIKE ?
        OR CAST(COALESCE(s.year, '') AS TEXT) LIKE ?
      ORDER BY s.updated_at DESC
      LIMIT ?
    `
    )
    .all(userId, q, q, q, q, q, q, limit) as PublicSongRow[];

  return rows.map(toPublicSong);
}

export function ensureDefaultUser() {
  const now = nowIso();
  const userId = "local-user";
  db.prepare(
    `
    INSERT INTO users (id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `
  ).run(userId, "local@melodify.app", "Local Listener", now, now);
  db.prepare(
    `
    INSERT INTO user_preferences (user_id, theme, player_state_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `
  ).run(userId, "nightpulse", JSON.stringify({}), now);
  return userId;
}

export function touchSession(sessionId: string, userId: string, meta: { userAgent?: string; ipAddress?: string }) {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      user_agent = excluded.user_agent,
      ip_address = excluded.ip_address
  `
  ).run(sessionId, userId, now, now, meta.userAgent ?? null, meta.ipAddress ?? null);
}

export function toggleFavorite(userId: string, songId: string) {
  if (isFavorite(userId, songId)) {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND song_id = ?").run(userId, songId);
    return false;
  }
  db.prepare("INSERT INTO favorites (user_id, song_id, created_at) VALUES (?, ?, ?)").run(userId, songId, nowIso());
  return true;
}

export function isFavorite(userId: string, songId: string) {
  const row = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND song_id = ?").get(userId, songId);
  return Boolean(row);
}

export function listFavorites(userId: string) {
  const rows = db
    .prepare(
      `
      SELECT
        ${songColumns},
        1 as favorite
      FROM favorites f
      JOIN songs s ON s.id = f.song_id
      JOIN albums a ON a.id = s.album_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `
    )
    .all(userId) as PublicSongRow[];
  return rows.map(toPublicSong);
}

export function recordPlayback(userId: string, songId: string) {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO recently_played (user_id, song_id, played_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, song_id) DO UPDATE SET played_at = excluded.played_at
  `
  ).run(userId, songId, now);
}

export function listRecentlyPlayed(userId: string, limit = 24) {
  const rows = db
    .prepare(
      `
      SELECT
        ${songColumns},
        CASE WHEN f.song_id IS NULL THEN 0 ELSE 1 END as favorite
      FROM recently_played r
      JOIN songs s ON s.id = r.song_id
      JOIN albums a ON a.id = s.album_id
      LEFT JOIN favorites f ON f.song_id = s.id AND f.user_id = ?
      WHERE r.user_id = ?
      ORDER BY r.played_at DESC
      LIMIT ?
    `
    )
    .all(userId, userId, limit) as PublicSongRow[];
  return rows.map(toPublicSong);
}

export function createPlaylist(userId: string, name: string, description?: string) {
  const now = nowIso();
  const playlistId = deterministicId("playlist", userId, name, now);
  db.prepare(
    `
    INSERT INTO playlists (id, user_id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(playlistId, userId, name, description ?? null, now, now);
  return getPlaylist(playlistId);
}

export function listPlaylists(userId: string) {
  return db
    .prepare(
      `
      SELECT
        p.id,
        p.user_id as userId,
        p.name,
        p.description,
        p.created_at as createdAt,
        p.updated_at as updatedAt,
        COUNT(ps.song_id) as songCount
      FROM playlists p
      LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `
    )
    .all(userId);
}

export function getPlaylist(playlistId: string) {
  const playlist = db
    .prepare(
      `
      SELECT id, user_id as userId, name, description, created_at as createdAt, updated_at as updatedAt
      FROM playlists WHERE id = ?
    `
    )
    .get(playlistId) as Playlist | undefined;
  if (!playlist) return null;
  const songs = db
    .prepare(
      `
      SELECT
        s.id, s.title, s.artist, a.title as albumTitle, s.track_number as trackNumber,
        ps.sort_order as sortOrder
      FROM playlist_songs ps
      JOIN songs s ON s.id = ps.song_id
      JOIN albums a ON a.id = s.album_id
      WHERE ps.playlist_id = ?
      ORDER BY ps.sort_order ASC
    `
    )
    .all(playlistId);
  return { ...playlist, songs };
}

export function addSongToPlaylist(playlistId: string, songId: string) {
  const currentMax = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as sortOrder FROM playlist_songs WHERE playlist_id = ?")
    .get(playlistId) as { sortOrder: number };
  db.prepare(
    `
    INSERT INTO playlist_songs (playlist_id, song_id, sort_order, added_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(playlist_id, song_id) DO UPDATE SET sort_order = excluded.sort_order
  `
  ).run(playlistId, songId, currentMax.sortOrder + 1, nowIso());
  db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(nowIso(), playlistId);
  return getPlaylist(playlistId);
}

export function getPreferences(userId: string) {
  const row = db
    .prepare("SELECT theme, player_state_json as playerStateJson FROM user_preferences WHERE user_id = ?")
    .get(userId) as { theme: string | null; playerStateJson: string | null } | undefined;
  return {
    theme: row?.theme ?? "nightpulse",
    playerState: safeJsonParse(row?.playerStateJson ?? null, {})
  };
}

export function savePreferences(userId: string, payload: { theme?: string; playerState?: unknown }) {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO user_preferences (user_id, theme, player_state_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      theme = COALESCE(excluded.theme, user_preferences.theme),
      player_state_json = COALESCE(excluded.player_state_json, user_preferences.player_state_json),
      updated_at = excluded.updated_at
  `
  ).run(userId, payload.theme ?? null, payload.playerState ? JSON.stringify(payload.playerState) : null, now);
  return getPreferences(userId);
}

export function buildStation(userId: string, mode: StationMode, artist?: string) {
  if (mode === "favorites") return listFavorites(userId);
  if (mode === "recent") return listRecentlyPlayed(userId, 40);
  if (mode === "artist" && artist) {
    return db
      .prepare(
        `
        SELECT s.id
        FROM songs s
        WHERE lower(s.artist) = lower(?)
        ORDER BY RANDOM()
        LIMIT 40
      `
      )
      .all(artist)
      .map((row) => getLibrarySong(userId, (row as { id: string }).id))
      .filter(Boolean);
  }
  return db
    .prepare("SELECT id FROM songs ORDER BY RANDOM() LIMIT 40")
    .all()
    .map((row) => getLibrarySong(userId, (row as { id: string }).id))
    .filter(Boolean);
}

export function getWarmupCandidates(limit: number) {
  return db
    .prepare(
      `
      SELECT s.id
      FROM songs s
      LEFT JOIN recently_played r ON r.song_id = s.id
      ORDER BY COALESCE(r.played_at, s.updated_at) DESC
      LIMIT ?
    `
    )
    .all(limit) as { id: string }[];
}

export function getPrefetchCandidates(currentSongId: string, limit: number) {
  const current = getSongById(currentSongId);
  if (!current) return [];
  return db
    .prepare(
      `
      SELECT id
      FROM songs
      WHERE album_id = ?
        AND id != ?
      ORDER BY track_number ASC, title ASC
      LIMIT ?
    `
    )
    .all(current.albumId, currentSongId, limit) as { id: string }[];
}

export function updateSongLinks(
  songId: string,
  payload: { upstreamUrl: string | null; audio128Url: string | null; audio320Url: string | null; audioLinksJson: string | null }
) {
  db.prepare(
    `
    UPDATE songs
    SET upstream_url = ?, audio_128_url = ?, audio_320_url = ?, audio_links_json = ?, updated_at = ?, last_verified_at = ?
    WHERE id = ?
  `
  ).run(payload.upstreamUrl, payload.audio128Url, payload.audio320Url, payload.audioLinksJson, nowIso(), payload.upstreamUrl ? nowIso() : null, songId);
}

export function markSongVerified(songId: string) {
  db.prepare("UPDATE songs SET last_verified_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), songId);
}

export function markPlaybackError(songId: string) {
  db.prepare("UPDATE songs SET last_playback_error_at = ? WHERE id = ?").run(nowIso(), songId);
}

export function clearPlaybackError(songId: string) {
  db.prepare("UPDATE songs SET last_playback_error_at = NULL WHERE id = ?").run(songId);
}

export function getSourceHealth() {
  return db
    .prepare(
      `
      SELECT
        COUNT(*) as songs,
        SUM(CASE WHEN upstream_url IS NOT NULL THEN 1 ELSE 0 END) as linkedSongs,
        SUM(CASE WHEN last_playback_error_at IS NOT NULL THEN 1 ELSE 0 END) as failedSongs
      FROM songs
    `
    )
    .get() as { songs: number; linkedSongs: number; failedSongs: number };
}

export function getSongStatus(songId: string, cacheStatus: SongStatus["cacheStatus"]): SongStatus | null {
  const row = db
    .prepare(
      `
      SELECT
        s.id,
        s.source_page_url as albumUrl,
        s.upstream_url as upstreamUrl,
        s.last_verified_at as lastVerifiedAt,
        s.last_playback_error_at as lastPlaybackErrorAt,
        s.updated_at as updatedAt
      FROM songs s
      WHERE s.id = ?
    `
    )
    .get(songId) as
    | { id: string; albumUrl: string; upstreamUrl: string | null; lastVerifiedAt: string | null; lastPlaybackErrorAt: string | null; updatedAt: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    albumUrl: row.albumUrl,
    hasUpstreamUrl: Boolean(row.upstreamUrl),
    lastVerifiedAt: row.lastVerifiedAt,
    lastPlaybackErrorAt: row.lastPlaybackErrorAt,
    cacheStatus,
    updatedAt: row.updatedAt
  };
}
