// Sruthi 2.o — minimal vanilla frontend served from the Worker's static assets.
//
// Feature set:
//   - Home: recent additions + quick artists
//   - Albums grid → album detail
//   - Search across tracks/albums/artists/composers (debounced, cancellable)
//   - Favorites + custom playlists in localStorage
//   - Bottom player with prev/play/next, scrubbing progress bar
//
// The full React app in apps/web/ is the desktop/mobile-grade UI. This is the
// lightweight version that runs entirely on Cloudflare's free tier.

const state = {
  tab: "home",
  searchInput: "",
  debouncedQuery: "",
  searchAbort: null,
  searchData: null,
  searchPending: false,
  cache: {
    home: null,
    albums: null,
    albumDetail: new Map(),
  },
  player: {
    queue: [],
    index: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
  },
  selectedAlbumId: null,
  favorites: loadStringSet("sruthi.favorites"),
  playlists: loadJSON("sruthi.playlists", []),
  recent: loadJSON("sruthi.recent", []),
};

const audio = document.getElementById("player-audio");
const playerEl = document.getElementById("player");
const playerArt = document.getElementById("player-art");
const playerTitle = document.getElementById("player-title");
const playerArtist = document.getElementById("player-artist");
const playerBar = document.getElementById("player-bar-fill");
const playerPlayBtn = document.getElementById("player-play");
const playerPrevBtn = document.getElementById("player-prev");
const playerNextBtn = document.getElementById("player-next");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const main = document.getElementById("main");

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) {}
}
function loadStringSet(key) {
  return new Set(loadJSON(key, []));
}
function saveStringSet(key, set) {
  saveJSON(key, [...set]);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b === btn));
    state.tab = btn.dataset.tab;
    state.selectedAlbumId = null;
    render();
  });
});

// ---------------------------------------------------------------------------
// Search — debounced + cancellable
// ---------------------------------------------------------------------------

let searchTimer = null;

searchInput.addEventListener("input", (event) => {
  state.searchInput = event.target.value;
  // Visible state shows the live input. Heavy work waits 220ms.
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.debouncedQuery = state.searchInput.trim();
    runSearch();
  }, 220);
  if (state.searchInput.trim()) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "home"));
    state.tab = "home";
  }
  render(); // re-render immediately so the input doesn't lag waiting for results
});

