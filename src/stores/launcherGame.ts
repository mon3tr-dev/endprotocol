import type { GameChannel } from "@/utils/launcherService";

/**
 * 启动器里的「游戏」维度。
 *
 * 一个游戏下可以有多个渠道（终末地 4 个、明日方舟 2 个），但**安装路径与渠道是
 * 按游戏各存一份**：两个游戏的目录结构、exe、CDN 都不一样，共用一份配置必然互相覆盖。
 */
export type LauncherGame = "endfield" | "arknights";

/** 游戏选择持久化在 localStorage 的键（记住上次看的是哪个游戏） */
const STORAGE_KEY = "launcher_game";

/** 每个游戏在没有任何记录时使用的默认渠道 */
export const DEFAULT_CHANNEL: Record<LauncherGame, GameChannel> = {
  endfield: "official",
  arknights: "arknights",
};

/** 渠道 → 所属游戏，与 `launcherService.CHANNEL_GAME` 保持一致（避免循环依赖在此重复） */
export function gameOfChannel(channel: GameChannel): LauncherGame {
  return channel.startsWith("arknights") ? "arknights" : "endfield";
}

export const ALL_GAMES: LauncherGame[] = ["endfield", "arknights"];

function normalize(value: string | null): LauncherGame | null {
  if (value === "endfield" || value === "arknights") return value;
  return null;
}

let currentGame: LauncherGame = (() => {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY)) ?? "endfield";
  } catch {
    return "endfield";
  }
})();

let listeners: Array<() => void> = [];

function emit() {
  listeners.forEach((fn) => fn());
}

export function getActiveGame(): LauncherGame {
  return currentGame;
}

export function setActiveGame(game: LauncherGame) {
  if (currentGame === game) return;
  currentGame = game;
  try {
    localStorage.setItem(STORAGE_KEY, game);
  } catch {}
  emit();
}

export function subscribeActiveGame(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((listener) => listener !== fn);
  };
}
