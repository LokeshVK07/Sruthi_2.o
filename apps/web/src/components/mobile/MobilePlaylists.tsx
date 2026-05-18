import { ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import type { Song } from "../../types";
import AbstractCover from "../AbstractCover";

type PlaylistSummary = { id: string; name: string; count: number };

type MobilePlaylistsProps = {
  playlists: PlaylistSummary[];
  selectedPlaylistId: string | null;
  selectedPlaylistName?: string | null;
  selectedPlaylistSongs: Song[];
  onBack: () => void;
  onCreatePlaylist: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onPlaySong: (song: Song, sourceQueue?: Song[]) => void;
  onRenamePlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
};

export default function MobilePlaylists({
  playlists,
  selectedPlaylistId,
  selectedPlaylistName,
  selectedPlaylistSongs,
  onBack,
  onCreatePlaylist,
  onOpenPlaylist,
  onPlaySong,
  onRenamePlaylist,
  onDeletePlaylist,
}: MobilePlaylistsProps) {
  return (
    <div className="mobile-screen">
      <div className="mobile-screen__header">
        <div className="mobile-screen__header-left">
          <button type="button" onClick={onBack} aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>{selectedPlaylistId ? selectedPlaylistName || "Playlist" : "Playlists"}</strong>
            <span>{selectedPlaylistId ? `${selectedPlaylistSongs.length} songs` : "Your lists"}</span>
          </div>
        </div>
        {!selectedPlaylistId ? (
          <button type="button" onClick={onCreatePlaylist} aria-label="Create playlist">
            <Plus size={18} />
          </button>
        ) : null}
      </div>

      {selectedPlaylistId ? (
        <div className="mobile-recent-list">
          {selectedPlaylistSongs.length ? selectedPlaylistSongs.map((song) => (
            <button key={song.id} type="button" className="mobile-song-row" onClick={() => onPlaySong(song, selectedPlaylistSongs)}>
              <AbstractCover seed={song.id || song.title} size="sm" className="mobile-artwork" />
              <div className="mobile-song-row__copy">
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </div>
            </button>
          )) : <div className="mobile-empty-state">This playlist is empty.</div>}
        </div>
      ) : (
        <div className="mobile-playlist-list">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="mobile-playlist-row">
              <button type="button" className="mobile-playlist-row__main" onClick={() => onOpenPlaylist(playlist.id)}>
                <div className="mobile-result-row__avatar">♫</div>
                <div>
                  <strong>{playlist.name}</strong>
                  <span>{playlist.count} songs</span>
                </div>
              </button>
              {playlist.id !== "favorites" ? (
                <div className="mobile-playlist-row__actions">
                  <button type="button" onClick={() => onRenamePlaylist(playlist.id)} aria-label="Rename playlist">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => onDeletePlaylist(playlist.id)} aria-label="Delete playlist">
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
