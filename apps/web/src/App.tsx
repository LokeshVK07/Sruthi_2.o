import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock3, Heart, Home, Library, ListMusic, Menu, MoreHorizontal, Plus, Search, Users } from "lucide-react";
import { apiClient } from "./api";
import { useDebounce } from "./hooks/useDebounce";
import { normalizeSearchText } from "./searchUtils";
import Sidebar, { type NavKey } from "./components/Sidebar";
import NowPlayingHero from "./components/NowPlayingHero";
import SearchFilterBar from "./components/SearchFilterBar";
import RecentlyPlayed from "./components/RecentlyPlayed";
import QueuePanel from "./components/QueuePanel";
import PlaylistModal from "./components/PlaylistModal";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import AbstractCover from "./components/AbstractCover";
import BottomPlayer from "./components/BottomPlayer";
import MobileLayout from "./components/mobile/MobileLayout";
import type { MobileLibrarySection } from "./components/mobile/MobileLayout";
import type { MobileTabKey } from "./components/mobile/MobileBottomNav";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePlayerStore } from "./store";
import type { Album, AlbumDetail, ComposerCollection, ComposerDetail, HomeResponse, RefreshStatus, Song } from "./types";
import { fallbackArt, imageForAlbum } from "./utils/artwork";

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
type HomePlaylistCard = {
  id: string;
  name: string;
  count: number;
  coverUrl: string | null;
  kind: "favorites" | "playlist";
};

type StoredPlaylistShape = {
  id: string;
  name: string;
  songIds: string[];
};

const MAX_RECENTLY_PLAYED = 50;
const RECENTLY_PLAYED_STORAGE_KEY = "sruthi_recently_played";
const MOBILE_SEARCH_HISTORY_KEY = "vibe2_search_history";
const PLAYLISTS_KEY = "sruthi-playlists";
const QUEUE_KEY = "sruthi-queue";
const QUEUE_SNAPSHOT_KEY = "sruthi-queue-snapshot";
const APP_NAME = "ViBe 2.o";
const DEV_PLAYBACK_LOG = import.meta.env.DEV;

const navItems = [
  { key: "home", label: "Home", icon: Home },
  { key: "search", label: "Search", icon: Search },
  { key: "library", label: "Library", icon: Library },
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "artists", label: "Artists", icon: Users }
] as const;

