//! 《明日方舟》数据模型 —— 森空岛 `player/info` / `cultivate` / `attendance` 的反序列化结构。
//!
//! # 为什么与终末地完全分开
//!
//! 终末地走 `/api/v1/game/endfield/card/detail`，用 `roleId + serverId + userId` 寻址，
//! 每次只返回一个角色；明日方舟走 `/api/v1/game/player/info?uid=`，**用渠道绑定 uid 寻址**，
//! 一次返回整个账号的全部数据（干员、基建、任务、剿灭、保全……），两者没有任何字段可复用。
//!
//! # 空值约定
//!
//! 真实返回里 `building.hire`（办公室未建造）与 `building.training`（没有进行中的专精）
//! 会是 `null` —— 这正是 skland-api 在 `recruit.py:38` 崩掉的原因（它直接下标没判空）。
//! 本文件所有 `building.*` 子对象一律建模为 `Option<T>`，容器级 `#[serde(default)]`
//! 保证字段缺失走 `Default` 而不是整包解析失败。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 《明日方舟》物品图标 CDN 前缀。
///
/// 签到接口的 `resourceInfoMap` **不下发 `icon` 字段**（实测只有
/// `id/type/name/rarity/stageDropList/otherSource/buildingProductList/sortId/classifyType`），
/// 地图标一律按 `resourceId` 拼固定地址：
/// `https://web.hycdn.cn/arknights/game/assets/item/{resourceId}.png`
/// （已实测 `2003` / `4001` / `3302` / `31033` 均返回 200，不存在的 id 返回 404）。
pub const ARKNIGHTS_ITEM_ICON_BASE: &str =
    "https://web.hycdn.cn/arknights/game/assets/item/";

/// 按 `resourceId` 拼出《明日方舟》物品图标地址。
pub fn arknights_item_icon_url(resource_id: &str) -> String {
    format!("{}{}.png", ARKNIGHTS_ITEM_ICON_BASE, resource_id)
}

/// 「单个对象或数组」都接受，统一收敛成 `Vec`
///
/// 基建设施在同一个响应里就是混用的：实测 `control` / `meeting` 是**对象**，
/// 而 `powers` / `tradings` / `manufactures` / `dormitories` 是**数组**
/// （skland-api 的 `FacilityPresence.from_skland_data` 也用 `isinstance(data, dict)`
/// 做了同样的兼容）。不兼容的话整个 `player/info` 都会解析失败。
fn one_or_many<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany<T> {
        One(T),
        Many(Vec<T>),
    }

    Ok(match OneOrMany::<T>::deserialize(deserializer)? {
        OneOrMany::One(single) => vec![single],
        OneOrMany::Many(list) => list,
    })
}

/// 「数组 / 单对象 / null / 缺失」四种形态都收敛成 `Vec`
///
/// `tomorrowAwards` 实测是数组，但同一家接口在别处给过单对象，这里一并兼容。
/// 实现直接走 `serde_json::Value` 再分发，不用 `#[serde(untagged)]` ——
/// untagged 靠 `Content` 缓冲、错误会被吞成变体失败，出问题时极难定位。
fn one_or_many_default<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    use serde::de::Error;
    use serde_json::Value;

    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Null => Ok(Vec::new()),
        Value::Array(items) => items
            .into_iter()
            .map(|item| serde_json::from_value::<T>(item).map_err(Error::custom))
            .collect(),
        // 单个对象：包成一项
        other => serde_json::from_value::<T>(other)
            .map(|single| vec![single])
            .map_err(Error::custom),
    }
}

/// 数字或字符串都接受，转成 `i64`
///
/// `attendance.currentTs` 实测是**字符串** `"1794324881"`，而
/// `player/info.currentTs` 是**数字** `1794324880` —— 同一家接口两种写法都有。
fn string_or_i64<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .ok_or_else(|| Error::custom("expected an integer")),
        serde_json::Value::String(text) => text
            .parse::<i64>()
            .map_err(|error| Error::custom(format!("failed to parse '{}' as i64: {}", text, error))),
        other => Err(Error::custom(format!(
            "expected a number or numeric string, got {}",
            other
        ))),
    }
}

/// 一个「当前/总量」对（理智、任务进度、剿灭进度等）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsProgress {
    pub current: i64,
    pub total: i64,
}

/// 玩家基础状态（`data.status`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsStatus {
    /// 昵称，形如 `Doctor#0000`（`名字#尾号`）
    pub name: String,
    /// 渠道角色 uid（注意与 `data.status.uid` 同值；不等于森空岛 userId）
    pub uid: String,
    pub level: i32,
    pub exp: ArknightsProgress,
    /// 理智
    pub ap: ArknightsAp,
    /// 头像（**明日方舟头像的唯一来源**，终末地的 `base.avatarUrl` 对它无效）
    pub avatar: Option<ArknightsAvatar>,
    pub char_cnt: i32,
    pub skin_cnt: i32,
    pub furniture_cnt: i32,
    /// 主线进度标识，如 `main_02-09`
    pub main_stage_progress: String,
    pub resume: String,
    /// 看板干员
    pub secretary: Option<ArknightsSecretary>,
    /// 服务器名（实测可能为空串，真正的服务器名在绑定接口的 `channelName`）
    pub server_name: String,
    pub register_ts: i64,
    pub last_online_ts: i64,
    /// 森空岛后端**最后一次同步游戏数据**的时间戳
    pub store_ts: i64,
    pub subscription_end: i64,
}

/// 理智（`status.ap`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAp {
    pub current: i64,
    pub max: i64,
    /// 上次恢复理智的时间戳（前端按 `1/6/60` 每秒自增推算当前值）
    pub last_ap_add_time: i64,
    /// 理智回满时间戳
    pub complete_recovery_time: i64,
}

/// 头像（`status.avatar`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAvatar {
    pub id: String,
    /// `ICON` / `PORTRAIT` 等
    #[serde(rename = "type")]
    pub kind: String,
    /// 远程地址（`web.hycdn.cn`）
    pub url: String,
    /// 缓存时下载好的 base64（与终末地 `AccountInfo.avatar` 同形式）。
    ///
    /// 接口本身不返回这个字段，由 [`crate::services::arknights_service::ArknightsService`]
    /// 在写缓存前填充；读取老缓存时缺失即为 `None`，前端回退用 `url`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
}

/// 看板干员（`status.secretary`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsSecretary {
    pub char_id: String,
    pub skin_id: String,
}

/// `player/info` 数据结构版本。
///
/// 缓存文件是「解析后的结构体落盘」，旧版本程序写的缓存里没有新增字段。
/// 前端拿到 `dataVersion < ARKNIGHTS_DATA_VERSION` 的响应时应强制联网刷新一次，
/// 避免「绑定很久的账户」永远看到旧缓存里缺失的章节/活动数据。
///
/// 变更记录：
/// - 1：章节进度 / 信息表 / 其他模式（2026-11）
/// - 2：剿灭阵营（`campaignZoneInfoMap` + `campaignInfoMap[].campaignZoneId`）
/// - 3：训练室补上 `level` / `slotId` / `slotState` / `lastUpdateTime`
///   （旧缓存缺 `level`，基地页面会显示「等级 」而没有数字）
pub const ARKNIGHTS_DATA_VERSION: i32 = 3;

