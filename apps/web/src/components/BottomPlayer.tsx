import type { CSSProperties } from "react";
import { Heart, ListMusic, Maximize2, MoreHorizontal, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import type { Song } from "../types";
import type { RepeatMode } from "../store";
import AbstractCover from "./AbstractCover";

type BottomPlayerProps = {
  song: Song | null;
  isPlaying: boolean;
  isShuffleOn: boolean;
  repeatMode: RepeatMode;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onSeek: (time: number) => void;
  onToggleQueue: () => void;
  onOpenMenu: () => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function BottomPlayer({
  song,
  isPlaying,
  isShuffleOn,
  repeatMode,
  isMuted,
  volume,
  currentTime,
  duration,
  onPlayPause,
  onPrevious,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onToggleFavorite,
  onToggleMute,
  onVolumeChange,
  onSeek,
  onToggleQueue,
  onOpenMenu,
}: BottomPlayerProps) {
  const resolvedDuration = Number.isFinite(duration) && duration > 0 ? duration : song?.durationSeconds ?? 0;
  const hasDuration = resolvedDuration > 0;
  const progressPercent = hasDuration ? Math.min(100, Math.max(0, (currentTime / resolvedDuration) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, (isMuted ? 0 : volume) * 100));

  return (
    <footer className="bottom-player">
      <div className="bottom-player__track">
        <AbstractCover seed={song?.id || song?.title} size="sm" variant="wave" active={isPlaying} />
        <div className="bottom-player__copy">
          <strong title={song?.title}>{song?.title ?? "Pick a song"}</strong>
          <span title={song?.artist}>{song?.artist ?? "Your Tamil vault"}</span>
        </div>
        <button className={song?.favorite ? "player-icon is-active" : "player-icon"} onClick={onToggleFavorite} aria-label="Favorite">
          <Heart size={19} fill={song?.favorite ? "currentColor" : "none"} />
        </button>
        <button className="player-icon" onClick={onOpenMenu} aria-label="More options">
          <MoreHorizontal size={20} />
        </button>
      </div>

      <div className="bottom-player__center">
        <div className="bottom-player__controls">
          <button className={isShuffleOn ? "player-icon is-active" : "player-icon"} onClick={onToggleShuffle} aria-label="Shuffle">
            <Shuffle size={18} />
          </button>
          <button className="player-icon" onClick={onPrevious} aria-label="Previous">
            <SkipBack size={20} />
          </button>
          <button className="player-play" onClick={onPlayPause} aria-label="Play or pause">
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button className="player-icon" onClick={onNext} aria-label="Next">
            <SkipForward size={20} />
          </button>
          <button className={repeatMode !== "off" ? "player-icon is-active" : "player-icon"} onClick={onCycleRepeat} aria-label="Repeat">
            <Repeat size={18} />
            {repeatMode === "one" ? <span className="player-icon__badge">1</span> : null}
          </button>
        </div>
        <div className="bottom-player__progress">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={hasDuration ? resolvedDuration : 1}
            step={hasDuration ? 0.1 : 1}
            value={hasDuration ? Math.min(currentTime, resolvedDuration) : 0}
            disabled={!hasDuration}
            onChange={(event) => onSeek(Number(event.target.value))}
            style={{ "--range-fill": `${progressPercent}%` } as CSSProperties}
          />
          <span>{hasDuration ? formatTime(resolvedDuration) : "—:—"}</span>
        </div>
      </div>

      <div className="bottom-player__tools">
        <button className="player-icon" aria-label="Device">
          <Maximize2 size={18} />
        </button>
        <button className="player-icon" onClick={onToggleMute} aria-label="Mute">
          {isMuted || volume <= 0.01 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          className="bottom-player__volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={isMuted ? 0 : volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          style={{ "--range-fill": `${volumePercent}%` } as CSSProperties}
        />
        <button className="player-icon" onClick={onToggleQueue} aria-label="Queue">
          <ListMusic size={20} />
        </button>
      </div>
    </footer>
  );
}
