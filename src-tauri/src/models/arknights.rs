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
    /// 公共招募栏位
    pub recruit: Vec<ArknightsRecruitSlot>,
    /// 每日/每周任务
    pub routine: ArknightsRoutine,
    /// 剿灭作战
    pub campaign: ArknightsCampaign,
    /// 保全派驻
    pub tower: ArknightsTower,
    /// 基建
    pub building: ArknightsBuilding,
    /// 数据生成时间戳
    pub current_ts: i64,
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
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCampaign {
    pub reward: ArknightsProgress,
    #[serde(default)]
    pub records: Vec<serde_json::Value>,
}

/// 保全派驻（`data.tower`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsTower {
    pub reward: ArknightsTowerReward,
    #[serde(default)]
    pub records: Vec<serde_json::Value>,
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
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAttendance {
    /// 本月签到日历（30 项左右）
    pub calendar: Vec<ArknightsCalendarEntry>,
    /// 已签到记录
    pub records: Vec<ArknightsCheckinRecord>,
    /// 物品 id → 物品静态信息（名称/稀有度/掉落关卡等）
    pub resource_info_map: serde_json::Map<String, serde_json::Value>,
    /// 数据生成时间戳。实测是**字符串**（`player/info` 那边是数字），两者都接受
    #[serde(default, deserialize_with = "string_or_i64")]
    pub current_ts: i64,
    /// 本月首次签到信息（可能为 null）
    pub first: Option<serde_json::Value>,
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

/// `do_attendance` 返回的奖励
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAward {
    pub resource: ArknightsAwardResource,
    pub count: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsAwardResource {
    pub id: String,
    pub name: String,
    pub icon: String,
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

        // 设施排班能解析
        assert!(!info.building.control.is_empty(), "building.control 没解析到");
        assert!(
            !info.building.control[0].chars.is_empty(),
            "building.control[].chars 没解析到"
        );
        assert!(info.building.control[0].chars[0].ap >= 0);

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
        let attendance: ArknightsAttendance =
            serde_json::from_value(data_of(ATTENDANCE)).expect("ArknightsAttendance 解析失败");

        assert!(!attendance.calendar.is_empty(), "calendar 没解析到");
        let entry = &attendance.calendar[0];
        assert!(!entry.resource_id.is_empty(), "calendar[].resourceId");
        assert_eq!(entry.kind, "daily");

        assert!(!attendance.records.is_empty(), "records 没解析到");
        let record = &attendance.records[0];
        // ts 是**字符串**时间戳
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

        assert!(attendance.current_ts > 0, "currentTs 没解析到");
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
        let attendance: ArknightsAttendance =
            serde_json::from_value(minimal).expect("最小签到响应也应能解析");
        assert!(attendance.records.is_empty());
        assert!(attendance.first.is_none());
    }
}
