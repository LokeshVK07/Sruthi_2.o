export const fallbackArt =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23191343'/><stop offset='45%' stop-color='%235320bf'/><stop offset='100%' stop-color='%23e668ff'/></linearGradient></defs><rect width='800' height='800' rx='44' fill='url(%23g)'/><path d='M518 168v296c0 30-24 55-69 71-34 12-78 11-98-4-21-14-18-39 6-54 22-14 55-20 84-16V245l166-36v211c0 31-24 56-69 72-35 12-78 11-99-4-21-15-17-39 7-54 21-14 54-20 84-16V168h-12Z' fill='white' fill-opacity='.9'/></svg>";

export type ArtworkSource = {
  artworkUrl?: string | null;
  albumArtUrl?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  coverUrl?: string | null;
  cover_url?: string | null;
  thumbnail?: string | null;
  album_art?: string | null;
};

function cleanArtworkUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

export function resolveArtwork(item?: ArtworkSource | null): string {
  const candidates = [
    item?.artworkUrl,
    item?.albumArtUrl,
    item?.imageUrl,
    item?.image_url,
    item?.coverUrl,
    item?.cover_url,
    item?.thumbnail,
    item?.album_art,
  ];

  for (const candidate of candidates) {
    const cleaned = cleanArtworkUrl(candidate);
    if (cleaned) return cleaned;
  }

  return fallbackArt;
}

export function heroArtworkFor(song?: ArtworkSource | null, album?: ArtworkSource | null): string {
  const songArt = resolveArtwork(song);
  if (songArt !== fallbackArt) return songArt;

  const albumArt = resolveArtwork(album);
  if (albumArt !== fallbackArt) return albumArt;

  return fallbackArt;
}

export function normalizeAlbum(raw: any) {
  const artworkUrl =
    raw?.artworkUrl ??
    raw?.imageUrl ??
    raw?.image_url ??
    raw?.coverUrl ??
    raw?.cover_url ??
    raw?.album_art ??
    raw?.thumbnail ??
    null;

  return {
    ...raw,
    id: String(raw?.id ?? raw?.albumId ?? raw?.album_id ?? raw?.album_url ?? ""),
    albumId: String(raw?.albumId ?? raw?.album_id ?? raw?.id ?? raw?.album_url ?? ""),
    name: raw?.name ?? raw?.albumTitle ?? raw?.album_name ?? "Unknown album",
    title: raw?.title ?? raw?.albumTitle ?? raw?.album_name ?? "Unknown album",
    artist: raw?.artist ?? raw?.musicDirector ?? raw?.music_director ?? raw?.singersSummary ?? raw?.singers_summary ?? "",
    year: raw?.year ?? null,
    artworkUrl,
    imageUrl: artworkUrl,
    coverUrl: artworkUrl,
    songs: Array.isArray(raw?.songs) ? raw.songs.map((song: any) => normalizeSong(song, { artworkUrl })) : [],
  };
}

export function normalizeSong(raw: any, album?: { artworkUrl?: string | null }) {
  const artworkUrl =
    raw?.artworkUrl ??
    raw?.imageUrl ??
    raw?.image_url ??
    raw?.coverUrl ??
    raw?.cover_url ??
    raw?.albumArtUrl ??
    raw?.album_art ??
    raw?.thumbnail ??
    album?.artworkUrl ??
    null;

  return {
    ...raw,
    id: String(raw?.id ?? raw?.songId ?? raw?.song_id ?? ""),
    title: raw?.title ?? raw?.trackName ?? raw?.track_name ?? "Unknown track",
    artist: raw?.artist ?? raw?.singers ?? raw?.singer ?? "Unknown artist",
    albumTitle: raw?.albumTitle ?? raw?.album_name ?? raw?.album ?? "Unknown album",
    albumId: String(raw?.albumId ?? raw?.album_id ?? ""),
    artworkUrl,
    imageUrl: artworkUrl,
    coverUrl: artworkUrl,
    streamUrl: raw?.streamUrl ?? raw?.stream_url ?? raw?.url_320kbps ?? raw?.url_128kbps ?? "",
    durationSeconds: raw?.durationSeconds ?? raw?.duration_seconds ?? 240,
    favorite: Boolean(raw?.favorite),
  };
}

export const imageForSong = resolveArtwork;
export const imageForAlbum = resolveArtwork;

export function replaceBrokenArtwork(event: { currentTarget: HTMLImageElement }) {
  if (event.currentTarget.src !== fallbackArt) {
    event.currentTarget.src = fallbackArt;
  }
}
