import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Album, Home, Library, ListMusic, Menu, Search, Users } from "lucide-react";
import { apiClient } from "./api.js";
import Sidebar, { type NavKey } from "./components/Sidebar.js";
import NowPlayingHero from "./components/NowPlayingHero.js";
import SearchFilterBar from "./components/SearchFilterBar.js";
import RecentlyPlayed from "./components/RecentlyPlayed.js";
import QueuePanel from "./components/QueuePanel.js";
import PlaylistModal from "./components/PlaylistModal.js";
import { usePlayerStore } from "./store.js";
import type { Song } from "./types.js";

type FilterKey = "all" | "tracks" | "albums" | "artists" | "playlists";
type ViewMode = "grid" | "list";
type PlayTrackOptions = {
  autoPlay?: boolean;
  addToRecent?: boolean;
  sourceQueue?: Song[];
};
type UiPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
};

const MAX_RECENTLY_PLAYED = 50;
const RECENTLY_PLAYED_STORAGE_KEY = "sruthi_recently_played";
const APP_NAME = "Vibe 2.o";

const fallbackArt =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23191343'/><stop offset='45%' stop-color='%235320bf'/><stop offset='100%' stop-color='%23e668ff'/></linearGradient></defs><rect width='800' height='800' rx='44' fill='url(%23g)'/><circle cx='602' cy='170' r='164' fill='rgba(255,255,255,0.1)'/><circle cx='208' cy='625' r='185' fill='rgba(255,255,255,0.08)'/><path d='M518 168v296c0 30-24 55-69 71-34 12-78 11-98-4-21-14-18-39 6-54 22-14 55-20 84-16V245l166-36v211c0 31-24 56-69 72-35 12-78 11-99-4-21-15-17-39 7-54 21-14 54-20 84-16V168h-12Z' fill='white' fill-opacity='.9'/></svg>";

const navItems = [
  { key: "home", label: "Home", icon: Home },
  { key: "search", label: "Search", icon: Search },
  { key: "library", label: "Library", icon: Library },
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "albums", label: "Albums", icon: Album },
  { key: "artists", label: "Artists", icon: Users }
] as const;

function safeDuration(song?: Song | null) {
  return song?.durationSeconds && song.durationSeconds > 0 ? song.durationSeconds : 240;
}

function imageFor(song?: Song | null) {
  return song?.artworkUrl || fallbackArt;
}

function songStreamUrl(song: Song) {
  const version = encodeURIComponent(String(song.updatedAt ?? song.id));
  return `${song.streamUrl}?v=${version}`;
}

function formatTextSearch(song: Song) {
  return [song.title, song.artist, song.albumTitle, song.composer ?? ""].join(" ").toLowerCase();
}

function titleMatches(song: Song, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return formatTextSearch(song).includes(normalized);
}

function deckHasSong(deck: HTMLAudioElement | null, song: Song | null) {
  return Boolean(deck && song && deck.dataset.songId === song.id);
}

function queueFromAlbum(albumId: string | undefined, songs: Song[]) {
  if (!albumId) return songs;
  const scoped = songs.filter((song) => song.albumId === albumId);
  return scoped.length ? scoped : songs;
}

function pickInitialSong(librarySongs: Song[]) {
  return (
    librarySongs.find((song) => song.title.toLowerCase().includes("a life full of love theme")) ??
    librarySongs.find((song) => song.albumTitle.toLowerCase().includes("moonu")) ??
    librarySongs[0] ??
    null
  );
}

function isValidTrack(value: unknown): value is Song {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === "string" &&
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    typeof track.albumTitle === "string" &&
    typeof track.albumId === "string" &&
    typeof track.streamUrl === "string" &&
    typeof track.trackNumber === "number"
  );
}

function updateRecentlyPlayedList(previous: Song[], track: Song) {
  const withoutDuplicate = previous.filter((item) => item.id !== track.id);
  return [track, ...withoutDuplicate].slice(0, MAX_RECENTLY_PLAYED);
}

async function safePlay(audio: HTMLAudioElement) {
  try {
    await audio.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    console.error("Audio play failed", error);
  }
}