function safeDuration(song?: Song | null) {
  return song?.durationSeconds && song.durationSeconds > 0 ? song.durationSeconds : 240;
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

function uniqueById(songs: Song[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (!song?.id || seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

function readStoredTracks(key: string, limit = MAX_RECENTLY_PLAYED): Song[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrack).slice(0, limit);
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
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
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [desktopQueueOpen, setDesktopQueueOpen] = useState(true);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [customPlaylists, setCustomPlaylists] = useState<UiPlaylist[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [heroMenuOpen, setHeroMenuOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"favorites" | "recent" | null>(null);
  const [heroFeedback, setHeroFeedback] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>(() => readStoredTracks(RECENTLY_PLAYED_STORAGE_KEY));
  const [recentlyPlayedHydrated, setRecentlyPlayedHydrated] = useState(() => typeof window !== "undefined");
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
  const [selectedComposerSlug, setSelectedComposerSlug] = useState<string | null>(null);
  const [playlistTargetTrack, setPlaylistTargetTrack] = useState<Song | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const queueHydratedRef = useRef(false);
  // Debounced version of `searchQuery` for the heavy work (filtering 28k+
  // songs, hitting /api/search). The visible <input> stays bound to
  // `searchQuery`, so typing is instant; only filtering/queries lag by ~200ms.
  const debouncedQuery = useDebounce(searchQuery.trim(), 200);
  const deferredQuery = debouncedQuery;
  const warmedUpRef = useRef(false);
  const lastVolumeRef = useRef(0.82);
  const lastRefreshVersionRef = useRef("");
  const prefetchedSongIdsRef = useRef<Set<string>>(new Set());
  const prefetchedAlbumIdsRef = useRef<Map<string, { leadLimit: number; refreshLinks: boolean }>>(new Map());
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  // Tracks how many transparent retries we've done for a given song so a flaky
  // upstream URL gets a second/third chance before we surface an error to the
  // user. Cleared whenever a different song starts.
  const playbackRetryRef = useRef<Map<string, number>>(new Map());
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);

  const { data: home } = useQuery<HomeResponse>({
    queryKey: ["home"],
    queryFn: apiClient.home,
    staleTime: 1000 * 60 * 5,
  });
  const { data: songs } = useQuery<{ items: Song[] }>({
    queryKey: ["songs"],
    queryFn: apiClient.songs,
    staleTime: 1000 * 60 * 10,
  });
  const { data: albums } = useQuery<{ items: Album[] }>({
    queryKey: ["albums"],
    queryFn: apiClient.albums,
    staleTime: 1000 * 60 * 10,
  });
  const { data: favorites } = useQuery<{ items: Song[] }>({
    queryKey: ["favorites"],
    queryFn: apiClient.favorites,
    staleTime: 1000 * 30,
  });
  // Grouped backend search. react-query passes an AbortSignal to queryFn and
  // cancels any in-flight request as soon as `queryKey` changes (i.e. the user
  // types another character), so we never paint stale results.
  const { data: searchData, isFetching: isSearchFetching } = useQuery({
    queryKey: ["search-all", debouncedQuery],
    queryFn: () => apiClient.searchAll(debouncedQuery, 30),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
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
  const { data: composersData } = useQuery<{ items: ComposerCollection[] }>({
    queryKey: ["composers"],
    queryFn: apiClient.composers,
    staleTime: 1000 * 60 * 60,
  });
  const { data: composerDetail } = useQuery<ComposerDetail>({
    queryKey: ["composer", selectedComposerSlug],
    queryFn: () => apiClient.composerSongs(selectedComposerSlug ?? ""),
    enabled: Boolean(selectedComposerSlug),
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
  const favoriteSongs = favorites?.items?.length ? favorites.items : home?.favorites ?? [];
  const albumItems = albums?.items ?? [];
  const fullLibrary = librarySongs.length ? librarySongs : home?.library ?? [];
  const albumLookup = useMemo(() => {
    const map = new Map<string, Album>();
    for (const album of albumItems) map.set(album.albumId, album);
    return map;
  }, [albumItems]);
  const songLookup = useMemo(() => {
    const map = new Map<string, Song>();
    for (const song of fullLibrary) map.set(song.id, song);
    for (const song of favoriteSongs) if (!map.has(song.id)) map.set(song.id, song);
    return map;
  }, [fullLibrary, favoriteSongs]);
  const withLatestSongMetadata = (song: Song | null | undefined): Song | null => {
    if (!song) return null;
    const latest = songLookup.get(song.id);
    const album = albumLookup.get((latest ?? song).albumId);
    const albumArt = imageForAlbum(album ?? null);
    const albumArtUrl = albumArt !== fallbackArt ? albumArt : null;
    return {
      ...song,
      ...(latest ?? {}),
      artworkUrl: latest?.artworkUrl || song.artworkUrl || albumArtUrl,
      albumArtUrl: latest?.albumArtUrl || song.albumArtUrl || albumArtUrl,
      imageUrl: latest?.imageUrl || song.imageUrl || albumArtUrl,
      image_url: latest?.image_url || song.image_url || albumArtUrl,
      coverUrl: latest?.coverUrl || song.coverUrl || albumArtUrl,
      cover_url: latest?.cover_url || song.cover_url || albumArtUrl,
      album_art: latest?.album_art || song.album_art || albumArtUrl,
    };
  };
  const enrichedQueue = useMemo(
    () => queue.map((song) => withLatestSongMetadata(song) ?? song),
    [queue, songLookup, albumLookup],
  );
  const searchSongResults = useMemo(() => {
    if (!debouncedQuery) return [];
    const backendItems = searchData?.tracks ?? [];
    if (backendItems.length) return backendItems;
    // Fallback to local filter — capped at 50 so we never render the whole
    // library on slow devices.
    const lower = debouncedQuery.toLowerCase();
    const out: Song[] = [];
    for (const song of fullLibrary) {
      if (titleMatches(song, lower)) out.push(song);
      if (out.length >= 50) break;
    }
    return out;
  }, [debouncedQuery, fullLibrary, searchData?.tracks]);
  const searchAlbumResults = useMemo(() => searchData?.albums ?? [], [searchData?.albums]);
  const searchArtistResults = useMemo(() => searchData?.artists ?? [], [searchData?.artists]);
  const searchComposerResults = useMemo(() => searchData?.composers ?? [], [searchData?.composers]);
  const recentSongs = useMemo(
    () =>
      recentlyPlayed
        .map((track) => songLookup.get(track.id) ?? track)
        .slice(0, MAX_RECENTLY_PLAYED),
    [recentlyPlayed, songLookup]
  );
  const currentSong = useMemo(() => {
    const queuedSong = enrichedQueue[currentIndex] ?? null;
    return queuedSong ?? recentSongs[0] ?? pickInitialSong(fullLibrary);
  }, [enrichedQueue, currentIndex, recentSongs, fullLibrary]);
  const artistItems = home?.artists ?? [];
  const filteredRecentSongs = useMemo(() => recentSongs.filter((song) => titleMatches(song, debouncedQuery)), [recentSongs, debouncedQuery]);
  const filteredFavoriteSongs = useMemo(() => favoriteSongs.filter((song) => titleMatches(song, debouncedQuery)), [favoriteSongs, debouncedQuery]);
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
  const homePlaylistCards = useMemo<HomePlaylistCard[]>(() => {
    const cards: HomePlaylistCard[] = [
      {
        id: "favorites",
        name: "Favorites",
        count: favoriteSongs.length,
        coverUrl: null,
        kind: "favorites",
      },
    ];

    for (const playlist of customPlaylists) {
      cards.push({
        id: playlist.id,
        name: playlist.name,
        count: playlist.trackIds.length,
        coverUrl: null,
        kind: "playlist",
      });
    }

    return cards;
  }, [customPlaylists, favoriteSongs, songLookup]);
  const homeComposerCards = useMemo(() => (composersData?.items ?? []).slice(0, 8), [composersData?.items]);

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
    if (deckHasSong(activeDeck, song)) {
      setBuffering(false);
      if (shouldPlay && activeDeck) {
        activeDeck.muted = isMuted;
        activeDeck.volume = isMuted ? 0 : volume;
        void safePlay(activeDeck);
        recordPlayback.mutate(song.id);
        prefetchRelated.mutate(song.id);
      }
      return;
    }
    setCurrentTime(0);
    setDuration(song.durationSeconds && song.durationSeconds > 0 ? song.durationSeconds : 0);
    setBuffering(true);
    playbackRetryRef.current.delete(song.id);
    if (!inactiveDeck) return;

    const nextDeckIndex = activeDeckIndex === 0 ? 1 : 0;
    inactiveDeck.pause();
    if (!deckHasSong(inactiveDeck, song)) {
      inactiveDeck.dataset.songId = song.id;
      inactiveDeck.src = songStreamUrl(song);
      debugPlayback("set-src", song.id, inactiveDeck.src);
      inactiveDeck.preload = "auto";
      inactiveDeck.load();
      debugPlayback("load-called", song.id);
    }
    inactiveDeck.currentTime = 0;
    inactiveDeck.muted = isMuted;
    inactiveDeck.volume = isMuted ? 0 : volume;

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
      window.setTimeout(() => schedulePlaybackPrefetches(track, scopedQueue), 300);
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

  const resolveSongById = (songId: string) =>
    queue.find((song) => song.id === songId) ??
    librarySongs.find((song) => song.id === songId) ??
    favoriteSongs.find((song) => song.id === songId) ??
    searchData?.tracks?.find((song: Song) => song.id === songId) ??
    home?.favorites?.find((song) => song.id === songId) ??
    home?.recentlyPlayed?.find((song) => song.id === songId) ??
    fullLibrary.find((song) => song.id === songId) ??
    null;

  const applyFavoriteState = (songId: string, active: boolean) => {
    const resolvedSong = resolveSongById(songId);
    setSongFavorite(songId, active);
    queryClient.setQueryData<{ items: Song[] } | undefined>(["songs"], (existing) =>
      existing ? { ...existing, items: existing.items.map((song) => (song.id === songId ? { ...song, favorite: active } : song)) } : existing
    );
    queryClient.setQueryData<{ items: Song[] } | undefined>(["favorites"], (existing) =>
      existing
        ? {
            ...existing,
            items: active
              ? existing.items.some((song) => song.id === songId)
                ? existing.items.map((song) => (song.id === songId ? { ...song, favorite: active } : song))
                : resolvedSong
                  ? [{ ...resolvedSong, favorite: true }, ...existing.items]
                  : existing.items
              : existing.items.filter((song) => song.id !== songId)
          }
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
            : resolvedSong
              ? [{ ...resolvedSong, favorite: true }, ...(existing.favorites ?? [])]
              : existing.favorites
          : (existing.favorites ?? []).filter((song: Song) => song.id !== songId)
      };
    });
  };

  const toggleFavorite = useMutation<{ active: boolean }, Error, string, { songId: string; previousActive: boolean }>({
    mutationFn: (songId: string) => apiClient.toggleFavorite(songId),
    onMutate: async (songId) => {
      const sourceSong = resolveSongById(songId);
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
    mutationFn: () => apiClient.recordPlayback(),
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
    setRecentlyPlayedHydrated(true);
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
    const snapshotQueue = readStoredTracks(QUEUE_SNAPSHOT_KEY, 100);
    if (!snapshotQueue.length) return;
    setQueue(snapshotQueue, 0, false);
    const firstPlayable = snapshotQueue[0];
    if (firstPlayable) {
      requestSongPrefetch(snapshotQueue.slice(0, 8).map((song) => song.id));
      requestAlbumPrefetch(firstPlayable.albumId, 8, true);
    }
  }, [setQueue]);

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
    try {
      const raw = window.localStorage.getItem(PLAYLISTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setCustomPlaylists(
        parsed
          .filter(
            (item): item is StoredPlaylistShape =>
              item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.songIds),
          )
          .map((item) => ({
            id: item.id,
            name: item.name,
            trackIds: item.songIds.filter((trackId): trackId is string => typeof trackId === "string"),
          })),
      );
    } catch {
      window.localStorage.removeItem(PLAYLISTS_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PLAYLISTS_KEY,
        JSON.stringify(customPlaylists.map((playlist) => ({ id: playlist.id, name: playlist.name, songIds: playlist.trackIds }))),
      );
    } catch {
      // ignore storage failures
    }
  }, [customPlaylists]);

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
    if (queueHydratedRef.current || !fullLibrary.length) return;
    queueHydratedRef.current = true;
    try {
      const raw = window.localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return;
      const restoredQueue = parsed
        .map((songId) => fullLibrary.find((song) => song.id === songId))
        .filter((song): song is Song => Boolean(song));
      if (restoredQueue.length) {
        setQueue(restoredQueue, 0, false);
      }
    } catch {
      window.localStorage.removeItem(QUEUE_KEY);
    }
  }, [fullLibrary, setQueue]);

  useEffect(() => {
    if (!queueHydratedRef.current) return;
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.map((song) => song.id)));
      if (queue.length) {
        window.localStorage.setItem(QUEUE_SNAPSHOT_KEY, JSON.stringify(queue.slice(0, 100)));
      }
    } catch {
      // ignore storage failures
    }
  }, [queue]);

  useEffect(() => {
    if (warmedUpRef.current || !fullLibrary.length) return;
    warmedUpRef.current = true;
    warmup.mutate(48);
    const initial = pickInitialSong(fullLibrary);
    if (!initial) return;
    if (queueHydratedRef.current && queue.length) return;
    const initialQueue = queueFromAlbum(initial.albumId, fullLibrary);
    setQueue(initialQueue, Math.max(0, initialQueue.findIndex((song) => song.id === initial.id)), false);
    window.setTimeout(() => {
      requestSongPrefetch(fullLibrary.slice(0, 8).map((song) => song.id));
      albumItems.slice(0, 3).forEach((album) => requestAlbumPrefetch(album.albumId, 4, false));
    }, 250);
  }, [fullLibrary, albumItems, queue.length, setQueue]);

  useEffect(() => {
    if (!selectedAlbumId) return;
    requestAlbumPrefetch(selectedAlbumId, 8, true);
  }, [selectedAlbumId]);

  useEffect(() => {
    const prioritySongs = uniqueById([...recentSongs.slice(0, 8), ...favoriteSongs.slice(0, 8), ...enrichedQueue.slice(0, 8)]).slice(0, 8);
    if (!prioritySongs.length) return;
    const timer = window.setTimeout(() => {
      requestSongPrefetch(prioritySongs.map((song) => song.id));
      const leadSong = prioritySongs[0];
      if (leadSong) requestAlbumPrefetch(leadSong.albumId, 8, true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [recentSongs, favoriteSongs, enrichedQueue]);

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
    apiClient.invalidateLibraryCache();
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
    currentSong?.title.toLowerCase().includes("a life full of love theme") ? "Curated from your Tamil vault" : currentSong?.composer || "Tamil soundtrack";
  const heroAlbumLabel = currentSong?.albumTitle ?? "Selected album";
  const currentAlbumArtwork = useMemo(
    () => albumItems.find((album) => album.albumId === currentSong?.albumId) ?? null,
    [albumItems, currentSong?.albumId],
  );
  const currentHeroArtwork = "";
  const selectedAlbumFallback = useMemo<AlbumDetail | null>(() => {
    if (!selectedAlbumId) return null;
    const album = albumLookup.get(selectedAlbumId);
    const albumSongs = fullLibrary.filter((song) => song.albumId === selectedAlbumId);
    if (!album && !albumSongs.length) return null;
    const firstSong = albumSongs[0] ?? null;
    return {
      albumId: selectedAlbumId,
      albumUrl: album?.albumUrl ?? selectedAlbumId,
      name: album?.name ?? firstSong?.albumTitle ?? "Unknown album",
      year: album?.year ?? firstSong?.year ?? null,
      musicDirector: album?.musicDirector ?? firstSong?.composer ?? null,
      singersSummary: album?.singersSummary ?? firstSong?.artist ?? null,
      imageUrl: album?.imageUrl ?? firstSong?.imageUrl ?? firstSong?.artworkUrl ?? null,
      coverUrl: album?.coverUrl ?? firstSong?.coverUrl ?? firstSong?.artworkUrl ?? null,
      language: album?.language ?? "Tamil",
      trackCount: album?.trackCount ?? albumSongs.length,
      updatedAt: album?.updatedAt ?? firstSong?.updatedAt,
      songs: albumSongs,
    };
  }, [selectedAlbumId, albumLookup, fullLibrary]);
  const selectedAlbumForView = selectedAlbum ?? selectedAlbumFallback;

  const filteredSongs = useMemo(() => {
    const base =
      activeNav === "favorites"
        ? favoriteSongs
        : activeNav === "playlists" && selectedPlaylist
          ? selectedPlaylistSongs
        : activeNav === "albums"
          ? selectedAlbum?.songs ?? queueFromAlbum(selectedAlbumId ?? undefined, fullLibrary)
          : activeNav === "search" && debouncedQuery
            ? searchSongResults
            : fullLibrary;
    if (!debouncedQuery) return base;
    return base.filter((song) => titleMatches(song, debouncedQuery));
  }, [activeNav, favoriteSongs, selectedPlaylist, selectedPlaylistSongs, selectedAlbum?.songs, selectedAlbumId, fullLibrary, debouncedQuery, searchSongResults]);

  const filteredAlbums = useMemo(
    () =>
      albumItems.filter((album) =>
        !debouncedQuery
          ? true
          : [album.name, album.musicDirector ?? "", album.singersSummary ?? "", String(album.year ?? "")]
              .join(" ")
              .toLowerCase()
              .includes(debouncedQuery.toLowerCase())
      ),
    [albumItems, debouncedQuery]
  );

  const filteredPlaylists = useMemo(
    () => playlistSummaries.filter((playlist) => (!debouncedQuery ? true : playlist.name.toLowerCase().includes(debouncedQuery.toLowerCase()))),
    [playlistSummaries, debouncedQuery]
  );

  const desktopSidebar = useMemo(
    () => (
      <Sidebar
        navItems={navItems}
        activeNav={activeNav}
        favoriteCount={favoriteSongs.length}
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
            if (nav !== "artists") setSelectedComposerSlug(null);
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
    ),
    [activeNav, favoriteSongs.length, playlistSummaries, selectedPlaylistId],
  );

  const desktopSearchBar = useMemo(
    () => (
      <SearchFilterBar
        inputRef={searchInputRef}
        query={searchQuery}
        selectedFilter={selectedFilter}
        viewMode={viewMode}
        filterOpen={filterOpen}
        refreshState={refreshStatus}
        refreshPending={manualRefreshCheck.isPending}
        onQueryChange={(value) => {
          setSearchQuery(value);
          if (value.trim()) setActiveNav("search");
          else if (activeNav === "search") setActiveNav("home");
        }}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        onSelectFilter={handleFilterSelect}
        onSetViewMode={setViewMode}
        onRefreshCheck={() => manualRefreshCheck.mutate()}
      />
    ),
    [searchQuery, selectedFilter, viewMode, filterOpen, refreshStatus, manualRefreshCheck.isPending, activeNav],
  );

  const desktopQueuePanel = useMemo(
    () => (
      <QueuePanel
        queue={enrichedQueue}
        fallbackArt={fallbackArt}
        currentSongId={currentSong?.id}
        onPlay={(song) => handleSongSelect(song, enrichedQueue)}
        onReorder={moveQueueItem}
        onClear={handleClearQueue}
      />
    ),
    [enrichedQueue, currentSong?.id],
  );

  const desktopPlaylistModal = useMemo(
    () => (
      <PlaylistModal
        open={playlistModalOpen}
        value={newPlaylistName}
        onChange={setNewPlaylistName}
        onClose={() => setPlaylistModalOpen(false)}
        onCreate={handleCreatePlaylist}
      />
    ),
    [playlistModalOpen, newPlaylistName],
  );

  function handleSongSelect(song: Song, sourceQueue?: Song[]) {
    const scopedQueue = sourceQueue?.length ? sourceQueue : queueFromAlbum(song.albumId, fullLibrary);
    playTrack(song, { autoPlay: true, addToRecent: true, sourceQueue: scopedQueue.length ? scopedQueue : [song] });
    if (song.albumId) {
      const albumId = song.albumId;
      const prefetch = () => requestAlbumPrefetch(albumId, 4, false);
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(prefetch, { timeout: 800 });
      } else {
        setTimeout(prefetch, 250);
      }
    }
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

  function seekTo(value: number) {
    const safeDurationValue = duration || currentSong?.durationSeconds || 0;
    const nextTime = Math.max(0, safeDurationValue ? Math.min(value, safeDurationValue) : value);
    setCurrentTime(nextTime);
    const activeDeck = getActiveDeck();
    if (activeDeck) activeDeck.currentTime = nextTime;
  }

  function seekBy(seconds: number) {
    seekTo(currentTime + seconds);
  }

  function seekToPercent(percent: number) {
    const safeDurationValue = duration || currentSong?.durationSeconds || 0;
    if (!safeDurationValue) return;
    seekTo(safeDurationValue * percent);
  }

  function setVolumeByDelta(delta: number) {
    handleVolumeChange(Math.max(0, Math.min(1, volume + delta)));
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
    setSelectedComposerSlug(null);
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

  function focusSearchInput() {
    setActiveNav("search");
    setMobileTab("search");
    setMobileSearchOpen(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }

  function navigateDesktop(nav: NavKey) {
    if (nav === "home") {
      resetHomeView();
      return;
    }
    setExpandedSection(null);
    setSelectedAlbumId(null);
    setSelectedPlaylistId(null);
    setSelectedArtistName(null);
    if (nav !== "artists") setSelectedComposerSlug(null);
    setSelectedFilter("all");
    setActiveNav(nav);
    setMobileTab(nav === "search" ? "search" : "library");
    if (nav === "search") setMobileSearchOpen(true);
    if (nav === "library") setMobileLibrarySection("favorites");
    if (nav === "playlists") setMobileLibrarySection("playlists");
    if (nav === "artists") setMobileLibrarySection("artists");
  }

  function closeTransientUi() {
    if (shortcutModalOpen) {
      setShortcutModalOpen(false);
      return;
    }
    setHeroMenuOpen(false);
    setFilterOpen(false);
    setPlaylistModalOpen(false);
    setMobileFullPlayerOpen(false);
    setMobileQueueOpen(false);
    setMobileAddToPlaylistOpen(false);
    setMobileCreatePlaylistOpen(false);
    setMobileRefreshOpen(false);
    setMobileSearchOpen(false);
    setMobileSidebarOpen(false);
  }

  function openAddCurrentToPlaylistPicker() {
    if (!currentSong) return;
    setPlaylistTargetTrack(currentSong);
    if (isMobileViewport) {
      setMobileAddToPlaylistOpen(true);
      return;
    }
    setHeroMenuOpen(true);
    setHeroFeedback("Choose a playlist from the More menu");
  }

  function openCreatePlaylistFromShortcut() {
    setPlaylistTargetTrack(currentSong ?? null);
    if (isMobileViewport) {
      setMobileCreatePlaylistOpen(true);
      return;
    }
    setPlaylistModalOpen(true);
  }

  function addCurrentSongToQueue() {
    if (!currentSong) return;
    addToQueue(currentSong);
    setHeroFeedback("Added to queue");
  }

  useKeyboardShortcuts({
    enabled: true,
    isShortcutModalOpen: shortcutModalOpen,
    openShortcuts: () => setShortcutModalOpen(true),
    closeModals: closeTransientUi,
    togglePlayPause: handlePlayPauseToggle,
    playNext: handleNextTrack,
    playPrevious: handlePreviousTrack,
    seekBy,
    seekToPercent,
    setVolumeByDelta,
    toggleMute: handleToggleMute,
    toggleShuffle,
    cycleRepeat: cycleRepeatMode,
    toggleFavoriteCurrent: () => currentSong && toggleFavorite.mutate(currentSong.id),
    focusSearch: focusSearchInput,
    navigateHome: resetHomeView,
    navigateSearch: focusSearchInput,
    navigateLibrary: () => navigateDesktop("library"),
    navigatePlaylists: () => navigateDesktop("playlists"),
    navigateArtists: () => navigateDesktop("artists"),
    toggleQueue: () => {
      if (isMobileViewport) setMobileQueueOpen((open) => !open);
      else setDesktopQueueOpen((open) => !open);
    },
    openAddToPlaylist: openAddCurrentToPlaylistPicker,
    openCreatePlaylist: openCreatePlaylistFromShortcut,
    addCurrentToQueue: addCurrentSongToQueue,
    toggleFullPlayer: () => setMobileFullPlayerOpen((open) => !open),
    openMoreOptions: () => setHeroMenuOpen((open) => !open),
  });

  const centerResults = useMemo(() => {
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
                  <AbstractCover seed={song.id || song.title} size="md" active={song.id === currentSong?.id} />
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
              <button
                key={song.id}
                className={viewMode === "grid" ? "recent-card" : "recent-row"}
                onClick={() => handleSongSelect(song, queueFromAlbum(song.albumId, fullLibrary))}
              >
                <div className="recent-card__media">
                  <AbstractCover seed={song.id || song.title} size="md" active={song.id === currentSong?.id} />
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
      const forYouCards = [
        { title: "Nature Acoustic", subtitle: "Organic calm", song: fullLibrary[0] ?? currentSong, variant: "wave" as const },
        { title: "Early Morning Calm", subtitle: "Soft starts", song: fullLibrary[1] ?? currentSong, variant: "rings" as const },
        { title: "Deep Focus", subtitle: "Quiet flow", song: fullLibrary[2] ?? currentSong, variant: "dots" as const },
        { title: "Peaceful Piano", subtitle: "Warm keys", song: fullLibrary[3] ?? currentSong, variant: "bars" as const },
        { title: "Rainy Day Vibes", subtitle: "Gentle mood", song: fullLibrary[4] ?? currentSong, variant: "lines" as const },
      ].filter((item): item is { title: string; subtitle: string; song: Song; variant: "wave" | "rings" | "dots" | "bars" | "lines" } => Boolean(item.song));
      const playlistRows = uniqueById([currentSong, ...filteredRecentSongs, ...favoriteSongs, ...fullLibrary].filter(Boolean) as Song[]).slice(0, 8);
      return (
        <>
          <section className="for-you-section">
            <div className="section-header">
              <h2>For You</h2>
              <button className="section-link" type="button" onClick={() => navigateDesktop("library")}>View all</button>
            </div>
            <div className="for-you-grid">
              {forYouCards.map((card) => (
                <button key={card.title} className="for-you-card" type="button" onClick={() => handleSongSelect(card.song, fullLibrary)}>
                  <AbstractCover seed={card.song.id || card.title} variant={card.variant} size="lg" />
                  <span>
                    <strong>{card.title}</strong>
                    <small>{card.subtitle}</small>
                  </span>
                  <span className="for-you-card__play">▶</span>
                </button>
              ))}
            </div>
          </section>
          <section className="content-section playlist-section">
            <div className="section-header">
              <h2>Your Playlist</h2>
              <button className="section-link section-link--pill" type="button" onClick={() => setPlaylistModalOpen(true)}>
                <Plus size={17} /> Add
              </button>
            </div>
            <div className="playlist-table">
              <div className="playlist-table__head">
                <span>#</span>
                <span />
                <span>Title</span>
                <span>Artist</span>
                <span>Album</span>
                <span />
                <span><Clock3 size={15} /></span>
                <span />
              </div>
              {playlistRows.map((song, index) => (
                <div key={song.id} className={song.id === currentSong?.id ? "playlist-row is-active" : "playlist-row"}>
                  <span>{index + 1}</span>
                  <AbstractCover seed={song.id || song.title} size="xs" active={song.id === currentSong?.id} />
                  <button type="button" onClick={() => handleSongSelect(song, playlistRows)}>{song.title}</button>
                  <span>{song.artist}</span>
                  <span>{song.albumTitle}</span>
                  <button className={song.favorite ? "track-row__favorite is-active" : "track-row__favorite"} onClick={() => toggleFavorite.mutate(song.id)}>
                    <Heart size={17} fill={song.favorite ? "currentColor" : "none"} />
                  </button>
                  <span>{safeDuration(song) ? `${Math.floor(safeDuration(song) / 60)}:${String(safeDuration(song) % 60).padStart(2, "0")}` : "—:—"}</span>
                  <button className="track-row__more" type="button" onClick={() => handleOpenAddToPlaylistForTrack(song)}>
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      );
    }

    if (activeNav === "albums" || selectedFilter === "albums") {
      if (selectedAlbumId && selectedAlbumForView) {
        return (
          <section className="content-section">
            <div className="section-header section-header--album-detail">
              <div>
                <span className="section-detail-label">ALBUM</span>
                <h2>{selectedAlbumForView.name}</h2>
                <span className="section-count">
                  {selectedAlbumForView.musicDirector || selectedAlbumForView.singersSummary || "Tamil soundtrack"}
                </span>
              </div>
              <button className="section-link" onClick={() => setSelectedAlbumId(null)}>
                All albums
              </button>
            </div>
            <div className="track-table">
              {selectedAlbumForView.songs.map((song) => (
                <div key={song.id} className="track-row">
                  <button className="track-row__main" onMouseEnter={() => requestSongPrefetch([song.id])} onClick={() => handleSongSelect(song, selectedAlbumForView.songs)}>
                    <AbstractCover seed={song.id || song.title} size="xs" active={song.id === currentSong?.id} />
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
                <AbstractCover seed={album.albumId || album.name} size="md" />
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
      if (selectedComposerSlug && composerDetail) {
        const composerSongs = composerDetail.songs;
        return (
          <section className="content-section">
            <div className="section-header section-header--album-detail">
              <div>
                <span className="section-detail-label">COMPOSER</span>
                <h2>{composerDetail.name}</h2>
                <span className="section-count">{composerDetail.songCount} songs</span>
              </div>
              <button className="section-link" onClick={() => setSelectedComposerSlug(null)}>
                All composers
              </button>
            </div>
            <div className="track-table">
              {composerSongs.map((song) => (
                <div key={song.id} className="track-row">
                  <button
                    className="track-row__main"
                    onMouseEnter={() => requestSongPrefetch([song.id])}
                    onClick={() => handleSongSelect(song, composerSongs)}
                  >
                    <AbstractCover seed={song.id || song.title} size="xs" active={song.id === currentSong?.id} />
                    <div>
                      <strong>{song.title}</strong>
                      <span>{song.artist}</span>
                    </div>
                  </button>
                  <span>{song.albumTitle}</span>
                  <span>{song.year ?? "Tamil"}</span>
                  <button
                    className={song.favorite ? "track-row__favorite is-active" : "track-row__favorite"}
                    onClick={() => toggleFavorite.mutate(song.id)}
                  >
                    ♥
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      }

      const composerList = (composersData?.items ?? []).filter((composer) =>
        !debouncedQuery ? true : composer.name.toLowerCase().includes(debouncedQuery.toLowerCase())
      );
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>Music composers</h2>
            <span className="section-count">{composerList.length} collections</span>
          </div>
          {composerList.length ? (
            <div className="composer-grid">
              {composerList.map((composer) => (
                <button
                  key={composer.slug}
                  className="composer-card"
                  type="button"
                  onClick={() => setSelectedComposerSlug(composer.slug)}
                >
                  <div className="composer-card__media">
                    <AbstractCover seed={composer.slug || composer.name} size="sm" variant="rings" />
                  </div>
                  <div className="composer-card__copy">
                    <strong title={composer.name}>{composer.name}</strong>
                    <span>{composer.songCount} songs · {composer.albumCount} albums</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="content-section__hint">Composer collections are loading…</div>
          )}
        </section>
      );
    }

    if (activeNav === "playlists" || selectedFilter === "playlists") {
      return (
        <section className="content-section">
          <div className="section-header">
            <h2>{selectedPlaylist ? selectedPlaylist.name : "Playlists"}</h2>
            {selectedPlaylist ? (
              <div className="section-header__actions">
                <button className="section-link" type="button" onClick={() => handleRenamePlaylist(selectedPlaylist.id)}>
                  Rename
                </button>
                <button className="section-link section-link--danger" type="button" onClick={() => handleDeletePlaylist(selectedPlaylist.id)}>
                  Delete
                </button>
                <button className="section-link" type="button" onClick={() => setSelectedPlaylistId(null)}>
                  All playlists
                </button>
              </div>
            ) : null}
          </div>
          {selectedPlaylist ? (
            selectedPlaylistSongs.length ? (
              <div className="track-table">
                {selectedPlaylistSongs.map((song) => (
                  <div key={song.id} className="track-row">
                    <button className="track-row__main" onMouseEnter={() => requestSongPrefetch([song.id])} onClick={() => handleSongSelect(song, selectedPlaylistSongs)}>
                      <AbstractCover seed={song.id || song.title} size="xs" active={song.id === currentSong?.id} />
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
                <div
                  key={playlist.id}
                  className="playlist-card"
                >
                  <button type="button" className="playlist-card__main" onClick={() => handleOpenPlaylistView(playlist.id)}>
                    <AbstractCover seed={playlist.id || playlist.name} size="sm" variant="leaf" />
                    <strong>{playlist.name}</strong>
                    <span>{playlist.count} songs</span>
                  </button>
                  <div className="playlist-card__actions">
                    <button type="button" onClick={() => handleRenamePlaylist(playlist.id)}>Rename</button>
                    <button type="button" onClick={() => handleDeletePlaylist(playlist.id)}>Delete</button>
                  </div>
                </div>
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
                <AbstractCover seed={song.id || song.title} size="xs" active={song.id === currentSong?.id} />
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
  }, [
    expandedSection,
    viewMode,
    filteredFavoriteSongs,
    filteredRecentSongs,
    activeNav,
    selectedFilter,
    searchQuery,
    favoriteSongs,
    currentSong?.id,
    selectedAlbumId,
    selectedAlbum,
    selectedAlbumForView,
    filteredAlbums,
    selectedComposerSlug,
    composerDetail,
    composersData?.items,
    debouncedQuery,
    selectedPlaylist,
    selectedPlaylistSongs,
    filteredPlaylists,
    filteredSongs,
    playlistSummaries,
    fullLibrary,
    albumItems,
    homePlaylistCards,
    homeComposerCards,
  ]);

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
            const next = event.currentTarget.currentTime;
            setCurrentTime((prev) => (Math.floor(prev) === Math.floor(next) ? prev : next));
          }}
          onLoadedMetadata={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            const reported = event.currentTarget.duration;
            debugPlayback("loaded-metadata", event.currentTarget.dataset.songId, reported);
            // Some MP3s without a Xing/VBR header report duration as Infinity
            // (or a partial estimate that grows as more bytes arrive). Only
            // accept finite positive values; otherwise fall back to the stored
            // metadata so the scrub bar shows an em-dash placeholder rather
            // than pinning the thumb to an arbitrary point.
            const finite = Number.isFinite(reported) && reported > 0 ? reported : 0;
            setDuration(finite || currentSong?.durationSeconds || 0);
          }}
          onDurationChange={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            const reported = event.currentTarget.duration;
            if (Number.isFinite(reported) && reported > 0) {
              setDuration((prev) => (prev === reported ? prev : reported));
            }
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
          onError={(event) => {
            if (deckIndex !== activeDeckIndex) return;
            const failedDeck = event.currentTarget;
            const failedSongId = failedDeck.dataset.songId;
            debugPlayback("error", failedSongId);
            setBuffering(false);
            // Most "errors" we see are transient: the masstamilan URL has
            // expired, or a CF-blocked album's first attempt is racing the
            // Playwright fallback. The backend always refreshes URLs and
            // retries on its own — silently re-load with a fresh cache-bust
            // up to 3 times. Each retry has progressively more backoff so
            // the server has time to fall back to Playwright if needed.
            const retries = playbackRetryRef.current.get(failedSongId ?? "") ?? 0;
            if (failedSongId && retries < 3 && currentSong && currentSong.id === failedSongId) {
              playbackRetryRef.current.set(failedSongId, retries + 1);
              const bust = `${songStreamUrl(currentSong)}${songStreamUrl(currentSong).includes("?") ? "&" : "?"}retry=${Date.now()}`;
              const backoffMs = retries === 0 ? 200 : retries === 1 ? 800 : 1600;
              debugPlayback("retry", failedSongId, retries + 1, `backoff=${backoffMs}ms`);
              setBuffering(true);
              window.setTimeout(() => {
                if (failedDeck.dataset.songId !== failedSongId) return;
                failedDeck.src = bust;
                failedDeck.load();
                void safePlay(failedDeck);
              }, backoffMs);
              return;
            }
            // After 3 retries the track really is unrecoverable for now —
            // skip to the next one rather than stranding the user.
            setPlaying(false);
            debugPlayback("auto-skip", failedSongId);
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
            searchQuery={debouncedQuery}
            searchInput={searchQuery}
            searchActive={isSearchFetching}
            searchTracks={searchData?.tracks}
            searchAlbums={searchData?.albums}
            searchArtists={searchData?.artists}
            searchComposers={searchData?.composers}
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
                queue={enrichedQueue}
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
          <div className={desktopQueueOpen ? "app-shell" : "app-shell is-queue-hidden"}>
            {mobileSidebarOpen ? <button className="app-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar" /> : null}

            <div className={mobileSidebarOpen ? "app-sidebar-wrap is-open" : "app-sidebar-wrap"}>
              {desktopSidebar}
            </div>

            <main className="main-content">
              <div className="mobile-header">
                <button className="mobile-header__menu" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
                  <Menu size={18} />
                </button>
                <div className="mobile-header__brand">
                  <AbstractCover seed={APP_NAME} size="xs" variant="leaf" />
                  <strong>{APP_NAME}</strong>
                </div>
              </div>

              <div className="top-bar">
                {desktopSearchBar}
                <div className="top-bar__actions">
                  <button className="top-bar__icon" type="button" aria-label="Notifications">
                    <Bell size={20} />
                  </button>
                  <button className="top-bar__profile" type="button" aria-label="Profile">
                    V
                  </button>
                </div>
              </div>

              <NowPlayingHero
                song={currentSong}
                artwork={currentHeroArtwork}
                background={currentHeroArtwork}
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
                onOpenShortcuts={() => {
                  setShortcutModalOpen(true);
                  setHeroMenuOpen(false);
                }}
                onShare={handleShareCurrentSong}
              />

              {centerResults}
            </main>

            {desktopQueueOpen ? desktopQueuePanel : null}

            <BottomPlayer
              song={currentSong}
              isPlaying={playing}
              isShuffleOn={shuffle}
              repeatMode={repeatMode}
              isMuted={isMuted}
              volume={volume}
              currentTime={currentTime}
              duration={duration || currentSong?.durationSeconds || 0}
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
              onToggleQueue={() => setDesktopQueueOpen((open) => !open)}
              onOpenMenu={() => setHeroMenuOpen((open) => !open)}
            />

            {desktopPlaylistModal}
          </div>
        </div>
      )}
      <KeyboardShortcutsModal open={shortcutModalOpen} onClose={() => setShortcutModalOpen(false)} />
    </>
  );
}
