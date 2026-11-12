/**
 * 基地数据卡片与独立页面共享的类型工具与设施状态计算。
 *
 * 数据来自 `player/info.building`（labor/hire/training/各设施排班）。
 * 心情换算与空值约定见 `src/types/arknights.ts`（ap/360000 = 0..24 点）。
 */

import {
  arknightsMoodOf,
  arknightsMoodPercent,
  type ArknightsBuilding,
  type ArknightsHire,
  type ArknightsLabor,
  type ArknightsRoomSegment,
  type ArknightsTraining,
} from "@/types/arknights";

export type {
  ArknightsBuilding,
  ArknightsHire,
  ArknightsLabor,
  ArknightsRoomSegment,
  ArknightsTraining,
};

export { arknightsMoodOf, arknightsMoodPercent };

/** 设施展示顺序（页面按此排列；某设施缺失/空数组时跳过） */
export const FACILITY_ORDER = [
  "control",
  "powers",
  "tradings",
  "manufactures",
  "dormitories",
  "meeting",
] as const;

export type FacilityKey = (typeof FACILITY_ORDER)[number];

/** 无人机当前填充百分比（0..100） */
export function laborPercent(labor: ArknightsLabor | null | undefined): number {
  if (!labor || labor.maxValue <= 0) return 0;
  return Math.min(100, Math.max(0, (labor.value / labor.maxValue) * 100));
}

/**
 * 无人机距补满的剩余毫秒数。
 *
 * 接口的 `remainSecs` 以 `lastUpdateTime`（数据快照时间）为基准，
 * 数据是快照，本地现在看要**减去已经流逝的时间**。
 */
export function laborRemainingMs(
  labor: ArknightsLabor | null | undefined,
  nowMs: number,
): number {
  if (!labor) return 0;
  if (labor.value >= labor.maxValue) return 0;
  const elapsedMs = Math.max(0, nowMs - labor.lastUpdateTime * 1000);
  return Math.max(0, labor.remainSecs * 1000 - elapsedMs);
}

/** 宿舍休息进度聚合（所有宿舍在休干员的平均心情百分比 + 在休人数） */
export function dormRestSummary(building: ArknightsBuilding | null | undefined): {
  percent: number;
  restingCount: number;
  charCount: number;
} {
  const dorms = building?.dormitories ?? [];
  let apSum = 0;
  let count = 0;
  let resting = 0;
  for (const dorm of dorms) {
    for (const char of dorm.chars ?? []) {
      apSum += arknightsMoodPercent(char.ap);
      count += 1;
      // 心情未满 = 还在恢复（休息进度未到 100%）
      if (arknightsMoodOf(char.ap) < 23.95) resting += 1;
    }
  }
  return {
    percent: count > 0 ? apSum / count : 0,
    restingCount: resting,
    charCount: count,
  };
}

/** 制造站单条产线状态 */
export interface ManufactureState {
  kind: "producing" | "done" | "idle";
  /** 进度 0..100（producing 时按批次时间窗估算） */
  percent: number;
  /** 预计完成时间戳（秒；idle 为 -1） */
  completeAtTs: number;
}

/**
 * 制造站单条产线状态。
 *
 * ⚠️ `completeWorkTime` 在**空闲**的设施上不会是 -1，而是**上一次生产遗留的时间戳**
 * （实测官服账号四个制造站全部 `weight: 0`、`complete: 0`，`completeWorkTime` 却都已过期）。
 * 所以「有时间戳且已过期」**不能**当成「有待收取」—— 那样空闲的站会一直显示
 * 「有待收取」。真正的完成标志是 `complete > 0`（已完成待领取的批次数）。
 */
export function manufactureState(
  segment: ArknightsRoomSegment | null | undefined,
  nowMs: number,
): ManufactureState {
  if (!segment) return { kind: "idle", percent: 0, completeAtTs: -1 };
  const cwt = segment.completeWorkTime ?? -1;
  const cwtMs = cwt * 1000;
  const pending = segment.complete ?? 0;
  if (cwt > 0 && cwtMs > nowMs) {
    const spanMs = cwtMs - (segment.lastUpdateTime ?? 0) * 1000;
    const doneMs = nowMs - (segment.lastUpdateTime ?? 0) * 1000;
    const percent = spanMs > 0 ? Math.min(100, Math.max(0, (doneMs / spanMs) * 100)) : 0;
    return { kind: "producing", percent, completeAtTs: cwt };
  }
  // 时间戳过期只有在「确实有产物待领取」时才算完成，否则是上一次生产的残留
  if (pending > 0) {
    return { kind: "done", percent: 100, completeAtTs: cwt };
  }
  return { kind: "idle", percent: 0, completeAtTs: -1 };
}

