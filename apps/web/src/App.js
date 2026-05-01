import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Album, Home, Library, ListMusic, Menu, Search, Users } from "lucide-react";
import { apiClient } from "./api.js";
import Sidebar from "./components/Sidebar.js";
import NowPlayingHero from "./components/NowPlayingHero.js";
import SearchFilterBar from "./components/SearchFilterBar.js";
import RecentlyPlayed from "./components/RecentlyPlayed.js";
import QueuePanel from "./components/QueuePanel.js";
import PlaylistModal from "./components/PlaylistModal.js";
import { usePlayerStore } from "./store.js";
const fallbackArt = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23191343'/><stop offset='45%' stop-color='%235320bf'/><stop offset='100%' stop-color='%23e668ff'/></linearGradient></defs><rect width='800' height='800' rx='44' fill='url(%23g)'/><circle cx='602' cy='170' r='164' fill='rgba(255,255,255,0.1)'/><circle cx='208' cy='625' r='185' fill='rgba(255,255,255,0.08)'/><path d='M518 168v296c0 30-24 55-69 71-34 12-78 11-98-4-21-14-18-39 6-54 22-14 55-20 84-16V245l166-36v211c0 31-24 56-69 72-35 12-78 11-99-4-21-15-17-39 7-54 21-14 54-20 84-16V168h-12Z' fill='white' fill-opacity='.9'/></svg>";
const navItems = [
    { key: "home", label: "Home", icon: Home },
    { key: "search", label: "Search", icon: Search },
    { key: "library", label: "Library", icon: Library },
    { key: "playlists", label: "Playlists", icon: ListMusic },
    { key: "albums", label: "Albums", icon: Album },
    { key: "artists", label: "Artists", icon: Users }
];
function safeDuration(song) {
    return song?.durationSeconds && song.durationSeconds > 0 ? song.durationSeconds : 240;
}
function imageFor(song) {
    return song?.artworkUrl || fallbackArt;
}
function songStreamUrl(song) {
    const version = encodeURIComponent(String(song.updatedAt ?? song.id));
    return `${song.streamUrl}?v=${version}`;
}
function formatTextSearch(song) {
    return [song.title, song.artist, song.albumTitle, song.composer ?? ""].join(" ").toLowerCase();
}
function titleMatches(song, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized)
        return true;
    return formatTextSearch(song).includes(normalized);
}
function deckHasSong(deck, song) {
    return Boolean(deck && song && deck.dataset.songId === song.id);
}
function queueFromAlbum(albumId, songs) {
    if (!albumId)
        return songs;
    const scoped = songs.filter((song) => song.albumId === albumId);
    return scoped.length ? scoped : songs;
}
function pickInitialSong(librarySongs) {
    return (librarySongs.find((song) => song.title.toLowerCase().includes("a life full of love theme")) ??
        librarySongs.find((song) => song.albumTitle.toLowerCase().includes("moonu")) ??
        librarySongs[0] ??
        null);
}
function pickRecentlyPlayed(source) {
    const keywords = [
        "idhazhin oram",
        "pavazha malli unplugged",
        "nee paartha vizhigal",
        "danga maari oodhari",
        "raavana muraedaa",
        "puttinu"
    ];
    const matched = keywords
        .map((keyword) => source.find((song) => formatTextSearch(song).includes(keyword)))
        .filter(Boolean);
    if (matched.length >= 4)
        return matched;
    const deduped = [...matched];
    for (const song of source) {
        if (deduped.some((item) => item.id === song.id))
            continue;
        deduped.push(song);
        if (deduped.length >= 6)
            break;
    }
    return deduped.slice(0, 6);
}
async function safePlay(audio) {
    try {
        await audio.play();
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
            return;
    }
}
export default function App() {
    const queryClient = useQueryClient();
    const [activeNav, setActiveNav] = useState("home");
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [selectedAlbumId, setSelectedAlbumId] = useState(null);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedFilter, setSelectedFilter] = useState("all");
    const [filterOpen, setFilterOpen] = useState(false);
    const [viewMode, setViewMode] = useState("grid");
    const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState("");
    const [customPlaylists, setCustomPlaylists] = useState([]);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffering, setBuffering] = useState(false);
    const [heroMenuOpen, setHeroMenuOpen] = useState(false);
    const [expandedSection, setExpandedSection] = useState(null);
    const [heroFeedback, setHeroFeedback] = useState(null);
    const deferredQuery = useDeferredValue(searchQuery.trim());
    const warmedUpRef = useRef(false);
    const lastVolumeRef = useRef(0.82);
    const deckARef = useRef(null);
    const deckBRef = useRef(null);
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
    const { queue, currentIndex, playing, volume, shuffle, repeatMode, setQueue, playSong, next, previous, setPlaying, setVolume, setCurrentIndex, setSongFavorite, clearQueue, moveQueueItem, addToQueue, toggleShuffle, cycleRepeatMode } = usePlayerStore();
    const librarySongs = songs?.items ?? [];
    const favoriteSongs = favorites?.items ?? [];
    const albumItems = albums?.items ?? [];
    const fullLibrary = home?.library?.length ? home.library : librarySongs;
    const currentSong = queue[currentIndex] ?? pickInitialSong(fullLibrary);
    const recentSongs = useMemo(() => pickRecentlyPlayed(home?.recentlyPlayed?.length ? home.recentlyPlayed : fullLibrary), [home?.recentlyPlayed, fullLibrary]);
    const displayedRecent = recentSongs.slice(0, 6);
    const selectedPlaylist = useMemo(() => customPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null, [customPlaylists, selectedPlaylistId]);
    const selectedPlaylistSongs = useMemo(() => (selectedPlaylist ? selectedPlaylist.trackIds.map((trackId) => fullLibrary.find((song) => song.id === trackId)).filter(Boolean) : []), [selectedPlaylist, fullLibrary]);
    const playlistSummaries = useMemo(() => customPlaylists.map((playlist) => ({ id: playlist.id, name: playlist.name, count: playlist.trackIds.length })), [customPlaylists]);
    const getDeck = (index) => (index === 0 ? deckARef.current : deckBRef.current);
    const getActiveDeck = () => getDeck(activeDeckIndex);
    const getInactiveDeck = () => getDeck(activeDeckIndex === 0 ? 1 : 0);
    const applyFavoriteState = (songId, active) => {
        setSongFavorite(songId, active);
        queryClient.setQueryData(["songs"], (existing) => existing ? { ...existing, items: existing.items.map((song) => (song.id === songId ? { ...song, favorite: active } : song)) } : existing);
        queryClient.setQueryData(["favorites"], (existing) => existing
            ? { ...existing, items: active ? existing.items : existing.items.filter((song) => song.id !== songId) }
            : existing);
        queryClient.setQueryData(["home"], (existing) => {
            if (!existing)
                return existing;
            const patch = (song) => (song.id === songId ? { ...song, favorite: active } : song);
            return {
                ...existing,
                library: (existing.library ?? []).map(patch),
                recentlyPlayed: (existing.recentlyPlayed ?? []).map(patch),
                favorites: active
                    ? (existing.favorites ?? []).some((song) => song.id === songId)
                        ? (existing.favorites ?? []).map(patch)
                        : currentSong
                            ? [{ ...currentSong, favorite: true }, ...(existing.favorites ?? [])]
                            : existing.favorites
                    : (existing.favorites ?? []).filter((song) => song.id !== songId)
            };
        });
    };
    const toggleFavorite = useMutation({
        mutationFn: (songId) => apiClient.toggleFavorite(songId),
        onMutate: async (songId) => {
            const sourceSong = queue.find((song) => song.id === songId) ??
                librarySongs.find((song) => song.id === songId) ??
                favoriteSongs.find((song) => song.id === songId) ??
                fullLibrary.find((song) => song.id === songId);
            const nextFavorite = !(sourceSong?.favorite ?? false);
            applyFavoriteState(songId, nextFavorite);
            return { songId, previousActive: sourceSong?.favorite ?? false };
        },
        onError: (_error, _songId, context) => {
            if (!context)
                return;
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
        mutationFn: (songId) => apiClient.recordPlayback(songId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["home"] });
        }
    });
    const prefetchRelated = useMutation({ mutationFn: (songId) => apiClient.prefetchRelated(songId) });
    const prefetchSongs = useMutation({ mutationFn: (songIds) => apiClient.prefetchSongs(songIds) });
    const warmup = useMutation({ mutationFn: apiClient.warmup });
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
        if (warmedUpRef.current || !fullLibrary.length)
            return;
        warmedUpRef.current = true;
        warmup.mutate();
        const initial = pickInitialSong(fullLibrary);
        if (!initial)
            return;
        const initialQueue = queueFromAlbum(initial.albumId, fullLibrary);
        setQueue(initialQueue, Math.max(0, initialQueue.findIndex((song) => song.id === initial.id)), false);
        prefetchSongs.mutate(fullLibrary.slice(0, 6).map((song) => song.id));
    }, [fullLibrary.length]);
    useEffect(() => {
        if (!currentSong)
            return;
        setCurrentTime(0);
        setDuration(safeDuration(currentSong));
        setBuffering(true);
        const activeDeck = getActiveDeck();
        const inactiveDeck = getInactiveDeck();
        if (!activeDeck || !inactiveDeck)
            return;
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
            recordPlayback.mutate(currentSong.id);
            prefetchRelated.mutate(currentSong.id);
        }
    }, [currentSong?.id]);
    useEffect(() => {
        const activeDeck = getActiveDeck();
        if (!activeDeck)
            return;
        if (playing) {
            void safePlay(activeDeck);
            if (currentSong) {
                recordPlayback.mutate(currentSong.id);
                prefetchRelated.mutate(currentSong.id);
            }
        }
        else {
            activeDeck.pause();
        }
    }, [playing, activeDeckIndex]);
    useEffect(() => {
        if (!currentSong)
            return;
        const activeDeck = getActiveDeck();
        if (!deckHasSong(activeDeck, currentSong))
            return;
        const nextCandidates = queue.slice(currentIndex + 1, currentIndex + 5);
        if (!nextCandidates.length)
            return;
        prefetchSongs.mutate(nextCandidates.map((song) => song.id));
        const inactiveDeck = getInactiveDeck();
        const nextSong = nextCandidates[0];
        if (!inactiveDeck || !nextSong || deckHasSong(inactiveDeck, nextSong))
            return;
        inactiveDeck.pause();
        inactiveDeck.dataset.songId = nextSong.id;
        inactiveDeck.src = songStreamUrl(nextSong);
        inactiveDeck.preload = "auto";
        inactiveDeck.currentTime = 0;
        inactiveDeck.load();
    }, [currentSong?.id, currentIndex, queue.length, activeDeckIndex]);
    useEffect(() => {
        if (!heroFeedback)
            return;
        const timeout = window.setTimeout(() => setHeroFeedback(null), 1800);
        return () => window.clearTimeout(timeout);
    }, [heroFeedback]);
    const orchestraLine = currentSong?.title.toLowerCase().includes("a life full of love theme") ? "The Chennai Strings Orchestra" : currentSong?.composer || "Studio Orchestra";
    const heroAlbumLabel = currentSong?.albumTitle ?? "Selected album";
    const filteredSongs = useMemo(() => {
        const base = activeNav === "favorites"
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
    const filteredAlbums = useMemo(() => albumItems.filter((album) => !searchQuery.trim()
        ? true
        : [album.name, album.musicDirector ?? "", album.singersSummary ?? "", String(album.year ?? "")]
            .join(" ")
            .toLowerCase()
            .includes(searchQuery.toLowerCase())), [albumItems, searchQuery]);
    const filteredArtists = useMemo(() => (home?.artists ?? []).filter((artist) => (!searchQuery.trim() ? true : artist.artist.toLowerCase().includes(searchQuery.toLowerCase()))), [home?.artists, searchQuery]);
    const filteredPlaylists = useMemo(() => playlistSummaries.filter((playlist) => (!searchQuery.trim() ? true : playlist.name.toLowerCase().includes(searchQuery.toLowerCase()))), [playlistSummaries, searchQuery]);
    function handleSongSelect(song, sourceQueue) {
        const scopedQueue = sourceQueue?.length ? sourceQueue : queueFromAlbum(song.albumId, fullLibrary);
        playSong(song, scopedQueue.length ? scopedQueue : [song]);
        setHeroMenuOpen(false);
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
    function handleVolumeChange(nextVolume) {
        setVolume(nextVolume);
        if (nextVolume <= 0.01) {
            setIsMuted(true);
        }
        else if (isMuted) {
            setIsMuted(false);
        }
    }
    function handleCreatePlaylist() {
        const trimmed = newPlaylistName.trim();
        if (!trimmed)
            return;
        const newId = `playlist-${Date.now()}`;
        setCustomPlaylists((existing) => [{ id: newId, name: trimmed, trackIds: [] }, ...existing]);
        setNewPlaylistName("");
        setPlaylistModalOpen(false);
        setSelectedPlaylistId(newId);
        setActiveNav("playlists");
    }
    function handleAddCurrentSongToPlaylist(playlistId) {
        if (!currentSong)
            return;
        let added = false;
        setCustomPlaylists((existing) => existing.map((playlist) => {
            if (playlist.id !== playlistId)
                return playlist;
            if (playlist.trackIds.includes(currentSong.id))
                return playlist;
            added = true;
            return { ...playlist, trackIds: [...playlist.trackIds, currentSong.id] };
        }));
        setHeroFeedback(added ? "Added to playlist" : "Already in playlist");
        setHeroMenuOpen(false);
    }
    function handleClearQueue() {
        if (!queue.length)
            return;
        if (!window.confirm("Clear the current queue?"))
            return;
        clearQueue();
    }
    function handleFilterSelect(filter) {
        setSelectedFilter(filter);
        setFilterOpen(false);
        if (filter === "albums") {
            setSelectedPlaylistId(null);
            setActiveNav("albums");
        }
        else if (filter === "artists") {
            setSelectedPlaylistId(null);
            setActiveNav("artists");
        }
        else if (filter === "playlists") {
            setActiveNav("playlists");
        }
        else if (filter === "tracks") {
            setSelectedPlaylistId(null);
            setActiveNav("library");
        }
        else if (!searchQuery.trim()) {
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
        if (!currentSong?.albumId)
            return;
        setSelectedAlbumId(currentSong.albumId);
        setSelectedPlaylistId(null);
        setSelectedFilter("all");
        setActiveNav("albums");
        setHeroMenuOpen(false);
    }
    function renderCenterResults() {
        if (expandedSection === "favorites") {
            return (_jsxs("section", { className: "content-section", children: [_jsxs("div", { className: "section-header", children: [_jsx("h2", { children: "Favorites" }), _jsx("button", { className: "section-link", onClick: resetHomeView, children: "Back" })] }), _jsx("div", { className: viewMode === "grid" ? "recent-grid" : "recent-list", children: favoriteSongs.map((song) => (_jsxs("button", { className: viewMode === "grid" ? "recent-card" : "recent-row", onClick: () => handleSongSelect(song, favoriteSongs), children: [_jsx("div", { className: "recent-card__media", children: _jsx("img", { src: song.artworkUrl || fallbackArt, alt: song.title }) }), _jsxs("div", { className: "recent-card__copy", children: [_jsx("strong", { children: song.title }), _jsx("span", { children: song.artist })] })] }, song.id))) })] }));
        }
        if (expandedSection === "recent") {
            return (_jsxs("section", { className: "content-section", children: [_jsxs("div", { className: "section-header", children: [_jsx("h2", { children: "Recently played" }), _jsx("button", { className: "section-link", onClick: resetHomeView, children: "Back" })] }), _jsx("div", { className: viewMode === "grid" ? "recent-grid" : "recent-list", children: recentSongs.map((song) => (_jsxs("button", { className: viewMode === "grid" ? "recent-card" : "recent-row", onClick: () => handleSongSelect(song, fullLibrary), children: [_jsx("div", { className: "recent-card__media", children: _jsx("img", { src: song.artworkUrl || fallbackArt, alt: song.title }) }), _jsxs("div", { className: "recent-card__copy", children: [_jsx("strong", { children: song.title }), _jsx("span", { children: song.artist })] })] }, song.id))) })] }));
        }
        if (activeNav === "home" && selectedFilter === "all" && !searchQuery.trim()) {
            return (_jsxs(_Fragment, { children: [_jsx(RecentlyPlayed, { title: "Favorites", songs: favoriteSongs.slice(0, 6), viewMode: viewMode, fallbackArt: fallbackArt, onSelect: (song) => handleSongSelect(song, favoriteSongs), onViewAll: () => {
                            setActiveNav("favorites");
                            setExpandedSection("favorites");
                        } }), _jsx(RecentlyPlayed, { title: "Recently played", songs: displayedRecent, viewMode: viewMode, fallbackArt: fallbackArt, onSelect: (song) => handleSongSelect(song, fullLibrary), onViewAll: () => setExpandedSection("recent") })] }));
        }
        if (activeNav === "albums" || selectedFilter === "albums") {
            if (selectedAlbumId && selectedAlbum) {
                return (_jsxs("section", { className: "content-section", children: [_jsxs("div", { className: "section-header section-header--album-detail", children: [_jsxs("div", { children: [_jsx("span", { className: "section-detail-label", children: "ALBUM" }), _jsx("h2", { children: selectedAlbum.name }), _jsx("span", { className: "section-count", children: selectedAlbum.musicDirector || selectedAlbum.singersSummary || "Tamil soundtrack" })] }), _jsx("button", { className: "section-link", onClick: () => setSelectedAlbumId(null), children: "All albums" })] }), _jsx("div", { className: "track-table", children: selectedAlbum.songs.map((song) => (_jsxs("div", { className: "track-row", children: [_jsxs("button", { className: "track-row__main", onClick: () => handleSongSelect(song, selectedAlbum.songs), children: [_jsx("img", { src: imageFor(song), alt: song.title }), _jsxs("div", { children: [_jsx("strong", { children: song.title }), _jsx("span", { children: song.artist })] })] }), _jsx("span", { children: song.albumTitle }), _jsx("span", { children: song.year ?? "Tamil" }), _jsx("button", { className: song.favorite ? "track-row__favorite is-active" : "track-row__favorite", onClick: () => toggleFavorite.mutate(song.id), children: "\u2665" })] }, song.id))) })] }));
            }
            return (_jsxs("section", { className: "content-section", children: [_jsx("div", { className: "section-header", children: _jsx("h2", { children: "Albums" }) }), _jsx("div", { className: "album-grid", children: filteredAlbums.map((album) => (_jsxs("button", { className: selectedAlbumId === album.albumId ? "album-card is-active" : "album-card", onClick: () => {
                                setSelectedAlbumId(album.albumId);
                                setActiveNav("albums");
                            }, children: [_jsx("img", { src: album.imageUrl || fallbackArt, alt: album.name }), _jsxs("div", { children: [_jsx("strong", { children: album.name }), _jsx("span", { children: album.musicDirector || album.singersSummary || "Tamil soundtrack" })] })] }, album.albumId))) })] }));
        }
        if (activeNav === "artists" || selectedFilter === "artists") {
            return (_jsxs("section", { className: "content-section", children: [_jsx("div", { className: "section-header", children: _jsx("h2", { children: "Artists" }) }), _jsx("div", { className: "artist-grid", children: filteredArtists.map((artist) => (_jsxs("button", { className: "artist-card", onClick: () => {
                                setSearchQuery(artist.artist);
                                setSelectedFilter("tracks");
                                setActiveNav("search");
                            }, children: [_jsx("span", { children: artist.artist.charAt(0) }), _jsx("strong", { children: artist.artist }), _jsxs("small", { children: [artist.songCount, " songs"] })] }, artist.artist))) })] }));
        }
        if (activeNav === "playlists" || selectedFilter === "playlists") {
            return (_jsxs("section", { className: "content-section", children: [_jsx("div", { className: "section-header", children: _jsx("h2", { children: selectedPlaylist ? selectedPlaylist.name : "Playlists" }) }), selectedPlaylist ? (selectedPlaylistSongs.length ? (_jsx("div", { className: "track-table", children: selectedPlaylistSongs.map((song) => (_jsxs("div", { className: "track-row", children: [_jsxs("button", { className: "track-row__main", onClick: () => handleSongSelect(song, selectedPlaylistSongs), children: [_jsx("img", { src: imageFor(song), alt: song.title }), _jsxs("div", { children: [_jsx("strong", { children: song.title }), _jsx("span", { children: song.artist })] })] }), _jsx("span", { children: song.albumTitle }), _jsx("span", { children: song.year ?? "Tamil" }), _jsx("button", { className: song.favorite ? "track-row__favorite is-active" : "track-row__favorite", onClick: () => toggleFavorite.mutate(song.id), children: "\u2665" })] }, song.id))) })) : (_jsx("div", { className: "content-section__hint", children: "This playlist is empty. Use the More menu in the hero to add the current song." }))) : (_jsx("div", { className: "playlist-grid", children: filteredPlaylists.map((playlist) => (_jsxs("button", { className: "playlist-card", onClick: () => {
                                setSelectedPlaylistId(playlist.id);
                                setActiveNav("playlists");
                            }, children: [_jsx("strong", { children: playlist.name }), _jsxs("span", { children: [playlist.count, " songs"] })] }, playlist.id))) }))] }));
        }
        return (_jsxs("section", { className: "content-section", children: [_jsxs("div", { className: "section-header", children: [_jsx("h2", { children: activeNav === "favorites" ? "Favorites" : activeNav === "search" ? "Search results" : "Library tracks" }), _jsxs("span", { className: "section-count", children: [filteredSongs.length, " tracks"] })] }), _jsx("div", { className: "track-table", children: filteredSongs.slice(0, 24).map((song) => (_jsxs("div", { className: "track-row", children: [_jsxs("button", { className: "track-row__main", onClick: () => handleSongSelect(song, filteredSongs), children: [_jsx("img", { src: imageFor(song), alt: song.title }), _jsxs("div", { children: [_jsx("strong", { children: song.title }), _jsx("span", { children: song.artist })] })] }), _jsx("span", { children: song.albumTitle }), _jsx("span", { children: song.year ?? "Tamil" }), _jsx("button", { className: song.favorite ? "track-row__favorite is-active" : "track-row__favorite", onClick: () => toggleFavorite.mutate(song.id), children: "\u2665" })] }, song.id))) })] }));
    }
    return (_jsxs("div", { className: "app-shell", children: [[0, 1].map((deckIndex) => (_jsx("audio", { ref: (element) => {
                    if (deckIndex === 0)
                        deckARef.current = element;
                    else
                        deckBRef.current = element;
                }, preload: "auto", className: "visually-hidden", onTimeUpdate: (event) => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    setCurrentTime(event.currentTarget.currentTime);
                }, onLoadedMetadata: (event) => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    setDuration(event.currentTarget.duration || safeDuration(currentSong));
                }, onCanPlay: () => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    setBuffering(false);
                }, onWaiting: () => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    setBuffering(true);
                }, onPlaying: () => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    setBuffering(false);
                }, onEnded: (event) => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    if (repeatMode === "one") {
                        event.currentTarget.currentTime = 0;
                        void safePlay(event.currentTarget);
                        return;
                    }
                    next();
                }, onError: () => {
                    if (deckIndex !== activeDeckIndex)
                        return;
                    next();
                } }, deckIndex))), mobileSidebarOpen ? _jsx("button", { className: "app-backdrop", onClick: () => setMobileSidebarOpen(false), "aria-label": "Close sidebar" }) : null, _jsx("div", { className: mobileSidebarOpen ? "app-sidebar-wrap is-open" : "app-sidebar-wrap", children: _jsx(Sidebar, { navItems: navItems, activeNav: activeNav, favoriteCount: favoriteSongs.length || 112, playlists: playlistSummaries, selectedPlaylistId: selectedPlaylistId, onNavChange: (nav) => {
                        startTransition(() => {
                            if (nav === "home") {
                                resetHomeView();
                                return;
                            }
                            setExpandedSection(null);
                            setActiveNav(nav);
                            if (nav !== "playlists")
                                setSelectedPlaylistId(null);
                            setMobileSidebarOpen(false);
                        });
                    }, onFavoritesClick: () => {
                        setSelectedPlaylistId(null);
                        setActiveNav("favorites");
                        setExpandedSection("favorites");
                    }, onPlaylistClick: (playlistId) => {
                        setSelectedPlaylistId(playlistId);
                        setActiveNav("playlists");
                        setExpandedSection(null);
                    }, onCreatePlaylist: () => setPlaylistModalOpen(true) }) }), _jsxs("main", { className: "main-content", children: [_jsxs("div", { className: "mobile-header", children: [_jsx("button", { className: "mobile-header__menu", onClick: () => setMobileSidebarOpen(true), "aria-label": "Open sidebar", children: _jsx(Menu, { size: 18 }) }), _jsx("strong", { children: "Sruthi \u2013 \u0BB8\u0BCD\u0BB0\u0BC1\u0BA4\u0BBF" })] }), _jsx(NowPlayingHero, { song: currentSong, artwork: imageFor(currentSong), background: imageFor(currentSong), orchestraLine: orchestraLine, albumLabel: heroAlbumLabel, isPlaying: playing, isShuffleOn: shuffle, repeatMode: repeatMode, isMuted: isMuted, volume: volume, currentTime: currentTime, duration: duration || safeDuration(currentSong), buffering: buffering, menuOpen: heroMenuOpen, playlists: playlistSummaries, feedback: heroFeedback, onPlayPause: () => setPlaying(!playing), onPrevious: previous, onNext: next, onToggleShuffle: toggleShuffle, onCycleRepeat: cycleRepeatMode, onToggleFavorite: () => currentSong && toggleFavorite.mutate(currentSong.id), onToggleMute: handleToggleMute, onVolumeChange: handleVolumeChange, onSeek: (value) => {
                            setCurrentTime(value);
                            const activeDeck = getActiveDeck();
                            if (activeDeck)
                                activeDeck.currentTime = value;
                        }, onOpenMenu: () => setHeroMenuOpen((open) => !open), onAddToPlaylist: handleAddCurrentSongToPlaylist, onAddToQueue: () => {
                            if (currentSong)
                                addToQueue(currentSong);
                            setHeroFeedback("Added to queue");
                            setHeroMenuOpen(false);
                        }, onViewAlbum: handleOpenCurrentAlbum, onShare: async () => {
                            if (!currentSong)
                                return;
                            await navigator.clipboard.writeText(`${currentSong.title} — ${currentSong.artist}`);
                            setHeroFeedback("Copied to clipboard");
                            setHeroMenuOpen(false);
                        } }), _jsx(SearchFilterBar, { query: searchQuery, selectedFilter: selectedFilter, viewMode: viewMode, filterOpen: filterOpen, onQueryChange: (value) => {
                            startTransition(() => {
                                setSearchQuery(value);
                                if (value.trim())
                                    setActiveNav("search");
                                else if (activeNav === "search")
                                    setActiveNav("home");
                            });
                        }, onToggleFilter: () => setFilterOpen((open) => !open), onSelectFilter: handleFilterSelect, onSetViewMode: setViewMode }), renderCenterResults()] }), _jsx(QueuePanel, { queue: queue, fallbackArt: fallbackArt, currentSongId: currentSong?.id, onPlay: (song) => {
                    const index = queue.findIndex((item) => item.id === song.id);
                    if (index >= 0)
                        setCurrentIndex(index);
                    playSong(song, queue);
                }, onReorder: moveQueueItem, onClear: handleClearQueue }), _jsx(PlaylistModal, { open: playlistModalOpen, value: newPlaylistName, onChange: setNewPlaylistName, onClose: () => setPlaylistModalOpen(false), onCreate: handleCreatePlaylist })] }));
}
