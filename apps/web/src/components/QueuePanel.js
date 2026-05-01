import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GripVertical } from "lucide-react";
import { useState } from "react";
function formatTime(seconds) {
    const value = !seconds || seconds <= 0 ? 240 : seconds;
    const mins = Math.floor(value / 60);
    const secs = Math.floor(value % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
}
export default function QueuePanel({ queue, fallbackArt, currentSongId, onPlay, onReorder, onClear }) {
    const [dragIndex, setDragIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    function resetDragState() {
        setDragIndex(null);
        setDragOverIndex(null);
    }
    function handleDrop(targetIndex) {
        if (dragIndex === null || dragIndex === targetIndex) {
            resetDragState();
            return;
        }
        onReorder(dragIndex, targetIndex);
        resetDragState();
    }
    return (_jsxs("aside", { className: "queue-panel", children: [_jsxs("div", { className: "queue-panel__header", children: [_jsxs("div", { children: [_jsx("span", { className: "queue-panel__eyebrow", children: "UP NEXT" }), _jsx("h2", { children: "Queue" })] }), _jsx("button", { className: "queue-panel__clear", onClick: onClear, children: "Clear" })] }), _jsx("div", { className: "queue-panel__list", children: queue.length ? (queue.map((song, index) => (_jsxs("div", { className: [
                        "queue-item",
                        song.id === currentSongId ? "is-active" : "",
                        dragIndex === index ? "is-dragging" : "",
                        dragOverIndex === index ? "is-drop-target" : ""
                    ]
                        .filter(Boolean)
                        .join(" "), onDragOver: (event) => {
                        event.preventDefault();
                        if (dragOverIndex !== index) {
                            setDragOverIndex(index);
                        }
                    }, onDrop: (event) => {
                        event.preventDefault();
                        handleDrop(index);
                    }, children: [_jsxs("button", { className: "queue-item__main", onClick: () => onPlay(song), children: [_jsx("img", { src: song.artworkUrl || fallbackArt, alt: song.title }), _jsxs("div", { className: "queue-item__copy", children: [_jsx("strong", { title: song.title, children: song.title }), _jsx("span", { title: song.artist, children: song.artist })] })] }), _jsx("span", { className: "queue-item__duration", children: formatTime(song.durationSeconds) }), _jsx("button", { className: "queue-item__handle", draggable: true, onDragStart: (event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", song.id);
                                setDragIndex(index);
                                setDragOverIndex(index);
                            }, onDragEnd: resetDragState, "aria-label": "Drag to reorder queue", title: "Drag to reorder queue", children: _jsx(GripVertical, { size: 16 }) })] }, `${song.id}-${index}`)))) : (_jsx("div", { className: "queue-panel__empty", children: _jsx("p", { children: "Your queue is empty. Pick a track from the center dashboard to start building it." }) })) })] }));
}