/**
 * 「联络次数」上限（公开招募刷新用的次数，游戏内满 3 次即封顶）。
 *
 * ⚠️ 这不是「每日刷新次数」：联络次数会随时间自动恢复、**可跨天累积**，
 * 到 3 就停。所以界面写「今日已用 x/3」是错的，应写「当前 x/3」。
 */
export const HIRE_REFRESH_LIMIT = 3;

/** 办公室联络次数状态（`building.hire`） */
export interface HireRefreshState {
  /** **当前持有**的联络次数（0..[HIRE_REFRESH_LIMIT]，不是"今日已用"） */
  used: number;
  total: number;
  /** 距离**下次恢复一次**的毫秒数；0 = 不用等（已满或时间戳缺失） */
  remainMs: number;
  /** 是否已满 3 次（满了就不再恢复，也不显示倒计时） */
  ready: boolean;
}

/**
 * 办公室「联络次数」状态。
 *
 * 实测语义（`building.hire`）：
 * - `refreshCount` = **当前持有**的联络次数（0..3），满了就停在 3；
 * - `completeWorkTime` = **下次 +1** 的时间戳（已过期 = 已经恢复好了，只是还没用掉）。
 *
 * 因此「满了」要看 `refreshCount >= 3`，**不能**看 `remainMs <= 0` ——
 * 后者只说明这一刻刚好恢复了一次，和上限无关。
 */
export function hireRefreshState(
  hire: ArknightsHire | null | undefined,
  nowMs: number,
): HireRefreshState {
  const used = Math.min(Math.max(hire?.refreshCount ?? 0, 0), HIRE_REFRESH_LIMIT);
  const full = used >= HIRE_REFRESH_LIMIT;
  const cwt = hire?.completeWorkTime ?? 0;
  // 满了就不再恢复，倒计时无意义
  const remainMs = full || cwt <= 0 ? 0 : Math.max(0, cwt * 1000 - nowMs);
  return {
    used,
    total: HIRE_REFRESH_LIMIT,
    remainMs,
    ready: full,
  };
}

/** 训练室当前状态：空闲 / 专精中 */
export interface TrainingState {
  /** 是否有受训干员（`trainee` 存在，哪怕 `targetSkill == -1` 只是待命） */
  hasTrainee: boolean;
  /** 是否在进行专精（`trainee.targetSkill >= 0`） */
  specializing: boolean;
  /** 受训干员 charId（缺省为空串） */
  traineeId: string;
  /** 训练员 charId（缺省为空串） */
  trainerId: string;
}

export function trainingState(
  training: ArknightsTraining | null | undefined,
): TrainingState {
  const trainee = training?.trainee ?? null;
  return {
    hasTrainee: Boolean(trainee && trainee.charId),
    specializing: Boolean(trainee && trainee.targetSkill >= 0),
    traineeId: trainee?.charId ?? "",
    trainerId: training?.trainer?.charId ?? "",
  };
}

/** 槽位归属：FACILITY_ORDER 里的设施键，或办公室 / 训练室 */
export type RoomSlotOwner = FacilityKey | "hire" | "training";

/**
 * 把内部槽位 id（如 `slot_32`）解析成「哪个设施的第几个」。
 *
 * 槽位 id 是接口的内部标识，**不应该直接显示给用户**。解析不到的返回 `null`
 * （`tiredChars[].roomSlotId` 实测会指向接口没下发的房间），调用方此时不要显示 id。
 */
export function locateRoomSlot(
  building: ArknightsBuilding | null | undefined,
  slotId: string | null | undefined,
): { key: RoomSlotOwner; index: number } | null {
  if (!building || !slotId) return null;
  for (const key of FACILITY_ORDER) {
    const segments = building[key] ?? [];
    const index = segments.findIndex((segment) => segment.slotId === slotId);
    if (index >= 0) return { key, index };
  }
  // 办公室 / 训练室不在 FACILITY_ORDER 里，单独比对
  if (building.hire?.slotId === slotId) return { key: "hire", index: 0 };
  if (building.training?.slotId === slotId) return { key: "training", index: 0 };
  return null;
}

/** 贸易站订单摘要 */
export function tradingSummary(segment: ArknightsRoomSegment | null | undefined): {
  count: number;
  limit: number;
  isGold: boolean;
} {
  const stock = segment?.stock ?? [];
  return {
    count: stock.length,
    limit: segment?.stockLimit ?? 0,
    isGold: (segment?.strategy ?? "") === "O_GOLD",
  };
}

/** 设施内干员的平均心情百分比（0..100） */
export function roomMoodPercent(segment: ArknightsRoomSegment | null | undefined): number {
  const chars = segment?.chars ?? [];
  if (chars.length === 0) return 0;
  const sum = chars.reduce((acc, c) => acc + arknightsMoodPercent(c.ap), 0);
  return sum / chars.length;
}