async function runSearch() {
  const query = state.debouncedQuery;
  if (!query) {
    state.searchData = null;
    state.searchPending = false;
    searchStatus.textContent = "";
    render();
    return;
  }
  // Cancel any in-flight search so older requests can't overwrite newer ones.
  if (state.searchAbort) state.searchAbort.abort();
  state.searchAbort = new AbortController();
  state.searchPending = true;
  searchStatus.textContent = "...";
  render();
  try {
    const response = await fetch(`/api/search/all?q=${encodeURIComponent(query)}&limit=30`, {
      signal: state.searchAbort.signal,
    });
    if (!response.ok) throw new Error(String(response.status));
    state.searchData = await response.json();
    state.searchPending = false;
    searchStatus.textContent = "";
    render();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.searchPending = false;
    searchStatus.textContent = "!";
    render();
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
}

async function loadHome() {
  if (!state.cache.home) state.cache.home = await getJSON("/api/library/home");
  return state.cache.home;
}
async function loadAlbums() {
  if (!state.cache.albums) state.cache.albums = await getJSON("/api/albums");
  return state.cache.albums;
}
async function loadAlbumDetail(albumId) {
  if (!state.cache.albumDetail.has(albumId)) {
    state.cache.albumDetail.set(albumId, await getJSON(`/api/albums/${encodeURIComponent(albumId)}`));
  }
  return state.cache.albumDetail.get(albumId);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function playSong(song, queue) {
  if (!song) return;
  const nextQueue = (queue && queue.length ? queue : [song]).slice();
  const index = nextQueue.findIndex((item) => item.id === song.id);
  state.player.queue = nextQueue;
  state.player.index = index >= 0 ? index : 0;
  state.player.playing = true;
  state.player.currentTime = 0;
  state.player.duration = 0;
  audio.src = `/api/stream/${encodeURIComponent(song.id)}`;
  audio.load();
  void audio.play().catch(() => {});
  playerEl.hidden = false;
  rememberRecent(song);
  updatePlayerUI();
  // Update song-rows' is-playing markers if they're on screen.
  render();
}
function togglePlay() {
  if (audio.src && audio.paused) {
    state.player.playing = true;
    void audio.play().catch(() => {});
  } else if (audio.src) {
    state.player.playing = false;
    audio.pause();
  }
  updatePlayerUI();
}
function nextTrack() {
  const { queue, index } = state.player;
  if (!queue.length) return;
  if (index + 1 < queue.length) playSong(queue[index + 1], queue);
}
function previousTrack() {
  const { queue, index } = state.player;
  if (!queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (index > 0) playSong(queue[index - 1], queue);
}
function rememberRecent(song) {
  const existing = state.recent.filter((item) => item.id !== song.id);
  state.recent = [song, ...existing].slice(0, 30);
  saveJSON("sruthi.recent", state.recent);
}

let playbackRetries = new Map();
audio.addEventListener("timeupdate", () => {
  state.player.currentTime = audio.currentTime;
  updateProgress();
});
audio.addEventListener("durationchange", () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    state.player.duration = audio.duration;
  }
});
audio.addEventListener("playing", () => { state.player.playing = true; updatePlayerUI(); });
audio.addEventListener("pause", () => { state.player.playing = false; updatePlayerUI(); });
audio.addEventListener("ended", () => nextTrack());
audio.addEventListener("error", () => {
  const song = state.player.queue[state.player.index];
  if (!song) return;
  const tries = (playbackRetries.get(song.id) || 0) + 1;
  playbackRetries.set(song.id, tries);
  if (tries <= 2) {
    setTimeout(() => {
      audio.src = `/api/stream/${encodeURIComponent(song.id)}?retry=${Date.now()}`;
      audio.load();
      void audio.play().catch(() => {});
    }, tries * 600);
  } else {
    nextTrack();
  }
});

function updatePlayerUI() {
  const song = state.player.queue[state.player.index];
  if (!song) { playerEl.hidden = true; return; }
  playerEl.hidden = false;
  playerArt.src = song.artworkUrl || "/Icon.png";
  playerTitle.textContent = song.title;
  playerArtist.textContent = song.artist;
  playerPlayBtn.textContent = state.player.playing ? "⏸" : "▶";
}
function updateProgress() {
  const { currentTime, duration } = state.player;
  if (duration > 0 && Number.isFinite(duration)) {
    const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100));
    playerBar.style.width = `${pct}%`;
  } else {
    playerBar.style.width = "0%";
  }
}

playerPlayBtn.addEventListener("click", togglePlay);
playerNextBtn.addEventListener("click", nextTrack);
playerPrevBtn.addEventListener("click", previousTrack);

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

