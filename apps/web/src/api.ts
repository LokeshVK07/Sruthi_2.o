import type { Album, AlbumDetail, ComposerCollection, ComposerDetail, HomeResponse, Playlist, RefreshStatus, Song } from "./types";
import { normalizeAlbum as normalizeArtworkAlbum, normalizeSong as normalizeArtworkSong } from "./utils/artwork";

type LegacySong = {
  id: string;
  albumUrl?: string;
  title: string;
  artist?: string;
  singers?: string;
  composer?: string;
  movie?: string;
  year?: number | null;
  mood?: string;
  audioUrl?: string;
  sourceUrl?: string;
  imageUrl?: string | null;
  image_url?: string | null;
  albumArtUrl?: string | null;
  coverUrl?: string | null;
  cover_url?: string | null;
  thumbnail?: string | null;
  album_art?: string | null;
  downloadLinks?: Array<{ label?: string; url: string; bitrate?: number }>;
  spotify?: Record<string, unknown>;
  lastRefreshedAt?: string;
  linkStatus?: string;
};

type LegacyLibraryResponse = {
  songs: LegacySong[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type LegacyAppState = {
  summary?: {
    albumCount?: number;
    trackCount?: number;
  };
  updatedAt?: string | null;
};

type StoredFavorite = {
  id: string;
  title?: string;
  composer?: string;
};

type StoredPlaylist = {
  id: string;
  name: string;
  songIds: string[];
};

const FAVORITES_KEY = "sruthi-favorites";
const PLAYLISTS_KEY = "sruthi-playlists";
const RECENTLY_PLAYED_STORAGE_KEY = "sruthi_recently_played";
const LIBRARY_CACHE_TTL_MS = 15_000;
const LIBRARY_PAGE_SIZE = 5000;
const MAX_LIBRARY_PAGES = 20;

let libraryCache:
  | {
      loadedAt: number;
      promise: Promise<Song[]>;
    }
  | null = null;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "album";
}

function absoluteStreamUrl(path: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, window.location.origin).toString();
}