/// 玩家账号全量数据（`GET /api/v1/game/player/info?uid=` 的 `data`）
///
/// 这是明日方舟的**唯一主数据源**：干员养成、基建、任务、剿灭、保全、公招全在里面，
/// 无需再单独请求 `cultivate`（后者只额外提供仓库 `items`）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsPlayerInfo {
    pub status: ArknightsStatus,
    /// 干员养成（`chars[]`，含精英化/等级/专精/潜能/信赖/模组/皮肤）
    pub chars: Vec<ArknightsChar>,
    /// 干员静态信息表：charId → {id, name, profession, rarity, ...}
    pub char_info_map: serde_json::Map<String, serde_json::Value>,
    /// 公共招募栏位（实测恒 4 个；`state == 2` 表示招募进行中）
    pub recruit: Vec<ArknightsRecruitSlot>,
    /// 每日/每周任务
    pub routine: ArknightsRoutine,
    /// 剿灭作战（各据点最大击杀数）
    pub campaign: ArknightsCampaign,
    /// 保全派驻（各训练场最好成绩）
    pub tower: ArknightsTower,
    /// 基建
    pub building: ArknightsBuilding,
    /// 数据生成时间戳
    pub current_ts: i64,

    // ---- 以下为「游戏数据页」用的章节/活动进度字段（2026-11 新增）----
    // ⚠️ 非 Value 值的映射必须用 BTreeMap：serde_json 1.0.151 起 Map<String, V>
    // 只对 V = Value 实现了 Serialize/Deserialize/Clone/Debug/Default。
    // 用 BTreeMap 还能让缓存文件键序稳定（按键排序）。

    /// 主线关卡展示信息表：只包含 `status.mainStageProgress` 指向的那一关。
    ///
    /// 实测它**不是全关卡表** —— 键最多只有 1 个（B 服账号甚至整个为空），
    /// 用途是给 `mainStageProgress`（如 `main_15-09`）补出可读的关卡号/名称。
    pub stage_info_map: BTreeMap<String, ArknightsStageInfo>,
    /// 各活动/章节的通关进度（77 项左右，含复刻）。分区进度为
    /// `clearedStage / totalStage`，聚合时逐区相加。
    pub activity: Vec<ArknightsActivityProgress>,
    /// 活动静态信息表：actId → {name, type, startTime...}（提供章节名/分组）
    pub activity_info_map: BTreeMap<String, ArknightsActivityInfo>,
    /// 剿灭据点信息表：campId → {name, picUrl, campaignZoneId}
    pub campaign_info_map: BTreeMap<String, ArknightsNamedInfo>,
    /// 剿灭阵营信息表：zoneId（如 `camp_zone_9`）→ {name}（如「哥伦比亚」）。
    ///
    /// 据点条目只给 `campaignZoneId`，阵营名（哥伦比亚/谢拉格/维多利亚…）
    /// 必须靠这张表翻译；缺失时前端不显示阵营徽标。
    pub campaign_zone_info_map: BTreeMap<String, ArknightsZoneInfo>,
    /// 集成战略主题信息表：rogueId → {name, picUrl, sort}
    pub rogue_info_map: BTreeMap<String, ArknightsNamedInfo>,
    /// 保全派驻训练场信息表：towerId → {name, subName, picUrl}
    pub tower_info_map: BTreeMap<String, ArknightsNamedInfo>,
    /// 集成战略（各主题的报酬/遗书/通票进度）
    pub rogue: ArknightsRogue,
    /// 沙中之地（沙盒）进度
    pub sandbox: Vec<ArknightsSandbox>,
    /// 历险签约（bossRush）记录
    pub boss_rush: Vec<ArknightsBossRush>,
    /// 本结构体的版本标记（[`ARKNIGHTS_DATA_VERSION`]）。接口本身不下发，
    /// 由 [`crate::services::arknights_service::ArknightsService`] 在拉取后填充；
    /// 旧缓存读到 0 即表示缓存格式过期，前端应强制刷新。
    #[serde(default)]
    pub data_version: i32,
}

/// 一个已拥有干员的养成状态（`data.chars[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsChar {
    pub char_id: String,
    pub level: i32,
    /// 精英化阶段 0/1/2
    pub evolve_phase: i32,
    /// 潜能 0..5
    pub potential_rank: i32,
    /// 技能等级 1..7
    pub main_skill_lvl: i32,
    /// 信赖百分比
    pub favor_percent: i32,
    /// 获得时间
    pub gain_time: i64,
    pub exp: i64,
    #[serde(rename = "rarity")]
    pub rarity: i32,
    pub default_skill_id: String,
    pub default_equip_id: String,
    pub skin_id: String,
    /// 技能专精（`level` 即专精等级 0..3）
    pub skills: Vec<ArknightsSkill>,
    /// 模组
    pub equip: Vec<ArknightsEquip>,
}

/// 干员技能专精
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsSkill {
    pub id: String,
    /// 专精等级 0..3
    pub specialize_level: i32,
}

/// 干员模组
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsEquip {
    pub id: String,
    pub level: i32,
    pub locked: bool,
}

/// 公共招募栏位（`data.recruit[]`）。`state == 2` 表示招募进行中。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRecruitSlot {
    pub state: i32,
    pub start_ts: i64,
    pub finish_ts: i64,
}

/// 每日/每周任务（`data.routine`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRoutine {
    pub daily: ArknightsProgress,
    pub weekly: ArknightsProgress,
}

/// 剿灭作战（`data.campaign`）
///
/// `records[]` 是**全部据点**（含未开放的轮换据点）的最大击杀数，
/// 据点名要查 `campaignInfoMap[campaignId].name`。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCampaign {
    pub reward: ArknightsProgress,
    #[serde(default)]
    pub records: Vec<ArknightsCampaignRecord>,
}

/// 剿灭作战的一个据点记录（`campaign.records[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCampaignRecord {
    pub campaign_id: String,
    /// 历史最大击杀数（400 = 常规据点满奖励）
    pub max_kills: i64,
}

/// 保全派驻（`data.tower`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTower {
    pub reward: ArknightsTowerReward,
    #[serde(default)]
    pub records: Vec<ArknightsTowerRecord>,
}

/// 保全派驻的一个训练场记录（`tower.records[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTowerRecord {
    pub tower_id: String,
    /// 最好成绩（通关层数）
    pub best: i32,
}

/// 保全派驻奖励进度
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTowerReward {
    pub higher_item: ArknightsProgress,
    pub lower_item: ArknightsProgress,
    /// 本期结束时间戳
    pub term_ts: i64,
}

/// 主线关卡展示信息（`stageInfoMap` 的值）
///
/// ⚠️ 接口只对「`mainStageProgress` 指向的那一关」下发这个结构，
/// 键就是关卡 id（如 `main_15-09`）。B 服账号实测整个 map 为空。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsStageInfo {
    /// 关卡 id，如 `main_15-09`
    pub id: String,
    /// 展示用关卡号，如 `15-10`（id 与关卡号可能不一致，以 code 为准展示）
    pub code: String,
    /// 关卡名（如「怀黍离」章末关）
    pub name: String,
    /// 所属分区 id（如 `act2mainss_zone1`）
    pub zone_id: String,
    /// `MAIN` / `SUB` 等
    pub stage_type: String,
    /// `NORMAL` / `TOUGH` 等
    pub difficulty: String,
    /// 理智消耗
    pub ap_cost: i32,
}

/// 一个活动/章节的通关进度（`data.activity[]`）
///
/// 每个活动有 1~5 个分区（zone），进度按分区给出，聚合展示时逐区相加。
/// `actReplicaId` 非空表示这是复刻（进度挂在复刻活动上，`actId` 仍指向原活动）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsActivityProgress {
    /// 活动 id（名称查 `activityInfoMap[actId]`）
    pub act_id: String,
    /// 复刻活动 id（非复刻为空串）
    pub act_replica_id: String,
    #[serde(default)]
    pub zones: Vec<ArknightsActivityZone>,
}

/// 活动内一个分区的通关进度
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsActivityZone {
    pub zone_id: String,
    pub zone_replica_id: String,
    /// 已通关关卡数
    pub cleared_stage: i32,
    /// 分区总关卡数（0 = 分区未开放/无内容）
    pub total_stage: i32,
}

/// 活动静态信息（`activityInfoMap` 的值，裁剪后只留展示字段）
///
/// `type` 实测取值：`SIDESTORY`（别传）/ `MINISTORY`（插曲）/ `BRANCHLINE`（支线）/
/// 空串（新活动未标注）。`picUrl` 为**章节封面图**（bbs.hycdn.cn），
/// 但**覆盖率只有约 57%**（44/77）—— 新活动与一部分老活动是空串，
/// 前端必须为空时回退到字母占位。接口原样给 `dropItemIds` 等大字段，
/// 这里不建模、反序列化时忽略。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsActivityInfo {
    pub id: String,
    /// 活动名（如「众生行记」）
    pub name: String,
    /// 活动类别（`SIDESTORY` / `MINISTORY` / `BRANCHLINE`，可为空串）
    #[serde(rename = "type", default)]
    pub kind: String,
    /// 开始时间戳（用于章节列表排序）
    pub start_time: i64,
    /// 结束时间戳
    pub end_time: i64,
    /// 活动横幅图（可能为空串）
    pub pic_url: String,
}

/// 剿灭据点 / 集成战略主题 / 保全训练场共用的一般信息表条目
///
/// 三张表（`campaignInfoMap` / `rogueInfoMap` / `towerInfoMap`）的值都有
/// `{id, name, picUrl}`，`rogueInfoMap` 多 `sort`、`towerInfoMap` 多 `subName`，
/// 统一用 Option 容纳。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsNamedInfo {
    pub id: String,
    pub name: String,
    pub pic_url: String,
    /// 仅保全训练场有（如「罗德岛制药」）
    pub sub_name: String,
    /// 仅集成战略有（主题排序号）
    pub sort: i32,
    /// 仅剿灭据点有：所属阵营 id（如 `camp_zone_9`），阵营名查 `campaignZoneInfoMap`
    pub campaign_zone_id: String,
}

/// 剿灭阵营（`data.campaignZoneInfoMap` 的值）
///
/// 实测 16 个：`camp_zone_1` 炎国龙门、`camp_zone_9` 哥伦比亚、`camp_zone_13` 谢拉格…
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsZoneInfo {
    pub id: String,
    pub name: String,
}

