import { ChevronRight, Play } from "lucide-react";
import type { Song } from "../types.js";

type ViewMode = "grid" | "list";

type RecentlyPlayedProps = {
  title: string;
  songs: Song[];
  viewMode: ViewMode;
  fallbackArt: string;
  onSelect: (song: Song) => void;
  onViewAll: () => void;
};

export default function RecentlyPlayed({ title, songs, viewMode, fallbackArt, onSelect, onViewAll }: RecentlyPlayedProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <h2>{title}</h2>
        <button className="section-link" onClick={onViewAll}>
          View all
          <ChevronRight size={16} />
        </button>
      </div>

      <div className={viewMode === "grid" ? "recent-grid" : "recent-list"}>
        {songs.map((song) => (
          <button key={song.id} className={viewMode === "grid" ? "recent-card" : "recent-row"} onClick={() => onSelect(song)}>
            <div className="recent-card__media">
              <img src={song.artworkUrl || fallbackArt} alt={song.title} />
              <span className="recent-card__play">
                <Play size={15} />
              </span>
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
