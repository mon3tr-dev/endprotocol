/**
 * 《明日方舟》前端数据类型 —— 与后端 `src-tauri/src/models/arknights.rs` 一一对应。
 *
 * 只收录前端（公开招募卡片/页面、基地卡片/页面、游戏数据页面）用到的字段；
 * 接口原样给的大字段（charAssets、skinInfoMap 等）不建模，后端解析时已忽略。
 *
 * # 空值约定（与后端一致）
 * - `building.hire` / `building.training` / 房间 `clue` 在真实返回里可能是 null；
 * - 容器字段缺失走默认值（空数组 / 空表 / 0），前端**必须**判空兜底；
 * - 旧版缓存的 `dataVersion` 为 0（见 `arknightsDataService` 的自动刷新逻辑）。
 */

/** `player/info` 数据结构版本（与后端 ARKNIGHTS_DATA_VERSION 同步） */
export const ARKNIGHTS_DATA_VERSION = 1;

/** 「当前/总量」对（理智、任务进度、奖章进度等） */
export interface ArknightsProgress {
  current: number;
  total: number;
}

/** 玩家账号全量数据（`GET /api/v1/game/player/info?uid=` 的 `data`） */
export interface ArknightsPlayerInfo {
  status: ArknightsStatus;
  /** 干员静态信息表：charId → {id, name, ...}（基建干员名从这里取） */
  charInfoMap: Record<string, ArknightsCharInfo>;
  /** 公共招募栏位（实测恒 4 个） */
  recruit: ArknightsRecruitSlot[];
  /** 数据生成时间戳（秒）——倒计时的基准 */
  currentTs: number;
  building: ArknightsBuilding;
  /** 主线关卡展示信息表：键 = `status.mainStageProgress` 指向的关卡 id（最多 1 项） */
  stageInfoMap: Record<string, ArknightsStageInfo>;
  /** 各活动/章节的通关进度（含复刻） */
  activity: ArknightsActivityProgress[];
  /** 活动静态信息表：actId → 名称/类别/起止时间 */
  activityInfoMap: Record<string, ArknightsActivityInfo>;
  /** 剿灭据点信息表：campId → 名称 */
  campaignInfoMap: Record<string, ArknightsNamedInfo>;
  /** 集成战略主题信息表：rogueId → 名称/排序 */
  rogueInfoMap: Record<string, ArknightsNamedInfo>;
  /** 保全派驻训练场信息表：towerId → 名称/副标题 */
  towerInfoMap: Record<string, ArknightsNamedInfo>;
  /** 集成战略（各主题进度） */
  rogue: ArknightsRogue;
  /** 沙中之地（沙盒）进度 */
  sandbox: ArknightsSandbox[];
  /** 历险签约记录 */
  bossRush: ArknightsBossRush[];
  /** 结构版本标记：0 = 旧缓存（缺新字段），由服务自动强制刷新 */
  dataVersion: number;
}

/** 干员静态信息（charInfoMap 的值，裁剪后只留展示字段） */
export interface ArknightsCharInfo {
  id: string;
  name: string;
  /** 稀有度 0..5（内部值） */
  rarity: number;
  /** 职业（PICTOR 观测/CASTER 等） */
  profession: string;
}

/** 玩家基础状态（`data.status`，本文件只收录招募/基地/游戏数据页需要的部分） */
export interface ArknightsStatus {
  name: string;
  uid: string;
  level: number;
  /** 理智 */
  ap: ArknightsAp;
  /** 主线进度标识（如 `main_15-09`；B 服账号实测可能为空串） */
  mainStageProgress: string;
  /** 看板干员 */
  secretary?: ArknightsSecretary | null;
  /** 森空岛后端最后一次同步游戏数据的时间戳 */
  storeTs: number;
  avatar?: ArknightsAvatar | null;
}

export interface ArknightsAp {
  current: number;
  max: number;
  /** 上次恢复理智的时间戳 */
  lastApAddTime: number;
  /** 理智回满时间戳 */
  completeRecoveryTime: number;
}

export interface ArknightsSecretary {
  charId: string;
  skinId: string;
}

export interface ArknightsAvatar {
  id: string;
  type: string;
  url: string;
  /** 缓存时由后端填充的 base64（老缓存缺失） */
  base64?: string | null;
}

