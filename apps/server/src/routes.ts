import fs from "node:fs";
import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import {
  addSongToPlaylist,
  buildStation,
  createPlaylist,
  ensureDefaultUser,
  getAlbum,
  getLibrarySong,
  getPreferences,
  getPrefetchCandidates,
  getSourceHealth,
  getWarmupCandidates,
  listAlbums,
  listArtists,
  listFavorites,
  listLibrary,
  listPlaylists,
  listRecentlyPlayed,
  recordPlayback,
  savePreferences,
  searchLibrary,
  toggleFavorite
} from "./repositories/library-repo.js";
import { appConfig } from "./config.js";
import { resolveArtwork } from "./services/artwork-service.js";
import { scraperService } from "./services/scraper-service.js";
import { getPlaybackHealth, getSongPlaybackStatus, resolveSongStream } from "./services/stream-service.js";
import { touchSession } from "./repositories/library-repo.js";
import { getCacheStatus, trimCacheIfNeeded } from "./services/cache-service.js";

export async function registerRoutes(app: FastifyInstance) {
  async function drainStream(stream: NodeJS.ReadableStream) {
    for await (const _chunk of stream) {
      // Intentionally drain to completion so prefetch/warmup can populate cache.
    }
  }

  app.addHook("preHandler", async (request, reply) => {
    const userId = ensureDefaultUser();
    const sessionId = request.cookies.sessionId || nanoid();
    touchSession(sessionId, userId, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip
    });
    reply.setCookie("sessionId", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });
    request.user = { id: userId, sessionId };
  });

  app.get("/api/health", async () => ({
    ok: true,
    app: "melodify",
    sourceHealth: getSourceHealth(),
    playback: getPlaybackHealth()
  }));

  app.get("/api/library/home", async (request) => {
    const userId = request.user.id;
    return {
      heroGreeting: getGreeting(),
      recentlyPlayed: listRecentlyPlayed(userId, 4),
      library: listLibrary(userId, 12),
      favorites: listFavorites(userId).slice(0, 8),
      artists: listArtists(8)
    };
  });

  app.get("/api/library/songs", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 120);
    return { items: listLibrary(request.user.id, limit) };
  });

  app.get("/api/library/albums", async () => ({ items: listAlbums() }));
  app.get("/api/library/artists", async () => ({ items: listArtists() }));
  app.get("/api/library/albums/:albumId", async (request, reply) => {
    const album = getAlbum((request.params as { albumId: string }).albumId);
    if (!album) return reply.code(404).send({ error: "Album not found" });
    return album;
  });

  app.get("/api/search", async (request) => {
    const q = ((request.query as { q?: string }).q ?? "").trim();
    if (!q) return { items: [] };
    return { items: searchLibrary(request.user.id, q) };
  });

  app.get("/api/favorites", async (request) => ({ items: listFavorites(request.user.id) }));
  app.post("/api/favorites/:songId/toggle", async (request) => {
    const active = toggleFavorite(request.user.id, (request.params as { songId: string }).songId);
    return { active };
  });

  app.get("/api/recently-played", async (request) => ({ items: listRecentlyPlayed(request.user.id) }));
  app.post("/api/recently-played/:songId", async (request) => {
    recordPlayback(request.user.id, (request.params as { songId: string }).songId);
    return { ok: true };
  });

  app.get("/api/playlists", async (request) => ({ items: listPlaylists(request.user.id) }));
  app.post("/api/playlists", async (request) => {
    const body = request.body as { name: string; description?: string };
    return createPlaylist(request.user.id, body.name, body.description);
  });
  app.post("/api/playlists/:playlistId/songs", async (request) => {
    const params = request.params as { playlistId: string };
    const body = request.body as { songId: string };
    return addSongToPlaylist(params.playlistId, body.songId);
  });

  app.get("/api/radio", async (request) => {
    const { mode = "discover", artist } = request.query as { mode?: "discover" | "favorites" | "recent" | "artist"; artist?: string };
    return { items: buildStation(request.user.id, mode, artist) };
  });

  app.get("/api/preferences", async (request) => getPreferences(request.user.id));
  app.post("/api/preferences", async (request) => savePreferences(request.user.id, request.body as { theme?: string; playerState?: unknown }));

  async function runPrefetch(songId: string) {
    const candidates = getPrefetchCandidates(songId, appConfig.STREAM_PREFETCH_LIMIT);
    await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const resolved = await resolveSongStream(candidate.id);
          const stream = await resolved.streamFactory();
          await drainStream(stream.body);
        } catch {}
      })
    );
    return { queued: candidates.length };
  }

  app.post("/api/playback/prefetch", async (request) => {
    const body = request.body as { songId: string };
    return runPrefetch(body.songId);
  });
  app.post("/api/prefetch", async (request) => runPrefetch((request.body as { songId: string }).songId));

  async function runWarmup() {
    const candidates = getWarmupCandidates(appConfig.WARMUP_BATCH_SIZE);
    await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const resolved = await resolveSongStream(candidate.id);
          const stream = await resolved.streamFactory();
          await drainStream(stream.body);
        } catch {}
      })
    );
    return { warmed: candidates.length };
  }

  app.post("/api/playback/warmup", async () => runWarmup());
  app.post("/api/warmup", async () => runWarmup());

  app.get("/api/playback/status", async () => getPlaybackHealth());
  app.get("/api/cache/status", async () => getCacheStatus());
  app.post("/api/cache/trim", async () => trimCacheIfNeeded());
  app.get("/api/song-status/:songId", async (request, reply) => {
    const status = getSongPlaybackStatus((request.params as { songId: string }).songId);
    if (!status) return reply.code(404).send({ error: "Song not found" });
    return status;
  });

  app.get("/api/stream/:songId", async (request, reply) => {
    const { songId } = request.params as { songId: string };
    const resolved = await resolveSongStream(songId);
    const range = request.headers.range;
    const stream = await resolved.streamFactory(range);
    const song = getLibrarySong(request.user.id, songId);
    if (song) recordPlayback(request.user.id, song.id);
    reply.code(stream.statusCode);
    for (const [key, value] of Object.entries(stream.headers)) {
      reply.header(key, value);
    }
    return reply.send(stream.body);
  });

  app.get("/api/artwork/:songId", async (request, reply) => {
    const filePath = await resolveArtwork((request.params as { songId: string }).songId);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "Artwork not found" });
    }
    return reply.send(fs.createReadStream(filePath));
  });

  app.post("/api/admin/scrape", async (request) => {
    const body = request.body as { page?: number; limit?: number; incremental?: boolean; fullScan?: boolean } | undefined;
    const result = await scraperService.scrape(body ?? {});
    return result;
  });
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}
