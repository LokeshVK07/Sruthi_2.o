import { ChevronRight, Heart, Library, ListMusic, Disc3, Users, History } from "lucide-react";

type LibrarySectionKey = "favorites" | "playlists" | "albums" | "artists" | "recent";

type MobileLibraryProps = {
  activeSection: LibrarySectionKey;
  favoriteCount: number;
  playlistCount: number;
  albumCount: number;
  artistCount: number;
  recentCount: number;
  onSectionChange: (section: LibrarySectionKey) => void;
  onCreatePlaylist: () => void;
};

const items: Array<{ key: LibrarySectionKey; label: string; icon: typeof Heart; countKey: keyof Omit<MobileLibraryProps, "activeSection" | "onSectionChange" | "onCreatePlaylist"> }> = [
  { key: "favorites", label: "Favorites", icon: Heart, countKey: "favoriteCount" },
  { key: "playlists", label: "Playlists", icon: ListMusic, countKey: "playlistCount" },
  { key: "albums", label: "Albums", icon: Disc3, countKey: "albumCount" },
  { key: "artists", label: "Artists", icon: Users, countKey: "artistCount" },
  { key: "recent", label: "Recently Played", icon: History, countKey: "recentCount" },
];

export default function MobileLibrary({
  favoriteCount,
  playlistCount,
  albumCount,
  artistCount,
  recentCount,
  onSectionChange,
  onCreatePlaylist,
}: MobileLibraryProps) {
  const counts = { favoriteCount, playlistCount, albumCount, artistCount, recentCount };

  return (
    <div className="mobile-screen">
      <div className="mobile-screen__header">
        <div>
          <strong>Library</strong>
          <span>Your collections</span>
        </div>
        <div className="mobile-screen__header-actions">
          <button type="button" onClick={onCreatePlaylist} aria-label="Create playlist">
            +
          </button>
        </div>
      </div>

      <div className="mobile-library-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" className="mobile-library-card" onClick={() => onSectionChange(item.key)}>
              <span className="mobile-library-card__icon">
                <Icon size={18} />
              </span>
              <div className="mobile-library-card__copy">
                <strong>{item.label}</strong>
                <span>{counts[item.countKey]} items</span>
              </div>
              <ChevronRight size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
