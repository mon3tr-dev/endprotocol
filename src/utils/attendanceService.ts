/**
 * 签到动作的共享实现。
 *
 * # 为什么需要这个文件
 *
 * 签到卡片（`components/cards/attendance`）与签到页面（`pages/attendance`）都要
 * 「发起签到」。早先卡片里写了 `handleSignIn`，页面却只渲染了只读的
 * `AttendanceRewards` —— 页面上**根本没有任何签到按钮**，用户点哪里都没反应。
 *
 * 两个游戏的分支、幂等判定、提示文案一旦在两处各写一遍就会漂移
 * （历史上就出现过「卡片能签、页面不能签」这种不一致），因此统一收敛到这里。
 */
import { invoke } from "@tauri-apps/api/core";
import { addMessage } from "@/utils/messageStore";
import { logError } from "@/utils/logger";

/** 角色所属游戏 */
export type AttendanceGame = "arknights" | "endfield";

/** 单个角色的签到状态（批量弹窗用） */
export interface RoleAttendanceState {
  roleId: string;
  game: AttendanceGame;
  /** 今天是否已签到；查询失败时为 null */
  signed: boolean | null;
  /** 查询失败原因 */
  error?: string;
}

/** 后端 `do_batch_attendance` 的单条结果 */
export interface BatchAttendanceItem {
  roleId: string;
  ok: boolean;
  alreadySigned: boolean;
  error: string | null;
}

/** 从账户列表里判定角色属于哪个游戏（缺失时按终末地，与后端默认一致） */
export function resolveAttendanceGame(
  accounts: Array<{ id: string; game?: string }> | undefined,
  roleId: string,
): AttendanceGame {
  return accounts?.find((a) => a.id === roleId)?.game === "arknights"
    ? "arknights"
    : "endfield";
}

/**
 * 查询签到状态（两个游戏分流）。
 *
 * 返回原始响应（不解析），交给 `parseAttendanceData` 归一 —— 它同时兼容
 * 森空岛外壳 `{code, message, data}` 与「后端直接返回 data」两种形状。
 */
export async function fetchAttendanceRaw(
  roleId: string,
  game: AttendanceGame,
): Promise<any> {
  return invoke<any>(
    game === "arknights" ? "get_arknights_attendance" : "get_attendance",
    { roleId },
  );
}

/** 执行签到，返回「本次是否属于『今天已经签过』的幂等结果」 */
export async function performAttendanceSignIn(
  roleId: string,
  game: AttendanceGame,
): Promise<{ alreadySigned: boolean; raw: any }> {
  const raw = await invoke<any>(
    game === "arknights" ? "do_arknights_attendance" : "do_attendance",
    { roleId },
  );

  // 两个游戏都是「森空岛响应外壳 + 结果在 data 里」：
  // - 终末地：业务码 10001 表示今天已签
  // - 明日方舟：后端在 `data.alreadySigned` 折好，顶层 `code` 也透传真实业务码
  const alreadySigned =
    game === "arknights"
      ? Boolean(raw?.data?.alreadySigned) || raw?.code === 10001
      : raw?.code === 10001;

  return { alreadySigned, raw };
}

/**
 * 查询若干角色今天是否已签到（并行，单个失败不影响其余）
 *
 * 批量签到弹窗需要先知道「哪些还没签」，才能默认勾选与禁用已签项。
 * 这里复用 `fetchAttendanceRaw` + `parseAttendanceData` 的既有归一逻辑，
 * 不额外新增后端接口 —— 签到状态本来就只能逐角色查。
 */
export async function fetchAttendanceStates(
  accounts: Array<{ id: string; game?: string }>,
  roleIds: string[],
): Promise<Record<string, RoleAttendanceState>> {
  const { parseAttendanceData } = await import(
    "@/components/cards/attendance/index"
  );

  const entries = await Promise.all(
    roleIds.map(async (roleId): Promise<[string, RoleAttendanceState]> => {
      const game = resolveAttendanceGame(accounts, roleId);
      try {
        const raw = await fetchAttendanceRaw(roleId, game);
        const parsed = parseAttendanceData(raw);
        return [
          roleId,
          {
            roleId,
            game,
            signed: parsed ? parsed.hasToday : null,
            error: parsed ? undefined : "parse failed",
          },
        ];
      } catch (e) {
        return [
          roleId,
          { roleId, game, signed: null, error: String(e) },
        ];
      }
    }),
  );

  return Object.fromEntries(entries);
}

/**
 * 批量签到（走后端 `do_batch_attendance`）
 *
 * 与逐个调 `performAttendanceSignIn` 的区别：
 * - 后端**串行**执行，失败不打断整批，逐条返回 `ok` / `error`
 * - 只需一次 IPC 往返，避免一次批量操作触发几十次跨进程调用
 */
export async function performBatchAttendance(
  roleIds: string[],
): Promise<BatchAttendanceItem[]> {
  const raw = await invoke<BatchAttendanceItem[]>("do_batch_attendance", {
    roleIds,
  });
  // 后端用 serde camelCase 还是 snake_case 取决于结构体标注；这里统一兜底
  return (raw ?? []).map((item: any) => ({
    roleId: item.roleId ?? item.role_id ?? "",
    ok: Boolean(item.ok),
    alreadySigned: Boolean(item.alreadySigned ?? item.already_signed),
    error: item.error ?? null,
  }));
}

/**
 * 发起签到并给出用户提示（卡片与页面共用）。
 *
 * @param onSuccess 签到成功（含幂等）后回调，通常用于刷新数据
 * @param translate i18n 的 `t` 函数
 * @returns 是否成功（失败时已弹 urgent 消息，调用方只需复位 UI 态）
 */
export async function signInWithFeedback(
  roleId: string,
  game: AttendanceGame,
  translate: (key: string) => string,
  onSuccess?: () => void | Promise<void>,
): Promise<boolean> {
  try {
    const { alreadySigned } = await performAttendanceSignIn(roleId, game);
    addMessage({
      type: "info",
      title: translate(
        alreadySigned
          ? "card:attendance_already_signed"
          : "card:attendance_sign_success",
      ),
      tag: "attendance",
    });
    await onSuccess?.();
    return true;
  } catch (e) {
    logError("[Attendance] sign-in failed:", e);
    addMessage({
      type: "urgent",
      title: translate("card:attendance_sign_failed"),
      body: String(e),
      tag: "attendance",
    });
    return false;
  }
}
