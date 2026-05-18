import { Search, X, Loader2 } from "lucide-react";
import type { Album, ComposerCollection, Song } from "../../types";

type FilterKey = "all" | "tracks" | "albums" | "artists" | "playlists";

type MobileSearchProps = {
  /** Visible value of the search input — updated immediately on every keystroke. */
  inputValue: string;
  /** Debounced version that drives the displayed results. */
  debouncedQuery: string;
  /** True while the backend search is in flight (drives the spinner only). */
  isSearching: boolean;
  selectedFilter: FilterKey;
  recentSearches: string[];
  songs: Song[];
  albums: Album[];
  artists: Array<{ artist: string; songCount: number }>;
  composers: ComposerCollection[];
  playlists: Array<{ id: string; name: string; count: number }>;
  fallbackArt: string;
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

const filterLabels: Record<FilterKey, string> = {
  all: "All",
  tracks: "Tracks",
  albums: "Albums",
  artists: "Artists",
  playlists: "Playlists",
};

export default function MobileSearch({
  inputValue,
  debouncedQuery,
  isSearching,
  selectedFilter,
  recentSearches,
  songs,
  albums,
  artists,
  composers,
  playlists,
  fallbackArt,
  onQueryChange,
  onClose,
  onSelectFilter,
  onClearHistory,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: MobileSearchProps) {
  const showAll = selectedFilter === "all";
  const showTracks = showAll || selectedFilter === "tracks";
  const showAlbums = showAll || selectedFilter === "albums";
  const showArtists = showAll || selectedFilter === "artists";
  const showPlaylists = showAll || selectedFilter === "playlists";

  const trimmed = inputValue.trim();
  const trimmedDebounced = debouncedQuery.trim();
  const hasInput = trimmed.length > 0;
  const queryAlignedWithInput = trimmedDebounced === trimmed;
  const totalResults = (showTracks ? songs.length : 0) +
    (showAlbums ? albums.length : 0) +
    (showArtists ? artists.length + composers.length : 0) +
    (showPlaylists ? playlists.length : 0);
  const showEmptyState = hasInput && queryAlignedWithInput && !isSearching && totalResults === 0;

  return (
    <div className="mobile-screen mobile-search-screen">
      <div className="mobile-search-screen__bar">
        <label className="mobile-search-bar mobile-search-bar--input">
          <Search size={18} className="mobile-search-bar__icon" />
          <input
            value={inputValue}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search songs, albums, artists..."
            autoFocus
            inputMode="search"
            type="search"
            enterKeyHint="search"
            // Type prop above already prevents iOS auto-capitalize, but be explicit.
            autoCorrect="off"
            autoComplete="off"
          />
          {hasInput ? (
            <button
              type="button"
              className="mobile-search-bar__clear"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          ) : (
            <span className="mobile-search-bar__clear mobile-search-bar__clear--ghost">
              {isSearching ? <Loader2 size={16} className="mobile-search-bar__spinner" /> : null}
            </span>
          )}
        </label>
        <button type="button" onClick={onClose} className="mobile-search-cancel">
          Cancel
        </button>
      </div>

      <div className="mobile-search-screen__filters">
        {filters.map((filter) => (
          <button
            key={filter}
            type="button"
            className={selectedFilter === filter ? "is-active" : ""}
            onClick={() => onSelectFilter(filter)}
          >
            {filterLabels[filter]}
          </button>
        ))}
      </div>

      {!hasInput ? (
        <>
          <div className="mobile-section__header">
            <h2>Recent searches</h2>
            <button type="button" onClick={onClearHistory}>
              Clear
            </button>
          </div>
          <div className="mobile-search-history">
            {recentSearches.length ? (
              recentSearches.map((item) => (
                <button key={item} type="button" onClick={() => onQueryChange(item)}>
                  {item}
                </button>
              ))
            ) : (
              <div className="mobile-empty-state">No recent searches</div>
            )}
          </div>
        </>
      ) : null}

      {hasInput && !queryAlignedWithInput && isSearching ? (
        <div className="mobile-empty-state mobile-empty-state--soft">Searching...</div>
      ) : null}

      {hasInput && showEmptyState ? (
        <div className="mobile-empty-state">No results for &ldquo;{trimmed}&rdquo;</div>
      ) : null}

      {hasInput && showTracks && songs.length ? (
        <section className="mobile-section">
          <h2>Tracks</h2>
          {songs.slice(0, 30).map((song) => (
            <button key={song.id} type="button" className="mobile-result-row" onClick={() => onPlaySong(song)}>
              <img src={song.artworkUrl || fallbackArt} alt={song.title} loading="lazy" />
              <div>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {hasInput && showAlbums && albums.length ? (
        <section className="mobile-section">
          <h2>Albums</h2>
          {albums.slice(0, 20).map((album) => (
            <button
              key={album.albumId}
              type="button"
              className="mobile-result-row"
              onClick={() => onOpenAlbum(album.albumId)}
            >
              <img src={album.imageUrl || fallbackArt} alt={album.name} loading="lazy" />
              <div>
                <strong>{album.name}</strong>
                <span>{album.musicDirector || album.singersSummary || "Album"}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {hasInput && showArtists && artists.length ? (
        <section className="mobile-section">
          <h2>Artists</h2>
          {artists.slice(0, 16).map((artist) => (
            <button
              key={artist.artist}
              type="button"
              className="mobile-result-row"
              onClick={() => onOpenArtist(artist.artist)}
            >
              <div className="mobile-result-row__avatar">{artist.artist.charAt(0)}</div>
              <div>
                <strong>{artist.artist}</strong>
                <span>{artist.songCount} {artist.songCount === 1 ? "song" : "songs"}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {hasInput && showArtists && composers.length ? (
        <section className="mobile-section">
          <h2>Composers</h2>
          {composers.slice(0, 12).map((composer) => (
            <button
              key={composer.slug}
              type="button"
              className="mobile-result-row"
              onClick={() => onOpenArtist(composer.name)}
            >
              <div className="mobile-result-row__avatar">{composer.name.charAt(0)}</div>
              <div>
                <strong>{composer.name}</strong>
                <span>{composer.songCount} {composer.songCount === 1 ? "song" : "songs"}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {hasInput && showPlaylists && playlists.length ? (
        <section className="mobile-section">
          <h2>Playlists</h2>
          {playlists.slice(0, 12).map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className="mobile-result-row"
              onClick={() => onOpenPlaylist(playlist.id)}
            >
              <div className="mobile-result-row__avatar">♫</div>
              <div>
                <strong>{playlist.name}</strong>
                <span>{playlist.count} {playlist.count === 1 ? "song" : "songs"}</span>
              </div>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
