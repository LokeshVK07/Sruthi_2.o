import { Heart, MoreHorizontal, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import type { Song } from "../types.js";
import type { RepeatMode } from "../store.js";

type NowPlayingHeroProps = {
  song: Song | null;
  artwork: string;
  background: string;
  orchestraLine: string;
  albumLabel: string;
  isPlaying: boolean;
  isShuffleOn: boolean;
  repeatMode: RepeatMode;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  buffering: boolean;
  menuOpen: boolean;
  playlists: Array<{ id: string; name: string; count: number }>;
  feedback?: string | null;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onSeek: (time: number) => void;
  onOpenMenu: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onAddToQueue: () => void;
  onViewAlbum: () => void;
  onShare: () => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function NowPlayingHero({
  song,
  artwork,
  background,
  orchestraLine,
  albumLabel,
  isPlaying,
  isShuffleOn,
  repeatMode,
  isMuted,
  volume,
  currentTime,
  duration,
  buffering,
  menuOpen,
  playlists,
  feedback,
  onPlayPause,
  onPrevious,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onToggleFavorite,
  onToggleMute,
  onVolumeChange,
  onSeek,
  onOpenMenu,
  onAddToPlaylist,
  onAddToQueue,
  onViewAlbum,
  onShare
}: NowPlayingHeroProps) {
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, (isMuted ? 0 : volume) * 100));

  return (
    <section className="hero-card">
      <div className="hero-card__glow" style={{ backgroundImage: `url(${background})` }} aria-hidden="true" />
      <div className="hero">
        <div className="hero__cover-wrap">
          <img className="hero__cover" src={artwork} alt={song?.title ?? "Now playing"} />
        </div>

        <div className="hero__body">
          <div className="hero__copy">
            <span className="hero__eyebrow">NOW PLAYING</span>
            <h1>{song?.title ?? "Pick a song to start"}</h1>
            <p>{song?.artist ?? "Your library is ready"}</p>
            <p>{orchestraLine}</p>
            <button className="hero__album-line" onClick={onViewAlbum} type="button">
              <span className="hero__album-dot" />
              <span>{albumLabel}</span>
            </button>
          </div>

          <div className="hero__controls">
            <button className={isShuffleOn ? "hero__icon is-active" : "hero__icon"} onClick={onToggleShuffle} aria-label="Shuffle">
              <Shuffle size={18} />
            </button>
            <button className="hero__icon" onClick={onPrevious} aria-label="Previous">
              <SkipBack size={18} />
            </button>
            <button className="hero__play" onClick={onPlayPause} aria-label="Play or pause">
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button className="hero__icon" onClick={onNext} aria-label="Next">
              <SkipForward size={18} />
            </button>
            <button className={repeatMode !== "off" ? "hero__icon is-active" : "hero__icon"} onClick={onCycleRepeat} aria-label="Repeat mode">
              <Repeat size={18} />
              {repeatMode === "one" ? <span className="hero__repeat-badge">1</span> : null}
            </button>
            <button className={song?.favorite ? "hero__icon is-active" : "hero__icon"} onClick={onToggleFavorite} aria-label="Favorite">
              <Heart size={18} fill={song?.favorite ? "currentColor" : "none"} />
            </button>
            <div className="hero__menu-wrap">
              <button className="hero__icon" onClick={onOpenMenu} aria-label="More options">
                <MoreHorizontal size={18} />
              </button>
              {menuOpen ? (
                <div className="hero__menu">
                  <div className="hero__menu-section">
                    <div className="hero__menu-label">Add to playlist</div>
                    {playlists.length ? (
                      playlists.map((playlist) => (
                        <button key={playlist.id} onClick={() => onAddToPlaylist(playlist.id)}>
                          {playlist.name}
                          <span>{playlist.count}</span>
                        </button>
                      ))
                    ) : (
                      <div className="hero__menu-empty">No playlists yet</div>
                    )}
                  </div>
                  <button onClick={onAddToQueue}>Add to queue</button>
                  <button onClick={onViewAlbum}>View album</button>
                  <button onClick={onShare}>Share</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="hero__sliders">
            <div className="hero__progress">
              <span className="hero__time">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 1)}
                value={Math.min(currentTime, Math.max(duration, 1))}
                onChange={(event) => onSeek(Number(event.target.value))}
                style={{
                  background: `linear-gradient(90deg, #e056ff 0%, #ff6ee7 ${progressPercent}%, rgba(255,255,255,0.16) ${progressPercent}%, rgba(255,255,255,0.16) 100%)`
                }}
              />
              <span className="hero__time">{formatTime(duration)}</span>
            </div>

            <div className="hero__volume">
              <button className="hero__icon" onClick={onToggleMute} aria-label="Toggle mute">
                {isMuted || volume <= 0.01 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                style={{
                  background: `linear-gradient(90deg, #e056ff 0%, #ff6ee7 ${volumePercent}%, rgba(255,255,255,0.16) ${volumePercent}%, rgba(255,255,255,0.16) 100%)`
                }}
              />
            </div>
          </div>

          {feedback ? <div className="hero__feedback">{feedback}</div> : null}
        </div>
      </div>
    </section>
  );
}