function isFavorite(songId) { return state.favorites.has(songId); }
function toggleFavorite(song) {
  if (state.favorites.has(song.id)) state.favorites.delete(song.id);
  else state.favorites.add(song.id);
  saveStringSet("sruthi.favorites", state.favorites);
  render();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function escapeHTML(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function songRow(song, queue) {
  const fav = isFavorite(song.id);
  const playing = state.player.queue[state.player.index]?.id === song.id;
  return `
    <div class="song-row${playing ? " is-playing" : ""}" data-song-id="${escapeHTML(song.id)}">
      <img src="${escapeHTML(song.artworkUrl || "/Icon.png")}" alt="" loading="lazy" />
      <button class="song-row__copy" data-action="play" data-song-id="${escapeHTML(song.id)}" aria-label="Play ${escapeHTML(song.title)}">
        <strong>${escapeHTML(song.title)}</strong>
        <span>${escapeHTML(song.artist)} · ${escapeHTML(song.albumTitle)}</span>
      </button>
      <button class="song-row__action${fav ? " is-fav" : ""}" data-action="fav" data-song-id="${escapeHTML(song.id)}" aria-label="Toggle favorite">
        ${fav ? "♥" : "♡"}
      </button>
    </div>
  `;
}

function albumCard(album) {
  return `
    <button class="card" data-action="open-album" data-album-id="${escapeHTML(album.albumId)}">
      <img src="${escapeHTML(album.imageUrl || "/Icon.png")}" alt="" loading="lazy" />
      <strong>${escapeHTML(album.name)}</strong>
      <span>${escapeHTML(album.musicDirector || album.singersSummary || "Album")}</span>
    </button>
  `;
}

function searchResultsHTML() {
  const data = state.searchData;
  if (!data) return "";
  const sections = [];
  if (data.tracks?.length) {
    sections.push(`
      <section class="section">
        <h2>Tracks</h2>
        <div class="song-list">${data.tracks.slice(0, 25).map((s) => songRow(s, data.tracks)).join("")}</div>
      </section>
    `);
  }
  if (data.albums?.length) {
    sections.push(`
      <section class="section">
        <h2>Albums</h2>
        <div class="card-row">${data.albums.slice(0, 18).map(albumCard).join("")}</div>
      </section>
    `);
  }
  if (data.artists?.length) {
    sections.push(`
      <section class="section">
        <h2>Artists</h2>
        <div class="song-list">${data.artists.slice(0, 12).map((a) => `
          <div class="song-row">
            <div class="song-row__copy" style="grid-column: span 4">
              <strong>${escapeHTML(a.artist)}</strong>
              <span>${a.songCount} songs</span>
            </div>
          </div>`).join("")}</div>
      </section>
    `);
  }
  if (data.composers?.length) {
    sections.push(`
      <section class="section">
        <h2>Composers</h2>
        <div class="song-list">${data.composers.slice(0, 10).map((c) => `
          <div class="song-row">
            <div class="song-row__copy" style="grid-column: span 4">
              <strong>${escapeHTML(c.name)}</strong>
              <span>${c.songCount} songs</span>
            </div>
          </div>`).join("")}</div>
      </section>
    `);
  }
  if (!sections.length) {
    return `<div class="empty-state">No results for "${escapeHTML(state.debouncedQuery)}"</div>`;
  }
  return sections.join("");
}

async function renderHome() {
  const home = await loadHome();
  const recent = state.recent.length ? state.recent : home.library.slice(0, 12);
  return `
    <section class="section">
      <div class="section-header"><h2>Recently played</h2><span>${recent.length}</span></div>
      <div class="song-list">${recent.slice(0, 12).map((s) => songRow(s, recent)).join("") || `<div class="empty-state">Pick a song to start</div>`}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2>Newly added</h2><span>${home.library.length} songs</span></div>
      <div class="song-list">${home.library.slice(0, 12).map((s) => songRow(s, home.library)).join("")}</div>
    </section>
  `;
}

async function renderAlbums() {
  if (state.selectedAlbumId) {
    const album = await loadAlbumDetail(state.selectedAlbumId);
    const queue = album.songs;
    return `
      <button class="album-detail-back" data-action="albums-back">← All albums</button>
      <section class="section">
        <div class="section-header"><h2>${escapeHTML(album.name)}</h2><span>${album.trackCount} songs</span></div>
        <div class="song-list">${queue.map((s) => songRow(s, queue)).join("")}</div>
      </section>
    `;
  }
  const albums = await loadAlbums();
  return `
    <section class="section">
      <div class="section-header"><h2>Albums</h2><span>${albums.items.length}</span></div>
      <div class="card-row">${albums.items.map(albumCard).join("")}</div>
    </section>
  `;
}

function renderFavorites() {
  // We only have ids — look them up from cache (recent + already-loaded).
  const lookup = new Map();
  for (const s of state.recent) lookup.set(s.id, s);
  if (state.cache.home) for (const s of state.cache.home.library) lookup.set(s.id, s);
  for (const detail of state.cache.albumDetail.values()) {
    for (const s of detail.songs) lookup.set(s.id, s);
  }
  if (state.searchData?.tracks) for (const s of state.searchData.tracks) lookup.set(s.id, s);
  const favSongs = [...state.favorites].map((id) => lookup.get(id)).filter(Boolean);
  return `
    <section class="section">
      <div class="section-header"><h2>Favorites</h2><span>${favSongs.length}</span></div>
      <div class="song-list">${
        favSongs.length
          ? favSongs.map((s) => songRow(s, favSongs)).join("")
          : `<div class="empty-state">Tap the heart on any song to save it. Favorites that haven't been viewed this session may not appear yet — open the album to load them.</div>`
      }</div>
    </section>
  `;
}

function renderPlaylists() {
  // Playlists live in localStorage as { id, name, songs: Song[] }.
  return `
    <section class="section">
      <div class="section-header"><h2>Playlists</h2><span>${state.playlists.length}</span></div>
      <div class="card-row">
        <button class="card" data-action="new-playlist">
          <img src="/Icon.png" alt="" />
          <strong>New playlist</strong>
          <span>Create your own</span>
        </button>
        ${state.playlists.map((p) => `
          <button class="card" data-action="open-playlist" data-playlist-id="${escapeHTML(p.id)}">
            <img src="${escapeHTML(p.cover || "/Icon.png")}" alt="" />
            <strong>${escapeHTML(p.name)}</strong>
            <span>${(p.songs || []).length} songs</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

async function render() {
  // Prefer search results when query is non-empty.
  if (state.debouncedQuery) {
    main.innerHTML = searchResultsHTML();
    bindEvents();
    return;
  }
  let html = "";
  try {
    if (state.tab === "home") html = await renderHome();
    else if (state.tab === "albums") html = await renderAlbums();
    else if (state.tab === "favorites") html = renderFavorites();
    else if (state.tab === "playlists") html = renderPlaylists();
  } catch (error) {
    html = `<div class="empty-state">Couldn't load this tab: ${escapeHTML(error.message || error)}</div>`;
  }
  main.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  main.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const action = node.dataset.action;
      const songId = node.dataset.songId;
      const albumId = node.dataset.albumId;
      const playlistId = node.dataset.playlistId;
      if (action === "play" && songId) {
        const queue = collectQueueForSong(songId);
        const song = queue.find((s) => s.id === songId);
        if (song) playSong(song, queue);
      } else if (action === "fav" && songId) {
        event.stopPropagation();
        const song = collectQueueForSong(songId).find((s) => s.id === songId);
        if (song) toggleFavorite(song);
      } else if (action === "open-album" && albumId) {
        state.selectedAlbumId = albumId;
        state.tab = "albums";
        document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "albums"));
        render();
      } else if (action === "albums-back") {
        state.selectedAlbumId = null;
        render();
      } else if (action === "new-playlist") {
        const name = prompt("Playlist name?");
        if (!name) return;
        state.playlists = [{ id: `pl-${Date.now()}`, name: name.trim(), songs: [] }, ...state.playlists];
        saveJSON("sruthi.playlists", state.playlists);
        render();
      } else if (action === "open-playlist" && playlistId) {
        const pl = state.playlists.find((p) => p.id === playlistId);
        if (!pl) return;
        if (pl.songs?.length) playSong(pl.songs[0], pl.songs);
      }
    });
  });
}

function collectQueueForSong(songId) {
  if (state.searchData?.tracks) {
    if (state.searchData.tracks.some((s) => s.id === songId)) return state.searchData.tracks;
  }
  if (state.cache.home) {
    if (state.cache.home.library.some((s) => s.id === songId)) return state.cache.home.library;
  }
  for (const detail of state.cache.albumDetail.values()) {
    if (detail.songs.some((s) => s.id === songId)) return detail.songs;
  }
  if (state.recent.some((s) => s.id === songId)) return state.recent;
  return [];
}

// Kick off the first render.
render();
