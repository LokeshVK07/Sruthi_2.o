import { Play, ChevronRight } from "lucide-react";
import type { Song } from "../types.js";

export type SmartPick = {
  id: string;
  title: string;
  subtitle: string;
  song: Song;
};

type SmartPicksProps = {
  picks: SmartPick[];
  fallbackArt: string;
  onPick: (song: Song) => void;
  onViewAll: () => void;
};

export default function SmartPicks({ picks, fallbackArt, onPick, onViewAll }: SmartPicksProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <h2>Smart picks for you</h2>
        <button className="section-link" onClick={onViewAll}>
          View all
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="smart-picks">
        {picks.map((pick) => (
          <button key={pick.id} className="smart-pick" onClick={() => onPick(pick.song)}>
            <img src={pick.song.artworkUrl || fallbackArt} alt={pick.title} />
            <div className="smart-pick__copy">
              <strong>{pick.title}</strong>
              <span>{pick.subtitle}</span>
            </div>
            <span className="smart-pick__play">
              <Play size={14} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