/// 集成战略进度（`data.rogue`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRogue {
    #[serde(default)]
    pub records: Vec<ArknightsRogueRecord>,
}

/// 一个集成战略主题的进度（`rogue.records[]`）
///
/// ⚠️ `bank` 的键是 `current/record`（不是 `total`），与 [`ArknightsProgress`] 不同形，
/// 单独建模。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRogueRecord {
    /// 主题 id（名称查 `rogueInfoMap`）
    pub rogue_id: String,
    /// 通票等级
    pub bp_level: i32,
    /// 首次通关时间戳（0 = 未通关）
    pub clear_time: i64,
    /// 前置储备（current）与历史最高（record）
    pub bank: ArknightsRogueBank,
    /// 主题奖章进度
    pub medal: ArknightsProgress,
    /// 收藏遗书数
    pub relic_cnt: i32,
}

/// 集成战略前置储备（`rogue.records[].bank`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRogueBank {
    pub current: i64,
    pub record: i64,
}

/// 沙中之地（沙盒）进度（`data.sandbox[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsSandbox {
    /// 沙盒 id（如 `sandbox_1`）
    pub id: String,
    /// 沙盒名（如「沙洲遗闻」）
    pub name: String,
    /// 基建等级
    pub base_lv: i32,
    /// 主线任务进度
    pub main_quest: i32,
    /// 已解锁节点数
    pub unlock_node: i32,
    /// 击杀数
    pub enemy_kill: i32,
    /// 最长存续天数
    pub max_day: i32,
    /// 最长挑战天数
    pub max_day_challenge: i32,
    /// 创建裂隙数
    pub create_rift: i32,
    /// 修复裂隙进度（实测 `[0, 5]` = 当前/目标）
    #[serde(default)]
    pub fix_rift: Vec<i32>,
    /// 支线任务（接口键名为 `subQuest`，单复数不一致，显式映射）
    #[serde(rename = "subQuest", default)]
    pub sub_quests: Vec<ArknightsSandboxQuest>,
}

/// 沙盒支线任务（`sandbox[].subQuest[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsSandboxQuest {
    pub id: String,
    pub name: String,
    pub done: bool,
}

/// 历险签约记录（`data.bossRush[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsBossRush {
    pub id: String,
    pub pic_url: String,
    pub record: ArknightsBossRushRecord,
}

/// 历险签约的单期记录
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsBossRushRecord {
    /// 达成的难度（空串 = 未挑战）
    pub difficulty: String,
    pub played: bool,
    pub stage_id: String,
}

/// 基建（`data.building`）
///
/// ⚠️ `hire` 与 `training` 在真实返回里可能是 `null`（未建办公室 / 无进行中专精），
/// **必须** 用 `Option`。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsBuilding {
    /// 无人机
    pub labor: Option<ArknightsLabor>,
    /// 办公室（公开招募刷新），未建造时为 null
    pub hire: Option<ArknightsHire>,
    /// 训练室（技能专精），无进行中专精时为 null
    pub training: Option<ArknightsTraining>,
    /// 疲劳干员（心情耗尽）
    pub tired_chars: Vec<ArknightsTiredChar>,
    /// 控制中枢（实测为**对象**，也兼容数组）
    #[serde(default, deserialize_with = "one_or_many")]
    pub control: Vec<ArknightsRoomSegment>,
    #[serde(default, deserialize_with = "one_or_many")]
    pub powers: Vec<ArknightsRoomSegment>,
    #[serde(default, deserialize_with = "one_or_many")]
    pub tradings: Vec<ArknightsRoomSegment>,
    #[serde(default, deserialize_with = "one_or_many")]
    pub manufactures: Vec<ArknightsRoomSegment>,
    #[serde(default, deserialize_with = "one_or_many")]
    pub dormitories: Vec<ArknightsRoomSegment>,
    /// 会客室（实测为**对象**，也兼容数组）
    #[serde(default, deserialize_with = "one_or_many")]
    pub meeting: Vec<ArknightsRoomSegment>,
}

/// 无人机（`building.labor`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsLabor {
    pub value: i64,
    pub max_value: i64,
    /// 距离补满的剩余秒数（**按 lastUpdateTime 计算**，与专精的 remainSecs 不同）
    pub remain_secs: i64,
    pub last_update_time: i64,
}

/// 办公室（`building.hire`）—— 公开招募刷新
///
/// 实测（B 服已建办公室）：
/// `{ chars: [...], completeWorkTime, level, refreshCount, slotId, slotState, state }`。
/// 未建造办公室时为 `null`（官服账号实测如此）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsHire {
    /// 已用刷新次数（上限 3）
    pub refresh_count: i32,
    /// 下次刷新完成时间戳
    pub complete_work_time: i64,
    /// 办公室等级
    pub level: i32,
    /// 槽位标识，如 `slot_23`
    pub slot_id: String,
    /// 槽位状态
    pub slot_state: i32,
    /// 设施状态
    pub state: i32,
    /// 在办公室工作的干员
    pub chars: Vec<ArknightsRoomChar>,
}

/// 训练室（`building.training`）—— 技能专精
///
/// 实测（两个官服/B 服账号都如此）：
/// `{ lastUpdateTime, level, remainPoint, remainSecs, slotId, slotState, speed,
/// trainee, trainer }`。**`level` / `slotId` / `slotState` 必须建模**，否则界面
/// 只能显示「等级 」而没有数字（2026-11 前的真实 bug）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTraining {
    pub trainee: Option<ArknightsTrainee>,
    pub trainer: Option<ArknightsTrainer>,
    /// 训练速度加成，**浮点**（`1.35` = +35%）。
    ///
    /// ⚠️ 实测 B 服给小数、官服给整数 —— 声明成 `i32` 会让整个 `player/info`
    /// 解析失败（表现为「接口 code=0，但等级/头像全是空」）。
    pub speed: f64,
    /// 剩余训练点数，同样可能是**浮点**（实测 `0.45`）
    pub remain_point: f64,
    /// 距离完成的剩余秒数（**按请求时间计算**）
    pub remain_secs: i64,
    /// 训练室等级（接口下发；缺失走 0）
    pub level: i32,
    /// 槽位标识，如 `slot_13`
    pub slot_id: String,
    /// 槽位状态（2 = 工作中）
    pub slot_state: i32,
    /// 设施最近一次数据刷新时间戳
    pub last_update_time: i64,
}

/// 正在专精的干员
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTrainee {
    pub char_id: String,
    /// 目标技能下标；-1 表示空位
    pub target_skill: i32,
}

/// 训练员
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTrainer {
    pub char_id: String,
}

/// 疲劳干员（`building.tiredChars[]`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTiredChar {
    pub char_id: String,
    /// 心情值
    pub ap: i64,
    /// 槽位下标
    pub index: i32,
    /// 所在房间槽位，如 `slot_34`
    pub room_slot_id: String,
    /// 心情恢复时间戳
    pub last_ap_add_time: i64,
    /// 已连续工作时长（秒）
    pub work_time: i64,
}

/// 一个设施内的排班段（`building.control` 等）
///
/// 字段以实测为准：
/// - `control`：`{ chars, level, slotId, slotState }`
/// - `powers`：`{ chars, level, slotId }`
/// - `dormitories`：`{ chars, comfort, level, slotId }`
/// - `manufactures`：`{ chars, capacity, complete, completeWorkTime, formulaId,
///   lastUpdateTime, level, remain, slotId, speed, weight }`
///
/// 不同设施给的字段不一样，所以全部走容错缺省（缺字段即 0 / 空串）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRoomSegment {
    pub chars: Vec<ArknightsRoomChar>,
    /// 设施等级
    pub level: i32,
    /// 槽位标识，如 `slot_34`
    pub slot_id: String,
    /// 槽位状态（`control` 才有；2 = 工作中）
    pub slot_state: i32,
    /// 制造站容量
    pub capacity: i32,
    /// 制造站当前占用
    pub weight: i32,
    /// 制造站配方 id
    pub formula_id: String,
    /// 制造站剩余产量
    pub remain: i32,
    /// 制造站是否已完成
    pub complete: i32,
    /// 制造站完成时间戳
    pub complete_work_time: i64,
    /// 设施最近一次数据刷新时间戳
    pub last_update_time: i64,
    /// 生产/加工速度加成。⚠️ **浮点**（实测 `1.35`），官服可能给整数
    pub speed: f64,
    /// 宿舍舒适度
    pub comfort: i32,

    // ---- 以下字段只有个别设施才有（缺省即空值）----

    /// 贸易站当前库存订单（`tradings[]` 才有）
    #[serde(default)]
    pub stock: Vec<ArknightsTradingOrder>,
    /// 贸易站订单上限
    pub stock_limit: i32,
    /// 贸易站订单策略（`O_GOLD` = 龙门币订单）
    pub strategy: String,
    /// 会客室线索信息（仅 `meeting`；未解锁时为 null/缺失）
    pub clue: Option<ArknightsClue>,
}

