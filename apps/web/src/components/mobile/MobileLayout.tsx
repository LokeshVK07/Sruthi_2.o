import { useMemo } from "react";
import type { Album, AlbumDetail, ComposerCollection, RefreshStatus, Song } from "../../types";
import type { RepeatMode } from "../../store";
import MobileAddToPlaylistSheet from "./MobileAddToPlaylistSheet";
import MobileAlbumDetail from "./MobileAlbumDetail";
import MobileArtistDetail from "./MobileArtistDetail";
import MobileBottomNav, { type MobileTabKey } from "./MobileBottomNav";
import MobileCreatePlaylistSheet from "./MobileCreatePlaylistSheet";
import MobileFullPlayer from "./MobileFullPlayer";
import MobileHome from "./MobileHome";
import MobileLibrary from "./MobileLibrary";
import MobileMiniPlayer from "./MobileMiniPlayer";
import MobilePlaylists from "./MobilePlaylists";
import MobileQueueSheet from "./MobileQueueSheet";
import MobileRefreshStatusSheet from "./MobileRefreshStatusSheet";
import MobileSearch from "./MobileSearch";

export type MobileLibrarySection = "favorites" | "playlists" | "albums" | "artists" | "recent";

type PlaylistSummary = { id: string; name: string; count: number };

type MobileLayoutProps = {
  appName: string;
  activeTab: MobileTabKey;
  librarySection: MobileLibrarySection;
  searchQuery: string;
  searchInput: string;
  searchActive: boolean;
  selectedFilter: "all" | "tracks" | "albums" | "artists" | "playlists";
  recentSearches: string[];
  searchTracks?: Song[];
  searchAlbums?: Album[];
  searchArtists?: Array<{ artist: string; songCount: number }>;
  searchComposers?: ComposerCollection[];
  currentSong: Song | null;
  fallbackArt: string;
  currentTime: number;
  duration: number;
  volume: number;
  isPlaying: boolean;
  isShuffleOn: boolean;
  repeatMode: RepeatMode;
  buffering: boolean;
  queue: Song[];
  favorites: Song[];
  recentlyPlayed: Song[];
  fullLibrary: Song[];
  albums: Album[];
  selectedAlbum: AlbumDetail | null;
  selectedArtist: string | null;
  artists: Array<{ artist: string; songCount: number }>;
  playlists: PlaylistSummary[];
  selectedPlaylistId: string | null;
  selectedPlaylistName?: string | null;
  selectedPlaylistSongs: Song[];
  refreshStatus?: RefreshStatus | null;
  refreshPending: boolean;
  fullPlayerOpen: boolean;
  queueOpen: boolean;
  addToPlaylistOpen: boolean;
  createPlaylistOpen: boolean;
  refreshOpen: boolean;
  onTabChange: (tab: MobileTabKey) => void;
  onLibrarySectionChange: (section: MobileLibrarySection) => void;
  onSearchQueryChange: (value: string) => void;
  onSelectFilter: (filter: "all" | "tracks" | "albums" | "artists" | "playlists") => void;
  onClearRecentSearches: () => void;
  onPlayTrack: (song: Song, sourceQueue?: Song[]) => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleFavorite: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onOpenFullPlayer: () => void;
  onCloseFullPlayer: () => void;
  onOpenQueue: () => void;
  onCloseQueue: () => void;
  onClearQueue: () => void;
  onRemoveFromQueue: (songId: string) => void;
  onReorderQueue: (from: number, to: number) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onOpenCreatePlaylist: () => void;
  onCloseCreatePlaylist: () => void;
  onCreatePlaylist: () => void;
  onPlaylistNameChange: (value: string) => void;
  newPlaylistName: string;
  onOpenAddToPlaylist: () => void;
  onCloseAddToPlaylist: () => void;
  onAddTrackToPlaylist: (playlistId: string) => void;
  onOpenAlbum: (albumId: string) => void;
  onCloseAlbum: () => void;
  onOpenArtist: (artist: string) => void;
  onCloseArtist: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onClosePlaylist: () => void;
  onRenamePlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onOpenRefresh: () => void;
  onCloseRefresh: () => void;
  onRefreshCheck: () => void;
  onShareCurrent: () => void;
  onShowLyrics: () => void;
  onViewCurrentAlbum: () => void;
  onViewCurrentArtist: () => void;
  onPrefetchTrack?: (track: Song) => void;
};

