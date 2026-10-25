/**
 * 帝江号卡片与独立页面共享的数据类型与工具
 */
import type { CharacterItem } from "@/types/charDetail";

export interface SpaceShipRoomChar {
  charId?: string;
  physicalStrength?: number;
  favorability?: number;
  avatarUrl?: string;
}

export interface SpaceShipRoom {
  id?: string;
  type?: number;
  level?: number;
  chars?: SpaceShipRoomChar[];
  reports?: Record<string, unknown>;
}

export type TrustLevelKey = "friendly" | "close" | "trust";

export const MOOD_MAX = 10000;
export const TRUST_CLOSE_THRESHOLD = 300;
export const TRUST_MAX_THRESHOLD = 1500;

export const ROOM_META: Record<number, { key: string; icon: string }> = {
  0: { key: "control", icon: "satellite" },
  1: { key: "manufacturing", icon: "factory" },
  2: { key: "growth", icon: "sprout" },
  5: { key: "reception", icon: "bell" },
};

export const TRUST_TEXT_CLASS: Record<TrustLevelKey, string> = {
  friendly: "text-muted",
  close: "text-primary",
  trust: "text-warning",
};

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function getMoodPercent(physicalStrength: number | undefined): number {
  return clamp(Math.round(((physicalStrength ?? 0) / MOOD_MAX) * 100), 0, 100);
}

export function getTrustPercent(favorability: number | undefined): number {
  const fav = favorability ?? 0;
  if (fav >= TRUST_MAX_THRESHOLD) return 200;
  if (fav >= TRUST_CLOSE_THRESHOLD) {
    // 亲近段：(fav - 300) / 1200 * 100，向下取整
    return clamp(
      100 +
        Math.floor(
          ((fav - TRUST_CLOSE_THRESHOLD) /
            (TRUST_MAX_THRESHOLD - TRUST_CLOSE_THRESHOLD)) *
            100,
        ),
      100,
      199,
    );
  }
  return clamp(Math.floor((fav / TRUST_CLOSE_THRESHOLD) * 100), 0, 99);
}

export function getTrustLevel(favorability: number | undefined): TrustLevelKey {
  const fav = favorability ?? 0;
  if (fav >= TRUST_MAX_THRESHOLD) return "trust";
  if (fav >= TRUST_CLOSE_THRESHOLD) return "close";
  return "friendly";
}

export function getMoodRingClass(pct: number): string {
  if (pct >= 50) return "border-success/70";
  if (pct >= 25) return "border-warning/70";
  return "border-danger/70";
}

export function getMoodTextClass(pct: number): string {
  if (pct >= 50) return "text-success";
  if (pct >= 25) return "text-warning";
  return "text-danger";
}

export function getMoodBarClass(pct: number): string {
  if (pct >= 50) return "bg-gradient-to-r from-success/70 to-success";
  if (pct >= 25) return "bg-gradient-to-r from-warning/70 to-warning";
  return "bg-gradient-to-r from-danger/70 to-danger";
}

export function getRoomMeta(type: number | undefined) {
  return ROOM_META[type ?? -1] ?? null;
}

export interface StationedCharView {
  charId: string;
  name: string;
  avatar: string;
  moodPct: number;
  trustPct: number;
  trustLevel: TrustLevelKey;
}

export function collectSpaceshipIds(char: CharacterItem): string[] {
  const d = char.charData;
  return [
    ...(d.cultivationTalents || []).map((t) => t.id),
    ...(d.combatTalents || []).map((t) => t.id),
    ...(d.abilityTalents || []).map((t) => t.id),
    ...(char.talent?.latestSpaceshipSkillNodes || []),
    ...(char.talent?.latestFactorySkillNodes || []),
  ];
}

/** 总控中枢置顶，其余保持接口顺序；未识别类型的舱室不展示 */
export function sortSpaceshipRooms(rooms: SpaceShipRoom[]): SpaceShipRoom[] {
  return rooms
    .filter((r) => getRoomMeta(r.type))
    .sort((a, b) => {
      const aCtrl = a.type === 0 ? 0 : 1;
      const bCtrl = b.type === 0 ? 0 : 1;
      return aCtrl - bCtrl;
    });
}
