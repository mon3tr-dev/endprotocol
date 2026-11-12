/**
 * 《明日方舟》数据服务 —— `get_arknights_player_info` 的类型化封装。
 *
 * # 为什么要这层薄封装
 * - **旧缓存自动迁移**：缓存文件是「解析后的结构体落盘」。2026-11 起结构体新增了
 *   章节进度（activity）等字段（`dataVersion` 标记）。绑定很久的账户磁盘上还是
 *   旧格式缓存，直接读会出现「游戏数据页一片空白但不报错」。这里检测到
 *   `dataVersion < ARKNIGHTS_DATA_VERSION` 时自动 `force = true` 联网刷新一次，
 *   刷新结果由后端落为新格式缓存，之后不再触发。
 * - **游戏分流**：`roleId` 可能指向终末地账户（仪表盘默认角色），这类调用必然
 *   失败 —— 先经 `resolveRoleGame` 判别，非明日方舟账户直接返回 null，
 *   由调用方渲染「无数据」状态（与 account-info 卡片对终末地的处理对称）。
 */

import { invoke } from "@tauri-apps/api/core";
import {
  ARKNIGHTS_DATA_VERSION,
  type ArknightsPlayerInfo,
} from "@/types/arknights";
import { resolveRoleGame } from "./roleGame";
import { logError } from "./logger";

/** 通用选项 */
export interface ArknightsDataOptions {
  /** 传给后端命令的 roleId（dashboard 默认角色或卡片自定义角色） */
  roleId: string;
  /** 强制联网刷新（绕过缓存） */
  force?: boolean;
}

/**
 * 拉取《明日方舟》玩家全量数据。
 *
 * - 非明日方舟账户返回 `null`（调用方显示「无数据/请切换账户」）；
 * - 命中旧格式缓存时自动强制刷新一次；
 * - 失败向上抛错（由 `useCardData` / 页面的 try-catch 统一处理）。
 */
export async function fetchArknightsPlayerInfo({
  roleId,
  force = false,
}: ArknightsDataOptions): Promise<ArknightsPlayerInfo | null> {
  const game = await resolveRoleGame(roleId);
  if (game !== "arknights") return null;

  let info = await invoke<ArknightsPlayerInfo>("get_arknights_player_info", {
    roleId,
    force,
  });

  if (!info) return null;

  if ((info.dataVersion ?? 0) < ARKNIGHTS_DATA_VERSION && !force) {
    try {
      info = await invoke<ArknightsPlayerInfo>("get_arknights_player_info", {
        roleId,
        force: true,
      });
    } catch (error) {
      // 强制刷新失败时仍返回旧缓存内容（ recruit / building 等老字段可用），
      // 新字段（章节进度）为空 —— 与「离线可用」的整体策略一致。
      logError("arknights cache migration refresh failed:", error);
    }
  }

  return info;
}
