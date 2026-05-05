import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Album as AlbumIcon, Home, Library, ListMusic, Menu, Search, Users } from "lucide-react";
import { apiClient } from "./api";
import Sidebar, { type NavKey } from "./components/Sidebar";
import NowPlayingHero from "./components/NowPlayingHero";
import SearchFilterBar from "./components/SearchFilterBar";
import RecentlyPlayed from "./components/RecentlyPlayed";
import QueuePanel from "./components/QueuePanel";
import PlaylistModal from "./components/PlaylistModal";
import MobileLayout from "./components/mobile/MobileLayout";
import type { MobileLibrarySection } from "./components/mobile/MobileLayout";
import type { MobileTabKey } from "./components/mobile/MobileBottomNav";
import { usePlayerStore } from "./store";
import type { Album, AlbumDetail, HomeResponse, RefreshStatus, Song } from "./types";

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
const MOBILE_SEARCH_HISTORY_KEY = "vibe2_search_history";
const APP_NAME = "Vibe 2.o";
const DEV_PLAYBACK_LOG = import.meta.env.DEV;

const fallbackArt =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23191343'/><stop offset='45%' stop-color='%235320bf'/><stop offset='100%' stop-color='%23e668ff'/></linearGradient></defs><rect width='800' height='800' rx='44' fill='url(%23g)'/><circle cx='602' cy='170' r='164' fill='rgba(255,255,255,0.1)'/><circle cx='208' cy='625' r='185' fill='rgba(255,255,255,0.08)'/><path d='M518 168v296c0 30-24 55-69 71-34 12-78 11-98-4-21-14-18-39 6-54 22-14 55-20 84-16V245l166-36v211c0 31-24 56-69 72-35 12-78 11-99-4-21-15-17-39 7-54 21-14 54-20 84-16V168h-12Z' fill='white' fill-opacity='.9'/></svg>";

const navItems = [
  { key: "home", label: "Home", icon: Home },
  { key: "search", label: "Search", icon: Search },
  { key: "library", label: "Library", icon: Library },
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "albums", label: "Albums", icon: AlbumIcon },
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

