import { isWindowsPlatform } from "@/utils/platform";

export type LauncherViewMode = "data" | "game";

const STORAGE_KEY = "launcher_view_mode";

let currentMode: LauncherViewMode = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "game" && !isWindowsPlatform()) {
      localStorage.setItem(STORAGE_KEY, "data");
      return "data";
    }
    if (stored === "data" || stored === "game") return stored;
  } catch {}
  return "data";
})();

let listeners: Array<() => void> = [];

function emit() {
  listeners.forEach((fn) => fn());
}

export function getLauncherMode(): LauncherViewMode {
  return currentMode;
}

export function setLauncherMode(mode: LauncherViewMode) {
  const nextMode = mode === "game" && !isWindowsPlatform() ? "data" : mode;
  if (currentMode === nextMode) return;
  currentMode = nextMode;
  try {
    localStorage.setItem(STORAGE_KEY, nextMode);
  } catch {}
  emit();
}

export function isGameMode(): boolean {
  return currentMode === "game";
}

export function subscribeLauncherMode(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

// ========== Background media store ==========
export interface LauncherBgMedia {
  image_url: string | null;
  video_url: string | null;
}

let currentBgMedia: LauncherBgMedia | null = null;
let bgListeners: Array<() => void> = [];

function emitBg() {
  bgListeners.forEach((fn) => fn());
}

export function getLauncherBgMedia(): LauncherBgMedia | null {
  return currentBgMedia;
}

export function setLauncherBgMedia(media: LauncherBgMedia | null) {
  currentBgMedia = media;
  emitBg();
}

export function subscribeLauncherBgMedia(fn: () => void): () => void {
  bgListeners.push(fn);
  return () => {
    bgListeners = bgListeners.filter((l) => l !== fn);
  };
}

// ========== Background mode (video / image) store ==========
export type GameBgMode = "video" | "image";

const BG_MODE_STORAGE_KEY = "game_bg_mode";

let currentBgMode: GameBgMode = (() => {
  try {
    const stored = localStorage.getItem(BG_MODE_STORAGE_KEY);
    if (stored === "video" || stored === "image") return stored;
  } catch {}
  return "video";
})();

let bgModeListeners: Array<() => void> = [];

function emitBgMode() {
  bgModeListeners.forEach((fn) => fn());
}

export function getGameBgMode(): GameBgMode {
  return currentBgMode;
}

export function setGameBgMode(mode: GameBgMode) {
  if (currentBgMode === mode) return;
  currentBgMode = mode;
  try {
    localStorage.setItem(BG_MODE_STORAGE_KEY, mode);
  } catch {}
  emitBgMode();
}

export function subscribeGameBgMode(fn: () => void): () => void {
  bgModeListeners.push(fn);
  return () => {
    bgModeListeners = bgModeListeners.filter((l) => l !== fn);
  };
}
