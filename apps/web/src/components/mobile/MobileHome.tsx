import { RefreshCw, Settings2, Play, Pause, ChevronRight, AudioLines } from "lucide-react";
import type { Album, RefreshStatus, Song } from "../../types";

type MobileHomeProps = {
  appName: string;
  song: Song | null;
  artwork: string;
  favorites: Song[];
  recentlyPlayed: Song[];
  refreshStatus?: RefreshStatus | null;
  searchQuery: string;
  buffering: boolean;
  isPlaying: boolean;
  onQueryChange: (value: string) => void;
  onOpenSearch: () => void;
  onOpenRefresh: () => void;
  onOpenSettings: () => void;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onPlayTrack: (track: Song, sourceQueue?: Song[]) => void;
  onViewFavorites: () => void;
  onViewRecent: () => void;
  onPrefetchTrack?: (track: Song) => void;
};

function refreshLabel(refreshStatus?: RefreshStatus | null) {
  if (!refreshStatus) return "Idle";
  if (refreshStatus.status === "checking") return "Checking";
  if (refreshStatus.status === "downloading") return "Downloading";
  if (refreshStatus.status === "applying") return "Applying";
  if (refreshStatus.status === "updated") return "Updated";
  if (refreshStatus.status === "error") return "Failed";
  return "Idle";
}

export default function MobileHome({
  appName,
  song,
  artwork,
  favorites,
  recentlyPlayed,
  refreshStatus,
  searchQuery,
  buffering,
  isPlaying,
  onQueryChange,
  onOpenSearch,
  onOpenRefresh,
  onOpenSettings,
  onOpenPlayer,
  onTogglePlay,
  onPlayTrack,
  onViewFavorites,
  onViewRecent,
  onPrefetchTrack,
}: MobileHomeProps) {
  return (
    <div className="mobile-screen mobile-home">
      <header className="mobile-screen__header">
        <div>
          <strong>{appName}</strong>
          <span>Premium music player</span>
        </div>
        <div className="mobile-screen__header-actions">
          <button type="button" onClick={onOpenRefresh} aria-label="Refresh status">
            <RefreshCw size={18} />
          </button>
          <button type="button" onClick={onOpenSettings} aria-label="Settings">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <button type="button" className="mobile-search-trigger" onClick={onOpenSearch}>
        <span>{searchQuery || "Search songs, albums, artists..."}</span>
        <small>{refreshLabel(refreshStatus)}</small>
      </button>

      {song ? (
        <button type="button" className="mobile-now-playing" onClick={onOpenPlayer}>
          <img src={artwork} alt={song.title} />
          <div className="mobile-now-playing__copy">
            <span className="mobile-pill">NOW PLAYING</span>
            <strong title={song.title}>{song.title}</strong>
            <span title={song.artist}>{song.artist}</span>
            <small title={song.albumTitle}>{song.albumTitle}</small>
          </div>
          <div className="mobile-now-playing__actions">
            {buffering ? <AudioLines size={18} /> : null}
            <button
              type="button"
              className="mobile-now-playing__play"
              onClick={(event) => {
                event.stopPropagation();
                onTogglePlay();
              }}
              aria-label="Toggle playback"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
          </div>
        </button>
      ) : null}

      <section className="mobile-section">
        <div className="mobile-section__header">
          <h2>Favorites</h2>
          <button type="button" onClick={onViewFavorites}>
            View all
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="mobile-favorites-row">
          {favorites.slice(0, 8).map((track) => (
            <button
              key={track.id}
              type="button"
              className="mobile-favorite-card"
              onClick={() => onPlayTrack(track, favorites)}
              onMouseEnter={() => onPrefetchTrack?.(track)}
            >
              <img src={track.artworkUrl || artwork} alt={track.title} />
              <strong title={track.title}>{track.title}</strong>
              <span title={track.artist}>{track.artist}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mobile-section">
        <div className="mobile-section__header">
          <h2>Recently played</h2>
          <button type="button" onClick={onViewRecent}>
            View all
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="mobile-recent-list">
          {recentlyPlayed.length ? (
            recentlyPlayed.slice(0, 12).map((track) => (
              <button
                key={track.id}
                type="button"
                className="mobile-song-row"
                onClick={() => onPlayTrack(track)}
                onMouseEnter={() => onPrefetchTrack?.(track)}
              >
                <img src={track.artworkUrl || artwork} alt={track.title} />
                <div className="mobile-song-row__copy">
                  <strong title={track.title}>{track.title}</strong>
                  <span title={track.artist}>{track.artist}</span>
                </div>
                <span className="mobile-song-row__action">
                  <Play size={16} />
                </span>
              </button>
            ))
          ) : (
            <div className="mobile-empty-state">No songs played yet</div>
          )}
        </div>
      </section>
    </div>
  );
}
