export type Album = {
  id: string;
  slug: string;
  title: string;
  artist: string;
  musicDirector: string | null;
  director: string | null;
  year: number | null;
  language: string | null;
  sourceUrl: string;
  artworkUrl: string | null;
  trackCount: number;
  firstSeenAt: string;
  updatedAt: string;
  lastScrapedAt: string | null;
};

export type Song = {
  id: string;
  albumId: string;
  title: string;
  artist: string;
  singers: string | null;
  composer: string | null;
  year: number | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  sourcePageUrl: string;
  upstreamUrl: string | null;
  audio128Url: string | null;
  audio320Url: string | null;
  audioLinksJson: string | null;
  artworkUrl: string | null;
  lyricsBy: string | null;
  firstSeenAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  lastPlaybackErrorAt: string | null;
};

export type PublicSong = {
  id: string;
  albumId: string;
  movie: string;
  album: string;
  albumTitle: string;
  track: string;
  title: string;
  artists: string;
  artist: string;
  singers: string | null;
  composer: string | null;
  musicDirector: string | null;
  year: number | null;
  trackNumber: number | null;
  durationSeconds: number | null;
  updatedAt: string;
  artworkProxyUrl: string | null;
  audioUrl: string;
  streamUrl: string;
  favorite: boolean;
};

export type Playlist = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LibrarySong = Song & {
  albumTitle: string;
  albumArtist: string;
  musicDirector: string | null;
};

export type SearchIndexRecord = {
  id: string;
  title: string;
  album: string;
  artist: string;
  singers: string | null;
  composer: string | null;
  year: number | null;
};

export type ScrapedAlbum = {
  slug: string;
  title: string;
  artist: string;
  musicDirector: string | null;
  director: string | null;
  lyricists: string | null;
  year: number | null;
  language: string | null;
  sourceUrl: string;
  artworkUrl: string | null;
  trackCount: number;
  songs: ScrapedSong[];
};

export type ScrapedSong = {
  title: string;
  artist: string;
  singers: string | null;
  composer: string | null;
  year: number | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  sourcePageUrl: string;
  upstreamUrl: string | null;
  audio128Url: string | null;
  audio320Url: string | null;
  audioLinksJson: string | null;
  artworkUrl: string | null;
  lyricsBy: string | null;
};

export type SongStreamRecord = Song & {
  albumTitle: string;
  musicDirector: string | null;
  albumSourceUrl: string;
  albumSlug: string;
};

export type SongStatus = {
  id: string;
  albumUrl: string;
  hasUpstreamUrl: boolean;
  lastVerifiedAt: string | null;
  lastPlaybackErrorAt: string | null;
  cacheStatus: "missing" | "valid" | "invalid";
  updatedAt: string;
};

export type PlaybackResolveResult = {
  source: "local-cache" | "shared-cache" | "upstream";
  contentType: string;
  contentLength: number | null;
  path?: string;
  streamFactory: (rangeHeader?: string) => Promise<ResolvedStream>;
};

export type ResolvedStream = {
  statusCode: number;
  headers: Record<string, string>;
  body: NodeJS.ReadableStream;
};

export type StationMode = "favorites" | "recent" | "discover" | "artist";
