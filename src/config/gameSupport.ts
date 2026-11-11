import type { GameId } from "@/utils/accountService";

/**
 * 「卡片 / 页面 → 支持的游戏」单一真值表。
 *
 * 为什么要集中在一处：侧边栏（只显示支持的项目）、添加卡片弹窗（右边标注支持
 * 的游戏、不支持的禁止选择）、各卡片自己的「切换账户」弹窗（只列出兼容的账户）
 * 三处必须给出**同一个答案**。分散写死在各处时，加一张卡片要改三四个地方，
 * 而且很容易漏掉某一处，表现为「侧栏能进、卡片加不出来」这种自相矛盾的状态。
 *
 * 数据层的依据（后端已就绪的《明日方舟》链路）：
 * - `get_arknights_player_info`：等级/理智/主线/干员数/日常周常/剿灭
 * - `get_arknights_cultivate`：仓库
 * - `get_arknights_attendance` / `do_arknights_attendance`：签到
 * - `get_arknights_gacha_categories` + 寻访记录：抽卡页
 *
 * 终末地独占的卡片依赖 `/api/v1/game/endfield/card/detail`（`query_role_data`），
 * 明日方舟没有对应接口，所以这些卡片对明日方舟账户一律不可用。
 */

/** 全部游戏，顺序即徽标展示顺序（与 `GAME_META` 一致）。 */
export const ALL_GAME_IDS: GameId[] = ["endfield", "arknights"];

/** 老缓存里 `game` 缺失时按终末地处理（与后端 `models::role::GAME_ENDFIELD` 默认一致）。 */
export function normalizeGameId(game?: string | null): GameId {
  return game === "arknights" ? "arknights" : "endfield";
}

/**
 * 仪表盘卡片类型 → 支持的游戏。
 *
 * 未登记的类型按「两个游戏都支持」处理：新卡片默认不阻塞用户，
 * 若它其实依赖终末地数据，再补一行即可。
 */
export const CARD_GAME_SUPPORT: Record<string, GameId[]> = {
  // —— 两个游戏都支持 ——
  // 签到：终末地 `/web/v1/game/endfield/attendance`，明日方舟 `/api/v1/game/attendance`
  attendance: ["endfield", "arknights"],
  // 账户信息：终末地读 `char_detail.base`，明日方舟读 `player/info.status`
  account_info: ["endfield", "arknights"],
  // 账户进度：终末地读 `dungeon/bpSystem/dailyMission/weeklyMission`，
  // 明日方舟读 `status.ap` + `routine.daily/weekly`
  account_progress: ["endfield", "arknights"],

  // —— 与游戏无关（系统资源、待办）——
  // 它们不读任何游戏数据，因此**不该**被某个游戏挡住，
  // 也不需要打「支持某游戏」的徽标 —— 打了反而误导。
  system_resource: [],
  todo: [],

  // —— 终末地独占（依赖 `card/detail` 的详情结构）——
  // 干员列表：明日方舟的干员数据结构完全不同，另行接入前先不支持
  character_list: ["endfield"],
  // 光荣之路（勋章）：`achieve.achieveMedals` 仅终末地有
  achievement: ["endfield"],
  // 区域信息：`base.domain` 仅终末地有（明日方舟没有「区域」概念）
  domain_info: ["endfield"],
  // 帝江号：`spaceShip` 仅终末地有
  spaceship: ["endfield"],
};

/** 页面 → 支持的游戏。键与侧边栏 `NavKey`、路由首段一致。 */
export const PAGE_GAME_SUPPORT: Record<string, GameId[]> = {
  dashboard: ["endfield", "arknights"], // 标签页里可以只放通用卡片
  attendance: ["endfield", "arknights"],
  gacha: ["endfield", "arknights"], // 两套寻访 API 已分流
  todo: ["endfield", "arknights"],
  characters: ["endfield"],
  medals: ["endfield"],
  domain: ["endfield"],
  spaceship: ["endfield"],
};

/** 侧边栏导航键 → 路由。 */
export const NAV_ROUTES: Record<string, string> = {
  dashboard: "/",
  characters: "/characters",
  medals: "/medals",
  attendance: "/attendance",
  gacha: "/gacha",
  todo: "/todo",
  domain: "/domain",
  spaceship: "/spaceship",
};

/**
 * 该卡片支持哪些游戏。
 *
 * - 返回空数组：卡片与游戏无关（系统资源、待办），任何账户都能用，也不打徽标。
 * - 返回两个游戏：卡片通用，两个游戏下都能用。
 * - 返回一个游戏：卡片只支持该游戏，另一个游戏的账户不能选它。
 *
 * 唯一真值表是 `CARD_GAME_SUPPORT`。卡片 meta.json 里的 `supportedGames`
 * 只是**自描述文档**（新增卡片时对照填写），运行时不再读它 ——
 * 两处都写一份却只生效一份，比只写一处更容易让人踩坑。
 *
 * 未登记的类型按「两个游戏都支持」处理：新卡片默认不阻塞用户，
 * 若它其实依赖终末地数据，再补一行即可。
 */
export function gamesForCard(cardType: string): GameId[] {
  return CARD_GAME_SUPPORT[cardType] ?? ALL_GAME_IDS;
}

/** 卡片是否与游戏无关（不读任何游戏数据）。 */
export function isCardGameAgnostic(cardType: string): boolean {
  return gamesForCard(cardType).length === 0;
}

/**
 * 卡片是否支持某个游戏。
 *
 * 与游戏无关的卡片对任何游戏都「支持」。
 * `game` 缺失（尚未选中账户）时也视为「支持」。
 */
export function cardSupportsGame(cardType: string, game?: string | null): boolean {
  if (!game) return true;
  const games = gamesForCard(cardType);
  if (games.length === 0) return true;
  return games.includes(normalizeGameId(game));
}

/** 页面（按侧边栏导航键）是否支持某个游戏。`game` 缺失时视为「支持」。 */
export function pageSupportsGame(pageKey: string, game?: string | null): boolean {
  if (!game) return true;
  const games = PAGE_GAME_SUPPORT[pageKey];
  if (!games) return true;
  return games.includes(normalizeGameId(game));
}

/**
 * 按卡片支持的游戏筛账户。
 *
 * 各卡片「切换账户」弹窗都用它：明日方舟账户不会出现在终末地独占卡片的候选里，
 * 避免选了之后卡片必然报「无数据」。与游戏无关的卡片返回全部账户。
 */
export function filterAccountsForCard<T extends { game?: string | null }>(
  accounts: T[],
  cardType: string,
): T[] {
  return accounts.filter((account) => cardSupportsGame(cardType, account.game));
}

/** 按页面支持的游戏筛账户（如签到页只列支持签到的账户）。 */
export function filterAccountsForPage<T extends { game?: string | null }>(
  accounts: T[],
  pageKey: string,
): T[] {
  return accounts.filter((account) => pageSupportsGame(pageKey, account.game));
}

/** 侧边栏导航键是否对当前游戏可见。 */
export function isNavVisible(navKey: string, game?: string | null): boolean {
  return pageSupportsGame(navKey, game);
}