/** 公共招募栏位（`data.recruit[]`） */
export interface ArknightsRecruitSlot {
  /**
   * 槽位状态：0 = 未开放（会客室等级不足），1 = 空闲可用，2 = 招募进行中
   * （state==2 且 finishTs 已过 = 已完成待领取）
   */
  state: number;
  /** 开始时间戳（未使用时为 -1） */
  startTs: number;
  /** 结束时间戳（未使用时为 -1） */
  finishTs: number;
}

/** 基建（`data.building`） */
export interface ArknightsBuilding {
  /** 无人机（未建控制中枢时可能为 null） */
  labor: ArknightsLabor | null;
  /** 办公室（公开招募刷新），未建造时为 null */
  hire: ArknightsHire | null;
  /** 训练室（技能专精），无进行中专精时可能为 null */
  training: ArknightsTraining | null;
  /** 疲劳干员（心情耗尽仍在工作） */
  tiredChars: ArknightsRoomChar[];
  control: ArknightsRoomSegment[];
  powers: ArknightsRoomSegment[];
  tradings: ArknightsRoomSegment[];
  manufactures: ArknightsRoomSegment[];
  dormitories: ArknightsRoomSegment[];
  meeting: ArknightsRoomSegment[];
}

/** 无人机（`building.labor`） */
export interface ArknightsLabor {
  value: number;
  maxValue: number;
  /** 距离补满的剩余秒数（按 lastUpdateTime 计算） */
  remainSecs: number;
  lastUpdateTime: number;
}

/** 办公室（`building.hire`）—— 公开招募刷新 */
export interface ArknightsHire {
  /** 已用刷新次数（上限 3） */
  refreshCount: number;
  /** 下次刷新完成时间戳 */
  completeWorkTime: number;
  level: number;
  slotId: string;
  slotState: number;
  state: number;
  chars: ArknightsRoomChar[];
}

/** 训练室（`building.training`）—— 技能专精 */
export interface ArknightsTraining {
  trainee: ArknightsTrainee | null;
  trainer: ArknightsTrainer | null;
  /** 训练速度加成（1.35 = +35%，注意可能给整数或小数） */
  speed: number;
  /** 剩余训练点数（可能是小数） */
  remainPoint: number;
  /** 距离完成的剩余秒数（按请求时间计算） */
  remainSecs: number;
}

export interface ArknightsTrainee {
  charId: string;
  /** 目标技能下标；-1 表示空位 */
  targetSkill: number;
}

export interface ArknightsTrainer {
  charId: string;
}

/** 一个设施内的排班段（control / powers / tradings / manufactures / dormitories / meeting） */
export interface ArknightsRoomSegment {
  chars: ArknightsRoomChar[];
  level: number;
  slotId: string;
  /** 槽位状态（control 才有；2 = 工作中） */
  slotState: number;
  /** 制造站容量 */
  capacity: number;
  /** 制造站当前占用 */
  weight: number;
  /** 制造站配方 id */
  formulaId: string;
  /** 制造站剩余产量 */
  remain: number;
  /** 制造站已完成批次数 */
  complete: number;
  /** 制造站完成时间戳（-1 = 无进行中批次） */
  completeWorkTime: number;
  /** 设施最近一次数据刷新时间戳 */
  lastUpdateTime: number;
  /** 生产/加工速度加成（可能是小数） */
  speed: number;
  /** 宿舍舒适度 */
  comfort: number;
  /** 贸易站当前库存订单（仅 tradings） */
  stock: ArknightsTradingOrder[];
  /** 贸易站订单上限 */
  stockLimit: number;
  /** 贸易站订单策略（O_GOLD = 龙门币订单） */
  strategy: string;
  /** 会客室线索（仅 meeting；未解锁/缺失为 null） */
  clue: ArknightsClue | null;
}

/** 贸易站的一笔订单 */
export interface ArknightsTradingOrder {
  delivery: ArknightsOrderItem[];
  /** 收益（如 1000 龙门币） */
  gain: ArknightsOrderItem | null;
  instId: number;
  type: string;
}

export interface ArknightsOrderItem {
  id: string;
  count: number;
  type: string;
}

/** 会客室线索（`meeting.clue`） */
export interface ArknightsClue {
  /** 摆放中的线索派系（RHODES / BLACKSTEEL ...） */
  board: string[];
  /** 今日碎片奖励是否已领 */
  dailyReward: boolean;
  needReceive: number;
  own: number;
  received: number;
  sharing: boolean;
}

/** 设施内的一名干员 */
export interface ArknightsRoomChar {
  charId: string;
  /** 心情值：ap / 360000 = 心情点数（0..24） */
  ap: number;
  index: number;
  lastApAddTime: number;
  /** 已连续工作时长（秒） */
  workTime: number;
}

