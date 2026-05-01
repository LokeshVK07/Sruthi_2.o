function isFrontendSong(song) {
    return "id" in song;
}
function cleanAlbumName(value) {
    const raw = value ?? "";
    return raw
        .replace(/\s+tamil mp3 songs download masstamilan\.com$/i, "")
        .replace(/\s+mass?tamilan\.com$/i, "")
        .trim();
}
function normalizeSong(song) {
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
function normalizeAlbum(album) {
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
async function api(path, init) {
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
    home: async () => {
        const data = await api("/api/library/home");
        return {
            ...data,
            recentlyPlayed: data.recentlyPlayed.map(normalizeSong),
            library: data.library.map(normalizeSong),
            favorites: data.favorites.map(normalizeSong)
        };
    },
    songs: async () => {
        const data = await api("/api/library/songs");
        return { items: data.items.map(normalizeSong) };
    },
    albums: async () => {
        const data = await api("/api/albums");
        return { items: data.items.map(normalizeAlbum) };
    },
    album: async (albumId) => {
        const data = await api(`/api/albums/${albumId}`);
        return {
            ...normalizeAlbum(data),
            songs: (data.songs ?? []).map(normalizeSong)
        };
    },
    playlists: () => api("/api/playlists"),
    favorites: async () => {
        const data = await api("/api/favorites");
        return { items: data.items.map(normalizeSong) };
    },
    search: async (q) => {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        return { items: data.items.map(normalizeSong) };
    },
    toggleFavorite: (songId) => api(`/api/favorites/${songId}/toggle`, { method: "POST" }),
    recordPlayback: (songId) => api(`/api/recently-played/${songId}`, { method: "POST" }),
    prefetchRelated: (songId) => api("/api/playback/prefetch", {
        method: "POST",
        body: JSON.stringify({ songId })
    }),
    prefetchSongs: (songIds) => api("/api/prefetch", {
        method: "POST",
        body: JSON.stringify({ songIds })
    }),
    warmup: () => api("/api/warmup", { method: "POST" }),
    cacheStatus: () => api("/api/cache/status")
};
