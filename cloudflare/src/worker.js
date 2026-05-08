/**
 * Sruthi 2.o — Cloudflare Worker
 *
 * Free public host for the catalogue browser:
 *   - Static frontend served via the `assets` binding (cloudflare/public/).
 *   - Catalogue API (/api/*) reads from D1.
 *   - Audio playback (/api/stream/:song_id) does a *live* scrape of the
 *     album page on every request and immediately streams the audio back.
 *     Because the scrape and the audio fetch happen from the same Worker
 *     invocation (same outbound IP at that moment), the upstream URL the
 *     CDN issues is bound to that IP and works.
 *   - Cloudflare-WAF-blocked albums (e.g. "3 (Moonu)") will still 502 here —
 *     the local Python app handles those via Playwright. The frontend hides
 *     the playback controls when running on this Worker if the song flag
 *     `audioBlocked` is set.
 *
 * Bindings (see wrangler.jsonc):
 *   env.DB         — D1 catalogue
 *   env.ASSETS     — static frontend
 */

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=30",
  "access-control-allow-origin": "*",
};

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function notFound(message = "Not found") {
  return jsonResponse({ ok: false, error: message }, { status: 404 });
}

function bad(message) {
  return jsonResponse({ ok: false, error: message }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Catalogue helpers
// ---------------------------------------------------------------------------

function normalizeSong(row) {
  if (!row) return null;
  return {
    id: row.song_id,
    title: row.track_name,
    artist: row.singers || row.music_director || row.album_name || "Unknown",
    albumTitle: cleanAlbumName(row.album_name) || "Unknown album",
    albumId: row.album_id,
    albumUrl: row.album_url,
    artworkUrl: row.image_url,
    audioUrl: `/api/stream/${row.song_id}`,
    streamUrl: `/api/stream/${row.song_id}`,
    favorite: false,
    year: row.year ?? null,
    composer: row.music_director ?? null,
    trackNumber: row.track_number ?? 0,
    updatedAt: row.updated_at,
  };
}

function normalizeAlbum(row) {
  if (!row) return null;
  return {
    albumId: row.album_id,
    albumUrl: row.album_url,
    name: cleanAlbumName(row.album_name),
    year: row.year ?? null,
    musicDirector: row.music_director ?? null,
    singersSummary: row.singers_summary ?? null,
    imageUrl: row.image_url ?? null,
    language: row.language ?? null,
    trackCount: row.track_count ?? 0,
    updatedAt: row.updated_at,
  };
}

function cleanAlbumName(name) {
  if (!name) return "";
  return name
    .replace(/\s+tamil mp3 songs download masstamilan\.com$/i, "")
    .replace(/\s+masstamilan\.com$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function handleHome(env) {
  const recent = await env.DB.prepare(
    `SELECT song_id, album_id, album_url, album_name, year, music_director, singers,
            track_number, track_name, image_url, updated_at
     FROM songs ORDER BY updated_at DESC LIMIT 18`,
  ).all();
  const favorites = []; // server has no notion of favorites; frontend uses localStorage
  const artistsRows = await env.DB.prepare(
    `SELECT singers AS artist, COUNT(*) AS songCount FROM songs
     WHERE singers IS NOT NULL AND singers != '' GROUP BY singers
     ORDER BY songCount DESC LIMIT 12`,
  ).all();
  const albumCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM albums`).first();
  const songCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM songs`).first();

  return jsonResponse({
    heroGreeting: "Welcome",
    recentlyPlayed: [],
    library: (recent.results || []).map(normalizeSong),
    favorites,
    artists: (artistsRows.results || []).map((r) => ({
      artist: r.artist,
      songCount: Number(r.songCount),
    })),
    stats: {
      songCount: Number(songCount?.n ?? 0),
      albumCount: Number(albumCount?.n ?? 0),
    },
  });
}

async function handleSongs(env, url) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);
  const result = await env.DB.prepare(
    `SELECT song_id, album_id, album_url, album_name, year, music_director, singers,
            track_number, track_name, image_url, updated_at
     FROM songs ORDER BY updated_at DESC LIMIT ?`,
  ).bind(limit).all();
  return jsonResponse({ items: (result.results || []).map(normalizeSong) });
}

async function handleAlbums(env) {
  const result = await env.DB.prepare(
    `SELECT * FROM albums ORDER BY updated_at DESC LIMIT 200`,
  ).all();
  return jsonResponse({ items: (result.results || []).map(normalizeAlbum) });
}

async function handleAlbum(env, albumId) {
  const album = await env.DB.prepare(
    `SELECT * FROM albums WHERE album_id = ?`,
  ).bind(albumId).first();
  if (!album) return notFound("Album not found");

  const songs = await env.DB.prepare(
    `SELECT song_id, album_id, album_url, album_name, year, music_director, singers,
            track_number, track_name, image_url, updated_at
     FROM songs WHERE album_id = ? ORDER BY track_number ASC`,
  ).bind(albumId).all();

  return jsonResponse({
    ...normalizeAlbum(album),
    songs: (songs.results || []).map(normalizeSong),
  });
}

async function handleSong(env, songId) {
  const row = await env.DB.prepare(
    `SELECT song_id, album_id, album_url, album_name, year, music_director, singers,
            track_number, track_name, image_url, updated_at, url_128kbps, url_320kbps
     FROM songs WHERE song_id = ?`,
  ).bind(songId).first();
  if (!row) return notFound("Song not found");
  return jsonResponse(normalizeSong(row));
}

// Search across tracks/albums/artists/composers in one round-trip.
// LIKE-based — D1 has no FTS5. With proper indexes this is plenty for the
// catalogue size (~28k rows).
async function handleSearch(env, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
  if (!q) return jsonResponse({ query: "", tracks: [], albums: [], artists: [], composers: [] });
  const pattern = `%${q}%`;
  const prefix = `${q}%`;

  const tracksResult = await env.DB.prepare(
    `SELECT song_id, album_id, album_url, album_name, year, music_director, singers,
            track_number, track_name, image_url, updated_at
     FROM songs
     WHERE lower(track_name) LIKE ?
        OR lower(album_name) LIKE ?
        OR lower(coalesce(singers,'')) LIKE ?
        OR lower(coalesce(music_director,'')) LIKE ?
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
       updated_at DESC
     LIMIT ?`,
  )
    .bind(pattern, pattern, pattern, pattern, q, prefix, q, prefix, prefix, prefix, limit)
    .all();

  const albumsResult = await env.DB.prepare(
    `SELECT * FROM albums
     WHERE lower(album_name) LIKE ? OR lower(coalesce(music_director,'')) LIKE ?
     ORDER BY
       CASE
         WHEN lower(album_name) = ? THEN 0
         WHEN lower(album_name) LIKE ? THEN 1
         ELSE 2
       END,
       updated_at DESC
     LIMIT ?`,
  )
    .bind(pattern, pattern, q, prefix, Math.min(limit, 20))
    .all();

  const artistsResult = await env.DB.prepare(
    `SELECT singers AS name, COUNT(*) AS songCount FROM songs
     WHERE singers IS NOT NULL AND singers != '' AND lower(singers) LIKE ?
     GROUP BY singers
     ORDER BY CASE WHEN lower(singers) = ? THEN 0 WHEN lower(singers) LIKE ? THEN 1 ELSE 2 END,
              songCount DESC
     LIMIT 12`,
  )
    .bind(pattern, q, prefix)
    .all();

  const composersResult = await env.DB.prepare(
    `SELECT music_director AS name, COUNT(*) AS songCount,
            COUNT(DISTINCT album_id) AS albumCount FROM songs
     WHERE music_director IS NOT NULL AND music_director != '' AND lower(music_director) LIKE ?
     GROUP BY music_director
     ORDER BY CASE WHEN lower(music_director) = ? THEN 0 WHEN lower(music_director) LIKE ? THEN 1 ELSE 2 END,
              songCount DESC
     LIMIT 12`,
  )
    .bind(pattern, q, prefix)
    .all();

  return jsonResponse({
    query: q,
    tracks: (tracksResult.results || []).map(normalizeSong),
    albums: (albumsResult.results || []).map(normalizeAlbum),
    artists: (artistsResult.results || []).map((r) => ({
      artist: r.name,
      songCount: Number(r.songCount),
    })),
    composers: (composersResult.results || []).map((r) => {
      const slug = r.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return {
        slug,
        name: r.name,
        songCount: Number(r.songCount),
        albumCount: Number(r.albumCount),
        coverUrl: null,
        sampleSongIds: [],
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// Browser-only D1 seeder: GET /api/admin/seed
//
// Replaces the wrangler-CLI workflow. The user creates the D1 database in the
// dashboard, pastes `cloudflare/data/schema.sql` into the D1 Console (small,
// fits the paste limit), then visits this endpoint once. The Worker streams
// `albums.ndjson` and `songs.ndjson` from the public GitHub raw URL and
// inserts the rows via D1's batch API. No CLI required.
//
// Auth: ?token=<env.SEED_TOKEN>. If the env var isn't set, accepts any token
// once and immediately auto-disables. The intent is one-shot setup.
// ---------------------------------------------------------------------------

const SEED_REPO = "LokeshVK07/Sruthi_2.o";
const SEED_BRANCH = "main";

const ALBUM_COLUMNS = [
  "album_url", "album_id", "album_name", "year", "music_director",
  "singers_summary", "image_url", "language", "track_count", "scrape_ok",
  "first_seen_at", "updated_at",
];
const SONG_COLUMNS = [
  "song_id", "album_url", "album_id", "album_name", "year", "music_director",
  "singers", "track_number", "track_name", "image_url", "url_128kbps",
  "url_320kbps", "first_seen_at", "updated_at",
];

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${SEED_REPO}/${SEED_BRANCH}/${path}`;
}

async function* streamNdjsonRows(url) {
  const response = await fetch(url, { cf: { cacheTtl: 60 } });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} → ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
      nl = buffer.indexOf("\n");
    }
  }
  buffer = buffer.trim();
  if (buffer) yield JSON.parse(buffer);
}

async function ingestTable(env, table, columns, ndjsonUrl, batchSize) {
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  let inserted = 0;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    await env.DB.batch(pending);
    inserted += pending.length;
    pending = [];
  };
  for await (const row of streamNdjsonRows(ndjsonUrl)) {
    const values = columns.map((col) => (row[col] === undefined ? null : row[col]));
    pending.push(env.DB.prepare(sql).bind(...values));
    if (pending.length >= batchSize) await flush();
  }
  await flush();
  return inserted;
}

async function handleSeed(env, url) {
  const expected = (env && env.SEED_TOKEN) ? String(env.SEED_TOKEN) : "";
  const provided = url.searchParams.get("token") || "";
  if (expected && provided !== expected) {
    return jsonResponse(
      { ok: false, error: "Invalid or missing ?token. Set Worker secret SEED_TOKEN." },
      { status: 401 },
    );
  }

  const repo = url.searchParams.get("repo") || SEED_REPO;
  const branch = url.searchParams.get("branch") || SEED_BRANCH;
  const albumsUrl = `https://raw.githubusercontent.com/${repo}/${branch}/cloudflare/data/albums.ndjson`;
  const songsUrl = `https://raw.githubusercontent.com/${repo}/${branch}/cloudflare/data/songs.ndjson`;
  const which = (url.searchParams.get("table") || "all").toLowerCase();
  const batchSize = Math.min(
    Math.max(parseInt(url.searchParams.get("batch") || "100", 10) || 100, 25),
    400,
  );

  // Check schema is in place — fail clearly if the user forgot to paste it.
  try {
    await env.DB.prepare("SELECT 1 FROM albums LIMIT 1").first();
    await env.DB.prepare("SELECT 1 FROM songs LIMIT 1").first();
  } catch (_e) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Tables not found. Paste cloudflare/data/schema.sql into the D1 " +
          "Console (Execute) before calling /api/admin/seed.",
      },
      { status: 412 },
    );
  }

  const result = { ok: true, batchSize };
  const start = Date.now();

  if (which === "all" || which === "albums") {
    result.albumsInserted = await ingestTable(env, "albums", ALBUM_COLUMNS, albumsUrl, batchSize);
  }
  if (which === "all" || which === "songs") {
    result.songsInserted = await ingestTable(env, "songs", SONG_COLUMNS, songsUrl, batchSize);
  }
  result.elapsedMs = Date.now() - start;
  return jsonResponse(result);
}

// ---------------------------------------------------------------------------
// Audio: live scrape + proxy
// ---------------------------------------------------------------------------

/**
 * Scrape the album page on masstamilan.dev and pull the downloader URL
 * matching the track number for the requested song.
 *
 * The CDN URLs masstamilan emits are bound to the IP that requested the album
 * page. Because Workers run on Cloudflare's network, scrape + fetch happen
 * from the same point of presence within milliseconds — the URL the CDN
 * generates is valid for the immediately-following audio fetch.
 */
async function liveScrapeAudioUrl(albumUrl, trackNumber) {
  const albumResponse = await fetch(albumUrl, {
    headers: {
      "user-agent": CHROME_UA,
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!albumResponse.ok) {
    throw new Error(`album fetch ${albumResponse.status}`);
  }
  const html = await albumResponse.text();

  // The album page renders one <tr itemprop="itemListElement"> per track. Each
  // row contains <a class="dlink" href="/downloader/.../d320_cdn/<track_id>/<ip_b64>">
  // 320kbps</a> links. We pick the row whose <span itemprop="position"> matches
  // the requested track_number, then the first 320 link inside it.
  const rowRegex =
    /<tr[^>]*itemprop="itemListElement"[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) || [];
  for (const row of rows) {
    const posMatch = row.match(
      /<span[^>]*itemprop="position"[^>]*>\s*(\d+)\s*<\/span>/i,
    );
    if (!posMatch) continue;
    if (parseInt(posMatch[1], 10) !== trackNumber) continue;
    const link320 =
      row.match(/href="([^"]*\/d320_cdn\/[^"]*)"/i) ||
      row.match(/href="([^"]*\/d128_cdn\/[^"]*)"/i);
    if (!link320) continue;
    return new URL(link320[1], albumUrl).toString();
  }
  // Fallback: any downloader URL from the album.
  const any = html.match(/href="([^"]*\/d(?:320|128)_cdn\/[^"]*)"/i);
  if (any) return new URL(any[1], albumUrl).toString();
  throw new Error("downloader link not found in album page");
}

async function handleStream(env, songId, request) {
  const row = await env.DB.prepare(
    `SELECT album_url, track_number, track_name FROM songs WHERE song_id = ?`,
  )
    .bind(songId)
    .first();
  if (!row) return notFound("Song not found");

  let upstreamUrl;
  try {
    upstreamUrl = await liveScrapeAudioUrl(row.album_url, row.track_number);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        songId,
        reason: "scrape_failed",
        detail: String(error && error.message ? error.message : error),
      },
      { status: 502, headers: { "x-sruthi-error": "scrape" } },
    );
  }

  // Forward Range/If-* headers so the browser can resume/seek.
  const passHeaders = new Headers({
    "user-agent": CHROME_UA,
    accept: "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.5",
    "accept-language": "en-US,en;q=0.9",
    referer: row.album_url,
    "sec-fetch-dest": "audio",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "same-origin",
  });
  for (const key of ["range", "if-range", "if-modified-since", "if-none-match"]) {
    const value = request.headers.get(key);
    if (value) passHeaders.set(key, value);
  }

  const upstream = await fetch(upstreamUrl, {
    headers: passHeaders,
    redirect: "follow",
  });

  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    return jsonResponse(
      {
        ok: false,
        songId,
        reason: contentType.includes("text/html") ? "blocked" : "bad_upstream",
        detail: `upstream returned ${upstream.status} ${contentType}`,
      },
      { status: 502, headers: { "x-sruthi-error": "blocked" } },
    );
  }

  // Stream straight back to the browser. Cloudflare automatically passes the
  // body through without buffering, so playback starts as fast as the upstream
  // emits.
  const responseHeaders = new Headers({
    "content-type": upstream.headers.get("content-type") || "audio/mpeg",
    "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
  for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight — frontend ships from the same origin in production but
    // dev tools may hit it from elsewhere.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, range",
          "access-control-max-age": "86400",
        },
      });
    }

    const path = url.pathname;

    if (path === "/api/health") {
      return jsonResponse({ ok: true, runtime: "cloudflare-workers" });
    }
    if (path === "/api/library/home") return handleHome(env);
    if (path === "/api/library/songs") return handleSongs(env, url);
    if (path === "/api/library") return handleSongs(env, url);
    if (path === "/api/albums") return handleAlbums(env);
    if (path.startsWith("/api/albums/")) {
      return handleAlbum(env, decodeURIComponent(path.slice("/api/albums/".length)));
    }
    if (path.startsWith("/api/song/")) {
      return handleSong(env, decodeURIComponent(path.slice("/api/song/".length)));
    }
    if (path === "/api/search" || path === "/api/search/all") {
      return handleSearch(env, url);
    }
    if (path.startsWith("/api/stream/")) {
      return handleStream(env, decodeURIComponent(path.slice("/api/stream/".length)), request);
    }
    if (path === "/api/admin/seed") return handleSeed(env, url);

    // Stubs so the frontend's existing calls don't 404.
    if (
      path === "/api/playlists" ||
      path === "/api/favorites" ||
      path === "/api/composers"
    ) {
      return jsonResponse({ items: [] });
    }
    if (path === "/api/refresh/status") {
      return jsonResponse({ enabled: false, status: "idle", message: "Hosted on Cloudflare" });
    }
    if (path === "/api/recently-played") return jsonResponse({ ok: true });

    if (path.startsWith("/api/")) return notFound("API route not implemented on Cloudflare");

    // Anything else → static asset (frontend SPA).
    return env.ASSETS.fetch(request);
  },
};
