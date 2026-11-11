/**
 * 《明日方舟》签到数据的判定与归一化。
 *
 * # 关键事实（2026-11-11 真实抓包确认）
 *
 * `GET /api/v1/game/attendance?uid=` 的 `data` 形如：
 *
 * ```json
 * { "currentTs": "1794405833",
 *   "calendar": [ {"resourceId":"2002","count":3,"available":false,"done":true},
 *                 {"resourceId":"4001","count":500,"available":true,"done":false},
 *                 ... 共 30 项 ... ],
 *   "records": [ {"ts":"1794240000","resourceId":"2002","type":"daily","count":3} ],
 *   "first": null,
 *   "resourceInfoMap": { "4001": {"id":"4001","type":"GOLD","name":"龙门币",...} } }
 * ```
 *
 * **`calendar` 是「月度 30 格累计领取轨道」，不是日期网格。**
 *
 * 抓包时刻是 11 号 22:03，签到前：只有**下标 1** 是 `available:true, done:false`，
 * 下标 0 是 `done:true`，下标 2 之后全 false。点签到后
 * `POST /api/v1/game/attendance` 返回的 `awards` 正是下标 1 那格（`4001`×500）。
 *
 * 由此可得：
 * - `calendar[i]` 是「本月第 i+1 次签到」的奖励，**与日期无关**；
 * - `available` 标的是「当前可领的那一格」，不是终末地那种「今天可领取」；
 * - `done` 按天累加，最后一个 `done` 即「最近领到的那格」。
 *
 * ⚠️ 因此**绝不能**用「今天几号 - 1」当下标去索引日历（早期版本就是这么错的：
 * 11 号会去读下标 10，而那是第 11 次签到的奖励，`done` 必然是 false，
 * 于是永远判成「未签到」）。
 *
 * # 判「今天是否已签到」
 *
 * 唯一可靠判据是**是否存在 `available && !done` 的格子**：
 * 有 ⇒ 还能领 ⇒ 今天没签；没有 ⇒ 今天已签（或整月领完）。
 *
 * 后端已把结论算成 `hasToday` / `todayIndex` / `tomorrowIndex` 一并下发，
 * 这里优先用后端值，缺失时才本地按同一规则推（兼容老版本后端的响应）。
 */

/** 取出「当前可领」的格子下标（`available && !done` 的第一个） */
export function claimableIndex(calendar: any[] | undefined): number {
  if (!Array.isArray(calendar)) return -1;
  return calendar.findIndex((e) => Boolean(e?.available) && !Boolean(e?.done));
}

/** 取出「最近已领」的格子下标（最后一个 `done`） */
export function lastDoneIndex(calendar: any[] | undefined): number {
  if (!Array.isArray(calendar)) return -1;
  for (let i = calendar.length - 1; i >= 0; i--) {
    if (Boolean(calendar[i]?.done)) return i;
  }
  return -1;
}

/** 取时间戳所在的本地自然日（YYYY-MM-DD）。时间戳单位为秒。 */
function localDayKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `records[]` 里是否有落在 `currentTs` 当天的流水 */
function hasRecordToday(data: any): boolean {
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  const currentTs = Number(data?.currentTs ?? 0);
  if (!(currentTs > 0) || records.length === 0) return false;
  const todayKey = localDayKey(currentTs);
  return records.some((record) => {
    const ts = Number(record?.ts);
    return Number.isFinite(ts) && ts > 0 && localDayKey(ts) === todayKey;
  });
}

/**
 * 判断《明日方舟》今天是否已签到。
 *
 * @param calendar 签到日历（`{resourceId, done, available, count, type}[]`）
 * @param data     整个 `data` 对象（含 `records[]`、`currentTs`、可选的 `hasToday`）
 */
export function detectSignedToday(calendar: any[], data: any): boolean {
  // ① 后端已经算好了（当前版本总是给），直接用
  if (typeof data?.hasToday === "boolean") return data.hasToday;

  // ② 本地按同一规则推：有可领格 ⇒ 没签
  if (Array.isArray(calendar) && calendar.length > 0) {
    return claimableIndex(calendar) < 0;
  }

  // ③ 日历为空（刚绑定、服务端还没排轨道）→ 退回看签到流水
  if (hasRecordToday(data)) return true;

  // 两条路都给不出结论时保守判「已签」——
  // 判成未签会让界面显示可点的签到按钮，用户点下去后端返回「请勿重复签到」，
  // 反而显得是故障；判成已签最多是少显示一次可领奖励。
  return true;
}

/**
 * 计算「今日奖励」「明日奖励」在日历里的下标。
 *
 * - 未签：可领那格；已签：最近领到那格
 * - 明日：今日 + 1（越界为 null）
 *
 * 后端给了 `todayIndex` / `tomorrowIndex` 时优先用后端值。
 */
export function resolveSlotIndices(
  calendar: any[] | undefined,
  data: any,
): { todayIndex: number | null; tomorrowIndex: number | null } {
  const total = Array.isArray(calendar) ? calendar.length : 0;
  const isValid = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value < total;

  // 后端值优先
  if (isValid(data?.todayIndex)) {
    const todayIndex = data.todayIndex;
    const tomorrowIndex = isValid(data?.tomorrowIndex)
      ? data.tomorrowIndex
      : todayIndex + 1 < total
        ? todayIndex + 1
        : null;
    return { todayIndex, tomorrowIndex };
  }

  // 本地回退：可领格 → 最后一个已领格
  let todayIndex = claimableIndex(calendar);
  if (todayIndex < 0) todayIndex = lastDoneIndex(calendar);
  if (todayIndex < 0) {
    return total > 0
      ? { todayIndex: 0, tomorrowIndex: total > 1 ? 1 : null }
      : { todayIndex: null, tomorrowIndex: null };
  }
  const tomorrowIndex = todayIndex + 1 < total ? todayIndex + 1 : null;
  return { todayIndex, tomorrowIndex };
}