/** 主线关卡展示信息（`stageInfoMap` 的值） */
export interface ArknightsStageInfo {
  id: string;
  /** 展示用关卡号（如 `15-10`，与 id 可能差 1，以 code 为准展示） */
  code: string;
  name: string;
  zoneId: string;
  stageType: string;
  difficulty: string;
  apCost: number;
}

/** 一个活动/章节的通关进度（`data.activity[]`） */
export interface ArknightsActivityProgress {
  actId: string;
  /** 复刻活动 id（非复刻为空串） */
  actReplicaId: string;
  zones: ArknightsActivityZone[];
}

/** 活动内一个分区的通关进度 */
export interface ArknightsActivityZone {
  zoneId: string;
  zoneReplicaId: string;
  clearedStage: number;
  /** 分区总关卡数（0 = 未开放/无内容） */
  totalStage: number;
}

/** 活动静态信息（`activityInfoMap` 的值） */
export interface ArknightsActivityInfo {
  id: string;
  name: string;
  /** SIDESTORY（别传）/ MINISTORY（插曲）/ BRANCHLINE（支线），可为空串 */
  type: string;
  startTime: number;
  endTime: number;
  picUrl: string;
}

/** 剿灭据点 / 集成战略主题 / 保全训练场共用的信息表条目 */
export interface ArknightsNamedInfo {
  id: string;
  name: string;
  picUrl: string;
  /** 仅保全训练场有 */
  subName: string;
  /** 仅集成战略有（主题排序号） */
  sort: number;
}

/** 集成战略进度（`data.rogue`） */
export interface ArknightsRogue {
  records: ArknightsRogueRecord[];
}

/** 一个集成战略主题的进度 */
export interface ArknightsRogueRecord {
  rogueId: string;
  bpLevel: number;
  /** 首次通关时间戳（0 = 未通关） */
  clearTime: number;
  /** 前置储备（current/record，注意不是 total） */
  bank: { current: number; record: number };
  /** 主题奖章进度 */
  medal: ArknightsProgress;
  /** 收藏遗书数 */
  relicCnt: number;
}

/** 沙中之地（沙盒）进度 */
export interface ArknightsSandbox {
  id: string;
  name: string;
  baseLv: number;
  mainQuest: number;
  unlockNode: number;
  enemyKill: number;
  maxDay: number;
  maxDayChallenge: number;
  createRift: number;
  /** 修复裂隙进度（[当前, 目标]） */
  fixRift: number[];
  subQuest: { id: string; name: string; done: boolean }[];
}

/** 历险签约记录 */
export interface ArknightsBossRush {
  id: string;
  picUrl: string;
  record: { difficulty: string; played: boolean; stageId: string };
}

/** 心情点数换算：ap/360000 = 0..24 点（与后端约定一致） */
export const ARKNIGHTS_MOOD_DIVISOR = 360000;
/** 心情上限（点数） */
export const ARKNIGHTS_MOOD_MAX = 24;

/** 干员头像（半身像）CDN 前缀。
 *
 * `player/info` 接口**不下发**干员头像（`charInfoMap` 无图片字段，
 * `charAssets`/`skinAssets` 实测为空数组），但官方 CDN 存在确定规律：
 * `https://web.hycdn.cn/arknights/game/assets/char/portrait/{charId}.png`
 * （已实测 char_002_amiya / char_4234_pedro / char_1021_kroos2（token 干员）等 12 个 id 均返回 200）。
 */
export const ARKNIGHTS_PORTRAIT_BASE =
  "https://web.hycdn.cn/arknights/game/assets/char/portrait/";

/** 按 charId 拼干员头像地址 */
export function arknightsPortraitUrl(charId: string): string {
  return `${ARKNIGHTS_PORTRAIT_BASE}${charId}.png`;
}

/** 由 ap 原始值换算心情点数（0..24，保留 1 位小数） */
export function arknightsMoodOf(ap: number): number {
  return Math.round((ap / ARKNIGHTS_MOOD_DIVISOR) * 10) / 10;
}

/** 心情恢复/消耗进度（0..100，24 点 = 100%） */
export function arknightsMoodPercent(ap: number): number {
  return Math.min(100, Math.max(0, ((ap / ARKNIGHTS_MOOD_DIVISOR) / ARKNIGHTS_MOOD_MAX) * 100));
}
