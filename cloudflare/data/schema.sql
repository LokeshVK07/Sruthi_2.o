-- D1 schema for Sruthi 2.o catalogue. Paste this whole block into the
-- Cloudflare D1 Console (single Execute) — it's small and well under the
-- console's paste limit.

DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS songs;

CREATE TABLE albums (
  album_url TEXT PRIMARY KEY,
  album_id TEXT UNIQUE NOT NULL,
  album_name TEXT NOT NULL,
  year INTEGER,
  music_director TEXT,
  singers_summary TEXT,
  image_url TEXT,
  language TEXT,
  track_count INTEGER DEFAULT 0,
  scrape_ok INTEGER DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_albums_album_id ON albums(album_id);
CREATE INDEX idx_albums_updated_at ON albums(updated_at);
CREATE INDEX idx_albums_name_lower ON albums(lower(album_name));

CREATE TABLE songs (
  song_id TEXT PRIMARY KEY,
  album_url TEXT NOT NULL,
  album_id TEXT NOT NULL,
  album_name TEXT NOT NULL,
  year INTEGER,
  music_director TEXT,
  singers TEXT,
  track_number INTEGER NOT NULL,
  track_name TEXT NOT NULL,
  image_url TEXT,
  url_128kbps TEXT,
  url_320kbps TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_songs_album_id ON songs(album_id);
CREATE INDEX idx_songs_album_url ON songs(album_url);
CREATE INDEX idx_songs_track_name_lower ON songs(lower(track_name));
CREATE INDEX idx_songs_singers_lower ON songs(lower(singers));
CREATE INDEX idx_songs_director_lower ON songs(lower(music_director));
