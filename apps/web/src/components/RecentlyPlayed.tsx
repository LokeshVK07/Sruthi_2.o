import { ChevronRight, Play } from "lucide-react";
import type { Song } from "../types.js";

type ViewMode = "grid" | "list";

type RecentlyPlayedProps = {
  title: string;
  tracks: Song[];
  viewMode: ViewMode;
  fallbackArt: string;
  currentTrackId?: string;
  onPlayTrack: (track: Song) => void;
  onViewAll: () => void;
};

export default function RecentlyPlayed({ title, tracks, viewMode, fallbackArt, currentTrackId, onPlayTrack, onViewAll }: RecentlyPlayedProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <h2>{title}</h2>
        <button className="section-link" onClick={onViewAll}>
          View all
          <ChevronRight size={16} />
        </button>
      </div>

      {tracks.length ? (
        <div className={viewMode === "grid" ? "recent-grid" : "recent-list"}>
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              className={
                viewMode === "grid"
                  ? track.id === currentTrackId
                    ? "recent-card is-active"
                    : "recent-card"
                  : track.id === currentTrackId
                    ? "recent-row is-active"
                    : "recent-row"
              }
              onClick={() => onPlayTrack(track)}
            >
              <div className="recent-card__media">
                <img src={track.artworkUrl || fallbackArt} alt={track.title} />
                <span className="recent-card__play" aria-hidden="true">
                  <Play size={15} />
                </span>
              </div>
              <div className="recent-card__action">
                <div className="recent-card__copy">
                  <strong title={track.title}>{track.title}</strong>
                  <span title={track.artist}>{track.artist}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="content-section__hint">No songs played yet</div>
      )}
    </section>
  );
}
