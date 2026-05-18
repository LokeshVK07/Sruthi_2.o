import { Heart, Keyboard, MoreHorizontal } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { Song } from "../types";
import type { RepeatMode } from "../store";
import AbstractCover from "./AbstractCover";

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
  onOpenShortcuts: () => void;
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
  onOpenShortcuts,
  onShare
}: NowPlayingHeroProps) {
  const titleText = song?.title ?? "Pick a song to start";
  const titleRef = useAutoShrinkHeading(titleText);
  const year = song?.year ? String(song.year) : "Tamil";

  return (
    <section className="hero-card">
      <div className="hero">
        <div className="hero__cover-wrap">
          <AbstractCover seed={song?.id || song?.title} size="hero" variant="wave" active={isPlaying} />
        </div>

        <div className="hero__body">
          <div className="hero__copy">
            <span className="hero__eyebrow">NOW PLAYING</span>
            <h1 ref={titleRef}>{titleText}</h1>
            <p>{song?.artist ?? "Your library is ready"}</p>
            <button className="hero__album-line" onClick={onViewAlbum} type="button">
              <span>From the album</span>
              <strong>{albumLabel}</strong>
            </button>
            <div className="hero__chips">
              <span>{orchestraLine || "Tamil soundtrack"}</span>
              <span>{year}</span>
            </div>
          </div>

          <div className="hero__controls">
            <button className={song?.favorite ? "hero__icon is-active" : "hero__icon"} onClick={onToggleFavorite} aria-label="Favorite">
              <Heart size={22} fill={song?.favorite ? "currentColor" : "none"} />
            </button>
            <div className="hero__menu-wrap">
              <button className="hero__icon" onClick={onOpenMenu} aria-label="More options">
                <MoreHorizontal size={22} />
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
                  <button onClick={onOpenShortcuts}>
                    Keyboard shortcuts
                    <Keyboard size={13} />
                  </button>
                  <button onClick={onShare}>Share</button>
                </div>
              ) : null}
            </div>
          </div>

          {feedback ? <div className="hero__feedback">{feedback}</div> : null}
        </div>
      </div>
    </section>
  );
}
