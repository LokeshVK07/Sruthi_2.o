import { ChevronRight, Play } from "lucide-react";
import type { Song } from "../types";
import AbstractCover from "./AbstractCover";

type ViewMode = "grid" | "list";
type Layout = "grid" | "row";

type RecentlyPlayedProps = {
  title: string;
  tracks: Song[];
  viewMode: ViewMode;
  fallbackArt: string;
  currentTrackId?: string;
  layout?: Layout;
  emptyHint?: string;
  onPlayTrack: (track: Song) => void;
  onPrefetchTrack?: (track: Song) => void;
  onViewAll: () => void;
};

export default function RecentlyPlayed({
  title,
  tracks,
  viewMode,
  fallbackArt,
  currentTrackId,
  layout = "grid",
  emptyHint = "No songs played yet",
  onPlayTrack,
  onPrefetchTrack,
  onViewAll
}: RecentlyPlayedProps) {
  const isRow = layout === "row";
  const cardClass = isRow || viewMode === "grid" ? "recent-card" : "recent-row";
  const containerClass = isRow ? "recent-row-scroll" : viewMode === "grid" ? "recent-grid" : "recent-list";

  return (
    <section className="content-section">
      <div className="section-header">
        <h2>{title}</h2>
        <button className="section-link" onClick={onViewAll}>
          View all
          <ChevronRight size={14} />
        </button>
      </div>

      {tracks.length ? (
        <div className={containerClass}>
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              className={track.id === currentTrackId ? `${cardClass} is-active` : cardClass}
              onClick={() => onPlayTrack(track)}
              onMouseEnter={() => onPrefetchTrack?.(track)}
            >
              <div className="recent-card__media">
                <AbstractCover seed={track.id || track.title} size="md" active={track.id === currentTrackId} />
                <span className="recent-card__play" aria-hidden="true">
                  <Play size={12} />
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
        <div className="content-section__hint">{emptyHint}</div>
      )}
    </section>
  );
}
