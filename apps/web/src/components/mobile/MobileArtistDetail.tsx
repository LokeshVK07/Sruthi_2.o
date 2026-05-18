import { ChevronLeft } from "lucide-react";
import type { Album, Song } from "../../types";

type MobileArtistDetailProps = {
  artist: string;
  songs: Song[];
  albums: Album[];
  fallbackArt: string;
  onBack: () => void;
  onPlayTrack: (track: Song, sourceQueue?: Song[]) => void;
  onOpenAlbum: (albumId: string) => void;
};

export default function MobileArtistDetail({
  artist,
  songs,
  albums,
  fallbackArt,
  onBack,
  onPlayTrack,
  onOpenAlbum,
}: MobileArtistDetailProps) {
  return (
    <div className="mobile-screen">
      <div className="mobile-screen__header">
        <div className="mobile-screen__header-left">
          <button type="button" onClick={onBack} aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>{artist}</strong>
            <span>{songs.length} songs</span>
          </div>
        </div>
      </div>

      <section className="mobile-section">
        <h2>Popular songs</h2>
        <div className="mobile-recent-list">
          {songs.slice(0, 12).map((song) => (
            <button key={song.id} type="button" className="mobile-song-row" onClick={() => onPlayTrack(song, songs)}>
              <img src={song.artworkUrl || fallbackArt} alt={song.title} />
              <div className="mobile-song-row__copy">
                <strong>{song.title}</strong>
                <span>{song.albumTitle}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mobile-section">
        <h2>Albums</h2>
        <div className="mobile-favorites-row">
          {albums.map((album) => (
            <button key={album.albumId} type="button" className="mobile-favorite-card" onClick={() => onOpenAlbum(album.albumId)}>
              <img src={album.imageUrl || fallbackArt} alt={album.name} />
              <strong>{album.name}</strong>
              <span>{album.musicDirector || "Album"}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
