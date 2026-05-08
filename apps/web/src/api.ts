import type { Album, AlbumDetail, ComposerCollection, ComposerDetail, HomeResponse, Playlist, RefreshStatus, Song } from "./types";

type ApiSong =
  | Song
  | {
      song_id?: string;
      track_name?: string;
      singers?: string | null;
      album_name?: string;
      album_id?: string;
      image_url?: string | null;
      audioUrl?: string;
      streamUrl?: string;
      favorite?: boolean;
      year?: number | null;
      music_director?: string | null;
      track_number?: number;
      updated_at?: string;
    };

function isFrontendSong(song: ApiSong): song is Song {
  return "id" in song;
}

type ApiAlbum = {
  album_id: string;
  album_url: string;
  album_name: string;
  year?: number | null;
  music_director?: string | null;
  singers_summary?: string | null;
  image_url?: string | null;
  language?: string | null;
  track_count: number;
  updated_at?: string;
  songs?: ApiSong[];
};

function cleanAlbumName(value: string | undefined): string {
  const raw = value ?? "";
  return raw
    .replace(/\s+tamil mp3 songs download masstamilan\.com$/i, "")
    .replace(/\s+mass?tamilan\.com$/i, "")
    .trim();
}

function normalizeSong(song: ApiSong): Song {
  if (isFrontendSong(song)) {
    return {
      ...song,
      albumTitle: cleanAlbumName(song.albumTitle),
      audioUrl: song.audioUrl ?? song.streamUrl
    };
  }
  return {
    id: song.song_id ?? "",
    title: song.track_name ?? "Unknown track",
    artist: song.singers ?? song.music_director ?? song.album_name ?? "Unknown artist",
    albumTitle: cleanAlbumName(song.album_name) || "Unknown album",
    albumId: song.album_id ?? "",
    artworkUrl: song.image_url ?? null,
    audioUrl: song.streamUrl ?? song.audioUrl ?? "",
    streamUrl: song.streamUrl ?? song.audioUrl ?? "",
    favorite: song.favorite ?? false,
    year: song.year ?? null,
    composer: song.music_director ?? null,
    trackNumber: song.track_number ?? 0,
    updatedAt: song.updated_at
  };
}

