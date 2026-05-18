import type { LucideIcon } from "lucide-react";
import { Download, Heart, History, Leaf, Moon, Music2, Plus, Radio, Sprout, Waves } from "lucide-react";

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
  const libraryItems = [
    { key: "favorites" as const, label: "Favorites", icon: Heart, onClick: onFavoritesClick },
    { key: "recent" as const, label: "Recently Played", icon: History, onClick: () => onNavChange("library") },
    { key: "downloaded" as const, label: "Downloaded", icon: Download, onClick: () => onNavChange("library") },
    { key: "new" as const, label: "New Playlist", icon: Plus, onClick: onCreatePlaylist },
  ];
  const browseItems = [
    { label: "Focus", icon: Radio },
    { label: "Relax", icon: Waves },
    { label: "Nature", icon: Sprout },
    { label: "Sleep", icon: Moon },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <Leaf size={24} />
        </div>
        <div>
          <strong>ViBe 2.o</strong>
        </div>
      </div>

      <div className="sidebar__section-label">MAIN</div>
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
          {libraryItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={item.key === "favorites" && activeNav === "favorites" ? "sidebar__library-item is-active" : "sidebar__library-item"}
                onClick={item.onClick}
              >
                <span className="sidebar__library-icon">
                  <Icon size={17} />
                </span>
                <span>{item.label}</span>
                {item.key === "favorites" ? <small>{favoriteCount}</small> : null}
              </button>
            );
          })}
          {playlists.slice(0, 3).map((playlist) => (
            <button
              key={playlist.id}
              className={selectedPlaylistId === playlist.id ? "sidebar__library-item is-active" : "sidebar__library-item"}
              onClick={() => onPlaylistClick(playlist.id)}
            >
              <span className="sidebar__library-icon">
                <Music2 size={16} />
              </span>
              <span>{playlist.name}</span>
              <small>{playlist.count}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar__browse">
        <div className="sidebar__section-label">BROWSE</div>
        {browseItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} className="sidebar__library-item" onClick={() => onNavChange("library")}>
              <span className="sidebar__library-icon">
                <Icon size={17} />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </section>

      <button className="sidebar__breath-card" type="button" onClick={() => onNavChange("library")}>
        <span className="sidebar__breath-icon">
          <Sprout size={48} />
        </span>
        <span>
          <strong>Take a breath</strong>
          <small>Nature sounds to calm your mind.</small>
        </span>
        <span className="sidebar__breath-play">
          <Music2 size={16} />
        </span>
      </button>
    </aside>
  );
}
