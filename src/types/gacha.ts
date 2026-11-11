/** 卡池类型（页面分类用，对应后端 meta tab 的 key 前缀；weapon 为独立的武器寻访分类） */
export type GachaPoolKind = "special" | "joint" | "normal" | "weapon";

/** 页面分类：GachaPoolKind 外加 "all"（全部角色：限定+联合+常驻，不含武器） */
export type GachaCategory = GachaPoolKind | "all";

/**
 * 单条抽卡记录（对应后端 models/gacha.rs GachaRecord）。
 *
 * 终末地与《明日方舟》共用这一个结构 —— 后端在入库时已经把明日方舟的记录
 * **归一化成同一形状**（`rarity` 统一为星数、`seqId` 统一为稳定唯一键、
 * `kind` 统一为 `draw`），因此页面的统计、图表、筛选可以完全不区分游戏。
 * 两套 API 的真实差异见 `src-tauri/src/services/arknights_gacha_service.rs` 的模块文档。
 */
export interface GachaRecord {
  kind: string; // draw / gift_intel_book
  poolId: string;
  poolName: string;
  nameText: string;
  charId?: string | null;
  charName?: string | null;
  /** 武器寻访记录字段（仅终末地） */
  weaponId?: string | null;
  weaponName?: string | null;
  weaponType?: string | null;
  /** 星数（终末地原样；明日方舟由后端 +1 归一化） */
  rarity?: number | null;
  isFree?: boolean | null;
  isNew?: boolean | null;
  /** 毫秒时间戳（字符串） */
  gachaTs: string;
  /** 全局唯一序号（明日方舟为后端合成的 `{poolId}|{gachaTs}|{pos}`） */
  seqId: string;
  /**
   * 同一次十连内的序号 0..9（**仅明日方舟**，终末地恒为 undefined）。
   *
   * 明日方舟的 `gachaTs` 在一次十连里是**相同**的，必须靠 `pos` 区分与排序。
   */
  pos?: number | null;
}

/** 卡池信息 */
export interface GachaPoolInfo {
  poolName: string;
  poolType: string;
}

/** 本地保存的武器寻访记录（对应后端 SavedWeaponGachaData） */
export interface SavedWeaponGachaData {
  userId: string;
  serverId: string;
  lastSyncTime?: number | null;
  pools: Record<string, GachaPoolInfo>;
  /** 全部记录，从新到旧 */
  records: GachaRecord[];
}

/** 本地保存的抽卡记录（对应 GachaSavedData） */
export interface SavedGachaData {
  userId: string;
  serverId: string;
  lastSyncTime?: number | null;
  pools: Record<string, GachaPoolInfo>;
  /** 全部记录，从新到旧 */
  records: GachaRecord[];
}

/** 同步进度事件负载（对应 GachaSyncProgress） */
export interface GachaSyncProgress {
  userId: string;
  serverId: string;
  tabIndex: number;
  tabCount: number;
  tabKey: string;
  page: number;
  tabFetched: number;
  totalFetched: number;
  done: boolean;
}

/** 同步结果（对应 GachaSyncResult） */
export interface GachaSyncResult {
  userId: string;
  serverId: string;
  syncedAt: number;
  newRecords: number;
  totalRecords: number;
  perTabNew: Record<string, number>;
}

/** meta 中的卡池 Tab（对应 GachaTab，**仅终末地**） */
export interface GachaTab {
  key: string; // special / joint:{poolId} / normal
  label?: string | null;
  poolType: string;
  poolId?: string | null;
}

/**
 * 《明日方舟》寻访卡池分类（对应后端 ArknightsGachaCategory）。
 *
 * ⚠️ 这是**分类**（限定寻访·庆典 / 中坚寻访 …），不是终末地的 Tab。
 * `name` 里含换行符，展示前需用 `formatCategoryName` 处理。
 */
export interface ArknightsGachaCategory {
  /** 分类 id，即 `/api/gacha/history` 的 `category` 参数 */
  id: string;
  /** 展示名，可能含 `\n`（如 `"限定寻访\n庆典"`） */
  name: string;
  /** 是否对应当前正在进行的卡池 */
  active?: boolean | null;
}
