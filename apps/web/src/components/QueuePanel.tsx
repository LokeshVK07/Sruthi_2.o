import { GripVertical } from "lucide-react";
import { useState } from "react";
import type { Song } from "../types";

type QueuePanelProps = {
  queue: Song[];
  fallbackArt: string;
  currentSongId?: string;
  onPlay: (song: Song) => void;
  onReorder: (from: number, to: number) => void;
  onClear: () => void;
};

function formatTime(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "";
  const value = seconds;
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function QueuePanel({ queue, fallbackArt, currentSongId, onPlay, onReorder, onClear }: QueuePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function resetDragState() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      resetDragState();
      return;
    }
    onReorder(dragIndex, targetIndex);
    resetDragState();
  }

  return (
    <aside className="queue-panel">
      <div className="queue-panel__header">
        <div>
          <span className="queue-panel__eyebrow">UP NEXT</span>
          <h2>Queue</h2>
        </div>
        <button className="queue-panel__clear" onClick={onClear}>
          Clear
        </button>
      </div>

      <div className="queue-panel__list">
        {queue.length ? (
          queue.map((song, index) => (
            <div
              key={`${song.id}-${index}`}
              className={[
                "queue-item",
                song.id === currentSongId ? "is-active" : "",
                dragIndex === index ? "is-dragging" : "",
                dragOverIndex === index ? "is-drop-target" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragOverIndex !== index) {
                  setDragOverIndex(index);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(index);
              }}
            >
              <button className="queue-item__main" onClick={() => onPlay(song)}>
                <img src={song.artworkUrl || fallbackArt} alt={song.title} loading="lazy" decoding="async" />
                <div className="queue-item__copy">
                  <strong title={song.title}>{song.title}</strong>
                  <span title={song.artist}>{song.artist}</span>
                </div>
              </button>
              <span className={formatTime(song.durationSeconds) ? "queue-item__duration" : "queue-item__duration is-empty"}>
                {formatTime(song.durationSeconds)}
              </span>
              <button
                type="button"
                className="queue-item__handle"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", song.id);
                  setDragIndex(index);
                  setDragOverIndex(index);
                }}
                onDragEnd={resetDragState}
                aria-label="Drag to reorder queue"
                title="Drag to reorder queue"
              >
                <GripVertical size={16} />
              </button>
            </div>
          ))
        ) : (
          <div className="queue-panel__empty">
            <p>Your queue is empty. Pick a track from the center dashboard to start building it.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
