import { ChevronLeft, Play, Shuffle } from "lucide-react";
import type { AlbumDetail, Song } from "../../types";
import AbstractCover from "../AbstractCover";

type MobileAlbumDetailProps = {
  album: AlbumDetail;
  fallbackArt: string;
  onBack: () => void;
  onPlayTrack: (track: Song, sourceQueue?: Song[]) => void;
};

export default function MobileAlbumDetail({ album, fallbackArt: _fallbackArt, onBack, onPlayTrack }: MobileAlbumDetailProps) {
  return (
    <div className="mobile-screen">
      <div className="mobile-screen__header">
        <div className="mobile-screen__header-left">
          <button type="button" onClick={onBack} aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>{album.name}</strong>
            <span>{album.trackCount} songs</span>
          </div>
        </div>
      </div>

      <div className="mobile-album-hero">
        <AbstractCover seed={album.albumId || album.name} size="lg" className="mobile-artwork" />
        <div>
          <strong>{album.name}</strong>
          <span>{album.musicDirector || album.singersSummary || "Tamil soundtrack"}</span>
          <small>{album.year || "Tamil"} • {album.trackCount} tracks</small>
        </div>
      </div>

      <div className="mobile-album-actions">
        <button type="button" onClick={() => album.songs[0] && onPlayTrack(album.songs[0], album.songs)}>
          <Play size={16} />
          Play All
        </button>
        <button type="button" onClick={() => album.songs[0] && onPlayTrack(album.songs[Math.floor(Math.random() * album.songs.length)] || album.songs[0], album.songs)}>
          <Shuffle size={16} />
          Shuffle
        </button>
      </div>

      <div className="mobile-recent-list">
        {album.songs.map((song, index) => (
          <button key={song.id} type="button" className="mobile-song-row" onClick={() => onPlayTrack(song, album.songs)}>
            <span className="mobile-song-row__index">{index + 1}</span>
            <div className="mobile-song-row__copy">
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
