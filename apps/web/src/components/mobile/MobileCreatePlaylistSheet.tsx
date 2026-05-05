type MobileCreatePlaylistSheetProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

export default function MobileCreatePlaylistSheet({
  open,
  value,
  onChange,
  onClose,
  onCreate,
}: MobileCreatePlaylistSheetProps) {
  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-header">
          <div>
            <span className="mobile-pill">PLAYLISTS</span>
            <h2>Create Playlist</h2>
          </div>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
        <div className="mobile-sheet-form">
          <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Playlist name" maxLength={80} />
          <small>{value.trim().length}/80</small>
          <button type="button" className="mobile-sheet-submit" onClick={onCreate} disabled={!value.trim()}>
            Create Playlist
          </button>
        </div>
      </div>
    </div>
  );
}