function debugPlayback(...parts: Array<string | number | null | undefined>) {
  if (!DEV_PLAYBACK_LOG) return;
  console.debug("[playback-ui]", ...parts);
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
  const [isMobileViewport, setIsMobileViewport] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 640 : false));
  const [mobileTab, setMobileTab] = useState<MobileTabKey>("home");
  const [mobileLibrarySection, setMobileLibrarySection] = useState<MobileLibrarySection>("favorites");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileFullPlayerOpen, setMobileFullPlayerOpen] = useState(false);
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [mobileAddToPlaylistOpen, setMobileAddToPlaylistOpen] = useState(false);
  const [mobileCreatePlaylistOpen, setMobileCreatePlaylistOpen] = useState(false);
  const [mobileRefreshOpen, setMobileRefreshOpen] = useState(false);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [playlistTargetTrack, setPlaylistTargetTrack] = useState<Song | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(searchQuery.trim());
  const warmedUpRef = useRef(false);
  const lastVolumeRef = useRef(0.82);
  const lastRefreshVersionRef = useRef("");
  const prefetchedSongIdsRef = useRef<Set<string>>(new Set());
  const prefetchedAlbumIdsRef = useRef<Map<string, { leadLimit: number; refreshLinks: boolean }>>(new Map());
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);

  const { data: home } = useQuery<HomeResponse>({ queryKey: ["home"], queryFn: apiClient.home });
  const { data: songs } = useQuery<{ items: Song[] }>({ queryKey: ["songs"], queryFn: apiClient.songs });
  const { data: albums } = useQuery<{ items: Album[] }>({ queryKey: ["albums"], queryFn: apiClient.albums });
  const { data: favorites } = useQuery<{ items: Song[] }>({ queryKey: ["favorites"], queryFn: apiClient.favorites });
  const { data: searchData } = useQuery<{ items: Song[] }>({
    queryKey: ["search", deferredQuery],
    queryFn: () => apiClient.search(deferredQuery),
    enabled: deferredQuery.length > 0
  });
  const { data: selectedAlbum } = useQuery<AlbumDetail>({
    queryKey: ["album", selectedAlbumId],
    queryFn: () => apiClient.album(selectedAlbumId ?? ""),
    enabled: Boolean(selectedAlbumId)
  });
  const { data: refreshStatus } = useQuery<RefreshStatus>({
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
    removeFromQueue,
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
  const artistItems = home?.artists ?? [];
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

  function rememberSearchTerm(value: string) {
    const term = value.trim();
    if (!term) return;
    setRecentSearches((previous) => [term, ...previous.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  }

  function requestSongPrefetch(songIds: string[]) {
    const nextSongIds = songIds.filter((songId) => {
      if (!songId || prefetchedSongIdsRef.current.has(songId)) return false;
      prefetchedSongIdsRef.current.add(songId);
      return true;
    });
    if (!nextSongIds.length) return;
    prefetchSongs.mutate(nextSongIds);
  }

  function requestAlbumPrefetch(albumId: string | undefined, leadLimit = 4, refreshLinks = false) {
    if (!albumId) return;
    const existing = prefetchedAlbumIdsRef.current.get(albumId);
    if (existing && existing.leadLimit >= leadLimit && (!refreshLinks || existing.refreshLinks)) {
      return;
    }
    prefetchedAlbumIdsRef.current.set(albumId, {
      leadLimit: Math.max(existing?.leadLimit ?? 0, leadLimit),
      refreshLinks: Boolean(existing?.refreshLinks || refreshLinks),
    });
    prefetchAlbum.mutate({ albumId, leadLimit, refreshLinks });
  }

  function schedulePlaybackPrefetches(track: Song, sourceQueue?: Song[]) {
    const scopedQueue = sourceQueue?.length ? sourceQueue : queueFromAlbum(track.albumId, fullLibrary);
    const trackIndex = scopedQueue.findIndex((item) => item.id === track.id);
    const neighborIds =
      trackIndex >= 0
        ? scopedQueue
            .slice(Math.max(0, trackIndex + 1), trackIndex + 5)
            .map((item) => item.id)
        : [];
    if (neighborIds.length) {
      requestSongPrefetch(neighborIds);
    }
    requestAlbumPrefetch(track.albumId, 8, true);
  }

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
    debugPlayback("set-src", song.id, inactiveDeck.src);
    inactiveDeck.preload = "auto";
    inactiveDeck.currentTime = 0;
    inactiveDeck.muted = isMuted;
    inactiveDeck.volume = isMuted ? 0 : volume;
    inactiveDeck.load();
    debugPlayback("load-called", song.id);

    if (activeDeck) {
      activeDeck.pause();
      activeDeck.currentTime = 0;
      activeDeck.muted = true;
      activeDeck.volume = 0;
    }

    setActiveDeckIndex(nextDeckIndex);

    if (shouldPlay) {
      debugPlayback("play-start", song.id);
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
    if (autoPlay) {
      schedulePlaybackPrefetches(track, scopedQueue);
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

  const toggleFavorite = useMutation<{ active: boolean }, Error, string, { songId: string; previousActive: boolean }>({
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

  const recordPlayback = useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (songId: string) => apiClient.recordPlayback(songId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    }
  });
  const prefetchRelated = useMutation<{ queued: number }, Error, string>({ mutationFn: (songId: string) => apiClient.prefetchRelated(songId) });
  const prefetchSongs = useMutation<{ queued: number }, Error, string[]>({ mutationFn: (songIds: string[]) => apiClient.prefetchSongs(songIds) });
  const prefetchAlbum = useMutation<{ ok: boolean; queued: number; songCount: number }, Error, { albumId: string; leadLimit?: number; refreshLinks?: boolean }>({
    mutationFn: ({ albumId, leadLimit = 4, refreshLinks = false }: { albumId: string; leadLimit?: number; refreshLinks?: boolean }) =>
      apiClient.prefetchAlbum(albumId, leadLimit, refreshLinks)
  });
  const warmup = useMutation<{ ok: boolean; queued: number }, Error, number>({ mutationFn: (limit: number) => apiClient.warmup(limit) });
  const manualRefreshCheck = useMutation<RefreshStatus, Error, void>({
    mutationFn: apiClient.refreshCheck,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["refresh-status"] });
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobileViewport(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

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
    try {
      const raw = window.localStorage.getItem(MOBILE_SEARCH_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((item): item is string => typeof item === "string").slice(0, 8));
      }
    } catch {
      window.localStorage.removeItem(MOBILE_SEARCH_HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MOBILE_SEARCH_HISTORY_KEY, JSON.stringify(recentSearches.slice(0, 8)));
    } catch {
      // ignore storage failures
    }
  }, [recentSearches]);

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
    warmup.mutate(48);
    const initial = pickInitialSong(fullLibrary);
    if (!initial) return;
    const initialQueue = queueFromAlbum(initial.albumId, fullLibrary);
    setQueue(initialQueue, Math.max(0, initialQueue.findIndex((song) => song.id === initial.id)), false);
    requestSongPrefetch(fullLibrary.slice(0, 8).map((song) => song.id));
    albumItems.slice(0, 3).forEach((album) => requestAlbumPrefetch(album.albumId, 4, false));
  }, [fullLibrary.length, albumItems]);

  useEffect(() => {
    if (!selectedAlbumId) return;
    requestAlbumPrefetch(selectedAlbumId, 8, true);
  }, [selectedAlbumId]);

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
    requestSongPrefetch(nextCandidates.map((song) => song.id));
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
    requestAlbumPrefetch(song.albumId, 8, true);
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
    const targetTrack = playlistTargetTrack ?? currentSong;
    setCustomPlaylists((existing) => [
      { id: newId, name: trimmed, trackIds: targetTrack ? [targetTrack.id] : [] },
      ...existing
    ]);
    setNewPlaylistName("");
    setPlaylistModalOpen(false);
    setMobileCreatePlaylistOpen(false);
    setMobileAddToPlaylistOpen(false);
    setSelectedPlaylistId(newId);
    setActiveNav("playlists");
    setMobileTab("library");
    setMobileLibrarySection("playlists");
    setPlaylistTargetTrack(null);
  }

  function handleAddCurrentSongToPlaylist(playlistId: string) {
    handleAddSongToPlaylist(currentSong, playlistId);
  }

  function handleAddSongToPlaylist(track: Song | null, playlistId: string) {
    if (!track) return;
    let added = false;
    setCustomPlaylists((existing) =>
      existing.map((playlist) => {
        if (playlist.id !== playlistId) return playlist;
        if (playlist.trackIds.includes(track.id)) return playlist;
        added = true;
        return { ...playlist, trackIds: [...playlist.trackIds, track.id] };
      })
    );
    setHeroFeedback(added ? "Added to playlist" : "Already in playlist");
    setHeroMenuOpen(false);
    setMobileAddToPlaylistOpen(false);
    setPlaylistTargetTrack(null);
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
    setSelectedArtistName(null);
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
    handleOpenAlbumView(currentSong.albumId);
    setHeroMenuOpen(false);
  }

  function handleOpenAlbumView(albumId: string) {
    requestAlbumPrefetch(albumId, 8, true);
    setSelectedAlbumId(albumId);
    setSelectedArtistName(null);
    setSelectedPlaylistId(null);
    setSelectedFilter("all");
    setExpandedSection(null);
    setActiveNav("albums");
    setMobileTab("library");
    setMobileLibrarySection("albums");
  }

  function handleOpenArtistView(artist: string) {
    rememberSearchTerm(artist);
    setSelectedArtistName(artist);
    setSelectedAlbumId(null);
    setSelectedPlaylistId(null);
    setExpandedSection(null);
    setActiveNav("artists");
    setMobileTab("library");
    setMobileLibrarySection("artists");
  }

  function handleOpenPlaylistView(playlistId: string) {
    setSelectedPlaylistId(playlistId);
    setSelectedAlbumId(null);
    setSelectedArtistName(null);
    setExpandedSection(null);
    setActiveNav("playlists");
    setMobileTab("library");
    setMobileLibrarySection("playlists");
  }

  function handleRenamePlaylist(playlistId: string) {
    const playlist = customPlaylists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const nextName = window.prompt("Rename playlist", playlist.name)?.trim();
    if (!nextName || nextName === playlist.name) return;
    setCustomPlaylists((existing) =>
      existing.map((item) => (item.id === playlistId ? { ...item, name: nextName } : item))
    );
  }

  function handleDeletePlaylist(playlistId: string) {
    const playlist = customPlaylists.find((item) => item.id === playlistId);
    if (!playlist) return;
    if (!window.confirm(`Delete playlist "${playlist.name}"?`)) return;
    setCustomPlaylists((existing) => existing.filter((item) => item.id !== playlistId));
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    }
  }

  function handleShareCurrentSong() {
    if (!currentSong) return;
    void navigator.clipboard.writeText(`${currentSong.title} — ${currentSong.artist}`);
    setHeroFeedback("Copied to clipboard");
    setHeroMenuOpen(false);
  }

  function handleMobileTabChange(tab: MobileTabKey) {
    if (tab === "queue") {
      setMobileQueueOpen(true);
      return;
    }
    setMobileTab(tab);
    setMobileSearchOpen(tab === "search");
    if (tab === "home") {
      setSelectedAlbumId(null);
      setSelectedArtistName(null);
      setSelectedPlaylistId(null);
    }
    if (tab === "library") {
      setMobileLibrarySection((section) => section || "favorites");
    }
  }

  function handleMobileSearchOpen() {
    setMobileSearchOpen(true);
    setMobileTab("search");
  }

  function handleMobileSearchClose() {
    setMobileSearchOpen(false);
    if (mobileTab === "search") {
      setMobileTab("home");
    }
  }

  function handleMobileSearchQueryChange(value: string) {
    setSearchQuery(value);
    if (value.trim()) {
      setMobileSearchOpen(true);
      setMobileTab("search");
    }
  }

  function handleOpenAddToPlaylistForTrack(track?: Song | null) {
    setPlaylistTargetTrack(track ?? currentSong ?? null);
    setMobileAddToPlaylistOpen(true);
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
            onPrefetchTrack={(song) => requestSongPrefetch([song.id])}
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
            onPrefetchTrack={(song) => requestSongPrefetch([song.id])}
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
                  <button className="track-row__main" onMouseEnter={() => requestSongPrefetch([song.id])} onClick={() => handleSongSelect(song, selectedAlbum.songs)}>
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
                onMouseEnter={() => requestAlbumPrefetch(album.albumId, 4, false)}
                onClick={() => {
                  handleOpenAlbumView(album.albumId);
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
                onClick={() => handleOpenArtistView(artist.artist)}
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
                    <button className="track-row__main" onMouseEnter={() => requestSongPrefetch([song.id])} onClick={() => handleSongSelect(song, selectedPlaylistSongs)}>
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
                  onClick={() => handleOpenPlaylistView(playlist.id)}
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
              <button className="track-row__main" onMouseEnter={() => requestSongPrefetch([song.id])} onClick={() => handleSongSelect(song, filteredSongs)}>
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
    <>
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
            debugPlayback("loaded-metadata", event.currentTarget.dataset.songId, event.currentTarget.duration);
            setDuration(event.currentTarget.duration || currentSong?.durationSeconds || 0);
          }}
          onCanPlay={() => {
            if (deckIndex !== activeDeckIndex) return;
            debugPlayback("canplay", getDeck(deckIndex)?.dataset.songId);
            setBuffering(false);
          }}
          onWaiting={() => {
            if (deckIndex !== activeDeckIndex) return;
            debugPlayback("waiting", getDeck(deckIndex)?.dataset.songId);
            setBuffering(true);
          }}
          onPlaying={() => {
            if (deckIndex !== activeDeckIndex) return;
            debugPlayback("playing", getDeck(deckIndex)?.dataset.songId);
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
            debugPlayback("error", getDeck(deckIndex)?.dataset.songId);
            handleNextTrack();
          }}
        />
      ))}
      {isMobileViewport ? (
        <div className="mobile-only">
          <MobileLayout
            appName={APP_NAME}
            activeTab={mobileSearchOpen ? "search" : mobileTab}
            librarySection={mobileLibrarySection}
            searchQuery={searchQuery}
            selectedFilter={selectedFilter}
            recentSearches={recentSearches}
            currentSong={currentSong}
            fallbackArt={fallbackArt}
            currentTime={currentTime}
            duration={duration || currentSong?.durationSeconds || 0}
            volume={volume}
            isPlaying={playing}
            isShuffleOn={shuffle}
            repeatMode={repeatMode}
            buffering={buffering}
            queue={queue}
            favorites={favoriteSongs}
            recentlyPlayed={recentSongs}
            fullLibrary={fullLibrary}
            albums={albumItems}
            selectedAlbum={selectedAlbum ?? null}
            selectedArtist={selectedArtistName}
            artists={artistItems}
            playlists={playlistSummaries}
            selectedPlaylistId={selectedPlaylistId}
            selectedPlaylistName={selectedPlaylist?.name ?? null}
            selectedPlaylistSongs={selectedPlaylistSongs}
            refreshStatus={refreshStatus ?? null}
            refreshPending={manualRefreshCheck.isPending}
            fullPlayerOpen={mobileFullPlayerOpen}
            queueOpen={mobileQueueOpen}
            addToPlaylistOpen={mobileAddToPlaylistOpen}
            createPlaylistOpen={mobileCreatePlaylistOpen}
            refreshOpen={mobileRefreshOpen}
            onTabChange={handleMobileTabChange}
            onLibrarySectionChange={setMobileLibrarySection}
            onSearchQueryChange={handleMobileSearchQueryChange}
            onSelectFilter={(filter) => {
              setSelectedFilter(filter);
              if (filter !== "all") {
                setMobileTab("search");
              }
            }}
            onClearRecentSearches={() => setRecentSearches([])}
            onPlayTrack={(song, sourceQueue) => {
              if (searchQuery.trim()) {
                rememberSearchTerm(searchQuery);
              }
              handleSongSelect(song, sourceQueue);
            }}
            onTogglePlay={handlePlayPauseToggle}
            onPrevious={handlePreviousTrack}
            onNext={handleNextTrack}
            onSeek={(value) => {
              setCurrentTime(value);
              const activeDeck = getActiveDeck();
              if (activeDeck) activeDeck.currentTime = value;
            }}
            onVolumeChange={handleVolumeChange}
            onToggleFavorite={() => currentSong && toggleFavorite.mutate(currentSong.id)}
            onToggleShuffle={toggleShuffle}
            onCycleRepeat={cycleRepeatMode}
            onOpenFullPlayer={() => setMobileFullPlayerOpen(true)}
            onCloseFullPlayer={() => setMobileFullPlayerOpen(false)}
            onOpenQueue={() => setMobileQueueOpen(true)}
            onCloseQueue={() => setMobileQueueOpen(false)}
            onClearQueue={handleClearQueue}
            onRemoveFromQueue={removeFromQueue}
            onReorderQueue={moveQueueItem}
            onOpenSearch={handleMobileSearchOpen}
            onCloseSearch={handleMobileSearchClose}
            onOpenCreatePlaylist={() => setMobileCreatePlaylistOpen(true)}
            onCloseCreatePlaylist={() => setMobileCreatePlaylistOpen(false)}
            onCreatePlaylist={handleCreatePlaylist}
            onPlaylistNameChange={setNewPlaylistName}
            newPlaylistName={newPlaylistName}
            onOpenAddToPlaylist={() => handleOpenAddToPlaylistForTrack(currentSong)}
            onCloseAddToPlaylist={() => {
              setMobileAddToPlaylistOpen(false);
              setPlaylistTargetTrack(null);
            }}
            onAddTrackToPlaylist={(playlistId) => handleAddSongToPlaylist(playlistTargetTrack ?? currentSong, playlistId)}
            onOpenAlbum={handleOpenAlbumView}
            onCloseAlbum={() => setSelectedAlbumId(null)}
            onOpenArtist={handleOpenArtistView}
            onCloseArtist={() => setSelectedArtistName(null)}
            onOpenPlaylist={handleOpenPlaylistView}
            onClosePlaylist={() => setSelectedPlaylistId(null)}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onOpenRefresh={() => setMobileRefreshOpen(true)}
            onCloseRefresh={() => setMobileRefreshOpen(false)}
            onRefreshCheck={() => manualRefreshCheck.mutate()}
            onShareCurrent={handleShareCurrentSong}
            onShowLyrics={() => setHeroFeedback("Lyrics unavailable")}
            onViewCurrentAlbum={handleOpenCurrentAlbum}
            onViewCurrentArtist={() => currentSong && handleOpenArtistView(currentSong.artist)}
            onPrefetchTrack={(song) => requestSongPrefetch([song.id])}
          />
        </div>
      ) : (
        <div className="desktop-only">
          <div className="app-shell">
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
                    setSelectedArtistName(null);
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
                  handleOpenPlaylistView(playlistId);
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
                onShare={handleShareCurrentSong}
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
        </div>
      )}
    </>
  );
}
