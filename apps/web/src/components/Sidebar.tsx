import type { LucideIcon } from "lucide-react";
import { ChevronDown, Heart, Plus, Waves } from "lucide-react";

export type NavKey = "home" | "search" | "library" | "favorites" | "playlists" | "albums" | "artists";

type NavItem = {
  key: NavKey;
  label: string;
  icon: LucideIcon;
};

type PlaylistItem = {
  id: string;
  name: string;
  count: number;
};

type SidebarProps = {
  navItems: readonly NavItem[];
  activeNav: NavKey;
  favoriteCount: number;
  playlists: readonly PlaylistItem[];
  selectedPlaylistId: string | null;
  onNavChange: (nav: NavKey) => void;
  onFavoritesClick: () => void;
  onPlaylistClick: (playlistId: string) => void;
  onCreatePlaylist: () => void;
};

export default function Sidebar({
  navItems,
  activeNav,
  favoriteCount,
  playlists,
  selectedPlaylistId,
  onNavChange,
  onFavoritesClick,
  onPlaylistClick,
  onCreatePlaylist
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <Waves size={20} />
        </div>
        <div>
          <strong>Sruthi – ஸ்ருதி</strong>
          <span>Premium music dashboard</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={activeNav === item.key ? "sidebar__nav-item is-active" : "sidebar__nav-item"}
              onClick={() => onNavChange(item.key)}
            >
              <span className="sidebar__nav-icon">
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="sidebar__library">
        <div className="sidebar__section-label">YOUR LIBRARY</div>
        <div className="sidebar__library-list">
          <button className={activeNav === "favorites" ? "sidebar__library-item is-active" : "sidebar__library-item"} onClick={onFavoritesClick}>
            <div className="sidebar__library-item-main">
              <span className="sidebar__library-icon">
                <Heart size={15} />
              </span>
              <div>
                <strong>Favorites</strong>
                <span>{favoriteCount} songs</span>
              </div>
            </div>
          </button>
          {playlists.length ? (
            <div className="sidebar__playlist-list">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  className={selectedPlaylistId === playlist.id ? "sidebar__library-item is-active" : "sidebar__library-item"}
                  onClick={() => onPlaylistClick(playlist.id)}
                >
                  <div className="sidebar__library-item-main">
                    <div>
                      <strong>{playlist.name}</strong>
                      <span>{playlist.count} songs</span>
                    </div>
                  </div>
                  <ChevronDown size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="sidebar__library-empty">Create a playlist to keep your own mix here.</div>
          )}
        </div>
        <button className="sidebar__playlist-button" onClick={onCreatePlaylist}>
          <Plus size={16} />
          New Playlist
        </button>
      </section>
    </aside>
  );
}