function artworkUrlForSong(songId: string, updatedAt?: string) {
  const url = new URL("/api/artwork", window.location.origin);
  url.searchParams.set("id", songId);
  if (updatedAt) url.searchParams.set("v", updatedAt);
  return url.toString();
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function favoriteIds() {
  const stored = readStorage<StoredFavorite[]>(FAVORITES_KEY, []);
  return new Set(stored.map((item) => item.id).filter(Boolean));
}

function readPlaylists() {
  return readStorage<StoredPlaylist[]>(PLAYLISTS_KEY, []).filter(
    (playlist) => playlist && typeof playlist.id === "string" && typeof playlist.name === "string" && Array.isArray(playlist.songIds),
  );
}

function readRecentlyPlayed() {
  return readStorage<Song[]>(RECENTLY_PLAYED_STORAGE_KEY, []).filter((song) => song && typeof song.id === "string");
}

function normalizeSong(song: LegacySong, favorites: Set<string>): Song {
  const albumTitle = (song.movie || "Unknown album").trim() || "Unknown album";
  const albumId = slugify(song.albumUrl || albumTitle);
  const favorite = favorites.has(song.id);
  const audioUrl = absoluteStreamUrl(song.audioUrl || "");
  const artworkSong = normalizeArtworkSong(song);
  const directArtwork = artworkSong.artworkUrl;
  const proxiedArtwork = artworkUrlForSong(song.id, song.lastRefreshedAt);
  return {
    id: song.id,
    title: song.title || "Unknown track",
    artist: song.artist || song.singers || song.composer || "Unknown artist",
    albumTitle,
    albumId,
    artworkUrl: proxiedArtwork,
    albumArtUrl: song.albumArtUrl || song.imageUrl || song.image_url || null,
    imageUrl: directArtwork || null,
    image_url: song.image_url || song.imageUrl || null,
    coverUrl: artworkSong.coverUrl || null,
    cover_url: song.cover_url || song.coverUrl || null,
    thumbnail: song.thumbnail || null,
    album_art: song.album_art || null,
    audioUrl,
    streamUrl: audioUrl,
    favorite,
    year: typeof song.year === "number" ? song.year : null,
    durationSeconds: null,
    composer: song.composer || null,
    trackNumber: 0,
    updatedAt: song.lastRefreshedAt || undefined,
  };
}

function normalizeAlbumSongs(songs: Song[]): Album[] {
  const byId = new Map<string, Album>();
  for (const song of songs) {
    const existing = byId.get(song.albumId);
    if (existing) {
      existing.trackCount += 1;
      if (!existing.imageUrl && (song.imageUrl || song.artworkUrl)) existing.imageUrl = song.imageUrl || song.artworkUrl;
      if (!existing.coverUrl && (song.coverUrl || song.imageUrl || song.artworkUrl)) {
        existing.coverUrl = song.coverUrl || song.imageUrl || song.artworkUrl;
      }
      continue;
    }
    byId.set(song.albumId, {
      ...normalizeArtworkAlbum({
        albumId: song.albumId,
        albumUrl: song.albumId,
        name: song.albumTitle,
        imageUrl: song.imageUrl || song.artworkUrl || null,
        coverUrl: song.coverUrl || song.imageUrl || song.artworkUrl || null,
      }),
      albumId: song.albumId,
      albumUrl: song.albumId,
      name: song.albumTitle,
      year: song.year ?? null,
      musicDirector: song.composer ?? null,
      singersSummary: song.artist ?? null,
      imageUrl: song.imageUrl || song.artworkUrl || null,
      coverUrl: song.coverUrl || song.imageUrl || song.artworkUrl || null,
      language: "Tamil",
      trackCount: 1,
      updatedAt: song.updatedAt,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchLegacyLibrary(force = false): Promise<Song[]> {
  const now = Date.now();
  if (!force && libraryCache && now - libraryCache.loadedAt < LIBRARY_CACHE_TTL_MS) {
    return libraryCache.promise;
  }
  const promise = (async () => {
    const favorites = favoriteIds();
    const songs: Song[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_LIBRARY_PAGES; page += 1) {
      const payload = await api<LegacyLibraryResponse>(
        `/api/library?query=&decade=all&mood=all&full=true&offset=${offset}&limit=${LIBRARY_PAGE_SIZE}`,
      );
      songs.push(...payload.songs.map((song) => normalizeSong(song, favorites)));
      if (!payload.hasMore || payload.songs.length < LIBRARY_PAGE_SIZE) {
        break;
      }
      offset += payload.songs.length;
    }
    return songs;
  })();
  libraryCache = { loadedAt: now, promise };
  return promise;
}

function filterSongs(songs: Song[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return songs;
  return songs.filter((song) =>
    [song.title, song.artist, song.albumTitle, song.composer ?? ""].join(" ").toLowerCase().includes(normalized),
  );
}

function groupArtists(songs: Song[]) {
  const counts = new Map<string, number>();
  for (const song of songs) {
    const artist = song.artist || "Unknown artist";
    counts.set(artist, (counts.get(artist) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, songCount]) => ({ artist, songCount }))
    .sort((a, b) => b.songCount - a.songCount || a.artist.localeCompare(b.artist));
}

function groupComposers(songs: Song[]): ComposerCollection[] {
  const grouped = new Map<string, { slug: string; name: string; songCount: number; albumIds: Set<string>; coverUrl: string | null; sampleSongIds: string[] }>();
  for (const song of songs) {
    const name = song.composer || song.artist || "Unknown composer";
    const slug = slugify(name);
    const existing = grouped.get(slug) || {
      slug,
      name,
      songCount: 0,
      albumIds: new Set<string>(),
      coverUrl: song.artworkUrl || null,
      sampleSongIds: [],
    };
    existing.songCount += 1;
    existing.albumIds.add(song.albumId);
    if (!existing.coverUrl && song.artworkUrl) existing.coverUrl = song.artworkUrl;
    if (existing.sampleSongIds.length < 4 && !existing.sampleSongIds.includes(song.id)) existing.sampleSongIds.push(song.id);
    grouped.set(slug, existing);
  }
  return [...grouped.values()]
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      songCount: entry.songCount,
      albumCount: entry.albumIds.size,
      coverUrl: entry.coverUrl,
      sampleSongIds: entry.sampleSongIds,
    }))
    .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name));
}

async function currentStatus(): Promise<LegacyAppState> {
  return api<LegacyAppState>("/api/app-state");
}

export const apiClient = {
  home: async (): Promise<HomeResponse> => {
    const [library, state] = await Promise.all([fetchLegacyLibrary(), currentStatus()]);
    const favoritesSet = favoriteIds();
    const favorites = library.filter((song) => favoritesSet.has(song.id));
    const recent = readRecentlyPlayed()
      .map((item) => library.find((song) => song.id === item.id) || item)
      .filter((song): song is Song => Boolean(song));
    return {
      heroGreeting: "Now playing from your Tamil vault",
      recentlyPlayed: recent,
      library: library.slice(0, 120),
      favorites,
      artists: groupArtists(library).slice(0, 24),
      stats: {
        songCount: state.summary?.trackCount ?? library.length,
        albumCount: state.summary?.albumCount ?? normalizeAlbumSongs(library).length,
      },
    };
  },
  songs: async (): Promise<{ items: Song[] }> => {
    const items = await fetchLegacyLibrary();
    return { items };
  },
  albums: async (): Promise<{ items: Album[] }> => {
    const items = normalizeAlbumSongs(await fetchLegacyLibrary());
    return { items };
  },
  album: async (albumId: string): Promise<AlbumDetail> => {
    const songs = (await fetchLegacyLibrary()).filter((song) => song.albumId === albumId);
    const album = normalizeAlbumSongs(songs)[0];
    if (!album) {
      throw new Error("Album not found");
    }
    return { ...album, songs };
  },
  playlists: async (): Promise<{ items: Playlist[] }> => {
    const items = readPlaylists().map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: null,
      songCount: playlist.songIds.length,
    }));
    return { items };
  },
  favorites: async (): Promise<{ items: Song[] }> => {
    const library = await fetchLegacyLibrary();
    const favs = favoriteIds();
    return { items: library.filter((song) => favs.has(song.id)) };
  },
  search: async (q: string): Promise<{ items: Song[] }> => {
    const items = filterSongs(await fetchLegacyLibrary(), q).slice(0, 50);
    return { items };
  },
  searchAll: async (
    q: string,
    limit = 20,
  ): Promise<{
    query: string;
    tracks: Song[];
    albums: Album[];
    artists: Array<{ artist: string; songCount: number }>;
    composers: ComposerCollection[];
  }> => {
    const library = await fetchLegacyLibrary();
    const tracks = filterSongs(library, q).slice(0, Math.max(limit, 12));
    const albums = normalizeAlbumSongs(tracks).slice(0, 12);
    const artists = groupArtists(tracks).slice(0, 12);
    const composers = groupComposers(tracks).slice(0, 12);
    return { query: q, tracks, albums, artists, composers };
  },
  toggleFavorite: async (songId: string): Promise<{ active: boolean }> => {
    const library = await fetchLegacyLibrary();
    const current = readStorage<StoredFavorite[]>(FAVORITES_KEY, []);
    const exists = current.some((item) => item.id === songId);
    const song = library.find((item) => item.id === songId);
    const next = exists
      ? current.filter((item) => item.id !== songId)
      : [{ id: songId, title: song?.title, composer: song?.composer ?? undefined }, ...current];
    writeStorage(FAVORITES_KEY, next);
    return { active: !exists };
  },
  recordPlayback: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  prefetchRelated: async (songId: string): Promise<{ queued: number }> => {
    const payload = await api<{ queuedAlbums?: number; queuedSongs?: number; ok?: boolean }>("/api/prefetch/album", {
      method: "POST",
      body: JSON.stringify({ songId, limit: 8 }),
    });
    return { queued: Number(payload.queuedSongs || 0) };
  },
  prefetchSongs: async (songIds: string[]): Promise<{ queued: number }> => {
    const payload = await api<{ queued?: number }>("/api/prefetch", {
      method: "POST",
      body: JSON.stringify({ ids: songIds.slice(0, 8) }),
    });
    return { queued: Number(payload.queued || 0) };
  },
  warmup: async (limit = 24): Promise<{ ok: boolean; queued: number }> => {
    const payload = await api<{ ok: boolean; queuedSongs?: number[] }>("/api/warmup", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
    return { ok: payload.ok, queued: Array.isArray(payload.queuedSongs) ? payload.queuedSongs.length : 0 };
  },
  cacheStatus: async () => {
    const payload = await api<{ cachedCount?: number; inFlight?: number; refreshingAlbums?: number }>("/api/cache/status");
    return {
      fileCount: Number(payload.cachedCount || 0),
      totalBytes: 0,
      totalMegabytes: 0,
      limitMegabytes: 0,
      inFlight: Number(payload.inFlight || 0),
      refreshingAlbums: Number(payload.refreshingAlbums || 0),
    };
  },
  refreshStatus: async (): Promise<RefreshStatus> => {
    const payload = await currentStatus();
    const version = payload.updatedAt || new Date().toISOString();
    return {
      enabled: true,
      status: "updated",
      message: `${payload.summary?.trackCount ?? 0} songs indexed`,
      currentVersion: version,
      remoteVersion: version,
      checkedAt: version,
      updatedAt: version,
    };
  },
  refreshCheck: async (): Promise<RefreshStatus> => apiClient.refreshStatus(),
  prefetchAlbum: async (albumId: string, leadLimit = 4, refreshLinks = false) => {
    const library = await fetchLegacyLibrary();
    const leadSong = library.find((song) => song.albumId === albumId);
    if (!leadSong) return { ok: false, queued: 0, songCount: 0 };
    const payload = await api<{ ok: boolean; queuedSongs?: number; albumSongCount?: number }>("/api/prefetch/album", {
      method: "POST",
      body: JSON.stringify({ songId: leadSong.id, limit: leadLimit, refreshLinks }),
    });
    return {
      ok: payload.ok,
      queued: Number(payload.queuedSongs || 0),
      songCount: Number(payload.albumSongCount || 0),
    };
  },
  composers: async (): Promise<{ items: ComposerCollection[] }> => {
    const items = groupComposers(await fetchLegacyLibrary());
    return { items };
  },
  composerSongs: async (slug: string): Promise<ComposerDetail> => {
    const songs = (await fetchLegacyLibrary()).filter((song) => slugify(song.composer || song.artist || "unknown-composer") === slug);
    const label = songs[0]?.composer || songs[0]?.artist || "Unknown composer";
    return {
      slug,
      name: label,
      songCount: songs.length,
      songs,
    };
  },
  invalidateLibraryCache() {
    libraryCache = null;
  },
};
