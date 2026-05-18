import { create } from "zustand";
import type { Song } from "./types";

export type RepeatMode = "off" | "all" | "one";

type PlayerState = {
  queue: Song[];
  currentIndex: number;
  playing: boolean;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  setQueue: (songs: Song[], startIndex?: number, autoplay?: boolean) => void;
  playSong: (song: Song, queue?: Song[]) => void;
  next: () => void;
  previous: () => void;
  setPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setCurrentIndex: (index: number) => void;
  setSongFavorite: (songId: string, favorite: boolean) => void;
  clearQueue: () => void;
  removeFromQueue: (songId: string) => void;
  moveQueueItem: (from: number, to: number) => void;
  addToQueue: (song: Song) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  playing: false,
  volume: 0.82,
  shuffle: false,
  repeatMode: "off",
  setQueue: (songs, startIndex = 0, autoplay = true) =>
    set({
      queue: songs,
      currentIndex: songs.length ? Math.max(0, Math.min(startIndex, songs.length - 1)) : 0,
      playing: autoplay && songs.length > 0
    }),
  playSong: (song, queue) => {
    const state = get();
    const currentQueue = queue ?? state.queue;
    const nextQueue = currentQueue.length
      ? currentQueue
      : state.queue.length
        ? [
            ...state.queue.slice(0, state.currentIndex + 1),
            song,
            ...state.queue.slice(state.currentIndex + 1).filter((item) => item.id !== song.id),
          ]
        : [song];
    const index = nextQueue.findIndex((item) => item.id === song.id);
    set({
      queue: nextQueue,
      currentIndex: index >= 0 ? index : 0,
      playing: true
    });
  },
  next: () => {
    const state = get();
    if (!state.queue.length) return;
    if (state.repeatMode === "one") {
      set({ playing: true });
      return;
    }
    if (state.shuffle && state.queue.length > 1) {
      let nextIndex = state.currentIndex;
      while (nextIndex === state.currentIndex) {
        nextIndex = Math.floor(Math.random() * state.queue.length);
      }
      set({ currentIndex: nextIndex, playing: true });
      return;
    }
    if (state.currentIndex < state.queue.length - 1) {
      set({ currentIndex: state.currentIndex + 1, playing: true });
      return;
    }
    if (state.repeatMode === "all") {
      set({ currentIndex: 0, playing: true });
      return;
    }
    set({ playing: false });
  },
  previous: () => {
    const state = get();
    if (!state.queue.length) return;
    if (state.currentIndex > 0) {
      set({ currentIndex: state.currentIndex - 1, playing: true });
      return;
    }
    if (state.repeatMode === "all") {
      set({ currentIndex: state.queue.length - 1, playing: true });
    }
  },
  setPlaying: (playing) => set({ playing }),
  setVolume: (volume) => set({ volume }),
  setCurrentIndex: (index) =>
    set((state) => ({
      currentIndex: state.queue.length ? Math.max(0, Math.min(index, state.queue.length - 1)) : 0
    })),
  setSongFavorite: (songId, favorite) =>
    set((state) => ({
      queue: state.queue.map((song) => (song.id === songId ? { ...song, favorite } : song))
    })),
  clearQueue: () => set({ queue: [], currentIndex: 0, playing: false }),
  removeFromQueue: (songId) =>
    set((state) => {
      const nextQueue = state.queue.filter((song) => song.id !== songId);
      const removedBeforeCurrent = state.queue.findIndex((song) => song.id === songId) < state.currentIndex;
      const currentSongRemoved = state.queue[state.currentIndex]?.id === songId;
      let nextIndex = state.currentIndex;
      if (currentSongRemoved) {
        nextIndex = Math.min(state.currentIndex, Math.max(0, nextQueue.length - 1));
      } else if (removedBeforeCurrent) {
        nextIndex = Math.max(0, state.currentIndex - 1);
      }
      return {
        queue: nextQueue,
        currentIndex: nextQueue.length ? nextIndex : 0,
        playing: nextQueue.length ? state.playing : false
      };
    }),
  moveQueueItem: (from, to) =>
    set((state) => {
      if (from === to || from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length) {
        return state;
      }
      const nextQueue = [...state.queue];
      const [moved] = nextQueue.splice(from, 1);
      nextQueue.splice(to, 0, moved);
      let nextIndex = state.currentIndex;
      if (state.currentIndex === from) {
        nextIndex = to;
      } else if (from < state.currentIndex && to >= state.currentIndex) {
        nextIndex -= 1;
      } else if (from > state.currentIndex && to <= state.currentIndex) {
        nextIndex += 1;
      }
      return { queue: nextQueue, currentIndex: nextIndex };
    }),
  addToQueue: (song) =>
    set((state) => {
      const queue = state.queue.length ? [...state.queue] : [song];
      const existingIndex = queue.findIndex((item) => item.id === song.id);
      if (!state.queue.length) {
        return { queue, currentIndex: 0 };
      }
      if (existingIndex >= 0) {
        queue.splice(existingIndex, 1);
      }
      queue.splice(state.currentIndex + 1, 0, song);
      return { queue };
    }),
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
  cycleRepeatMode: () =>
    set((state) => ({
      repeatMode: state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off"
    }))
}));