/// 贸易站的一笔订单（`stock[]`）
///
/// 实测形状：`{ "delivery": [{"count":2,"id":"3003","type":"MATERIAL"}],
/// "gain": {"count":1000,"id":"4001","type":"GOLD"}, "instId": 2959, "type": "O_GOLD" }`。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTradingOrder {
    /// 卖出货物（原样保留，前端可展开）
    #[serde(default)]
    pub delivery: Vec<ArknightsOrderItem>,
    /// 收益（如 1000 龙门币）
    pub gain: Option<ArknightsOrderItem>,
    pub inst_id: i64,
    #[serde(rename = "type", default)]
    pub kind: String,
}

/// 订单里的一件物品
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsOrderItem {
    pub id: String,
    pub count: i64,
    #[serde(rename = "type", default)]
    pub kind: String,
}

/// 会客室线索（`meeting.clue`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsClue {
    /// 摆放中的线索派系（如 `RHODES` / `BLACKSTEEL`）
    #[serde(default)]
    pub board: Vec<String>,
    /// 今日碎片奖励是否已领
    pub daily_reward: bool,
    /// 待接收的线索数
    pub need_receive: i32,
    /// 库存线索数
    pub own: i32,
    /// 已接收未领取数
    pub received: i32,
    /// 是否正在传递线索
    pub sharing: bool,
}

/// 设施内的一名干员
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsRoomChar {
    pub char_id: String,
    /// 心情值，`ap / 360000` 为心情点数（0..24）
    pub ap: i64,
    /// 槽位下标
    pub index: i32,
    /// 该干员的心情恢复时间戳
    pub last_ap_add_time: i64,
    /// 已连续工作时长（秒）
    pub work_time: i64,
}

/// 干员仓库（`GET /api/v1/game/cultivate/player?uid=` 的 `data`）
///
/// 明日方舟的养成数据 `player/info` 已经全给了，这个接口唯一的增量是 `items`（仓库）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCultivate {
    pub characters: Vec<ArknightsCultivateChar>,
    /// 仓库物品（`count` 是**字符串**，接口原样如此）
    pub items: Vec<ArknightsItem>,
}

/// `cultivate` 里的干员（比 `player/info.chars` 少了信赖/皮肤）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCultivateChar {
    pub id: String,
    pub level: i32,
    pub evolve_phase: i32,
    pub potential_rank: i32,
    pub main_skill_level: i32,
    pub skills: Vec<ArknightsCultivateSkill>,
    pub equips: Vec<ArknightsCultivateEquip>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCultivateSkill {
    pub id: String,
    pub level: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCultivateEquip {
    pub id: String,
    pub level: i32,
}

/// 仓库物品
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsItem {
    pub id: String,
    /// 接口以**字符串**返回（`"56"`），这里保留字符串以免再转换
    pub count: String,
}

/// 签到状态（`GET /api/v1/game/attendance?uid=` 的 `data`）
///
/// # `calendar` 是「月度 30 格领取轨道」，不是日期网格
///
/// 实测（2026-11-11 抓包，签到前 22:03）：`calendar` 有 30 项，只有**下标 1**
/// （`resourceId=4001`, `count=500`）是 `available=true, done=false`；
/// 下标 0（`2002`×3）是 `done=true`（前一天领的），下标 2 之后全为 `false`。
/// 同一时刻 `records` 里只有 `ts=1794240000`（本地 11-10 00:00）一条。
///
/// 随后点签到，`POST /api/v1/game/attendance` 返回的 `awards` 正是
/// `4001`×500 —— 即**下标 1 那一格**。这证明：
///
/// - `calendar[i]` 是第 i+1 天的累计奖励，**下标与「几号」无关**（11 号并不等于下标 10）；
/// - `available` 标记的是「当前这一格能不能领」，**不是**终末地那种「今天可领取」；
/// - `done` 按天累加，所以「最后一条 `done`」就是最近一次领到的格子。
///
/// 因此「今天是否已签到」的唯一可靠判据是：**存在任何 `available && !done` 的格子
/// ⇔ 今天还能领 ⇒ 今天没签**。拿「今天是几号」去索引 `calendar` 是错的
/// （早先 `detectSignedToday` 就犯了这个错）。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAttendance {
    /// 本月签到日历（30 项，按累计天数排，与日期无关）
    pub calendar: Vec<ArknightsCalendarEntry>,
    /// 已签到记录
    pub records: Vec<ArknightsCheckinRecord>,
    /// 物品 id → 物品静态信息（名称/稀有度/掉落关卡等）。
    ///
    /// ⚠️ 接口**不下发 `icon`**，由 [`ArknightsAttendance::fill_resource_icons`]
    /// 按 `resourceId` 拼 CDN 地址补上。
    pub resource_info_map: serde_json::Map<String, serde_json::Value>,
    /// 数据生成时间戳。实测是**字符串**（`player/info` 那边是数字），两者都接受
    #[serde(default, deserialize_with = "string_or_i64")]
    pub current_ts: i64,
    /// 本月首次签到信息（可能为 null）
    pub first: Option<serde_json::Value>,

    // ---- 以下字段接口不返回，由 `ArknightsService` 计算后一并下发给前端 ----
    /// 今天是否已经签到（等价于终末地的 `hasToday`）
    #[serde(default)]
    pub has_today: bool,
    /// 「今日奖励」所在的下标（未签 = 可领那格；已签 = 最近领到那格）
    #[serde(default)]
    pub today_index: Option<i64>,
    /// 「明日奖励」所在的下标（即 `todayIndex + 1`，越界为 null）
    #[serde(default)]
    pub tomorrow_index: Option<i64>,
}

impl ArknightsAttendance {
    /// 当前可领取的那一格（`available && !done` 的第一个）
    pub fn claimable_index(&self) -> Option<usize> {
        self.calendar.iter().position(|e| e.available && !e.done)
    }

    /// 最近一次已领取的那一格（最后一个 `done`）
    pub fn last_done_index(&self) -> Option<usize> {
        self.calendar.iter().rposition(|e| e.done)
    }

    /// `records` 里是否存在落在 `currentTs` 当天（本地时区）的记录
    pub fn has_record_today(&self) -> bool {
        if self.current_ts <= 0 {
            return false;
        }
        let today = local_day_key(self.current_ts);
        self.records.iter().any(|record| {
            record
                .ts
                .trim()
                .parse::<i64>()
                .map(|ts| ts > 0 && local_day_key(ts) == today)
                .unwrap_or(false)
        })
    }

    /// 今天是否已经签到。
    ///
    /// 判据见结构体文档：有可领格 ⇒ 未签；没有可领格 ⇒ 已签。
    /// `records` 只作为**空日历**时的兜底（刚绑定、服务端还没排轨道）。
    pub fn signed_today(&self) -> bool {
        if self.claimable_index().is_some() {
            return false;
        }
        if self.calendar.is_empty() {
            return self.has_record_today();
        }
        // 日历非空且无可领格：今天这一格必然已经领过（或整月已领完）。
        true
    }

    /// 「今日奖励」下标 / 「明日奖励」下标
    ///
    /// 未签：可领那一格；已签：最近领到那一格。与前端 `findTodayEntry` 语义一致
    /// （它就是 `available && !done` → 最后一个 `done` 的回退链）。
    pub fn today_slot(&self) -> Option<usize> {
        self.claimable_index().or_else(|| self.last_done_index())
    }

    pub fn tomorrow_slot(&self) -> Option<usize> {
        let today = self.today_slot()?;
        let next = today + 1;
        (next < self.calendar.len()).then_some(next)
    }

    /// 把 `hasToday` / `todayIndex` / `tomorrowIndex` 填好（下发前调用）
    pub fn fill_derived(&mut self) {
        self.has_today = self.signed_today();
        let today = self.today_slot();
        let tomorrow = self.tomorrow_slot();
        self.today_index = today.map(|i| i as i64);
        self.tomorrow_index = tomorrow.map(|i| i as i64);
    }

