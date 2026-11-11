/**
 * 判断《明日方舟》今天是否已签到。
 *
 * 明日方舟的签到响应没有终末地那个 `hasToday` 字段，只能自己推。两条路：
 *
 * 1. **签到记录**（主）：`records[]` 是本月签到流水，`ts` 是签到时刻（秒）。
 *    只要有一条落在「今天」（本地自然日）就算已签。这是最可靠的判据 ——
 *    它直接对应「签到动作真的发生过」。
 *
 * 2. **当天日历格**（辅）：`calendar` 是本月日历。若能定位到今天的格子，
 *    它的 `done` 也是答案。定位方式是按「今天在本月的第几天」取格 ——
 *    日历通常从 1 号开始排，因此第 N 天对应第 N 格（下标 N-1）。
 *
 * ⚠️ 不用 `available` 判定：实测明日方舟的日历项 `available` 恒为 false，
 * 它不是终末地「今天可领取」的语义，拿它判断会永远判成「未签」。
 */

/** 取时间戳所在的本地自然日（YYYY-MM-DD）。时间戳单位为秒。 */
function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * @param calendar 明日的日历数组（`{resourceId, done, available, count, type}`）
 * @param data 整个 `data` 对象（含 `records[]` 与 `currentTs`）
 */
export function detectSignedToday(calendar: any[], data: any): boolean {
  // —— 路径 1：签到记录里有今天的流水 ——
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  const currentTs = Number(data?.currentTs ?? 0);
  if (currentTs > 0 && records.length > 0) {
    const todayKey = localDayKey(currentTs);
    for (const record of records) {
      const ts = Number(record?.ts);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      if (localDayKey(ts) === todayKey) return true;
    }
  }

  // —— 路径 2：当天日历格的 done ——
  // 日历通常从 1 号排起：今天的日号 - 1 即下标。越界说明日历不是从 1 号起
  // （比如刚绑定只显示剩余天数），此时不能靠它判定。
  if (currentTs > 0 && Array.isArray(calendar) && calendar.length > 0) {
    const dayOfMonth = new Date(currentTs * 1000).getDate();
    const idx = dayOfMonth - 1;
    if (idx >= 0 && idx < calendar.length) {
      return Boolean(calendar[idx]?.done);
    }
  }

  // 两条路都给不出结论时，保守判「已签」——
  // 判成未签会让界面显示可点击的签到按钮，用户点下去后端返回「请勿重复签到」，
  // 反而显得是故障；判成已签最多是少显示一次可领奖励。
  return true;
}