function normalizeAlbum(album: ApiAlbum): Album {
  return {
    albumId: album.album_id,
    albumUrl: album.album_url,
    name: cleanAlbumName(album.album_name),
    year: album.year ?? null,
    musicDirector: album.music_director ?? null,
    singersSummary: album.singers_summary ?? null,
    imageUrl: album.image_url ?? null,
    language: album.language ?? null,
    trackCount: album.track_count,
    updatedAt: album.updated_at
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export const apiClient = {
  home: async (): Promise<HomeResponse> => {
    const data = await api<HomeResponse>("/api/library/home");
    return {
      ...data,
      recentlyPlayed: data.recentlyPlayed.map(normalizeSong),
      library: data.library.map(normalizeSong),
      favorites: data.favorites.map(normalizeSong)
    };
  },
  songs: async (): Promise<{ items: Song[] }> => {
    const data = await api<{ items: ApiSong[] }>("/api/library/songs");
    return { items: data.items.map(normalizeSong) };
  },
  albums: async (): Promise<{ items: Album[] }> => {
    const data = await api<{ items: ApiAlbum[] }>("/api/albums");
    return { items: data.items.map(normalizeAlbum) };
  },
  album: async (albumId: string): Promise<AlbumDetail> => {
    const data = await api<ApiAlbum>(`/api/albums/${albumId}`);
    return {
      ...normalizeAlbum(data),
      songs: (data.songs ?? []).map(normalizeSong)
    };
  },
  playlists: () => api<{ items: Playlist[] }>("/api/playlists"),
  favorites: async (): Promise<{ items: Song[] }> => {
    const data = await api<{ items: ApiSong[] }>("/api/favorites");
    return { items: data.items.map(normalizeSong) };
  },
  search: async (q: string, signal?: AbortSignal): Promise<{ items: Song[] }> => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = (await response.json()) as { items: ApiSong[] };
    return { items: data.items.map(normalizeSong) };
  },
  searchAll: async (
    q: string,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<{
    query: string;
    tracks: Song[];
    albums: Album[];
    artists: Array<{ artist: string; songCount: number }>;
    composers: ComposerCollection[];
  }> => {
    const response = await fetch(
      `/api/search/all?q=${encodeURIComponent(q)}&limit=${limit}`,
      { credentials: "include", signal },
    );
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = (await response.json()) as {
      query: string;
      tracks: ApiSong[];
      albums: ApiAlbum[];
      artists: Array<{ artist: string; songCount: number }>;
      composers: Array<{
        slug: string;
        name: string;
        songCount: number;
        albumCount: number;
        coverUrl?: string | null;
        sampleSongIds?: string[];
      }>;
    };
    return {
      query: data.query,
      tracks: data.tracks.map(normalizeSong),
      albums: data.albums.map(normalizeAlbum),
      artists: data.artists,
      composers: data.composers.map((item) => ({
        slug: item.slug,
        name: item.name,
        songCount: item.songCount,
        albumCount: item.albumCount,
        coverUrl: item.coverUrl ?? null,
        sampleSongIds: item.sampleSongIds ?? [],
      })),
    };
  },
  toggleFavorite: (songId: string) => api<{ active: boolean }>(`/api/favorites/${songId}/toggle`, { method: "POST" }),
  recordPlayback: (songId: string) => api<{ ok: boolean }>(`/api/recently-played/${songId}`, { method: "POST" }),
  prefetchRelated: (songId: string) =>
    api<{ queued: number }>("/api/playback/prefetch", {
      method: "POST",
      body: JSON.stringify({ songId })
    }),
  prefetchSongs: (songIds: string[]) =>
    api<{ queued: number }>("/api/prefetch", {
      method: "POST",
      body: JSON.stringify({ songIds })
    }),
  warmup: (limit = 48) =>
    api<{ ok: boolean; queued: number }>("/api/warmup", {
      method: "POST",
      body: JSON.stringify({ limit })
    }),
  cacheStatus: () => api<{ fileCount: number; totalBytes: number; totalMegabytes: number; limitMegabytes: number }>("/api/cache/status"),
  refreshStatus: () => api<RefreshStatus>("/api/refresh/status"),
  refreshCheck: () => api<RefreshStatus>("/api/refresh/check", { method: "POST" }),
  prefetchAlbum: (albumId: string, leadLimit = 4, refreshLinks = false) =>
    api<{ ok: boolean; queued: number; songCount: number }>("/api/prefetch/album", {
      method: "POST",
      body: JSON.stringify({ albumId, leadLimit, refreshLinks })
    }),
  composers: async (): Promise<{ items: ComposerCollection[] }> => {
    const data = await api<{
      items: Array<{
        slug: string;
        name: string;
        songCount: number;
        albumCount: number;
        coverUrl?: string | null;
        sampleSongIds?: string[];
      }>;
    }>("/api/composers");
    return {
      items: data.items.map((item) => ({
        slug: item.slug,
        name: item.name,
        songCount: item.songCount,
        albumCount: item.albumCount,
        coverUrl: item.coverUrl ?? null,
        sampleSongIds: item.sampleSongIds ?? []
      }))
    };
  },
  composerSongs: async (slug: string): Promise<ComposerDetail> => {
    const data = await api<{ slug: string; name: string; songCount: number; items: ApiSong[] }>(
      `/api/composers/${encodeURIComponent(slug)}/songs`
    );
    return {
      slug: data.slug,
      name: data.name,
      songCount: data.songCount,
      songs: data.items.map(normalizeSong)
    };
  }
};