    /// 给 `resourceInfoMap` 的每一项补上 `icon`
    ///
    /// 接口只给 `id/type/name/rarity/...`，图标一律按 `resourceId` 拼
    /// `https://web.hycdn.cn/arknights/game/assets/item/{id}.png`。
    /// 同时保证每项都有 `id`（个别条目键与 `id` 不一致时以键为准补 `id`）。
    pub fn fill_resource_icons(&mut self) {
        for (key, entry) in self.resource_info_map.iter_mut() {
            let resource_id = entry
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| key.clone());

            if let Some(object) = entry.as_object_mut() {
                object
                    .entry("id".to_string())
                    .or_insert_with(|| serde_json::Value::String(resource_id.clone()));
                object.insert(
                    "icon".to_string(),
                    serde_json::Value::String(arknights_item_icon_url(&resource_id)),
                );
            }
        }
    }

    /// 把日历里出现的 `resourceId` 按顺序关联成可直接渲染的奖励行
    ///
    /// 数量取自**日历格自身**的 `count`（不同格的同一物品数量不同，例如
    /// `4001` 在 30 格里是 500/1000 混排，绝不能按 id 累加）。
    pub fn reward_of(&self, index: usize) -> Option<ArknightsAttendanceReward> {
        let entry = self.calendar.get(index)?;
        let info = self.resource_info_map.get(&entry.resource_id);
        Some(ArknightsAttendanceReward {
            resource_id: entry.resource_id.clone(),
            name: info
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            icon: info
                .and_then(|v| v.get("icon"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| arknights_item_icon_url(&entry.resource_id)),
            count: entry.count,
            kind: entry.kind.clone(),
            done: entry.done,
            available: entry.available,
        })
    }
}

/// 日历格解析后的奖励（供前端直接渲染，避免再按 id 去 map 里反查数量）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAttendanceReward {
    pub resource_id: String,
    pub name: String,
    pub icon: String,
    pub count: i32,
    #[serde(rename = "type")]
    pub kind: String,
    pub done: bool,
    pub available: bool,
}

/// 把 Unix 秒转成本地时区的自然日键（`YYYY-MM-DD`）
fn local_day_key(ts_seconds: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_opt(ts_seconds, 0).single() {
        Some(datetime) => datetime.format("%Y-%m-%d").to_string(),
        None => String::new(),
    }
}

/// 签到日历中的一格
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCalendarEntry {
    pub resource_id: String,
    pub count: i32,
    /// `daily` / `monthly` 等
    #[serde(rename = "type")]
    pub kind: String,
    pub done: bool,
    pub available: bool,
}

/// 一条签到记录
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCheckinRecord {
    pub resource_id: String,
    pub count: i32,
    /// 签到日期时间戳（**字符串**）
    pub ts: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// `POST /api/v1/game/attendance` 返回的一件奖励
///
/// 实测形状：`{ "resource": {...}, "count": 500, "type": "daily" }`。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAward {
    pub resource: ArknightsAwardResource,
    pub count: i32,
    /// 奖励类别（`daily` / `monthly`）
    #[serde(rename = "type", default)]
    pub kind: String,
}

/// 奖励对应的物品静态信息
///
/// ⚠️ 接口**不下发 `icon`**；由 [`ArknightsAwardResource::fill_icon`] 按 `id`
/// 拼 CDN 地址。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAwardResource {
    pub id: String,
    /// 物品大类，如 `GOLD` / `MATERIAL`
    #[serde(rename = "type", default)]
    pub kind: String,
    pub name: String,
    /// 稀有度（`4001` 龙门币为 3）
    #[serde(default)]
    pub rarity: i32,
    /// 图标地址 —— 接口不给，由后端补 `web.hycdn.cn` 的固定路径
    pub icon: String,
}

impl ArknightsAwardResource {
    /// 用 `id` 拼出图标地址（幂等：已有非空 `icon` 时不覆盖）
    pub fn fill_icon(&mut self) {
        if self.icon.is_empty() && !self.id.is_empty() {
            self.icon = arknights_item_icon_url(&self.id);
        }
    }
}

impl ArknightsAward {
    pub fn fill_icon(&mut self) {
        self.resource.fill_icon();
    }
}

/// `POST /api/v1/game/attendance` 的完整结果
///
/// 抓包（2026-11-11 22:05）实测 `data` 有四项，早先只取了 `awards`，其余全丢：
///
/// ```json
/// { "ts": "1794405925",
///   "awards": [ { "resource": {"id":"4001", ...}, "count": 500, "type": "daily" } ],
///   "resourceInfoMap": { "3302": {...}, "4001": {...} },
///   "tomorrowAwards": [ { "resource": {"id":"3302", ...}, "count": 2, "type": "daily" } ] }
/// ```
///
/// ⚠️ `tomorrowAwards` 是**数组**（实测只有一项，但结构是数组）；
/// `resourceInfoMap` 只含本次相关的物品 —— 与签到状态接口那份 map 不是同一份。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAttendanceResult {
    /// 本次签到的服务端时间戳
    #[serde(default, deserialize_with = "string_or_i64")]
    pub ts: i64,
    /// 本次发放的奖励（重复签到时为空）
    pub awards: Vec<ArknightsAward>,
    /// 明日可领奖励（实测数组；缺失时为空）
    #[serde(default, deserialize_with = "one_or_many_default")]
    pub tomorrow_awards: Vec<ArknightsAward>,
    /// 本次响应附带物品静态信息（含 `name` / `rarity`）
    pub resource_info_map: serde_json::Map<String, serde_json::Value>,
    /// 是否属于「今天已经签过」的幂等结果
    #[serde(default)]
    pub already_signed: bool,
    /// 原始业务码（`0` = 真的签到了；`10001` = 请勿重复签到）
    #[serde(default)]
    pub code: i64,
    /// 原始业务文案
    #[serde(default)]
    pub message: String,
}

// ---------------------------------------------------------------------------
// 离线解析测试（用真实抓取的响应夹具，不联网）
// ---------------------------------------------------------------------------
//
// 夹具来源：真实账号（官服）调 `/api/v1/game/player/info`、`/cultivate/player`、
// `/attendance` 的响应，裁掉未建模的大字段后放在 `tests/fixtures/arknights/`。
// 昵称/uid 已换成占位值，其余结构与线上一致。
//
// 这里守两类回归：
//
// 1. **字段名对齐**：`serde` 遇到对不上的字段会静默走 `default`，表现为「界面一片空值
//    但不报错」。所以下面逐字段断言真实值，而不是只断言「解析成功」。
// 2. **可空字段**：`building.hire` / `building.training` 在真实数据里是 `null`
//    （未建办公室 / 无进行中专精）。skland-api 就是没判空而在 `recruit.py:38` 崩的，
//    夹具刻意保留这两个 null。
#[cfg(test)]
mod tests {
    use super::*;

    const PLAYER_INFO: &str = include_str!("../../tests/fixtures/arknights/player_info.json");
    const CULTIVATE: &str = include_str!("../../tests/fixtures/arknights/cultivate.json");
    const ATTENDANCE: &str = include_str!("../../tests/fixtures/arknights/attendance.json");
    const ATTENDANCE_SIGNED: &str =
        include_str!("../../tests/fixtures/arknights/attendance_signed.json");
    const ATTENDANCE_RESULT: &str =
        include_str!("../../tests/fixtures/arknights/attendance_result.json");

    /// 取出响应里的 `data` 部分
    fn data_of(raw: &str) -> serde_json::Value {
        let root: serde_json::Value = serde_json::from_str(raw).expect("fixture is valid json");
        root.get("data").expect("fixture has data").clone()
    }

