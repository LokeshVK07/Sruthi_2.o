type PlaylistSummary = { id: string; name: string; count: number };

type MobileAddToPlaylistSheetProps = {
  open: boolean;
  playlists: PlaylistSummary[];
  onClose: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onCreateNew: () => void;
};

export default function MobileAddToPlaylistSheet({
  open,
  playlists,
  onClose,
  onSelectPlaylist,
  onCreateNew,
}: MobileAddToPlaylistSheetProps) {
  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-header">
          <div>
            <span className="mobile-pill">PLAYLISTS</span>
            <h2>Add to Playlist</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="mobile-sheet-list">
          {playlists.length ? (
            playlists.map((playlist) => (
              <button key={playlist.id} type="button" className="mobile-sheet-list__item" onClick={() => onSelectPlaylist(playlist.id)}>
                <strong>{playlist.name}</strong>
                <span>{playlist.count} songs</span>
              </button>
            ))
          ) : (
            <div className="mobile-empty-state">No playlists yet. Create one first.</div>
          )}
          <button type="button" className="mobile-sheet-list__item is-primary" onClick={onCreateNew}>
            Create New Playlist
          </button>
        </div>
      </div>
    </div>
  );
}
