import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { appConfig } from "./config.js";

fs.mkdirSync(path.dirname(appConfig.databasePath), { recursive: true });

export const db = new Database(appConfig.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      music_director TEXT,
      director TEXT,
      lyricists TEXT,
      year INTEGER,
      language TEXT,
      source_url TEXT NOT NULL UNIQUE,
      artwork_url TEXT,
      track_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_scraped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      singers TEXT,
      composer TEXT,
      year INTEGER,
      duration_seconds INTEGER,
      track_number INTEGER,
      source_page_url TEXT NOT NULL,
      upstream_url TEXT,
      audio_128_url TEXT,
      audio_320_url TEXT,
      audio_links_json TEXT,
      artwork_url TEXT,
      lyrics_by TEXT,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_verified_at TEXT,
      last_playback_error_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      page_from INTEGER,
      page_to INTEGER,
      mode TEXT NOT NULL,
      albums_found INTEGER NOT NULL DEFAULT 0,
      songs_found INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, song_id)
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, song_id)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT,
      player_state_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recently_played (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      played_at TEXT NOT NULL,
      PRIMARY KEY (user_id, song_id)
    );

    CREATE INDEX IF NOT EXISTS idx_songs_album_id ON songs(album_id);
    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
    CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
    CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);
    CREATE INDEX IF NOT EXISTS idx_songs_source_page_url ON songs(source_page_url);
    CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);
    CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
    CREATE INDEX IF NOT EXISTS idx_albums_source_url ON albums(source_url);
    CREATE INDEX IF NOT EXISTS idx_recently_played_user_played ON recently_played(user_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_order ON playlist_songs(playlist_id, sort_order);
  `);

  ensureColumn("songs", "audio_128_url", "TEXT");
  ensureColumn("songs", "audio_320_url", "TEXT");
  ensureColumn("songs", "audio_links_json", "TEXT");
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