export default function App() {
  const queryClient = useQueryClient();
  const [activeNav, setActiveNav] = useState<NavKey>("home");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [customPlaylists, setCustomPlaylists] = useState<UiPlaylist[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [heroMenuOpen, setHeroMenuOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"favorites" | "recent" | null>(null);
  const [heroFeedback, setHeroFeedback] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>([]);
  const [recentlyPlayedHydrated, setRecentlyPlayedHydrated] = useState(false);
  const deferredQuery = useDeferredValue(searchQuery.trim());
  const warmedUpRef = useRef(false);
  const lastVolumeRef = useRef(0.82);
  const lastRefreshVersionRef = useRef("");
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);

  const { data: home } = useQuery({ queryKey: ["home"], queryFn: apiClient.home });
  const { data: songs } = useQuery({ queryKey: ["songs"], queryFn: apiClient.songs });
  const { data: albums } = useQuery({ queryKey: ["albums"], queryFn: apiClient.albums });
  const { data: favorites } = useQuery({ queryKey: ["favorites"], queryFn: apiClient.favorites });
  const { data: searchData } = useQuery({
    queryKey: ["search", deferredQuery],
    queryFn: () => apiClient.search(deferredQuery),
    enabled: deferredQuery.length > 0
  });
  const { data: selectedAlbum } = useQuery({
    queryKey: ["album", selectedAlbumId],
    queryFn: () => apiClient.album(selectedAlbumId ?? ""),
    enabled: Boolean(selectedAlbumId)
  });
  const { data: refreshStatus } = useQuery({
    queryKey: ["refresh-status"],
    queryFn: apiClient.refreshStatus,
    refetchInterval: 30000,
  });

  const {
    queue,
    currentIndex,
    playing,
    volume,
    shuffle,
    repeatMode,
    setQueue,
    playSong,
    setPlaying,
    setVolume,
    setSongFavorite,
    clearQueue,
    moveQueueItem,
    addToQueue,
    toggleShuffle,
    cycleRepeatMode
  } = usePlayerStore();

  const librarySongs = songs?.items ?? [];
  const favoriteSongs = favorites?.items ?? [];
  const albumItems = albums?.items ?? [];
  const fullLibrary = home?.library?.length ? home.library : librarySongs;
  const currentSong = queue[currentIndex] ?? pickInitialSong(fullLibrary);
  const recentSongs = useMemo(
    () =>
      recentlyPlayed
        .map((track) => fullLibrary.find((song) => song.id === track.id) ?? track)
        .slice(0, MAX_RECENTLY_PLAYED),
    [recentlyPlayed, fullLibrary]
  );
  const filteredRecentSongs = useMemo(() => recentSongs.filter((song) => titleMatches(song, searchQuery)), [recentSongs, searchQuery]);
  const filteredFavoriteSongs = useMemo(() => favoriteSongs.filter((song) => titleMatches(song, searchQuery)), [favoriteSongs, searchQuery]);
  const displayedRecent = filteredRecentSongs.slice(0, 6);
  const selectedPlaylist = useMemo(
    () => customPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [customPlaylists, selectedPlaylistId]
  );
  const selectedPlaylistSongs = useMemo(
    () => (selectedPlaylist ? selectedPlaylist.trackIds.map((trackId) => fullLibrary.find((song) => song.id === trackId)).filter(Boolean) as Song[] : []),
    [selectedPlaylist, fullLibrary]
  );
  const playlistSummaries = useMemo(
    () => customPlaylists.map((playlist) => ({ id: playlist.id, name: playlist.name, count: playlist.trackIds.length })),
    [customPlaylists]
  );

  const getDeck = (index: number) => (index === 0 ? deckARef.current : deckBRef.current);
  const getActiveDeck = () => getDeck(activeDeckIndex);
  const getInactiveDeck = () => getDeck(activeDeckIndex === 0 ? 1 : 0);

  function updateRecentlyPlayed(track: Song) {
    setRecentlyPlayed((previous) => updateRecentlyPlayedList(previous, track));
  }

  function activateSongDeck(song: Song, shouldPlay: boolean) {
    const activeDeck = getActiveDeck();
    const inactiveDeck = getInactiveDeck();
    setCurrentTime(0);
    setDuration(song.durationSeconds && song.durationSeconds > 0 ? song.durationSeconds : 0);
    setBuffering(true);
    if (!inactiveDeck) return;

    const nextDeckIndex = activeDeckIndex === 0 ? 1 : 0;
    inactiveDeck.pause();
    inactiveDeck.dataset.songId = song.id;
    inactiveDeck.src = songStreamUrl(song);
    inactiveDeck.preload = "auto";
    inactiveDeck.currentTime = 0;
    inactiveDeck.muted = isMuted;
    inactiveDeck.volume = isMuted ? 0 : volume;
    inactiveDeck.load();

    if (activeDeck) {
      activeDeck.pause();
      activeDeck.currentTime = 0;
      activeDeck.muted = true;
      activeDeck.volume = 0;
    }

    setActiveDeckIndex(nextDeckIndex);

    if (shouldPlay) {
      void safePlay(inactiveDeck);
      recordPlayback.mutate(song.id);
      prefetchRelated.mutate(song.id);
    }
  }

  function playTrack(track: Song, options: PlayTrackOptions = {}) {
    if (!track?.id) return;
    const autoPlay = options.autoPlay ?? true;
    const addToRecent = options.addToRecent ?? true;
    const scopedQueue =
      options.sourceQueue?.length
        ? options.sourceQueue
        : queue.length
          ? queue.some((item) => item.id === track.id)
            ? queue
            : [track, ...queue]
          : [track];

    activateSongDeck(track, autoPlay);
    playSong(track, scopedQueue);
    if (addToRecent) {
      updateRecentlyPlayed(track);
    }
    setHeroMenuOpen(false);
  }

  function getNextTrack() {
    if (!queue.length || currentIndex < 0) return null;
    if (repeatMode === "one") return queue[currentIndex] ?? null;
    if (shuffle && queue.length > 1) {
      const candidates = queue.filter((_, index) => index !== currentIndex);
      return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
    }
    if (currentIndex < queue.length - 1) return queue[currentIndex + 1] ?? null;
    if (repeatMode === "all") return queue[0] ?? null;
    return null;
  }

  function getPreviousTrack() {
    if (!queue.length || currentIndex < 0) return null;
    if (currentIndex > 0) return queue[currentIndex - 1] ?? null;
    if (repeatMode === "all") return queue[queue.length - 1] ?? null;
    return queue[currentIndex] ?? null;
  }

  function handlePlayPauseToggle() {
    const activeDeck = getActiveDeck();
    if (!activeDeck) {
      setPlaying(!playing);
      return;
    }
    if (playing) {
      activeDeck.pause();
      setPlaying(false);
      return;
    }
    void safePlay(activeDeck);
    if (currentSong) {
      recordPlayback.mutate(currentSong.id);
      prefetchRelated.mutate(currentSong.id);
    }
    setPlaying(true);
  }

  function handleNextTrack() {
    const nextTrack = getNextTrack();
    if (!nextTrack) {
      setPlaying(false);
      return;
    }
    playTrack(nextTrack, { autoPlay: true, addToRecent: true, sourceQueue: queue });
  }

  function handlePreviousTrack() {
    const previousTrack = getPreviousTrack();
    if (!previousTrack) return;
    playTrack(previousTrack, { autoPlay: true, addToRecent: true, sourceQueue: queue });
  }

  const applyFavoriteState = (songId: string, active: boolean) => {
    setSongFavorite(songId, active);
    queryClient.setQueryData<{ items: Song[] } | undefined>(["songs"], (existing) =>
      existing ? { ...existing, items: existing.items.map((song) => (song.id === songId ? { ...song, favorite: active } : song)) } : existing
    );
    queryClient.setQueryData<{ items: Song[] } | undefined>(["favorites"], (existing) =>
      existing
        ? { ...existing, items: active ? existing.items : existing.items.filter((song) => song.id !== songId) }
        : existing
    );
    queryClient.setQueryData(["home"], (existing: any) => {
      if (!existing) return existing;
      const patch = (song: Song) => (song.id === songId ? { ...song, favorite: active } : song);
      return {
        ...existing,
        library: (existing.library ?? []).map(patch),
        recentlyPlayed: (existing.recentlyPlayed ?? []).map(patch),
        favorites: active
          ? (existing.favorites ?? []).some((song: Song) => song.id === songId)
            ? (existing.favorites ?? []).map(patch)
            : currentSong
              ? [{ ...currentSong, favorite: true }, ...(existing.favorites ?? [])]
              : existing.favorites
          : (existing.favorites ?? []).filter((song: Song) => song.id !== songId)
      };
    });
  };

  const toggleFavorite = useMutation({
    mutationFn: (songId: string) => apiClient.toggleFavorite(songId),
    onMutate: async (songId) => {
      const sourceSong =
        queue.find((song) => song.id === songId) ??
        librarySongs.find((song) => song.id === songId) ??
        favoriteSongs.find((song) => song.id === songId) ??
        fullLibrary.find((song) => song.id === songId);
      const nextFavorite = !(sourceSong?.favorite ?? false);
      applyFavoriteState(songId, nextFavorite);
      return { songId, previousActive: sourceSong?.favorite ?? false };
    },
    onError: (_error, _songId, context) => {
      if (!context) return;
      applyFavoriteState(context.songId, context.previousActive);
    },
    onSuccess: (result, songId) => {
      applyFavoriteState(songId, result.active);
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
      void queryClient.invalidateQueries({ queryKey: ["favorites"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    }
  });

  const recordPlayback = useMutation({
    mutationFn: (songId: string) => apiClient.recordPlayback(songId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    }
  });
  const prefetchRelated = useMutation({ mutationFn: (songId: string) => apiClient.prefetchRelated(songId) });
  const prefetchSongs = useMutation({ mutationFn: (songIds: string[]) => apiClient.prefetchSongs(songIds) });
  const warmup = useMutation({ mutationFn: apiClient.warmup });
  const manualRefreshCheck = useMutation({
    mutationFn: apiClient.refreshCheck,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["refresh-status"] });
    }
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const validTracks = parsed.filter(isValidTrack).slice(0, MAX_RECENTLY_PLAYED);
      setRecentlyPlayed(validTracks);
    } catch {
      window.localStorage.removeItem(RECENTLY_PLAYED_STORAGE_KEY);
    } finally {
      setRecentlyPlayedHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!recentlyPlayedHydrated || recentlyPlayed.length || !home?.recentlyPlayed?.length) return;
    setRecentlyPlayed(home.recentlyPlayed.filter(isValidTrack).slice(0, MAX_RECENTLY_PLAYED));
  }, [recentlyPlayedHydrated, recentlyPlayed.length, home?.recentlyPlayed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify(recentlyPlayed.slice(0, MAX_RECENTLY_PLAYED)));
    } catch {
      // ignore storage failures
    }
  }, [recentlyPlayed]);

  useEffect(() => {
    const activeDeck = getActiveDeck();
    const inactiveDeck = getInactiveDeck();
    if (activeDeck) {
      activeDeck.volume = isMuted ? 0 : volume;
      activeDeck.muted = isMuted;
    }
    if (inactiveDeck) {
      inactiveDeck.volume = 0;
      inactiveDeck.muted = true;
    }
  }, [volume, isMuted, activeDeckIndex]);

  useEffect(() => {
    if (warmedUpRef.current || !fullLibrary.length) return;
    warmedUpRef.current = true;
    warmup.mutate();
    const initial = pickInitialSong(fullLibrary);
    if (!initial) return;
    const initialQueue = queueFromAlbum(initial.albumId, fullLibrary);
    setQueue(initialQueue, Math.max(0, initialQueue.findIndex((song) => song.id === initial.id)), false);
    prefetchSongs.mutate(fullLibrary.slice(0, 6).map((song) => song.id));
  }, [fullLibrary.length]);

  useEffect(() => {
    if (!currentSong) return;
    const activeDeck = getActiveDeck();
    if (deckHasSong(activeDeck, currentSong)) return;
    setCurrentTime(0);
    setDuration(currentSong.durationSeconds && currentSong.durationSeconds > 0 ? currentSong.durationSeconds : 0);
    setBuffering(true);
    const inactiveDeck = getInactiveDeck();
    if (!activeDeck || !inactiveDeck) return;

    const nextDeckIndex = activeDeckIndex === 0 ? 1 : 0;
    inactiveDeck.pause();
    inactiveDeck.dataset.songId = currentSong.id;
    inactiveDeck.src = songStreamUrl(currentSong);
    inactiveDeck.preload = "auto";
    inactiveDeck.currentTime = 0;
    inactiveDeck.load();

    activeDeck.pause();
    activeDeck.currentTime = 0;
    activeDeck.muted = true;
    activeDeck.volume = 0;

    setActiveDeckIndex(nextDeckIndex);
    inactiveDeck.muted = isMuted;
    inactiveDeck.volume = isMuted ? 0 : volume;

    if (playing) {
      void safePlay(inactiveDeck);
    }
  }, [currentSong?.id]);

  useEffect(() => {
    const activeDeck = getActiveDeck();
    if (!activeDeck) return;
    if (playing) {
      void safePlay(activeDeck);
    } else {
      activeDeck.pause();
    }
  }, [playing, activeDeckIndex]);

  useEffect(() => {
    if (!currentSong) return;
    const activeDeck = getActiveDeck();
    if (!deckHasSong(activeDeck, currentSong)) return;
    const nextCandidates = queue.slice(currentIndex + 1, currentIndex + 5);
    if (!nextCandidates.length) return;
    prefetchSongs.mutate(nextCandidates.map((song) => song.id));
    const inactiveDeck = getInactiveDeck();
    const nextSong = nextCandidates[0];
    if (!inactiveDeck || !nextSong || deckHasSong(inactiveDeck, nextSong)) return;
    inactiveDeck.pause();
    inactiveDeck.dataset.songId = nextSong.id;
    inactiveDeck.src = songStreamUrl(nextSong);
    inactiveDeck.preload = "auto";
    inactiveDeck.currentTime = 0;
    inactiveDeck.load();
  }, [currentSong?.id, currentIndex, queue.length, activeDeckIndex]);

  useEffect(() => {
    if (!heroFeedback) return;
    const timeout = window.setTimeout(() => setHeroFeedback(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [heroFeedback]);

  useEffect(() => {
    const nextVersion = refreshStatus?.currentVersion ?? "";
    if (!nextVersion) return;
    if (!lastRefreshVersionRef.current) {
      lastRefreshVersionRef.current = nextVersion;
      return;
    }
    if (nextVersion === lastRefreshVersionRef.current) return;
    lastRefreshVersionRef.current = nextVersion;
    void queryClient.invalidateQueries({ queryKey: ["home"] });
    void queryClient.invalidateQueries({ queryKey: ["songs"] });
    void queryClient.invalidateQueries({ queryKey: ["albums"] });
    void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    void queryClient.invalidateQueries({ queryKey: ["search"] });
    if (selectedAlbumId) {
      void queryClient.invalidateQueries({ queryKey: ["album", selectedAlbumId] });
    }
  }, [refreshStatus?.currentVersion, selectedAlbumId]);

  const orchestraLine =
    currentSong?.title.toLowerCase().includes("a life full of love theme") ? "The Chennai Strings Orchestra" : currentSong?.composer || "Studio Orchestra";
  const heroAlbumLabel = currentSong?.albumTitle ?? "Selected album";

  const filteredSongs = useMemo(() => {
    const base =
      activeNav === "favorites"
        ? favoriteSongs
        : activeNav === "playlists" && selectedPlaylist
          ? selectedPlaylistSongs
        : activeNav === "albums"
          ? selectedAlbum?.songs ?? queueFromAlbum(selectedAlbumId ?? undefined, fullLibrary)
          : activeNav === "search" && deferredQuery
            ? searchData?.items ?? []
            : fullLibrary;
    return base.filter((song) => titleMatches(song, searchQuery));
  }, [activeNav, favoriteSongs, selectedPlaylist, selectedPlaylistSongs, selectedAlbum?.songs, selectedAlbumId, fullLibrary, deferredQuery, searchData?.items, searchQuery]);

  const filteredAlbums = useMemo(
    () =>
      albumItems.filter((album) =>
        !searchQuery.trim()
          ? true
          : [album.name, album.musicDirector ?? "", album.singersSummary ?? "", String(album.year ?? "")]
              .join(" ")
              .toLowerCase()
              .includes(searchQuery.toLowerCase())
      ),
    [albumItems, searchQuery]
  );

  const filteredArtists = useMemo(
    () =>
      (home?.artists ?? []).filter((artist) => (!searchQuery.trim() ? true : artist.artist.toLowerCase().includes(searchQuery.toLowerCase()))),
    [home?.artists, searchQuery]
  );

  const filteredPlaylists = useMemo(
    () => playlistSummaries.filter((playlist) => (!searchQuery.trim() ? true : playlist.name.toLowerCase().includes(searchQuery.toLowerCase()))),
    [playlistSummaries, searchQuery]
  );

  function handleSongSelect(song: Song, sourceQueue?: Song[]) {
    const scopedQueue = sourceQueue?.length ? sourceQueue : queueFromAlbum(song.albumId, fullLibrary);
    playTrack(song, { autoPlay: true, addToRecent: true, sourceQueue: scopedQueue.length ? scopedQueue : [song] });
  }

  function handleToggleMute() {
    if (isMuted) {
      setIsMuted(false);
      setVolume(lastVolumeRef.current || 0.82);
      return;
    }
    lastVolumeRef.current = volume;
    setIsMuted(true);
  }

  function handleVolumeChange(nextVolume: number) {
    setVolume(nextVolume);
    if (nextVolume <= 0.01) {
      setIsMuted(true);
    } else if (isMuted) {
      setIsMuted(false);
    }
  }

  function handleCreatePlaylist() {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    const newId = `playlist-${Date.now()}`;
    setCustomPlaylists((existing) => [{ id: newId, name: trimmed, trackIds: [] }, ...existing]);
    setNewPlaylistName("");
    setPlaylistModalOpen(false);
    setSelectedPlaylistId(newId);
    setActiveNav("playlists");
  }

  function handleAddCurrentSongToPlaylist(playlistId: string) {
    if (!currentSong) return;
    let added = false;
    setCustomPlaylists((existing) =>
      existing.map((playlist) => {
        if (playlist.id !== playlistId) return playlist;
        if (playlist.trackIds.includes(currentSong.id)) return playlist;
        added = true;
        return { ...playlist, trackIds: [...playlist.trackIds, currentSong.id] };
      })
    );
    setHeroFeedback(added ? "Added to playlist" : "Already in playlist");
    setHeroMenuOpen(false);
  }

  function handleClearQueue() {
    if (!queue.length) return;
    if (!window.confirm("Clear the current queue?")) return;
    clearQueue();
  }

  function handleFilterSelect(filter: FilterKey) {
    setSelectedFilter(filter);
    setFilterOpen(false);
    if (filter === "albums") {
      setSelectedPlaylistId(null);
      setActiveNav("albums");
    } else if (filter === "artists") {
      setSelectedPlaylistId(null);
      setActiveNav("artists");
    } else if (filter === "playlists") {
      setActiveNav("playlists");
    } else if (filter === "tracks") {
      setSelectedPlaylistId(null);
      setActiveNav("library");
    } else if (!searchQuery.trim()) {
      setSelectedPlaylistId(null);
      setActiveNav("home");
    }
  }

  function resetHomeView() {
    setActiveNav("home");
    setSelectedAlbumId(null);
    setSelectedPlaylistId(null);
    setSelectedFilter("all");
    setSearchQuery("");
    setFilterOpen(false);
    setExpandedSection(null);
    setHeroMenuOpen(false);
    setMobileSidebarOpen(false);
  }

  function handleOpenCurrentAlbum() {
    if (!currentSong?.albumId) return;
    setSelectedAlbumId(currentSong.albumId);
    setSelectedPlaylistId(null);
    setSelectedFilter("all");
    setActiveNav("albums");
    setHeroMenuOpen(false);
  }

  function renderCenterResults() {
    if (expandedSection === "favorites") {
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>Favorites</h2>
            <button className="section-link" onClick={resetHomeView}>
              Back
            </button>
          </div>
          <div className={viewMode === "grid" ? "recent-grid" : "recent-list"}>
            {filteredFavoriteSongs.map((song) => (
              <button key={song.id} className={viewMode === "grid" ? "recent-card" : "recent-row"} onClick={() => handleSongSelect(song, favoriteSongs)}>
                <div className="recent-card__media">
                  <img src={song.artworkUrl || fallbackArt} alt={song.title} />
                </div>
                <div className="recent-card__copy">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      );
    }

    if (expandedSection === "recent") {
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>Recently played</h2>
            <button className="section-link" onClick={resetHomeView}>
              Back
            </button>
          </div>
          <div className={viewMode === "grid" ? "recent-grid" : "recent-list"}>
            {filteredRecentSongs.map((song) => (
              <button key={song.id} className={viewMode === "grid" ? "recent-card" : "recent-row"} onClick={() => handleSongSelect(song, fullLibrary)}>
                <div className="recent-card__media">
                  <img src={song.artworkUrl || fallbackArt} alt={song.title} />
                </div>
                <div className="recent-card__copy">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      );
    }

    if (activeNav === "home" && selectedFilter === "all" && !searchQuery.trim()) {
      return (
        <>
          <RecentlyPlayed
            title="Favorites"
            tracks={filteredFavoriteSongs.slice(0, 6)}
            viewMode={viewMode}
            fallbackArt={fallbackArt}
            currentTrackId={currentSong?.id}
            onPlayTrack={(song) => handleSongSelect(song, favoriteSongs)}
            onViewAll={() => {
              setActiveNav("favorites");
              setExpandedSection("favorites");
            }}
          />
          <RecentlyPlayed
            title="Recently played"
            tracks={displayedRecent}
            viewMode={viewMode}
            fallbackArt={fallbackArt}
            currentTrackId={currentSong?.id}
            onPlayTrack={(song) => handleSongSelect(song, fullLibrary)}
            onViewAll={() => setExpandedSection("recent")}
          />
        </>
      );
    }

    if (activeNav === "albums" || selectedFilter === "albums") {
      if (selectedAlbumId && selectedAlbum) {
        return (
          <section className="content-section">
            <div className="section-header section-header--album-detail">
              <div>
                <span className="section-detail-label">ALBUM</span>
                <h2>{selectedAlbum.name}</h2>
                <span className="section-count">
                  {selectedAlbum.musicDirector || selectedAlbum.singersSummary || "Tamil soundtrack"}
                </span>
              </div>
              <button className="section-link" onClick={() => setSelectedAlbumId(null)}>
                All albums
              </button>
            </div>
            <div className="track-table">
              {selectedAlbum.songs.map((song) => (
                <div key={song.id} className="track-row">
                  <button className="track-row__main" onClick={() => handleSongSelect(song, selectedAlbum.songs)}>
                    <img src={imageFor(song)} alt={song.title} />
                    <div>
                      <strong>{song.title}</strong>
                      <span>{song.artist}</span>
                    </div>
                  </button>
                  <span>{song.albumTitle}</span>
                  <span>{song.year ?? "Tamil"}</span>
                  <button className={song.favorite ? "track-row__favorite is-active" : "track-row__favorite"} onClick={() => toggleFavorite.mutate(song.id)}>
                    ♥
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      }

      return (
        <section className="content-section">
          <div className="section-header">
            <h2>Albums</h2>
          </div>
          <div className="album-grid">
            {filteredAlbums.map((album) => (
              <button
                key={album.albumId}
                className={selectedAlbumId === album.albumId ? "album-card is-active" : "album-card"}
                onClick={() => {
                  setSelectedAlbumId(album.albumId);
                  setActiveNav("albums");
                }}
              >
                <img src={album.imageUrl || fallbackArt} alt={album.name} />
                <div>
                  <strong>{album.name}</strong>
                  <span>{album.musicDirector || album.singersSummary || "Tamil soundtrack"}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      );
    }

    if (activeNav === "artists" || selectedFilter === "artists") {
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>Artists</h2>
          </div>
          <div className="artist-grid">
            {filteredArtists.map((artist) => (
              <button
                key={artist.artist}
                className="artist-card"
                onClick={() => {
                  setSearchQuery(artist.artist);
                  setSelectedFilter("tracks");
                  setActiveNav("search");
                }}
              >
                <span>{artist.artist.charAt(0)}</span>
                <strong>{artist.artist}</strong>
                <small>{artist.songCount} songs</small>
              </button>
            ))}
          </div>
        </section>
      );
    }

    if (activeNav === "playlists" || selectedFilter === "playlists") {
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>{selectedPlaylist ? selectedPlaylist.name : "Playlists"}</h2>
          </div>
          {selectedPlaylist ? (
            selectedPlaylistSongs.length ? (
              <div className="track-table">
                {selectedPlaylistSongs.map((song) => (
                  <div key={song.id} className="track-row">
                    <button className="track-row__main" onClick={() => handleSongSelect(song, selectedPlaylistSongs)}>
                      <img src={imageFor(song)} alt={song.title} />
                      <div>
                        <strong>{song.title}</strong>
                        <span>{song.artist}</span>
                      </div>
                    </button>
                    <span>{song.albumTitle}</span>
                    <span>{song.year ?? "Tamil"}</span>
                    <button className={song.favorite ? "track-row__favorite is-active" : "track-row__favorite"} onClick={() => toggleFavorite.mutate(song.id)}>
                      ♥
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="content-section__hint">This playlist is empty. Use the More menu in the hero to add the current song.</div>
            )
          ) : (
            <div className="playlist-grid">
              {filteredPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  className="playlist-card"
                  onClick={() => {
                    setSelectedPlaylistId(playlist.id);
                    setActiveNav("playlists");
                  }}
                >
                  <strong>{playlist.name}</strong>
                  <span>{playlist.count} songs</span>
                </button>
              ))}
            </div>
          )}
        </section>
      );
    }

    return (
      <section className="content-section">
        <div className="section-header">
          <h2>{activeNav === "favorites" ? "Favorites" : activeNav === "search" ? "Search results" : "Library tracks"}</h2>
          <span className="section-count">{filteredSongs.length} tracks</span>
        </div>
        <div className="track-table">
          {filteredSongs.slice(0, 24).map((song) => (
            <div key={song.id} className="track-row">
              <button className="track-row__main" onClick={() => handleSongSelect(song, filteredSongs)}>
                <img src={imageFor(song)} alt={song.title} />
                <div>
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
              <span>{song.albumTitle}</span>
              <span>{song.year ?? "Tamil"}</span>
              <button className={song.favorite ? "track-row__favorite is-active" : "track-row__favorite"} onClick={() => toggleFavorite.mutate(song.id)}>
                ♥
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      {[0, 1].map((deckIndex) => (
        <audio
          key={deckIndex}
          ref={(element) => {
            if (deckIndex === 0) deckARef.current = element;
            else deckBRef.current = element;
          }}
          preload="auto"
          className="visually-hidden"
          onTimeUpdate={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            setCurrentTime(event.currentTarget.currentTime);
          }}
          onLoadedMetadata={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            setDuration(event.currentTarget.duration || currentSong?.durationSeconds || 0);
          }}
          onCanPlay={() => {
            if (deckIndex !== activeDeckIndex) return;
            setBuffering(false);
          }}
          onWaiting={() => {
            if (deckIndex !== activeDeckIndex) return;
            setBuffering(true);
          }}
          onPlaying={() => {
            if (deckIndex !== activeDeckIndex) return;
            setBuffering(false);
          }}
          onEnded={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            if (repeatMode === "one") {
              event.currentTarget.currentTime = 0;
              void safePlay(event.currentTarget);
              return;
            }
            handleNextTrack();
          }}
          onError={() => {
            if (deckIndex !== activeDeckIndex) return;
            handleNextTrack();
          }}
        />
      ))}

      {mobileSidebarOpen ? <button className="app-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar" /> : null}

      <div className={mobileSidebarOpen ? "app-sidebar-wrap is-open" : "app-sidebar-wrap"}>
        <Sidebar
          navItems={navItems}
          activeNav={activeNav}
          favoriteCount={favoriteSongs.length || 112}
          playlists={playlistSummaries}
          selectedPlaylistId={selectedPlaylistId}
          onNavChange={(nav) => {
            startTransition(() => {
              if (nav === "home") {
                resetHomeView();
                return;
              }
              setExpandedSection(null);
              setActiveNav(nav);
              if (nav !== "playlists") setSelectedPlaylistId(null);
              setMobileSidebarOpen(false);
            });
          }}
          onFavoritesClick={() => {
            setSelectedPlaylistId(null);
            setActiveNav("favorites");
            setExpandedSection("favorites");
          }}
          onPlaylistClick={(playlistId) => {
            setSelectedPlaylistId(playlistId);
            setActiveNav("playlists");
            setExpandedSection(null);
          }}
          onCreatePlaylist={() => setPlaylistModalOpen(true)}
        />
      </div>

      <main className="main-content">
        <div className="mobile-header">
          <button className="mobile-header__menu" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
            <Menu size={18} />
          </button>
          <div className="mobile-header__brand">
            <img src="/Icon.png" alt={APP_NAME} />
            <strong>{APP_NAME}</strong>
          </div>
        </div>

        <NowPlayingHero
          song={currentSong}
          artwork={imageFor(currentSong)}
          background={imageFor(currentSong)}
          orchestraLine={orchestraLine}
          albumLabel={heroAlbumLabel}
          isPlaying={playing}
          isShuffleOn={shuffle}
          repeatMode={repeatMode}
          isMuted={isMuted}
          volume={volume}
          currentTime={currentTime}
          duration={duration || currentSong?.durationSeconds || 0}
          buffering={buffering}
          menuOpen={heroMenuOpen}
          playlists={playlistSummaries}
          feedback={heroFeedback}
          onPlayPause={handlePlayPauseToggle}
          onPrevious={handlePreviousTrack}
          onNext={handleNextTrack}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={cycleRepeatMode}
          onToggleFavorite={() => currentSong && toggleFavorite.mutate(currentSong.id)}
          onToggleMute={handleToggleMute}
          onVolumeChange={handleVolumeChange}
          onSeek={(value) => {
            setCurrentTime(value);
            const activeDeck = getActiveDeck();
            if (activeDeck) activeDeck.currentTime = value;
          }}
          onOpenMenu={() => setHeroMenuOpen((open) => !open)}
          onAddToPlaylist={handleAddCurrentSongToPlaylist}
          onAddToQueue={() => {
            if (currentSong) addToQueue(currentSong);
            setHeroFeedback("Added to queue");
            setHeroMenuOpen(false);
          }}
          onViewAlbum={handleOpenCurrentAlbum}
          onShare={async () => {
            if (!currentSong) return;
            await navigator.clipboard.writeText(`${currentSong.title} — ${currentSong.artist}`);
            setHeroFeedback("Copied to clipboard");
            setHeroMenuOpen(false);
          }}
        />

        <SearchFilterBar
          query={searchQuery}
          selectedFilter={selectedFilter}
          viewMode={viewMode}
          filterOpen={filterOpen}
          refreshState={refreshStatus}
          refreshPending={manualRefreshCheck.isPending}
          onQueryChange={(value) => {
            startTransition(() => {
              setSearchQuery(value);
              if (value.trim()) setActiveNav("search");
              else if (activeNav === "search") setActiveNav("home");
            });
          }}
          onToggleFilter={() => setFilterOpen((open) => !open)}
          onSelectFilter={handleFilterSelect}
          onSetViewMode={setViewMode}
          onRefreshCheck={() => manualRefreshCheck.mutate()}
        />

        {renderCenterResults()}
      </main>

      <QueuePanel
        queue={queue}
        fallbackArt={fallbackArt}
        currentSongId={currentSong?.id}
        onPlay={(song) => handleSongSelect(song, queue)}
        onReorder={moveQueueItem}
        onClear={handleClearQueue}
      />

      <PlaylistModal
        open={playlistModalOpen}
        value={newPlaylistName}
        onChange={setNewPlaylistName}
        onClose={() => setPlaylistModalOpen(false)}
        onCreate={handleCreatePlaylist}
      />
    </div>
  );
}
