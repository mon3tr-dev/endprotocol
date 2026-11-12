/**
 * 基地数据卡片与独立页面共享的类型工具与设施状态计算。
 *
 * 数据来自 `player/info.building`（labor/hire/training/各设施排班）。
 * 心情换算与空值约定见 `src/types/arknights.ts`（ap/360000 = 0..24 点）。
 */

import { arknightsMoodOf, arknightsMoodPercent, type ArknightsBuilding, type ArknightsLabor, type ArknightsRoomSegment } from "@/types/arknights";

export type { ArknightsBuilding, ArknightsLabor, ArknightsRoomSegment };

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

export function manufactureState(
  segment: ArknightsRoomSegment | null | undefined,
  nowMs: number,
): ManufactureState {
  if (!segment) return { kind: "idle", percent: 0, completeAtTs: -1 };
  const cwt = segment.completeWorkTime ?? -1;
  const cwtMs = cwt * 1000;
  if (cwt > 0 && cwtMs > nowMs) {
    const spanMs = cwtMs - (segment.lastUpdateTime ?? 0) * 1000;
    const doneMs = nowMs - (segment.lastUpdateTime ?? 0) * 1000;
    const percent = spanMs > 0 ? Math.min(100, Math.max(0, (doneMs / spanMs) * 100)) : 0;
    return { kind: "producing", percent, completeAtTs: cwt };
  }
  if ((segment.complete ?? 0) > 0 || (cwt > 0 && cwtMs <= nowMs)) {
    return { kind: "done", percent: 100, completeAtTs: cwt };
  }
  return { kind: "idle", percent: 0, completeAtTs: -1 };
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
