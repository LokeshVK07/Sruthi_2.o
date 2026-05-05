import { Search, X, Filter } from "lucide-react";
import type { Album, Song } from "../../types";

type FilterKey = "all" | "tracks" | "albums" | "artists" | "playlists";

type MobileSearchProps = {
  query: string;
  selectedFilter: FilterKey;
  recentSearches: string[];
  songs: Song[];
  albums: Album[];
  artists: Array<{ artist: string; songCount: number }>;
  playlists: Array<{ id: string; name: string; count: number }>;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onSelectFilter: (filter: FilterKey) => void;
  onClearHistory: () => void;
  onPlaySong: (song: Song) => void;
  onOpenAlbum: (albumId: string) => void;
  onOpenArtist: (artist: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
};

const filters: FilterKey[] = ["all", "tracks", "albums", "artists", "playlists"];

export default function MobileSearch({
  query,
  selectedFilter,
  recentSearches,
  songs,
  albums,
  artists,
  playlists,
  onQueryChange,
  onClose,
  onSelectFilter,
  onClearHistory,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: MobileSearchProps) {
  return (
    <div className="mobile-screen mobile-search-screen">
      <div className="mobile-search-screen__bar">
        <label className="mobile-search-screen__input">
          <Search size={18} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search songs, albums, artists..." />
        </label>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>

      <div className="mobile-search-screen__filters">
        {filters.map((filter) => (
          <button key={filter} type="button" className={selectedFilter === filter ? "is-active" : ""} onClick={() => onSelectFilter(filter)}>
            <Filter size={14} />
            {filter}
          </button>
        ))}
      </div>

      {!query.trim() ? (
        <>
          <div className="mobile-section__header">
            <h2>Recent searches</h2>
            <button type="button" onClick={onClearHistory}>Clear</button>
          </div>
          <div className="mobile-search-history">
            {recentSearches.length ? recentSearches.map((item) => (
              <button key={item} type="button" onClick={() => onQueryChange(item)}>{item}</button>
            )) : <div className="mobile-empty-state">No recent searches</div>}
          </div>
        </>
      ) : null}

      {selectedFilter === "all" || selectedFilter === "tracks" ? (
        <section className="mobile-section">
          <h2>Tracks</h2>
          {songs.map((song) => (
            <button key={song.id} type="button" className="mobile-result-row" onClick={() => onPlaySong(song)}>
              <img src={song.artworkUrl || ""} alt={song.title} />
              <div>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {selectedFilter === "all" || selectedFilter === "albums" ? (
        <section className="mobile-section">
          <h2>Albums</h2>
          {albums.map((album) => (
            <button key={album.albumId} type="button" className="mobile-result-row" onClick={() => onOpenAlbum(album.albumId)}>
              <img src={album.imageUrl || ""} alt={album.name} />
              <div>
                <strong>{album.name}</strong>
                <span>{album.musicDirector || album.singersSummary || "Album"}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {selectedFilter === "all" || selectedFilter === "artists" ? (
        <section className="mobile-section">
          <h2>Artists</h2>
          {artists.map((artist) => (
            <button key={artist.artist} type="button" className="mobile-result-row" onClick={() => onOpenArtist(artist.artist)}>
              <div className="mobile-result-row__avatar">{artist.artist.charAt(0)}</div>
              <div>
                <strong>{artist.artist}</strong>
                <span>{artist.songCount} songs</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {selectedFilter === "all" || selectedFilter === "playlists" ? (
        <section className="mobile-section">
          <h2>Playlists</h2>
          {playlists.map((playlist) => (
            <button key={playlist.id} type="button" className="mobile-result-row" onClick={() => onOpenPlaylist(playlist.id)}>
              <div className="mobile-result-row__avatar">♫</div>
              <div>
                <strong>{playlist.name}</strong>
                <span>{playlist.count} songs</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
