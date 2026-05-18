import {
  ChevronDown,
  Heart,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import type { Song } from "../../types";
import type { RepeatMode } from "../../store";
import AbstractCover from "../AbstractCover";

type MobileFullPlayerProps = {
  open: boolean;
  song: Song | null;
  artwork: string;
  currentTime: number;
  duration: number;
  volume: number;
  isPlaying: boolean;
  isShuffleOn: boolean;
  repeatMode: RepeatMode;
  buffering: boolean;
  onClose: () => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleFavorite: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onOpenQueue: () => void;
  onOpenAddToPlaylist: () => void;
  onViewAlbum: () => void;
  onViewArtist: () => void;
  onShare: () => void;
  onShowLyrics: () => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function MobileFullPlayer(props: MobileFullPlayerProps) {
  const {
    open,
    song,
    artwork: _artwork,
    currentTime,
    duration,
    volume,
    isPlaying,
    isShuffleOn,
    repeatMode,
    buffering,
    onClose,
    onPlayPause,
    onPrevious,
    onNext,
    onSeek,
    onVolumeChange,
    onToggleFavorite,
    onToggleShuffle,
    onCycleRepeat,
    onOpenQueue,
    onOpenAddToPlaylist,
    onViewAlbum,
    onViewArtist,
    onShare,
    onShowLyrics,
  } = props;

  if (!open || !song) return null;

  // The browser sometimes reports `duration` as Infinity for partially-buffered
  // MP3s without a Xing/VBR header, or as 0 before metadata loads. Reject
  // anything non-finite so the thumb stays at the start instead of pinning to
  // the right end of the track.
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const safeDuration = hasDuration ? duration : 0;
  const progressPercent = hasDuration
    ? Math.min(100, Math.max(0, (currentTime / safeDuration) * 100))
    : 0;
  const progressMax = hasDuration ? safeDuration : 1;
  const progressValue = hasDuration ? Math.min(currentTime, safeDuration) : 0;

  return (
    <div className="mobile-overlay">
      <div className="mobile-full-player">
        <div className="mobile-full-player__header">
          <button type="button" onClick={onClose} aria-label="Close player">
            <ChevronDown size={22} />
          </button>
          <strong>Now Playing</strong>
          <button type="button" onClick={onShare} aria-label="Share track">
            <Share2 size={18} />
          </button>
        </div>

        <AbstractCover seed={song.id || song.title} size="hero" className="mobile-full-player__artwork" />

        <div className="mobile-full-player__copy">
          <strong title={song.title}>{song.title}</strong>
          <span title={song.artist}>{song.artist}</span>
          <button type="button" onClick={onViewAlbum} className="mobile-full-player__album">
            {song.albumTitle}
          </button>
        </div>

        <div className="mobile-full-player__progress">
          <input
            type="range"
            min={0}
            max={progressMax}
            step={hasDuration ? 0.1 : 1}
            value={progressValue}
            disabled={!hasDuration}
            onChange={(event) => onSeek(Number(event.target.value))}
            style={{
              background: `linear-gradient(90deg, #e056ff 0%, #ff6ee7 ${progressPercent}%, rgba(255,255,255,0.16) ${progressPercent}%, rgba(255,255,255,0.16) 100%)`,
            }}
          />
          <div className="mobile-full-player__times">
            <span>{formatTime(currentTime) || "0:00"}</span>
            <span>{buffering ? "Buffering…" : formatTime(safeDuration) || "—:—"}</span>
          </div>
        </div>

        <div className="mobile-full-player__controls">
          <button type="button" className={isShuffleOn ? "is-active" : ""} onClick={onToggleShuffle} aria-label="Shuffle">
            <Shuffle size={18} />
          </button>
          <button type="button" onClick={onPrevious} aria-label="Previous track">
            <SkipBack size={20} />
          </button>
          <button type="button" className="mobile-full-player__play" onClick={onPlayPause} aria-label="Play or pause">
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button type="button" onClick={onNext} aria-label="Next track">
            <SkipForward size={20} />
          </button>
          <button type="button" className={repeatMode !== "off" ? "is-active" : ""} onClick={onCycleRepeat} aria-label="Repeat mode">
            <Repeat size={18} />
          </button>
        </div>

        <div className="mobile-full-player__volume">
          <Volume2 size={18} />
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} />
        </div>

        <div className="mobile-full-player__actions">
          <button type="button" onClick={onToggleFavorite} className={song.favorite ? "is-active" : ""}>
            <Heart size={16} />
            Favorite
          </button>
          <button type="button" onClick={onOpenAddToPlaylist}>
            <ListMusic size={16} />
            Playlist
          </button>
          <button type="button" onClick={onOpenQueue}>
            <ListMusic size={16} />
            Queue
          </button>
          <button type="button" onClick={onShowLyrics}>
            <MoreHorizontal size={16} />
            Lyrics
          </button>
          <button type="button" onClick={onViewArtist}>
            <MoreHorizontal size={16} />
            Artist
          </button>
        </div>
      </div>
    </div>
  );
}