    #[test]
    fn player_info_parses_all_modelled_fields() {
        let info: ArknightsPlayerInfo =
            serde_json::from_value(data_of(PLAYER_INFO)).expect("ArknightsPlayerInfo 解析失败");

        // ---- status ----
        assert_eq!(info.status.name, "Doctor#0000");
        assert_eq!(info.status.uid, "700000001");
        // 夹具取自 **B 服** 账号（等级 85），刻意覆盖官服没出现的浮点场景
        assert_eq!(info.status.level, 85);
        assert!(info.status.ap.max > 0, "ap.max 没解析到");
        assert!(info.status.ap.last_ap_add_time > 0, "ap.lastApAddTime 没解析到");
        assert!(
            info.status.ap.complete_recovery_time > 0,
            "ap.completeRecoveryTime 没解析到"
        );
        // mainStageProgress 可能为空串（B 服账号实测就是空，官服给 `main_02-09`），
        // 只验证字段能读到、不是缺失
        assert!(info.status.main_stage_progress.len() < 64);
        assert_eq!(info.status.resume, "");

        // 头像：明日方舟唯一的头像来源（终末地的 base.avatarUrl 对它无效）
        // B 服账号用的是干员皮肤头像（type = ASSISTANT），官服是默认 ICON
        let avatar = info.status.avatar.as_ref().expect("status.avatar 没解析到");
        assert!(!avatar.id.is_empty(), "status.avatar.id 没解析到");
        assert_eq!(avatar.kind, "ASSISTANT");
        assert!(
            avatar.url.starts_with("https://web.hycdn.cn/"),
            "头像 url: {}",
            avatar.url
        );
        assert!(avatar.base64.is_none(), "接口本身不下发 base64");

        // 看板干员
        let secretary = info
            .status
            .secretary
            .as_ref()
            .expect("status.secretary 没解析到");
        assert!(!secretary.char_id.is_empty(), "secretary.charId 没解析到");

        // ---- chars：干员养成（只断言结构，具体值随账号不同）----
        assert!(!info.chars.is_empty(), "chars 没解析到");
        let first = &info.chars[0];
        assert!(!first.char_id.is_empty(), "chars[].charId 没解析到");
        assert!(first.level > 0, "chars[].level 没解析到");
        assert!(
            first.evolve_phase == 0 || first.evolve_phase == 1 || first.evolve_phase == 2,
            "evolvePhase 取值异常: {}",
            first.evolve_phase
        );
        assert!(first.main_skill_lvl > 0, "mainSkillLvl 没解析到");
        // player/info 里专精字段名是 specializeLevel（cultivate 里才叫 level）；
        // 有些干员（如近卫阿米娅前的低星）skills 为空数组，所以只对非空的做断言
        if let Some(skill) = first.skills.first() {
            assert!(
                skill.specialize_level >= 0 && skill.specialize_level <= 3,
                "specializeLevel 越界: {}",
                skill.specialize_level
            );
        }

        // ---- charInfoMap ----
        assert!(!info.char_info_map.is_empty(), "charInfoMap 没解析到");
        let (char_id, entry) = info
            .char_info_map
            .iter()
            .next()
            .expect("charInfoMap 为空");
        assert!(!char_id.is_empty());
        assert!(
            entry.get("name").and_then(|v| v.as_str()).is_some(),
            "charInfoMap[].name 没解析到"
        );
        assert!(
            entry.get("rarity").and_then(|v| v.as_i64()).is_some(),
            "charInfoMap[].rarity 没解析到"
        );

        // ---- routine / campaign / tower（只验证结构读到、上限为正）----
        assert!(info.routine.daily.total > 0, "routine.daily.total 没解析到");
        assert!(info.routine.weekly.total > 0, "routine.weekly.total 没解析到");
        assert!(info.campaign.reward.total > 0, "campaign.reward.total 没解析到");
        assert!(
            info.tower.reward.higher_item.total > 0,
            "tower.reward.higherItem.total 没解析到"
        );
        assert!(
            info.tower.reward.lower_item.total > 0,
            "tower.reward.lowerItem.total 没解析到"
        );
        assert!(info.tower.reward.term_ts > 0, "tower.termTs 没解析到");

        // ---- recruit（只验证结构：4 个栏位，state 取值合法）----
        assert_eq!(info.recruit.len(), 4, "recruit 栏位数量");
        assert!(
            info.recruit.iter().all(|slot| slot.state >= 0 && slot.state <= 3),
            "recruit[].state 取值异常"
        );

        // ---- building ----
        let labor = info.building.labor.as_ref().expect("building.labor 没解析到");
        assert!(labor.max_value > 0, "labor.maxValue 没解析到");
        assert!(labor.value >= 0, "labor.value 没解析到");
        assert!(labor.last_update_time > 0);

        // ★ 真实 bug 回归：夹具取自 **B 服** 账号，它的 hire/training 是对象且
        // training.speed=1.35 / remainPoint=0.45 都是**浮点**。
        // 官服账号这两个字段是 null（见 player_info_tolerates_missing_building 与
        // player_info_accepts_hire_and_training_when_present），两种形态都必须能解析。
        let hire = info.building.hire.as_ref().expect("building.hire 没解析到");
        assert!(hire.level > 0, "hire.level 没解析到");
        assert!(hire.slot_id.starts_with("slot_"), "hire.slotId");

        let training = info.building.training.as_ref().expect("building.training 没解析到");
        assert!(
            (training.speed - 1.35).abs() < 1e-9,
            "training.speed 应为浮点 1.35，实际 {}",
            training.speed
        );
        assert!(
            (training.remain_point - 0.45).abs() < 1e-9,
            "training.remainPoint 应为浮点 0.45，实际 {}",
            training.remain_point
        );
        // trainee 存在但 targetSkill = -1（空位）也要能读出
        let trainee = training.trainee.as_ref().expect("training.trainee 没解析到");
        assert_eq!(trainee.target_skill, -1);
        assert!(
            training.trainer.is_some(),
            "training.trainer 没解析到"
        );
        // ★ 回归：训练室等级/槽位必须在模型里（缺失时页面显示「等级 」无数字）
        assert_eq!(training.level, 3, "training.level 没解析到");
        assert!(training.slot_id.starts_with("slot_"), "training.slotId");
        assert!(training.last_update_time > 0, "training.lastUpdateTime 没解析到");

        // 设施排班能解析
        assert!(!info.building.control.is_empty(), "building.control 没解析到");
        assert!(
            !info.building.control[0].chars.is_empty(),
            "building.control[].chars 没解析到"
        );
        assert!(info.building.control[0].chars[0].ap >= 0);

        // ---- 游戏数据页字段（章节进度 / 信息表 / 其他模式）----
        // 主线关卡展示信息：键 = mainStageProgress 指向的关卡 id
        let stage = info
            .stage_info_map
            .get("main_15-09")
            .expect("stageInfoMap 没解析到");
        assert_eq!(stage.code, "15-10");
        assert_eq!(stage.name, "怀黍离");
        assert_eq!(stage.ap_cost, 24);

        // 活动章节进度：聚合 = 逐区相加
        assert_eq!(info.activity.len(), 2, "activity 没解析到");
        let act55 = info
            .activity
            .iter()
            .find(|a| a.act_id == "act55side")
            .expect("act55side 没解析到");
        assert!(act55.act_replica_id.is_empty());
        let cleared: i32 = act55.zones.iter().map(|z| z.cleared_stage).sum();
        let total: i32 = act55.zones.iter().map(|z| z.total_stage).sum();
        assert_eq!((cleared, total), (18, 27), "act55side 聚合进度");
        let replica = info
            .activity
            .iter()
            .find(|a| a.act_id == "1stact")
            .expect("复刻活动没解析到");
        assert_eq!(replica.act_replica_id, "act13d2");

        // 信息表（名称 / 类别 / 排序 / 封面）
        let act_info = info.activity_info_map.get("act55side").expect("activityInfoMap");
        assert_eq!(act_info.name, "时间啊，向前！");
        assert_eq!(act_info.kind, "", "新活动 type 可为空串");
        assert!(act_info.pic_url.is_empty(), "act55side 实测无封面（picUrl 覆盖率约 57%，必须能容忍空串）");
        let replica_info = info.activity_info_map.get("1stact").expect("1stact");
        assert_eq!(replica_info.kind, "SIDESTORY");
        assert!(
            replica_info.pic_url.starts_with("https://bbs.hycdn.cn/"),
            "1stact 实测带章节封面 picUrl"
        );
        assert_eq!(
            info.campaign_info_map.get("camp_01").expect("campaignInfoMap").name,
            "切尔诺伯格"
        );
        assert_eq!(
            info.rogue_info_map.get("rogue_5").expect("rogueInfoMap").sort,
            5
        );
        assert_eq!(
            info.tower_info_map.get("tower_tr_01").expect("towerInfoMap").sub_name,
            "罗德岛制药"
        );

        // 集成战略：bank 的键是 current/record（不是 total）
        assert_eq!(info.rogue.records.len(), 2, "rogue.records 没解析到");
        let rogue5 = info
            .rogue
            .records
            .iter()
            .find(|r| r.rogue_id == "rogue_5")
            .expect("rogue_5 没解析到");
        assert_eq!(rogue5.bank.record, 3);
        assert_eq!(rogue5.medal.total, 12);

        // 沙盒（subQuest 键名显式映射）与历险签约
        assert_eq!(info.sandbox.len(), 1, "sandbox 没解析到");
        assert_eq!(info.sandbox[0].fix_rift, vec![0, 5]);
        assert_eq!(info.sandbox[0].sub_quests.len(), 1, "subQuest 没解析到");
        assert_eq!(info.boss_rush.len(), 1, "bossRush 没解析到");

        // 原始响应不带 dataVersion（由服务层填充）；旧缓存/裸接口解析后为 0
        assert_eq!(info.data_version, 0, "接口本身不下发 dataVersion");

        assert!(info.current_ts > 0, "currentTs 没解析到");
    }

    #[test]
    fn player_info_tolerates_missing_building() {
        // 整个 building 缺失：容器级 #[serde(default)] 必须走 Default 而不是报错
        let minimal = serde_json::json!({
            "status": { "name": "X", "level": 1 }
        });
        let info: ArknightsPlayerInfo =
            serde_json::from_value(minimal).expect("最小响应也应能解析（容器级 default）");
        assert_eq!(info.status.name, "X");
        assert!(info.building.hire.is_none());
        assert!(info.building.labor.is_none());
        assert!(info.chars.is_empty());
    }

