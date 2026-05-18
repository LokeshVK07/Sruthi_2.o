import { useEffect } from "react";

type KeyboardShortcutHandlers = {
  enabled?: boolean;
  isShortcutModalOpen: boolean;
  openShortcuts: () => void;
  closeModals: () => void;
  togglePlayPause: () => void;
  playNext: () => void;
  playPrevious: () => void;
  seekBy: (seconds: number) => void;
  seekToPercent: (percent: number) => void;
  setVolumeByDelta: (delta: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavoriteCurrent: () => void;
  focusSearch: () => void;
  navigateHome: () => void;
  navigateSearch: () => void;
  navigateLibrary: () => void;
  navigatePlaylists: () => void;
  navigateArtists: () => void;
  toggleQueue: () => void;
  openAddToPlaylist: () => void;
  openCreatePlaylist: () => void;
  addCurrentToQueue: () => void;
  toggleFullPlayer: () => void;
  openMoreOptions: () => void;
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function useKeyboardShortcuts({
  enabled = true,
  isShortcutModalOpen,
  openShortcuts,
  closeModals,
  togglePlayPause,
  playNext,
  playPrevious,
  seekBy,
  seekToPercent,
  setVolumeByDelta,
  toggleMute,
  toggleShuffle,
  cycleRepeat,
  toggleFavoriteCurrent,
  focusSearch,
  navigateHome,
  navigateSearch,
  navigateLibrary,
  navigatePlaylists,
  navigateArtists,
  toggleQueue,
  openAddToPlaylist,
  openCreatePlaylist,
  addCurrentToQueue,
  toggleFullPlayer,
  openMoreOptions,
}: KeyboardShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);
      const key = event.key;
      const lower = key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;

      if (key === "Escape") {
        event.preventDefault();
        closeModals();
        return;
      }

      if (typing) {
        return;
      }

      if (key === "?" || (event.shiftKey && key === "/")) {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if (isShortcutModalOpen) {
        return;
      }

      if (meta && lower === "k") {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.shiftKey && key === "ArrowRight") {
        event.preventDefault();
        seekBy(10);
        return;
      }

      if (event.shiftKey && key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-10);
        return;
      }

      if (event.altKey && key === "ArrowRight") {
        event.preventDefault();
        seekBy(5);
        return;
      }

      if (event.altKey && key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-5);
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        playNext();
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        playPrevious();
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        setVolumeByDelta(0.05);
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        setVolumeByDelta(-0.05);
        return;
      }

      if (lower === "0") {
        event.preventDefault();
        seekToPercent(0);
        return;
      }

      if (lower === "9") {
        event.preventDefault();
        seekToPercent(0.9);
        return;
      }

      if (lower === "m") {
        event.preventDefault();
        toggleMute();
        return;
      }

      if (lower === "s" && event.shiftKey) {
        event.preventDefault();
        navigateSearch();
        return;
      }

      if (lower === "s") {
        event.preventDefault();
        toggleShuffle();
        return;
      }

      if (lower === "r") {
        event.preventDefault();
        cycleRepeat();
        return;
      }

      if (lower === "/") {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (lower === "h") {
        event.preventDefault();
        navigateHome();
        return;
      }

      if (lower === "p" && event.shiftKey) {
        event.preventDefault();
        navigatePlaylists();
        return;
      }

      if (key === " " || lower === "p") {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (lower === "l" && event.shiftKey) {
        event.preventDefault();
        navigateLibrary();
        return;
      }

      if (lower === "l") {
        event.preventDefault();
        toggleFavoriteCurrent();
        return;
      }

      if (lower === "a" && event.shiftKey) {
        event.preventDefault();
        navigateArtists();
        return;
      }

      if (lower === "q") {
        event.preventDefault();
        toggleQueue();
        return;
      }

      if (lower === "a") {
        event.preventDefault();
        openAddToPlaylist();
        return;
      }

      if (lower === "n") {
        event.preventDefault();
        openCreatePlaylist();
        return;
      }

      if (lower === "e") {
        event.preventDefault();
        addCurrentToQueue();
        return;
      }

      if (lower === "f") {
        event.preventDefault();
        toggleFullPlayer();
        return;
      }

      if (key === ".") {
        event.preventDefault();
        openMoreOptions();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    isShortcutModalOpen,
    openShortcuts,
    closeModals,
    togglePlayPause,
    playNext,
    playPrevious,
    seekBy,
    seekToPercent,
    setVolumeByDelta,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    toggleFavoriteCurrent,
    focusSearch,
    navigateHome,
    navigateSearch,
    navigateLibrary,
    navigatePlaylists,
    navigateArtists,
    toggleQueue,
    openAddToPlaylist,
    openCreatePlaylist,
    addCurrentToQueue,
    toggleFullPlayer,
    openMoreOptions,
  ]);
}
