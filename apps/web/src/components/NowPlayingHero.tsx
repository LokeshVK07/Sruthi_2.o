import { Heart, MoreHorizontal, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { Song } from "../types";
import type { RepeatMode } from "../store";

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
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Shrinks a heading's font-size so it fits within `maxLines` at any container
// width. The CSS uses `-webkit-line-clamp` which makes scrollHeight unreliable
// (it returns the clamped height, hiding the overflow), so we temporarily
// switch the node to plain block layout while measuring, then restore.
function useAutoShrinkHeading(text: string, minPx = 16, maxLines = 2) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.fontSize = "";

    const origDisplay = node.style.display;
    const origLineClamp = node.style.webkitLineClamp;
    node.style.display = "block";
    node.style.webkitLineClamp = "unset";

    const measure = () => {
      const computed = window.getComputedStyle(node);
      const fs = parseFloat(computed.fontSize) || 36;
      const lhRaw = computed.lineHeight;
      const lh = lhRaw === "normal" ? fs * 1.2 : parseFloat(lhRaw) || fs * 1.2;
      const maxH = lh * maxLines + 1;
      const overflowsHeight = node.scrollHeight > maxH;
      const overflowsWidth = node.scrollWidth > node.clientWidth + 1;
      return { fs, fits: !overflowsHeight && !overflowsWidth };
    };

    let { fs, fits } = measure();
    while (!fits && fs > minPx) {
      fs -= 1;
      node.style.fontSize = `${fs}px`;
      ({ fs, fits } = measure());
    }

    node.style.display = origDisplay;
    node.style.webkitLineClamp = origLineClamp;
  }, [text]);
  return ref;
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
  const titleText = song?.title ?? "Pick a song to start";
  const titleRef = useAutoShrinkHeading(titleText);
  const resolvedDuration = Number.isFinite(duration) && duration > 0 ? duration : song?.durationSeconds ?? 0;
  const hasDuration = resolvedDuration > 0;
  const progressPercent = hasDuration ? Math.min(100, Math.max(0, (currentTime / resolvedDuration) * 100)) : 0;
  // When duration is not yet loaded, peg the thumb to the start (value=0) so
  // it doesn't snap to the far right because the slider's effective max is 1.
  const progressValue = hasDuration ? Math.min(currentTime, resolvedDuration) : 0;
  const progressMax = hasDuration ? resolvedDuration : 1;
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
            <h1 ref={titleRef}>{titleText}</h1>
            <p>{song?.artist ?? "Your library is ready"}</p>
            <p>{orchestraLine}</p>
            <button className="hero__album-line" onClick={onViewAlbum} type="button">
              <span className="hero__album-dot" />
              <span>{albumLabel}</span>
            </button>
          </div>

          <div className="hero__controls">
            <button className={isShuffleOn ? "hero__icon is-active" : "hero__icon"} onClick={onToggleShuffle} aria-label="Shuffle">
              <Shuffle size={15} />
            </button>
            <button className="hero__icon" onClick={onPrevious} aria-label="Previous">
              <SkipBack size={15} />
            </button>
            <button className="hero__play" onClick={onPlayPause} aria-label="Play or pause">
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button className="hero__icon" onClick={onNext} aria-label="Next">
              <SkipForward size={15} />
            </button>
            <button className={repeatMode !== "off" ? "hero__icon is-active" : "hero__icon"} onClick={onCycleRepeat} aria-label="Repeat mode">
              <Repeat size={15} />
              {repeatMode === "one" ? <span className="hero__repeat-badge">1</span> : null}
            </button>
            <button className={song?.favorite ? "hero__icon is-active" : "hero__icon"} onClick={onToggleFavorite} aria-label="Favorite">
              <Heart size={15} fill={song?.favorite ? "currentColor" : "none"} />
            </button>
            <div className="hero__menu-wrap">
              <button className="hero__icon" onClick={onOpenMenu} aria-label="More options">
                <MoreHorizontal size={15} />
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
              <span className="hero__time">{formatTime(currentTime) || "0:00"}</span>
              <input
                type="range"
                min={0}
                max={progressMax}
                step={hasDuration ? 0.1 : 1}
                value={progressValue}
                disabled={!hasDuration}
                onChange={(event) => onSeek(Number(event.target.value))}
                style={{
                  background: `linear-gradient(90deg, #e056ff 0%, #ff6ee7 ${progressPercent}%, rgba(255,255,255,0.16) ${progressPercent}%, rgba(255,255,255,0.16) 100%)`
                }}
              />
              <span className="hero__time">{formatTime(resolvedDuration) || "—:—"}</span>
            </div>

            <div className="hero__volume">
              <button className="hero__icon" onClick={onToggleMute} aria-label="Toggle mute">
                {isMuted || volume <= 0.01 ? <VolumeX size={14} /> : <Volume2 size={14} />}
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