    #[test]
    fn player_info_accepts_hire_and_training_when_present() {
        // 有办公室 / 正在专精的账号：非 null 时必须真的解析出来
        // （不能因为用了 Option 就永不填充）
        let mut data = data_of(PLAYER_INFO);
        data["building"]["hire"] = serde_json::json!({
            "refreshCount": 2,
            "completeWorkTime": 1794240000
        });
        data["building"]["training"] = serde_json::json!({
            "trainee": { "charId": "char_002_amiya", "targetSkill": 1 },
            "trainer": { "charId": "char_003_kalts" },
            "speed": 25,
            "remainPoint": 12345,
            "remainSecs": 3600
        });

        let info: ArknightsPlayerInfo =
            serde_json::from_value(data).expect("带 hire/training 也应能解析");

        let hire = info.building.hire.expect("hire 应被解析");
        assert_eq!(hire.refresh_count, 2);
        assert_eq!(hire.complete_work_time, 1794240000);

        let training = info.building.training.expect("training 应被解析");
        // ⚠️ speed / remain_point 是 f64（实测接口会给 1.35 / 0.45 这类小数）
        assert!((training.speed - 25.0).abs() < 1e-9, "speed={}", training.speed);
        assert!(
            (training.remain_point - 12345.0).abs() < 1e-9,
            "remainPoint={}",
            training.remain_point
        );
        assert_eq!(training.remain_secs, 3600);
        let trainee = training.trainee.expect("training.trainee 应被解析");
        assert_eq!(trainee.char_id, "char_002_amiya");
        assert_eq!(trainee.target_skill, 1);
        assert_eq!(
            training.trainer.map(|t| t.char_id),
            Some("char_003_kalts".to_string())
        );

        // 空训练室（trainee/trainer 为 null）也要能解析
        let mut data2 = data_of(PLAYER_INFO);
        data2["building"]["training"] = serde_json::json!({
            "trainee": null, "trainer": null, "speed": 0, "remainPoint": 0, "remainSecs": 0
        });
        let info2: ArknightsPlayerInfo = serde_json::from_value(data2).expect("空训练室应能解析");
        let training2 = info2.building.training.expect("training 应被解析");
        assert!(training2.trainee.is_none());
        assert!(training2.trainer.is_none());
    }

    #[test]
    fn player_info_round_trips_without_losing_fields() {
        // 缓存是「解析后再序列化落盘」的，必须能原样读回来
        let info: ArknightsPlayerInfo =
            serde_json::from_value(data_of(PLAYER_INFO)).expect("解析");
        let json = serde_json::to_value(&info).expect("序列化");
        let again: ArknightsPlayerInfo = serde_json::from_value(json).expect("二次解析");
        assert_eq!(again.status.name, info.status.name);
        assert_eq!(again.chars.len(), info.chars.len());
        assert_eq!(again.status.avatar.map(|a| a.url), info.status.avatar.map(|a| a.url));
    }

    #[test]
    fn cultivate_parses_characters_and_items() {
        let cultivate: ArknightsCultivate =
            serde_json::from_value(data_of(CULTIVATE)).expect("ArknightsCultivate 解析失败");

        assert!(!cultivate.characters.is_empty(), "characters 没解析到");
        let first = &cultivate.characters[0];
        assert_eq!(first.id, "char_002_amiya");
        assert_eq!(first.evolve_phase, 2);
        assert!(!first.skills.is_empty(), "cultivate skills 没解析到");

        assert!(!cultivate.items.is_empty(), "items 没解析到");
        let item = &cultivate.items[0];
        // count 是**字符串**
        assert!(
            item.count.parse::<i64>().is_ok(),
            "items[].count 应为可解析字符串，实际 {:?}",
            item.count
        );
        assert!(!item.id.is_empty());
    }

