/**
 * 公开招募卡片与独立页面共享的类型与格式化工具。
 *
 * 数据来自 `player/info.recruit[]`（4 个栏位）+ `building.hire`（人力资源办公室的「联络次数」）。
 * 倒计时以**客户端时钟**为准（每秒重算），`player/info.currentTs` 只在页面详情里
 * 用来提示「数据快照时间」。
 */

/** 槽位展示状态 */
export type RecruitSlotState =
  | "locked" // 未开放（0）
  | "free" // 空闲可用（1）
  | "running" // 招募进行中（2 且未到 finishTs）
  | "finished"; // 已完成待领取（2 且已过 finishTs）

export interface RecruitSlotRaw {
  state: number;
  startTs: number;
  finishTs: number;
}

/**
 * 把接口的 `state` 折成展示状态。
 *
 * 实测取值：0 = 未开放、1 = 空闲、2 = 进行中（startTs/finishTs 为 -1 表示未使用）。
 * 「已完成」不是独立 state，而是 `state == 2 && finishTs <= now`，必须现算。
 */
export function recruitSlotState(slot: RecruitSlotRaw, nowMs: number): RecruitSlotState {
  if (slot.state === 2 && slot.finishTs > 0) {
    return slot.finishTs * 1000 <= nowMs ? "finished" : "running";
  }
  if (slot.state === 1) return "free";
  if (slot.state === 0) return "locked";
  return slot.state === 2 ? "running" : "free";
}

/** 槽位剩余毫秒数（running 状态下才有意义） */
export function recruitRemainingMs(slot: RecruitSlotRaw, nowMs: number): number {
  if (slot.finishTs <= 0) return 0;
  return Math.max(0, slot.finishTs * 1000 - nowMs);
}

/** 槽位进度（0..100，running 状态下按 start→finish 区间算） */
export function recruitProgressPercent(slot: RecruitSlotRaw, nowMs: number): number {
  if (slot.startTs <= 0 || slot.finishTs <= slot.startTs) return 0;
  const span = (slot.finishTs - slot.startTs) * 1000;
  const done = nowMs - slot.startTs * 1000;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, (done / span) * 100));
}

/**
 * 剩余时间格式化：< 1 天 → `HH:MM:SS`；≥ 1 天 → `Xd HH:MM:SS`。
 *
 * en 用 `d` 后缀，zh 用「天」，其余分隔符共用（数字为主，无需完整翻译）。
 */
export function formatCountdown(ms: number, lang: string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (days <= 0) return hms;
  const dayLabel = lang.startsWith("zh") ? "天" : "d";
  return `${days}${dayLabel} ${hms}`;
}

/** 时间戳 → `MM-DD HH:mm`（本地时区） */
export function formatShortDateTime(ts: number | undefined): string {
  if (!ts || ts <= 0) return "--";
  const d = new Date(ts * 1000);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mo}-${day} ${h}:${mi}`;
}
