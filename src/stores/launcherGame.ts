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

/** 切换方向：1 = 往下切（终末地 → 明日方舟），-1 = 往上切。 */
export type GameSwitchDirection = 1 | -1;

/**
 * 本次切换的序号与方向。
 *
 * 序号每次切换自增：界面靠它判断「是不是刚切过游戏」——单看 `activeGame`
 * 分不出「切过一次」与「本来就是这个游戏」，过渡动画就无从触发
 * （也不能靠 activeGame 当 key，那会把整棵子树重建，
 *  玻璃层与滚动位置都会跟着丢）。
 *
 * 方向由两个游戏在切换栏里的上下次序决定（切换栏自上而下是终末地、
 * 明日方舟），界面据此决定新内容往哪个方向让位。
 */
let switchSeq = 0;
let switchDirection: GameSwitchDirection = 1;

function emit() {
  listeners.forEach((fn) => fn());
}

export function getActiveGame(): LauncherGame {
  return currentGame;
}

export function setActiveGame(game: LauncherGame) {
  if (currentGame === game) return;
  // 切换栏里终末地在上、明日方舟在下：往下切为 1，往上切为 -1。
  switchDirection = game === "arknights" ? 1 : -1;
  switchSeq += 1;
  currentGame = game;
  try {
    localStorage.setItem(STORAGE_KEY, game);
  } catch {}
  emit();
}

/** 本次切换的序号（每次切换自增，用于触发一次性过渡动画）。 */
export function getGameSwitchSeq(): number {
  return switchSeq;
}

/** 本次切换的方向（1 = 往下切，-1 = 往上切）。 */
export function getGameSwitchDirection(): GameSwitchDirection {
  return switchDirection;
}

export function subscribeActiveGame(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((listener) => listener !== fn);
  };
}
