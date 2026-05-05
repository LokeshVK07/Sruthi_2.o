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
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function MobileFullPlayer(props: MobileFullPlayerProps) {
  const {
    open,
    song,
    artwork,
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

        <img className="mobile-full-player__artwork" src={artwork} alt={song.title} />

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
            max={Math.max(duration, 1)}
            value={Math.min(currentTime, Math.max(duration, 1))}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
          <div className="mobile-full-player__times">
            <span>{formatTime(currentTime)}</span>
            <span>{buffering ? "Buffering…" : formatTime(duration)}</span>
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
