import { X } from "lucide-react";

type PlaylistModalProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

export default function PlaylistModal({ open, value, onChange, onClose, onCreate }: PlaylistModalProps) {
  if (!open) return null;

  return (
    <div className="playlist-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="playlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="playlist-modal__header">
          <div>
            <span className="playlist-modal__eyebrow">Playlist</span>
            <h2 id="playlist-modal-title">Create a new playlist</h2>
          </div>
          <button className="playlist-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className="playlist-modal__field">
          <span>Name</span>
          <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Late night Tamil" autoFocus />
        </label>

        <div className="playlist-modal__actions">
          <button className="playlist-modal__ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="playlist-modal__primary" onClick={onCreate}>
            Create playlist
          </button>
        </div>
      </div>
    </div>
  );
}