function uniqueArtistAlbums(artist: string, albums: Album[], songs: Song[]) {
  const albumIds = new Set(
    songs.filter((song) => song.artist.toLowerCase().includes(artist.toLowerCase())).map((song) => song.albumId)
  );
  return albums.filter((album) => albumIds.has(album.albumId));
}

export default function MobileLayout(props: MobileLayoutProps) {
  const {
    appName,
    activeTab,
    librarySection,
    searchQuery,
    selectedFilter,
    recentSearches,
    currentSong,
    fallbackArt,
    currentTime,
    duration,
    volume,
    isPlaying,
    isShuffleOn,
    repeatMode,
    buffering,
    queue,
    favorites,
    recentlyPlayed,
    fullLibrary,
    albums,
    selectedAlbum,
    selectedArtist,
    artists,
    playlists,
    selectedPlaylistId,
    selectedPlaylistName,
    selectedPlaylistSongs,
    refreshStatus,
    refreshPending,
    fullPlayerOpen,
    queueOpen,
    addToPlaylistOpen,
    createPlaylistOpen,
    refreshOpen,
    onTabChange,
    onLibrarySectionChange,
    onSearchQueryChange,
    onSelectFilter,
    onClearRecentSearches,
    onPlayTrack,
    onTogglePlay,
    onPrevious,
    onNext,
    onSeek,
    onVolumeChange,
    onToggleFavorite,
    onToggleShuffle,
    onCycleRepeat,
    onOpenFullPlayer,
    onCloseFullPlayer,
    onOpenQueue,
    onCloseQueue,
    onClearQueue,
    onRemoveFromQueue,
    onReorderQueue,
    onOpenSearch,
    onCloseSearch,
    onOpenCreatePlaylist,
    onCloseCreatePlaylist,
    onCreatePlaylist,
    onPlaylistNameChange,
    newPlaylistName,
    onOpenAddToPlaylist,
    onCloseAddToPlaylist,
    onAddTrackToPlaylist,
    onOpenAlbum,
    onCloseAlbum,
    onOpenArtist,
    onCloseArtist,
    onOpenPlaylist,
    onClosePlaylist,
    onRenamePlaylist,
    onDeletePlaylist,
    onOpenRefresh,
    onCloseRefresh,
    onRefreshCheck,
    onShareCurrent,
    onShowLyrics,
    onViewCurrentAlbum,
    onViewCurrentArtist,
    onPrefetchTrack,
  } = props;

  // Heavy filtering keys off the *debounced* `searchQuery` (passed in from
  // App.tsx). The visible <input> stays bound to `searchInput`, so typing is
  // never blocked by 28k-row scans. We also cap every list so a wide query
  // doesn't try to render thousands of rows.
  const normalized = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const filteredSongs = useMemo(() => {
    // Prefer the backend's ranked tracks when present.
    if (props.searchTracks && props.searchTracks.length) return props.searchTracks.slice(0, 50);
    if (!normalized) return fullLibrary.slice(0, 20);
    const out: Song[] = [];
    for (const song of fullLibrary) {
      if ([song.title, song.artist, song.albumTitle, song.composer || ""].join(" ").toLowerCase().includes(normalized)) {
        out.push(song);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [fullLibrary, normalized, props.searchTracks]);

  const filteredAlbums = useMemo(() => {
    if (props.searchAlbums && props.searchAlbums.length) return props.searchAlbums.slice(0, 30);
    if (!normalized) return albums.slice(0, 20);
    return albums
      .filter((album) =>
        [album.name, album.musicDirector || "", album.singersSummary || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 30);
  }, [albums, normalized, props.searchAlbums]);

  const filteredArtists = useMemo(() => {
    if (props.searchArtists && props.searchArtists.length) return props.searchArtists.slice(0, 20);
    if (!normalized) return artists.slice(0, 20);
    return artists.filter((artist) => artist.artist.toLowerCase().includes(normalized)).slice(0, 20);
  }, [artists, normalized, props.searchArtists]);

  const filteredPlaylists = useMemo(() => {
    if (!normalized) return playlists;
    return playlists.filter((playlist) => playlist.name.toLowerCase().includes(normalized));
  }, [playlists, normalized]);

  const selectedArtistSongs = useMemo(
    () => (selectedArtist ? fullLibrary.filter((song) => song.artist.toLowerCase().includes(selectedArtist.toLowerCase())) : []),
    [fullLibrary, selectedArtist]
  );
  const selectedArtistAlbums = useMemo(
    () => (selectedArtist ? uniqueArtistAlbums(selectedArtist, albums, fullLibrary) : []),
    [selectedArtist, albums, fullLibrary]
  );

  let content = null;
  if (selectedAlbum) {
    content = <MobileAlbumDetail album={selectedAlbum} fallbackArt={fallbackArt} onBack={onCloseAlbum} onPlayTrack={onPlayTrack} />;
  } else if (selectedArtist) {
    content = (
      <MobileArtistDetail
        artist={selectedArtist}
        songs={selectedArtistSongs}
        albums={selectedArtistAlbums}
        fallbackArt={fallbackArt}
        onBack={onCloseArtist}
        onPlayTrack={onPlayTrack}
        onOpenAlbum={onOpenAlbum}
      />
    );
  } else if (selectedPlaylistId || activeTab === "library" && librarySection === "playlists") {
    content = (
      <MobilePlaylists
        playlists={playlists}
        selectedPlaylistId={selectedPlaylistId}
        selectedPlaylistName={selectedPlaylistName}
        selectedPlaylistSongs={selectedPlaylistSongs}
        onBack={onClosePlaylist}
        onCreatePlaylist={onOpenCreatePlaylist}
        onOpenPlaylist={onOpenPlaylist}
        onPlaySong={onPlayTrack}
        onRenamePlaylist={onRenamePlaylist}
        onDeletePlaylist={onDeletePlaylist}
      />
    );
  } else if (activeTab === "search") {
    content = (
      <MobileSearch
        // The <input> stays bound to the *unfiltered* `searchInput` so typing
        // is instant; results below derive from the debounced `searchQuery`.
        inputValue={props.searchInput}
        debouncedQuery={searchQuery}
        isSearching={props.searchActive}
        selectedFilter={selectedFilter}
        recentSearches={recentSearches}
        songs={filteredSongs}
        albums={filteredAlbums}
        artists={filteredArtists}
        composers={props.searchComposers ?? []}
        playlists={filteredPlaylists}
        fallbackArt={fallbackArt}
        onQueryChange={onSearchQueryChange}
        onClose={onCloseSearch}
        onSelectFilter={onSelectFilter}
        onClearHistory={onClearRecentSearches}
        onPlaySong={onPlayTrack}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onOpenPlaylist={onOpenPlaylist}
      />
    );
  } else if (activeTab === "library") {
    if (librarySection === "favorites") {
      content = (
        <div className="mobile-screen">
          <div className="mobile-screen__header">
            <div className="mobile-screen__header-left">
              <button type="button" onClick={() => onLibrarySectionChange("favorites")} aria-label="Favorites">
                ♥
              </button>
              <div>
                <strong>Favorites</strong>
                <span>{favorites.length} songs</span>
              </div>
            </div>
          </div>
          <div className="mobile-recent-list">
            {favorites.map((song) => (
              <button key={song.id} type="button" className="mobile-song-row" onClick={() => onPlayTrack(song, favorites)}>
                <img src={song.artworkUrl || fallbackArt} alt={song.title} />
                <div className="mobile-song-row__copy">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    } else if (librarySection === "recent") {
      content = (
        <div className="mobile-screen">
          <div className="mobile-screen__header">
            <div>
              <strong>Recently Played</strong>
              <span>{recentlyPlayed.length} songs</span>
            </div>
          </div>
          <div className="mobile-recent-list">
            {recentlyPlayed.map((song) => (
              <button key={song.id} type="button" className="mobile-song-row" onClick={() => onPlayTrack(song)}>
                <img src={song.artworkUrl || fallbackArt} alt={song.title} />
                <div className="mobile-song-row__copy">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    } else {
      content = (
        <MobileLibrary
          activeSection={librarySection}
          favoriteCount={favorites.length}
          playlistCount={playlists.length}
          albumCount={albums.length}
          artistCount={artists.length}
          recentCount={recentlyPlayed.length}
          onSectionChange={onLibrarySectionChange}
          onCreatePlaylist={onOpenCreatePlaylist}
        />
      );
    }
  } else {
    content = (
      <MobileHome
        appName={appName}
        recentlyPlayed={recentlyPlayed}
        refreshStatus={refreshStatus}
        searchQuery={props.searchInput}
        favoriteCount={favorites.length}
        playlists={playlists}
        onQueryChange={onSearchQueryChange}
        onOpenSearch={onOpenSearch}
        onOpenRefresh={onOpenRefresh}
        onOpenSettings={onOpenCreatePlaylist}
        onPlayTrack={onPlayTrack}
        onViewPlaylists={() => { onTabChange("library"); onLibrarySectionChange("playlists"); }}
        onViewRecent={() => { onTabChange("library"); onLibrarySectionChange("recent"); }}
        onOpenPlaylist={onOpenPlaylist}
        onOpenFavorites={() => { onTabChange("library"); onLibrarySectionChange("favorites"); }}
        onCreatePlaylist={onOpenCreatePlaylist}
        onPrefetchTrack={onPrefetchTrack}
      />
    );
  }

  return (
    <div className="mobile-layout">
      <div className="mobile-layout__content">{content}</div>

      {currentSong ? (
        <MobileMiniPlayer
          song={currentSong}
          artwork={currentSong.artworkUrl || fallbackArt}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          onPrevious={onPrevious}
          onNext={onNext}
          onOpenPlayer={onOpenFullPlayer}
        />
      ) : null}

      <MobileBottomNav activeTab={activeTab} onChange={onTabChange} />

      <MobileFullPlayer
        open={fullPlayerOpen}
        song={currentSong}
        artwork={currentSong?.artworkUrl || fallbackArt}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isPlaying={isPlaying}
        isShuffleOn={isShuffleOn}
        repeatMode={repeatMode}
        buffering={buffering}
        onClose={onCloseFullPlayer}
        onPlayPause={onTogglePlay}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        onVolumeChange={onVolumeChange}
        onToggleFavorite={onToggleFavorite}
        onToggleShuffle={onToggleShuffle}
        onCycleRepeat={onCycleRepeat}
        onOpenQueue={onOpenQueue}
        onOpenAddToPlaylist={onOpenAddToPlaylist}
        onViewAlbum={onViewCurrentAlbum}
        onViewArtist={onViewCurrentArtist}
        onShare={onShareCurrent}
        onShowLyrics={onShowLyrics}
      />

      <MobileQueueSheet
        open={queueOpen}
        queue={queue}
        currentSongId={currentSong?.id}
        fallbackArt={fallbackArt}
        onClose={onCloseQueue}
        onPlay={(song) => onPlayTrack(song, queue)}
        onClear={onClearQueue}
        onRemove={onRemoveFromQueue}
        onMove={onReorderQueue}
      />

      <MobileAddToPlaylistSheet
        open={addToPlaylistOpen}
        playlists={playlists}
        onClose={onCloseAddToPlaylist}
        onSelectPlaylist={onAddTrackToPlaylist}
        onCreateNew={onOpenCreatePlaylist}
      />

      <MobileCreatePlaylistSheet
        open={createPlaylistOpen}
        value={newPlaylistName}
        onChange={onPlaylistNameChange}
        onClose={onCloseCreatePlaylist}
        onCreate={onCreatePlaylist}
      />

      <MobileRefreshStatusSheet
        open={refreshOpen}
        status={refreshStatus}
        pending={refreshPending}
        onClose={onCloseRefresh}
        onCheck={onRefreshCheck}
      />
    </div>
  );
}