    #[test]
    fn attendance_parses_calendar_records_and_resource_map() {
        let mut attendance: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE)).expect("ArknightsAttendance 解析失败");

        // ★ 真实夹具是完整 30 格（2026-11-11 签到前抓包），不要退化成裁剪版
        assert_eq!(attendance.calendar.len(), 30, "calendar 应为 30 格");
        assert_eq!(attendance.records.len(), 1, "签到前只有 1 条历史记录");

        let entry = &attendance.calendar[0];
        assert_eq!(entry.resource_id, "2002", "calendar[0].resourceId");
        assert!(entry.done, "calendar[0] 是前一天已领的那格");
        assert!(!entry.available, "calendar[0] 不可再领");
        assert_eq!(entry.kind, "daily");

        // 记录 ts 是**字符串**时间戳
        let record = &attendance.records[0];
        assert!(
            record.ts.parse::<i64>().is_ok(),
            "records[].ts 应为可解析字符串，实际 {:?}",
            record.ts
        );
        assert_eq!(record.kind, "daily");

        assert!(
            !attendance.resource_info_map.is_empty(),
            "resourceInfoMap 没解析到"
        );
        let (id, value) = attendance.resource_info_map.iter().next().unwrap();
        assert!(!id.is_empty());
        assert!(
            value.get("name").and_then(|n| n.as_str()).is_some(),
            "resourceInfoMap 物品缺 name"
        );
        // ★ 接口不下发 icon —— 这正是必须按 resourceId 拼 CDN 的原因
        assert!(
            value.get("icon").is_none(),
            "真实接口不下发 icon，夹具不应有"
        );

        assert!(attendance.current_ts > 0, "currentTs 没解析到");
        // first 实测为 null
        assert!(attendance.first.is_none(), "first 实测为 null");

        // 图标按 resourceId 补上
        attendance.fill_resource_icons();
        for (key, value) in attendance.resource_info_map.iter() {
            let icon = value
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            assert_eq!(
                icon,
                format!("{}{}.png", ARKNIGHTS_ITEM_ICON_BASE, key),
                "resourceInfoMap[{}] 的 icon 拼错了",
                key
            );
        }
    }

    /// ★ 核心回归：签到前 → `hasToday = false`，签到后 → `hasToday = true`
    ///
    /// 这是早先实现最大的 bug：前端用「今天几号 - 1」索引日历，
    /// 11 号去读下标 10，而那格是第 11 次签到的奖励、`done` 恒为 false，
    /// 于是**永远判成未签到**，界面一直显示可点的签到按钮。
    #[test]
    fn attendance_signed_today_uses_claimable_slot_not_day_of_month() {
        // ---- 签到前：下标 1 是 available && !done ----
        let mut before: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE)).expect("解析签到前夹具");
        before.fill_derived();

        assert_eq!(
            before.claimable_index(),
            Some(1),
            "签到前可领格应是下标 1（4001×500）"
        );
        assert!(!before.has_today, "签到前 hasToday 必须为 false");
        assert_eq!(before.today_index, Some(1), "todayIndex = 可领格下标");
        assert_eq!(before.tomorrow_index, Some(2), "tomorrowIndex = 可领格 +1");
        assert!(!before.signed_today());

        // 那一格确实是 available && !done
        assert_eq!(before.calendar[1].resource_id, "4001");
        assert_eq!(before.calendar[1].count, 500);
        assert!(before.calendar[1].available);
        assert!(!before.calendar[1].done);

        // ---- 签到后：没有可领格了 ----
        let mut after: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE_SIGNED)).expect("解析签到后夹具");
        after.fill_derived();

        assert_eq!(after.claimable_index(), None, "签到后不应再有可领格");
        assert!(after.has_today, "签到后 hasToday 必须为 true");
        assert!(after.signed_today());
        // 今天 = 最近领到的那格（下标 1）
        assert_eq!(after.today_index, Some(1), "已签时 todayIndex = 最近领到的格");
        assert_eq!(after.tomorrow_index, Some(2));

        // ★ 反例：11 号 ≠ 下标 10。若按「日号 - 1」去读，会读到 done=false 的格子
        //   （该格是本月的第 11 格，还没轮到），从而错误地判成未签到。
        let day_of_month = 11usize;
        let wrong_index = day_of_month - 1;
        assert!(
            !after.calendar[wrong_index].done,
            "夹具必须能复现老 bug：按下标 10 读到的格子 done 应为 false"
        );
        // 正确判据（看可领格）与错误判据（看日号）结论相反 —— 这正是修复点
        assert!(after.signed_today(), "正确判据：已签到");
        assert!(
            !after.calendar[wrong_index].done,
            "错误判据会得出「未签到」"
        );
    }

    /// `POST /api/v1/game/attendance` 的真实响应解析
    ///
    /// 实测 `data` = `{ts, awards[], resourceInfoMap, tomorrowAwards}`，
    /// 其中 `tomorrowAwards` 是**单个对象**而不是数组。
    #[test]
    fn attendance_result_parses_awards_and_tomorrow() {
        let mut result: ArknightsAttendanceResult =
            serde_json::from_value(data_of(ATTENDANCE_RESULT)).expect("签到结果解析失败");

        assert!(result.ts > 0, "ts 没解析到");
        assert_eq!(result.awards.len(), 1, "本次应发 1 件奖励");

        let award = &result.awards[0];
        assert_eq!(award.resource.id, "4001", "应发龙门币");
        assert_eq!(award.count, 500);
        assert_eq!(award.kind, "daily", "award.type");
        assert_eq!(award.resource.name, "龙门币");
        assert_eq!(award.resource.rarity, 3);
        // 接口不下发 icon
        assert!(award.resource.icon.is_empty(), "接口本身不给 icon");

        // ★ tomorrowAwards 是数组（实测一项）
        assert_eq!(result.tomorrow_awards.len(), 1, "明日奖励应有 1 项");
        let tomorrow = &result.tomorrow_awards[0];
        assert_eq!(tomorrow.resource.id, "3302", "明日奖励应是技巧概要");
        assert_eq!(tomorrow.count, 2);

        // 本次附带的 resourceInfoMap
        assert!(
            result.resource_info_map.contains_key("4001"),
            "resourceInfoMap 缺 4001"
        );

        // 补图标后应是 CDN 地址
        for award in &mut result.awards {
            award.fill_icon();
        }
        assert_eq!(
            result.awards[0].resource.icon,
            "https://web.hycdn.cn/arknights/game/assets/item/4001.png"
        );
        for award in &mut result.tomorrow_awards {
            award.fill_icon();
        }
        assert_eq!(
            result.tomorrow_awards[0].resource.icon,
            "https://web.hycdn.cn/arknights/game/assets/item/3302.png"
        );
    }

    /// 重复签到：`code=10001` 且没有 `data`，应折成 `alreadySigned`
    #[test]
    fn attendance_result_marks_already_signed_when_code_nonzero() {
        let result = ArknightsAttendanceResult {
            already_signed: true,
            code: 10001,
            message: "请勿重复签到！".to_string(),
            ..Default::default()
        };
        assert!(result.already_signed);
        assert!(result.awards.is_empty());
        assert_eq!(result.code, 10001);
    }

    /// `reward_of` 必须逐格取数量：同一 `resourceId` 在不同格数量不同
    ///
    /// 实测 `4001` 在 30 格里是 500/1000 混排，早期实现按 id 累加，
    /// 界面上每格都显示「整月总量」。
    #[test]
    fn attendance_reward_count_is_per_slot_not_accumulated() {
        let mut attendance: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE)).expect("解析");
        attendance.fill_resource_icons();

        let first = attendance.reward_of(0).expect("calendar[0] 应有奖励");
        let second = attendance.reward_of(1).expect("calendar[1] 应有奖励");

        assert_eq!(first.resource_id, "2002");
        assert_eq!(first.count, 3, "calendar[0] 是 2002×3");

        assert_eq!(second.resource_id, "4001");
        assert_eq!(second.count, 500, "calendar[1] 是 4001×500");
        assert_eq!(
            second.icon, "https://web.hycdn.cn/arknights/game/assets/item/4001.png",
            "reward_of 也应给出 CDN 图标"
        );

        // 下标 13 是 4001×1000 —— 同一物品不同数量，证明不能按 id 聚合
        let later = attendance.reward_of(13).expect("calendar[13] 应有奖励");
        assert_eq!(later.resource_id, "4001");
        assert_eq!(later.count, 1000, "calendar[13] 是 4001×1000");

        // 逐格数量必须真的不同（否则这条测试没有意义）
        assert_ne!(second.count, later.count);

        // 越界返回 None
        assert!(attendance.reward_of(999).is_none());
    }

    /// `has_record_today` 按本地自然日比较 `records[].ts`
    #[test]
    fn attendance_detects_record_within_today() {
        let mut attendance: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE_SIGNED)).expect("解析");
        attendance.fill_derived();
        assert!(
            attendance.has_record_today(),
            "签到后夹具里有一条落在 currentTs 当天的记录"
        );

        // 换成签到前的夹具：唯一一条记录是前一天，不应算今天
        let before: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE)).expect("解析");
        assert!(
            !before.has_record_today(),
            "签到前唯一记录是前一天，不应算今天已签"
        );
    }

    #[test]
    fn training_accepts_float_speed_and_remain_point() {
        // ★ 真实 bug 回归：B 服账号的 `training.speed` = 1.35、`remainPoint` = 0.45
        // 都是**浮点**，而官服账号恰好给整数。以前声明成 i32/i64，导致整包解析失败 ——
        // 接口 code=0、字段看着都对，但前端表现为「等级 0、没有头像」。
        let mut data = data_of(PLAYER_INFO);
        data["building"]["training"] = serde_json::json!({
            "lastUpdateTime": 1794321410i64,
            "level": 3,
            "remainPoint": 0.45,
            "remainSecs": 0,
            "slotId": "slot_13",
            "slotState": 2,
            "speed": 1.35,
            "trainee": {
                "ap": 8640000i64,
                "charId": "char_4244_tocka",
                "lastApAddTime": 1794321410i64,
                "targetSkill": -1
            },
            "trainer": {
                "ap": 6933360i64,
                "charId": "char_4234_pedro",
                "lastApAddTime": 1794321410i64
            }
        });

        let info: ArknightsPlayerInfo =
            serde_json::from_value(data).expect("浮点 speed/remainPoint 必须能解析");

        let training = info.building.training.expect("training 应被解析");
        assert!((training.speed - 1.35).abs() < 1e-9, "speed={}", training.speed);
        assert!(
            (training.remain_point - 0.45).abs() < 1e-9,
            "remainPoint={}",
            training.remain_point
        );
        // trainee 存在但 targetSkill = -1（空位）也要正常读出
        let trainee = training.trainee.expect("trainee 应被解析");
        assert_eq!(trainee.char_id, "char_4244_tocka");
        assert_eq!(trainee.target_skill, -1);
    }

    #[test]
    fn room_speed_accepts_float() {
        // 基建设施里的 speed 也可能是浮点（实测 1.02 / 1.22 / 1.53 / 1.68）
        let mut data = data_of(PLAYER_INFO);
        data["building"]["manufactures"] = serde_json::json!([{
            "capacity": 3,
            "chars": [{ "ap": 8640000i64, "charId": "char_002_amiya", "index": 0 }],
            "complete": 0,
            "completeWorkTime": 0i64,
            "formulaId": "2001",
            "lastUpdateTime": 1794321410i64,
            "level": 3,
            "remain": 0,
            "slotId": "slot_21",
            "speed": 1.53,
            "weight": 0
        }]);

        let info: ArknightsPlayerInfo =
            serde_json::from_value(data).expect("设施 speed 为浮点时必须能解析");
        let manufact = &info.building.manufactures[0];
        assert!((manufact.speed - 1.53).abs() < 1e-9, "speed={}", manufact.speed);
    }

    #[test]
    fn attendance_tolerates_missing_optional_parts() {
        // first 可能为 null、resourceInfoMap 可能为空 —— 不能因此解析失败
        let minimal = serde_json::json!({
            "calendar": [],
            "records": [],
            "resourceInfoMap": {},
            "currentTs": 0,
            "first": null
        });
        let mut attendance: ArknightsAttendance =
            serde_json::from_value(minimal).expect("最小签到响应也应能解析");
        assert!(attendance.records.is_empty());
        assert!(attendance.first.is_none());

        // 派生字段接口不返回，缺省应是 false / None，且 fill_derived 不 panic
        attendance.fill_derived();
        assert!(!attendance.has_today, "空日历 + 无记录 ⇒ 保守判未签");
        assert!(attendance.today_index.is_none());
        assert!(attendance.tomorrow_index.is_none());
        assert!(attendance.reward_of(0).is_none());
    }

    /// 日历为空但有当天签到记录 → 兜底判「已签」
    #[test]
    fn attendance_falls_back_to_records_when_calendar_empty() {
        let mut attendance = ArknightsAttendance {
            current_ts: 1794405925,
            ..Default::default()
        };
        attendance.records.push(ArknightsCheckinRecord {
            resource_id: "4001".to_string(),
            count: 500,
            ts: "1794405925".to_string(), // 与 currentTs 同一天
            kind: "daily".to_string(),
        });

        assert!(attendance.has_record_today());
        assert!(attendance.signed_today(), "空日历时应靠 records 兜底");
        attendance.fill_derived();
        assert!(attendance.has_today);
    }

    /// 图标 URL 拼接规则（用户明确给出的形式）
    #[test]
    fn item_icon_url_uses_resource_id() {
        assert_eq!(
            arknights_item_icon_url("2003"),
            "https://web.hycdn.cn/arknights/game/assets/item/2003.png"
        );
        assert_eq!(
            arknights_item_icon_url("4001"),
            "https://web.hycdn.cn/arknights/game/assets/item/4001.png"
        );
    }
}
