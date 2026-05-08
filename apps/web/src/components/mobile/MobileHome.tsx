import { ChevronRight, Heart, ListMusic, Play, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
import AppLogo from "../AppLogo";
import type { RefreshStatus, Song } from "../../types";

type PlaylistSummary = { id: string; name: string; count: number };

type MobileHomeProps = {
  appName: string;
  recentlyPlayed: Song[];
  refreshStatus?: RefreshStatus | null;
  searchQuery: string;
  favoriteCount: number;
  playlists: PlaylistSummary[];
  onQueryChange: (value: string) => void;
  onOpenSearch: () => void;
  onOpenRefresh: () => void;
  onOpenSettings: () => void;
  onPlayTrack: (track: Song, sourceQueue?: Song[]) => void;
  onViewPlaylists: () => void;
  onViewRecent: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onOpenFavorites: () => void;
  onCreatePlaylist: () => void;
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

const PLAYLIST_GRADIENTS = [
  "linear-gradient(135deg, #d85cff 0%, #ff69d8 100%)",
  "linear-gradient(135deg, #5b8def 0%, #d85cff 100%)",
  "linear-gradient(135deg, #ff8a3d 0%, #ff69d8 100%)",
  "linear-gradient(135deg, #36e1c4 0%, #5b8def 100%)",
  "linear-gradient(135deg, #ffd166 0%, #d85cff 100%)",
];

export default function MobileHome({
  appName,
  recentlyPlayed,
  refreshStatus,
  searchQuery,
  favoriteCount,
  playlists,
  onOpenSearch,
  onOpenRefresh,
  onOpenSettings,
  onPlayTrack,
  onViewPlaylists,
  onViewRecent,
  onOpenPlaylist,
  onOpenFavorites,
  onCreatePlaylist,
  onPrefetchTrack,
}: MobileHomeProps) {
  return (
    <div className="mobile-screen mobile-home">
      <header className="mobile-screen__header mobile-screen__header--branded">
        <div className="mobile-brand">
          <AppLogo size={40} />
          <div className="mobile-brand__copy">
            <strong>{appName}</strong>
            <span>Premium music player</span>
          </div>
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

      <button type="button" className="mobile-search-bar mobile-search-bar--button" onClick={onOpenSearch}>
        <Search size={18} className="mobile-search-bar__icon" />
        <span className="mobile-search-bar__placeholder">
          {searchQuery || "Search songs, albums, artists..."}
        </span>
        <small className="mobile-search-bar__status">{refreshLabel(refreshStatus)}</small>
      </button>

      <section className="mobile-section">
        <div className="mobile-section__header">
          <h2>Playlists</h2>
          <button type="button" onClick={onViewPlaylists}>
            View all
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="mobile-playlists-row">
          <button
            type="button"
            className="mobile-playlist-card mobile-playlist-card--favorites"
            onClick={onOpenFavorites}
          >
            <span className="mobile-playlist-card__art" style={{ background: "linear-gradient(135deg, #ff5e8a 0%, #d85cff 100%)" }}>
              <Heart size={28} fill="currentColor" />
            </span>
            <strong title="Favorites">Favorites</strong>
            <span>{favoriteCount} {favoriteCount === 1 ? "song" : "songs"}</span>
          </button>

          {playlists.map((playlist, index) => (
            <button
              key={playlist.id}
              type="button"
              className="mobile-playlist-card"
              onClick={() => onOpenPlaylist(playlist.id)}
            >
              <span
                className="mobile-playlist-card__art"
                style={{ background: PLAYLIST_GRADIENTS[index % PLAYLIST_GRADIENTS.length] }}
              >
                <ListMusic size={26} />
              </span>
              <strong title={playlist.name}>{playlist.name}</strong>
              <span>
                {playlist.count} {playlist.count === 1 ? "song" : "songs"}
              </span>
            </button>
          ))}

          <button type="button" className="mobile-playlist-card mobile-playlist-card--new" onClick={onCreatePlaylist}>
            <span className="mobile-playlist-card__art mobile-playlist-card__art--ghost">
              <Plus size={26} />
            </span>
            <strong>New playlist</strong>
            <span>Create your own</span>
          </button>
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
                <img src={track.artworkUrl || ""} alt={track.title} />
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
