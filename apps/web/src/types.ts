export type Song = {
  id: string;
  title: string;
  artist: string;
  albumTitle: string;
  albumId: string;
  artworkUrl?: string | null;
  albumArtUrl?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  coverUrl?: string | null;
  cover_url?: string | null;
  thumbnail?: string | null;
  album_art?: string | null;
  audioUrl?: string;
  streamUrl: string;
  favorite?: boolean;
  year?: number | null;
  durationSeconds?: number | null;
  composer?: string | null;
  trackNumber: number;
  updatedAt?: string;
};

export type Album = {
  albumId: string;
  albumUrl: string;
  name: string;
  year?: number | null;
  musicDirector?: string | null;
  singersSummary?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  coverUrl?: string | null;
  cover_url?: string | null;
  artworkUrl?: string | null;
  albumArtUrl?: string | null;
  thumbnail?: string | null;
  album_art?: string | null;
  language?: string | null;
  trackCount: number;
  updatedAt?: string;
};

export type AlbumDetail = Album & {
  songs: Song[];
};

export type HomeResponse = {
  heroGreeting: string;
  recentlyPlayed: Song[];
  library: Song[];
  favorites: Song[];
  artists: Array<{ artist: string; songCount: number }>;
  stats?: {
    songCount: number;
    albumCount: number;
  };
};

export type Playlist = {
  id: string;
  name: string;
  description?: string | null;
  songCount?: number;
};

export type RefreshStatus = {
  enabled: boolean;
  status: "idle" | "checking" | "downloading" | "applying" | "updated" | "error" | string;
  message?: string;
  manifestUrl?: string;
  currentVersion?: string;
  remoteVersion?: string;
  checkedAt?: string;
  updatedAt?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
};

export type ComposerCollection = {
  slug: string;
  name: string;
  songCount: number;
  albumCount: number;
  coverUrl?: string | null;
  sampleSongIds?: string[];
};

export type ComposerDetail = {
  slug: string;
  name: string;
  songCount: number;
  songs: Song[];
};
