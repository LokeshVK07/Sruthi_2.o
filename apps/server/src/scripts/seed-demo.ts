import { initDb } from "../db.js";
import {
  addSongToPlaylist,
  createPlaylist,
  ensureDefaultUser,
  listLibrary,
  toggleFavorite,
  upsertAlbumGraph
} from "../repositories/library-repo.js";
import type { ScrapedAlbum } from "../types.js";

initDb();
const userId = ensureDefaultUser();

const demoAlbums: ScrapedAlbum[] = [
  {
    slug: "midnight-drive",
    title: "Midnight Drive",
    artist: "Neon Pulse",
    musicDirector: "Neon Pulse",
    director: "Studio Lane",
    lyricists: "Arun Vela",
    year: 2026,
    language: "Tamil",
    sourceUrl: "https://demo.local/albums/midnight-drive",
    artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
    trackCount: 3,
    songs: [
      {
        title: "Nightfall",
        artist: "Neon Pulse",
        singers: "Neon Pulse",
        composer: "Neon Pulse",
        year: 2026,
        durationSeconds: 233,
        trackNumber: 1,
        sourcePageUrl: "https://demo.local/albums/midnight-drive",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Arun Vela"
      },
      {
        title: "Glowline",
        artist: "Neon Pulse",
        singers: "Neon Pulse",
        composer: "Neon Pulse",
        year: 2026,
        durationSeconds: 256,
        trackNumber: 2,
        sourcePageUrl: "https://demo.local/albums/midnight-drive",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Arun Vela"
      },
      {
        title: "Speed Lights",
        artist: "Neon Pulse",
        singers: "Neon Pulse",
        composer: "Neon Pulse",
        year: 2026,
        durationSeconds: 214,
        trackNumber: 3,
        sourcePageUrl: "https://demo.local/albums/midnight-drive",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Arun Vela"
      }
    ]
  },
  {
    slug: "golden-hour",
    title: "Golden Hour",
    artist: "Luna Sol",
    musicDirector: "Luna Sol",
    director: "Harbor Cut",
    lyricists: "Mithra",
    year: 2025,
    language: "Tamil",
    sourceUrl: "https://demo.local/albums/golden-hour",
    artworkUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
    trackCount: 2,
    songs: [
      {
        title: "Ember Sky",
        artist: "Luna Sol",
        singers: "Luna Sol",
        composer: "Luna Sol",
        year: 2025,
        durationSeconds: 245,
        trackNumber: 1,
        sourcePageUrl: "https://demo.local/albums/golden-hour",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Mithra"
      },
      {
        title: "Dust and Sun",
        artist: "Luna Sol",
        singers: "Luna Sol",
        composer: "Luna Sol",
        year: 2025,
        durationSeconds: 228,
        trackNumber: 2,
        sourcePageUrl: "https://demo.local/albums/golden-hour",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Mithra"
      }
    ]
  },
  {
    slug: "velvet-sky",
    title: "Velvet Sky",
    artist: "Aurora Dreams",
    musicDirector: "Aurora Dreams",
    director: "Nightglass",
    lyricists: "Dhiya",
    year: 2024,
    language: "Tamil",
    sourceUrl: "https://demo.local/albums/velvet-sky",
    artworkUrl: "https://images.unsplash.com/photo-1571266028243-d220c9f5c3c7?auto=format&fit=crop&w=900&q=80",
    trackCount: 2,
    songs: [
      {
        title: "Afterglow",
        artist: "Aurora Dreams",
        singers: "Aurora Dreams",
        composer: "Aurora Dreams",
        year: 2024,
        durationSeconds: 267,
        trackNumber: 1,
        sourcePageUrl: "https://demo.local/albums/velvet-sky",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1571266028243-d220c9f5c3c7?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Dhiya"
      },
      {
        title: "Low Tide",
        artist: "Aurora Dreams",
        singers: "Aurora Dreams",
        composer: "Aurora Dreams",
        year: 2024,
        durationSeconds: 248,
        trackNumber: 2,
        sourcePageUrl: "https://demo.local/albums/velvet-sky",
        upstreamUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
        audio128Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
        audio320Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
        audioLinksJson: JSON.stringify({ "128": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3", "320": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" }),
        artworkUrl: "https://images.unsplash.com/photo-1571266028243-d220c9f5c3c7?auto=format&fit=crop&w=900&q=80",
        lyricsBy: "Dhiya"
      }
    ]
  }
];

for (const album of demoAlbums) {
  upsertAlbumGraph(album);
}

const favoritesSeed = ["nightfall", "ember-sky", "afterglow"];
const library = listLibrary(userId, 20);
for (const song of library) {
  if (favoritesSeed.some((seed) => song.title.toLowerCase().replace(/\s+/g, "-").includes(seed))) {
    toggleFavorite(userId, song.id);
  }
}
const playlist = createPlaylist(userId, "Night Motion", "Late drive rotation");
if (playlist) {
  for (const song of library.slice(0, 4)) {
    addSongToPlaylist(playlist.id, song.id);
  }
}
console.log("Demo library seeded.");
