from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AlbumRecord(BaseModel):
    album_url: str
    album_id: str
    album_name: str
    year: int | None = None
    music_director: str | None = None
    singers_summary: str | None = None
    image_url: str | None = None
    language: str | None = None
    track_count: int
    scrape_ok: bool = True
    first_seen_at: datetime
    updated_at: datetime


class SongRecord(BaseModel):
    song_id: str
    album_url: str
    album_id: str
    album_name: str
    year: int | None = None
    music_director: str | None = None
    singers: str | None = None
    track_number: int
    track_name: str
    image_url: str | None = None
    url_128kbps: str | None = None
    url_320kbps: str | None = None
    first_seen_at: datetime
    updated_at: datetime


class PublicSong(BaseModel):
    song_id: str
    album_id: str
    album_name: str
    year: int | None = None
    music_director: str | None = None
    singers: str | None = None
    track_number: int
    track_name: str
    image_url: str | None = None
    audioUrl: str
    updated_at: datetime


class FrontendSong(BaseModel):
    id: str
    title: str
    artist: str
    albumTitle: str
    albumId: str
    artworkUrl: str | None = None
    audioUrl: str
    streamUrl: str
    favorite: bool = False
    year: int | None = None
    durationSeconds: int | None = None
    composer: str | None = None
    trackNumber: int
    updatedAt: datetime


class ScrapedSong(BaseModel):
    track_name: str
    track_number: int
    singers: str | None = None
    image_url: str | None = None
    url_128kbps: str | None = None
    url_320kbps: str | None = None


class ScrapedAlbum(BaseModel):
    album_url: str
    album_id: str
    album_name: str
    year: int | None = None
    music_director: str | None = None
    singers_summary: str | None = None
    image_url: str | None = None
    language: str | None = None
    songs: list[ScrapedSong]


class ScrapeSummary(BaseModel):
    run_id: str
    pages_scraped: int
    albums_new: int
    albums_updated: int
    albums_failed: int
    songs_total: int
    status: str


class SongStatus(BaseModel):
    song_id: str
    album_url: str
    has_128kbps: bool
    has_320kbps: bool
    cache_status: str
    updated_at: datetime


class PreferencePayload(BaseModel):
    payload: dict[str, Any]


class PlaylistSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    songCount: int = 0
