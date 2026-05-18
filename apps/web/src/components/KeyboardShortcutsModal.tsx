import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type ShortcutItem = {
  keys: string[];
  label: string;
};

type ShortcutGroup = {
  title: string;
  items: ShortcutItem[];
};

type KeyboardShortcutsModalProps = {
  open: boolean;
  onClose: () => void;
};

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Playback",
    items: [
      { keys: ["Space"], label: "Play / Pause" },
      { keys: ["P"], label: "Play / Pause" },
      { keys: ["ArrowRight"], label: "Next Track" },
      { keys: ["ArrowLeft"], label: "Previous Track" },
      { keys: ["M"], label: "Mute / Unmute" },
      { keys: ["ArrowUp"], label: "Volume Up" },
      { keys: ["ArrowDown"], label: "Volume Down" },
      { keys: ["S"], label: "Shuffle On / Off" },
      { keys: ["R"], label: "Repeat Mode" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["/"], label: "Focus Search" },
      { keys: ["H"], label: "Go to Home" },
      { keys: ["Shift", "S"], label: "Go to Search" },
      { keys: ["Shift", "L"], label: "Go to Library" },
      { keys: ["Shift", "P"], label: "Go to Playlists" },
      { keys: ["Shift", "A"], label: "Go to Artists" },
      { keys: ["Q"], label: "Open / Close Queue" },
      { keys: ["Esc"], label: "Close Modals / Panels" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: ["L"], label: "Like / Unlike Song" },
      { keys: ["A"], label: "Add to Playlist" },
      { keys: ["N"], label: "Create New Playlist" },
      { keys: ["D"], label: "Download Song if supported" },
      { keys: ["E"], label: "Add to Queue" },
      { keys: ["."], label: "More Options" },
    ],
  },
  {
    title: "Seeking",
    items: [
      { keys: ["Alt", "ArrowRight"], label: "Seek Forward 5s" },
      { keys: ["Alt", "ArrowLeft"], label: "Seek Backward 5s" },
      { keys: ["Shift", "ArrowRight"], label: "Seek Forward 10s" },
      { keys: ["Shift", "ArrowLeft"], label: "Seek Backward 10s" },
      { keys: ["0"], label: "Go to Start" },
      { keys: ["9"], label: "Go to 90%" },
    ],
  },
  {
    title: "Queue & Playlist",
    items: [
      { keys: ["ArrowUp"], label: "Move Up in Queue when focused" },
      { keys: ["ArrowDown"], label: "Move Down in Queue when focused" },
      { keys: ["Delete"], label: "Remove from Queue when focused" },
      { keys: ["Ctrl", "ArrowUp"], label: "Move Playlist Up if supported" },
      { keys: ["Ctrl", "ArrowDown"], label: "Move Playlist Down if supported" },
      { keys: ["Ctrl", "Delete"], label: "Delete Playlist if supported" },
    ],
  },
  {
    title: "General",
    items: [
      { keys: ["?"], label: "Show Shortcuts" },
      { keys: ["F"], label: "Toggle Fullscreen Player" },
      { keys: ["Ctrl/Cmd", "K"], label: "Quick Search" },
      { keys: ["Ctrl/Cmd", ","], label: "Settings" },
      { keys: ["Ctrl/Cmd", "D"], label: "Toggle Dark Mode if supported" },
      { keys: ["Esc"], label: "Close Fullscreen / Drawer / Modal" },
    ],
  },
];

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="shortcuts-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="shortcuts-modal__header">
          <div>
            <span className="shortcuts-modal__eyebrow">ViBe 2.o</span>
            <h2 id="shortcuts-modal-title">Keyboard Shortcuts</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="shortcuts-modal__close" onClick={onClose} aria-label="Close keyboard shortcuts">
            <X size={18} />
          </button>
        </header>

        <div className="shortcuts-modal__grid">
          {shortcutGroups.map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              <div className="shortcuts-group__items">
                {group.items.map((item) => (
                  <div key={`${group.title}-${item.label}`} className="shortcut-row">
                    <span className="shortcut-row__keys">
                      {item.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="shortcuts-modal__tip">Tip: shortcuts are ignored while typing in search, playlist names, or any text field.</p>
      </section>
    </div>
  );
}
