import type { Album, ComposerCollection, Song } from "./types";

/**
 * Normalises text for case-insensitive, punctuation-loose matching while
 * preserving non-Latin scripts (Tamil, etc.). "A.R. Rahman", "A R Rahman",
 * and "ar rahman" all collapse to "a r rahman" so any of them matches.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    // Replace every char that isn't a letter (any script), digit, or whitespace
    // with a single space. Apostrophes/hyphens/dots → space so tokens collapse.
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-level normalised text — collapses spaces so "a r" matches "ar". */
export function normalizeCompact(value: string | null | undefined): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

export type SearchableTrack = {
  type: "track";
  id: string;
  song: Song;
  title: string;
  subtitle: string;
  normTitle: string;
  normArtist: string;
  normAlbum: string;
  normComposer: string;
  haystack: string;
  haystackCompact: string;
};

export type SearchableAlbum = {
  type: "album";
  id: string;
  album: Album;
  title: string;
  subtitle: string;
  normTitle: string;
  normComposer: string;
  haystack: string;
  haystackCompact: string;
};

export type SearchableArtist = {
  type: "artist";
  id: string;
  artist: { artist: string; songCount: number };
  title: string;
  subtitle: string;
  normTitle: string;
  haystack: string;
  haystackCompact: string;
};

export type SearchableComposer = {
  type: "composer";
  id: string;
  composer: ComposerCollection;
  title: string;
  subtitle: string;
  normTitle: string;
  haystack: string;
  haystackCompact: string;
};

export type SearchablePlaylist = {
  type: "playlist";
  id: string;
  playlist: { id: string; name: string; count: number };
  title: string;
  subtitle: string;
  normTitle: string;
  haystack: string;
  haystackCompact: string;
};

export type SearchableItem =
  | SearchableTrack
  | SearchableAlbum
  | SearchableArtist
  | SearchableComposer
  | SearchablePlaylist;

export function buildTrackIndex(songs: Song[]): SearchableTrack[] {
  return songs.map((song) => {
    const normTitle = normalizeSearchText(song.title);
    const normArtist = normalizeSearchText(song.artist);
    const normAlbum = normalizeSearchText(song.albumTitle);
    const normComposer = normalizeSearchText(song.composer ?? "");
    const haystack = `${normTitle} ${normArtist} ${normAlbum} ${normComposer}`.trim();
    return {
      type: "track" as const,
      id: song.id,
      song,
      title: song.title,
      subtitle: song.artist,
      normTitle,
      normArtist,
      normAlbum,
      normComposer,
      haystack,
      haystackCompact: haystack.replace(/\s+/g, ""),
    };
  });
}

export function buildAlbumIndex(albums: Album[]): SearchableAlbum[] {
  return albums.map((album) => {
    const normTitle = normalizeSearchText(album.name);
    const normComposer = normalizeSearchText(album.musicDirector ?? album.singersSummary ?? "");
    const haystack = `${normTitle} ${normComposer}`.trim();
    return {
      type: "album" as const,
      id: album.albumId,
      album,
      title: album.name,
      subtitle: album.musicDirector || album.singersSummary || "Album",
      normTitle,
      normComposer,
      haystack,
      haystackCompact: haystack.replace(/\s+/g, ""),
    };
  });
}

export function buildArtistIndex(artists: Array<{ artist: string; songCount: number }>): SearchableArtist[] {
  return artists.map((entry) => {
    const normTitle = normalizeSearchText(entry.artist);
    return {
      type: "artist" as const,
      id: entry.artist,
      artist: entry,
      title: entry.artist,
      subtitle: `${entry.songCount} song${entry.songCount === 1 ? "" : "s"}`,
      normTitle,
      haystack: normTitle,
      haystackCompact: normTitle.replace(/\s+/g, ""),
    };
  });
}

export function buildComposerIndex(composers: ComposerCollection[]): SearchableComposer[] {
  return composers.map((entry) => {
    const normTitle = normalizeSearchText(entry.name);
    return {
      type: "composer" as const,
      id: entry.slug,
      composer: entry,
      title: entry.name,
      subtitle: `${entry.songCount} song${entry.songCount === 1 ? "" : "s"}`,
      normTitle,
      haystack: normTitle,
      haystackCompact: normTitle.replace(/\s+/g, ""),
    };
  });
}

export function buildPlaylistIndex(
  playlists: Array<{ id: string; name: string; count: number }>,
): SearchablePlaylist[] {
  return playlists.map((entry) => {
    const normTitle = normalizeSearchText(entry.name);
    return {
      type: "playlist" as const,
      id: entry.id,
      playlist: entry,
      title: entry.name,
      subtitle: `${entry.count} song${entry.count === 1 ? "" : "s"}`,
      normTitle,
      haystack: normTitle,
      haystackCompact: normTitle.replace(/\s+/g, ""),
    };
  });
}

/**
 * Score a candidate against a normalised query. Lower is better; -1 means no
 * match. Encoded so that exact title beats prefix beats contains beats
 * compact-contains, with secondary matches on artist/album scoring lower.
 */
function scoreMatch(item: SearchableItem, normQuery: string, compactQuery: string): number {
  if (!normQuery) return -1;

  const title = item.normTitle;
  if (title === normQuery) return 0;
  if (title.startsWith(normQuery)) return 10;
  if (title.includes(normQuery)) return 20;

  if (item.type === "track") {
    if (item.normArtist.startsWith(normQuery)) return 30;
    if (item.normAlbum.startsWith(normQuery)) return 35;
    if (item.normArtist.includes(normQuery)) return 40;
    if (item.normAlbum.includes(normQuery)) return 45;
    if (item.normComposer.includes(normQuery)) return 50;
  }
  if (item.type === "album" && item.normComposer.includes(normQuery)) return 55;

  if (item.haystackCompact.includes(compactQuery)) return 90;
  if (item.haystack.includes(normQuery)) return 80;
  return -1;
}

export type SearchHit = {
  item: SearchableItem;
  score: number;
};

export function searchItems(
  items: SearchableItem[],
  query: string,
  limit: number,
): SearchHit[] {
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return [];
  const compactQuery = normQuery.replace(/\s+/g, "");

  const matches: SearchHit[] = [];
  for (const item of items) {
    const score = scoreMatch(item, normQuery, compactQuery);
    if (score >= 0) matches.push({ item, score });
  }
  matches.sort((a, b) => a.score - b.score);
  return matches.slice(0, limit);
}
