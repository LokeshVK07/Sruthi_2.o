import { ChevronUp, Pause, Play, ListMusic } from "lucide-react";
import type { Song } from "../../types";

type MobileMiniPlayerProps = {
  song: Song;
  artwork: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
};

export default function MobileMiniPlayer({
  song,
  artwork,
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onOpenPlayer,
  onOpenQueue,
}: MobileMiniPlayerProps) {
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="mobile-mini-player">
      <button type="button" className="mobile-mini-player__main" onClick={onOpenPlayer}>
        <img src={artwork} alt={song.title} />
        <div className="mobile-mini-player__copy">
          <strong title={song.title}>{song.title}</strong>
          <span title={song.artist}>{song.artist}</span>
          <div className="mobile-mini-player__bar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </button>
      <div className="mobile-mini-player__actions">
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenQueue(); }} aria-label="Open queue">
          <ListMusic size={18} />
        </button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onTogglePlay(); }} aria-label="Toggle playback">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenPlayer(); }} aria-label="Expand player">
          <ChevronUp size={18} />
        </button>
      </div>
    </div>
  );
}
