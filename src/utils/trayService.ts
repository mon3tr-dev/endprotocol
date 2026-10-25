/**
 * 托盘数据服务
 *
 * 托盘面板（右上角「等级」徽标、理智/每日活跃/每周事务/通行证四项指标）的数据
 * 统一在这里组装：拉取 char_detail 与账号列表 → 汇总 → `update_tray_user_data`
 * 写入配置键 `tray_user_info` 并广播 `tray-user-info-updated`。
 *
 * 抽出来是为了让 `main.tsx`（启动后延时刷新）与 `pages/settings.tsx`
 * （切换托盘显示角色）共用同一份字段映射，避免两处各写一遍导致字段丢失。
 */

import { invoke } from "@tauri-apps/api/core";
import logger from "@/utils/logger";
import { roleDataService } from "@/utils/roleDataService";
import { getAccounts } from "@/utils/accountService";

/** 与后端 `crate::tray::TrayUserInfo`（camelCase，字段均为 Option）一一对应 */
export interface TrayUserInfo {
  roleId?: string;
  nickname?: string | null;
  avatar?: string | null;
  /** 游戏账号等级（char_detail 的 base.level）——托盘右上角徽标用的就是这个值 */
  accountLevel?: number;
  curStamina?: number;
  maxStamina?: number;
  maxTs?: number;
  dailyActivation?: number;
  maxDailyActivation?: number;
  weeklyScore?: number;
  weeklyTotal?: number;
  bpCurLevel?: number;
  bpMaxLevel?: number;
}

/**
 * `query_role_data` 返回的是「路径字符串 → 该路径上的值」的扁平映射，
 * 所以叶子路径要用 `result["base.level"]` 取，而不是 `result.base.level`。
 */
interface TrayQueryResult {
  "base.level"?: number;
  dungeon?: { curStamina?: string; maxStamina?: string; maxTs?: string };
  bpSystem?: { curLevel?: number; maxLevel?: number };
  dailyMission?: { dailyActivation?: number; maxDailyActivation?: number };
  weeklyMission?: { score?: number; total?: number };
}

/**
 * 拉取并推送托盘数据。
 *
 * @param roleId 托盘要展示的角色 ID（配置键 `tray_user_role_id`）
 * @returns 是否成功推送（失败只记日志，返回 false，不打断调用方流程）
 */
export async function refreshTrayUserData(
  roleId: string,
): Promise<boolean> {
  if (!roleId) return false;

  try {
    const result = await roleDataService.queryData(
      roleId,
      "char_detail",
      [
        "base.level",
        "dungeon",
        "bpSystem",
        "dailyMission",
        "weeklyMission",
      ],
    );
    const detail = (result ?? {}) as TrayQueryResult;
    const accs = await getAccounts();
    const account = accs.find((a) => a.id === roleId);

    // 账号等级优先取 char_detail 的 base.level（最新），
    // 拿不到时回退到账号列表里缓存的 level，最后才是 0。
    const accountLevel =
      Number(detail["base.level"]) || Number(account?.level) || 0;

    const userInfo: TrayUserInfo = {
      roleId,
      nickname: account?.nickname ?? null,
      avatar: account?.avatar ?? null,
      accountLevel,
      curStamina: Number(detail.dungeon?.curStamina) || 0,
      maxStamina: Number(detail.dungeon?.maxStamina) || 0,
      maxTs: Number(detail.dungeon?.maxTs) || 0,
      dailyActivation: Number(detail.dailyMission?.dailyActivation) || 0,
      maxDailyActivation:
        Number(detail.dailyMission?.maxDailyActivation) || 0,
      weeklyScore: Number(detail.weeklyMission?.score) || 0,
      weeklyTotal: Number(detail.weeklyMission?.total) || 0,
      bpCurLevel: Number(detail.bpSystem?.curLevel) || 0,
      bpMaxLevel: Number(detail.bpSystem?.maxLevel) || 0,
    };

    await invoke("update_tray_user_data", { userInfo });
    return true;
  } catch (error) {
    logger.error("Failed to refresh tray user data: " + error, null, "TrayService");
    return false;
  }
}

/**
 * 只改托盘显示角色 ID（不动其他字段），并刷新一次数据。
 * 设置页切换托盘账号时使用。
 */
export async function setTrayUser(roleId: string): Promise<void> {
  try {
    await invoke("set_tray_user", { roleId });
  } catch {
    // 后端未就绪时忽略，下面的数据刷新仍会覆盖写入
  }
  await refreshTrayUserData(roleId);
}
