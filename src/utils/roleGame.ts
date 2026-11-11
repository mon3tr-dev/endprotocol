import { getAccounts, type Account } from "@/utils/accountService";
import type { GameId } from "@/utils/accountService";
import { logError } from "@/utils/logger";

/**
 * 「角色 → 所属游戏」的解析器。
 *
 * 为什么需要它：卡片要先知道角色属于哪个游戏，才能决定调终末地的
 * `query_role_data` 还是明日方舟的 `get_arknights_player_info`。
 * 但卡片渲染时账户列表往往还没加载完（`getAccounts()` 是异步的），
 * 直接在 `fetchData` 里 await 一次 `getAccounts()` 会让每张卡片都发一遍 IPC。
 *
 * 这里做一个带 TTL 的模块级缓存，并在 `accountChanged` 事件时失效：
 * - 同一时刻多个卡片问同一个角色，命中缓存，不再重复 IPC；
 * - 切换账户后缓存立刻失效，避免拿旧的游戏标识去分流。
 */
const CACHE_TTL_MS = 30_000;

let cache: { at: number; accounts: Account[] } | null = null;
let inflight: Promise<Account[]> | null = null;

/** 缓存失效（切换账户 / 刷新后调用）。 */
export function invalidateRoleGameCache() {
  cache = null;
  inflight = null;
}

/** 读缓存里的账户列表（不触发 IPC）。 */
export function peekAccounts(): Account[] {
  return cache?.accounts ?? [];
}

/**
 * 同步读某个角色的游戏标识。
 *
 * 缓存未命中时返回 `undefined`（调用方应退回默认游戏），
 * 因此它只能用于「尽力而为」的判断，不能作为唯一依据。
 */
export function peekRoleGame(roleId: string): GameId | undefined {
  const found = peekAccounts().find((a) => a.id === roleId);
  if (!found) return undefined;
  return found.game === "arknights" ? "arknights" : "endfield";
}

/**
 * 解析某个角色所属的游戏。
 *
 * 缓存缺失时拉一次账户列表；角色不在列表里（未绑定 / 已解绑）时按终末地处理，
 * 与后端 `models::role::GAME_ENDFIELD` 的默认一致。
 */
export async function resolveRoleGame(roleId: string): Promise<GameId> {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    if (!inflight) {
      inflight = getAccounts()
        .then((accounts) => {
          cache = { at: Date.now(), accounts: accounts ?? [] };
          return cache.accounts;
        })
        .catch((e) => {
          logError("[roleGame] Failed to load accounts:", e);
          return [] as Account[];
        })
        .finally(() => {
          inflight = null;
        });
    }
    await inflight;
  }
  return peekRoleGame(roleId) ?? "endfield";
}

// 切换账户后缓存的账户列表立刻失效
if (typeof window !== "undefined") {
  window.addEventListener("accountChanged", invalidateRoleGameCache);
}
