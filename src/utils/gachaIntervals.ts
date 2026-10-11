import type { GachaRecord } from "@/types/gacha";

export interface GachaSixStarInterval {
  record: GachaRecord;
  poolId: string;
  poolName: string;
  sixStarIndex: number;
  count: number;
  inGift: boolean;
}

/**
 * Calculate each six-star event independently per pool.
 * Free pulls without a six-star do not count; a free six-star counts through
 * its position in the current consecutive free-pull group.
 */
export function calculateGachaSixStarIntervals(
  records: GachaRecord[],
  pools: Record<string, { poolName?: string }> = {},
): GachaSixStarInterval[] {
  const chrono = records
    .filter((record) => record.kind === "draw")
    .sort((a, b) => Number(a.gachaTs) - Number(b.gachaTs));
  const since = new Map<string, number>();
  const giftPosition = new Map<string, number>();
  const sixStarCounts = new Map<string, number>();
  const intervals: GachaSixStarInterval[] = [];

  for (const record of chrono) {
    const poolId = record.poolId;
    const index = (sixStarCounts.get(poolId) ?? 0) + 1;
    if (record.isFree) {
      const position = (giftPosition.get(poolId) ?? 0) + 1;
      giftPosition.set(poolId, position);
      if ((record.rarity ?? 0) !== 6) continue;

      intervals.push({
        record,
        poolId,
        poolName: record.poolName || pools[poolId]?.poolName || poolId,
        sixStarIndex: index,
        count: (since.get(poolId) ?? 0) + position,
        inGift: true,
      });
      sixStarCounts.set(poolId, index);
      since.set(poolId, 0);
      giftPosition.set(poolId, 0);
      continue;
    }

    giftPosition.set(poolId, 0);
    if ((record.rarity ?? 0) === 6) {
      intervals.push({
        record,
        poolId,
        poolName: record.poolName || pools[poolId]?.poolName || poolId,
        sixStarIndex: index,
        count: (since.get(poolId) ?? 0) + 1,
        inGift: false,
      });
      sixStarCounts.set(poolId, index);
      since.set(poolId, 0);
    } else {
      since.set(poolId, (since.get(poolId) ?? 0) + 1);
    }
  }

  return intervals;
}
