use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// ef-webview 抽卡记录 API 统一响应包装（code=0 表示成功）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaApiResponse<T> {
    pub code: i32,
    pub msg: String,
    pub data: Option<T>,
}

/// GET /api/record/char/meta 的 data
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaMetaData {
    pub tabs: Vec<GachaTab>,
    #[serde(default)]
    pub beginner_pull_count: Option<i32>,
}

/// 卡池 Tab（meta 中一项）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaTab {
    /// "special" / "joint:{poolId}" / "normal"
    pub key: String,
    #[serde(default)]
    pub label: Option<String>,
    /// 请求记录时使用的 pool_type 参数
    pub pool_type: String,
    /// 请求记录时使用的 pool_id 参数（仅 joint 等有）
    #[serde(default)]
    pub pool_id: Option<String>,
}

impl GachaTab {
    /// 拉取该 Tab 记录时附带的 pool_id 参数
    pub fn request_pool_id(&self) -> Option<&str> {
        self.pool_id.as_deref()
    }
}

/// GET /api/record/char 的 data
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaRecordData {
    #[serde(default)]
    pub list: Vec<GachaRecord>,
    pub has_more: bool,
}

/// 单条抽卡记录
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaRecord {
    /// draw / gift_intel_book
    pub kind: String,
    pub pool_id: String,
    pub pool_name: String,
    /// 物品/角色展示名（gift 时为"寻访情报书"等）
    pub name_text: String,
    #[serde(default)]
    pub char_id: Option<String>,
    #[serde(default)]
    pub char_name: Option<String>,
    #[serde(default)]
    pub rarity: Option<i32>,
    #[serde(default)]
    pub is_free: Option<bool>,
    #[serde(default)]
    pub is_new: Option<bool>,
    /// 抽卡时间（毫秒时间戳，API 返回字符串）
    pub gacha_ts: String,
    /// 全局唯一序号，也是翻页游标
    pub seq_id: String,
}

impl GachaRecord {
    pub fn is_draw(&self) -> bool {
        self.kind == "draw"
    }

    pub fn is_gift(&self) -> bool {
        self.kind == "gift_intel_book"
    }

    /// 毫秒时间戳（解析失败返回 None）
    pub fn gacha_ts_ms(&self) -> Option<i64> {
        self.gacha_ts.parse::<i64>().ok()
    }
}

/// GET /api/record/weapon 的 data
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaWeaponRecordData {
    #[serde(default)]
    pub list: Vec<GachaWeaponRecord>,
    pub has_more: bool,
}

/// 单条武器寻访记录
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaWeaponRecord {
    /// draw
    pub kind: String,
    pub pool_id: String,
    pub pool_name: String,
    /// 物品/武器展示名
    pub name_text: String,
    #[serde(default)]
    pub weapon_id: Option<String>,
    #[serde(default)]
    pub weapon_name: Option<String>,
    #[serde(default)]
    pub weapon_type: Option<String>,
    #[serde(default)]
    pub rarity: Option<i32>,
    #[serde(default)]
    pub is_new: Option<bool>,
    /// 抽卡时间（毫秒时间戳，API 返回字符串）
    pub gacha_ts: String,
    /// 全局唯一序号，也是翻页游标
    pub seq_id: String,
}

impl GachaWeaponRecord {
    pub fn is_draw(&self) -> bool {
        self.kind == "draw"
    }

    /// 毫秒时间戳（解析失败返回 None）
    pub fn gacha_ts_ms(&self) -> Option<i64> {
        self.gacha_ts.parse::<i64>().ok()
    }
}

/// 本地保存的武器寻访记录（gacha_records 子目录下 gacha_weapon_records_{userId}_{serverId}.json）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedWeaponGachaData {
    pub user_id: String,
    pub server_id: String,
    #[serde(default)]
    pub last_sync_time: Option<i64>,
    /// poolId -> 卡池信息
    #[serde(default)]
    pub pools: HashMap<String, GachaPoolInfo>,
    /// 全部记录，从新到旧
    #[serde(default)]
    pub records: Vec<GachaWeaponRecord>,
}

/// 本地保存的抽卡记录（app_config.json 同级目录下 gacha_records_{userId}_{serverId}.json）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedGachaData {
    pub user_id: String,
    pub server_id: String,
    #[serde(default)]
    pub last_sync_time: Option<i64>,
    /// poolId -> 卡池信息
    #[serde(default)]
    pub pools: HashMap<String, GachaPoolInfo>,
    /// 全部记录，从新到旧
    #[serde(default)]
    pub records: Vec<GachaRecord>,
}

/// 卡池信息（名称、所属类型）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaPoolInfo {
    pub pool_name: String,
    pub pool_type: String,
}

/// 一次增量同步的结果
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaSyncResult {
    pub user_id: String,
    pub server_id: String,
    /// 同步完成时间（毫秒）
    pub synced_at: i64,
    /// 本次新增记录数
    pub new_records: i32,
    /// 合并后的总记录数
    pub total_records: i32,
    /// 每个 Tab（key）本次新增的记录数
    #[serde(default)]
    pub per_tab_new: HashMap<String, i32>,
}

/// 增量同步进度（通过 gacha-sync-progress 事件实时推送给前端）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GachaSyncProgress {
    pub user_id: String,
    pub server_id: String,
    /// 当前同步的 Tab 索引（从 0 开始）
    pub tab_index: usize,
    /// Tab 总数
    pub tab_count: usize,
    /// 当前 Tab 的 key（special/joint:{poolId}/normal）
    pub tab_key: String,
    /// 当前 Tab 已拉取的页数
    pub page: i32,
    /// 当前 Tab 本次拉取到的新记录数
    pub tab_fetched: usize,
    /// 本次同步累计拉取的新记录数
    pub total_fetched: usize,
    /// 同步是否已完成（最后一条进度事件为 true）
    pub done: bool,
}
