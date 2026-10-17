use serde::{Deserialize, Serialize};

/// 顶层响应包装
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharDetailResponse {
    pub code: i32,
    pub message: String,
    pub timestamp: String,
    pub data: CharDetailDataWrapper,
}

/// 数据包装器
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharDetailDataWrapper {
    pub detail: CharDetailData,
}

/// 主数据结构 - 包含所有角色详情信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharDetailData {
    pub base: BaseInfo,
    #[serde(default, deserialize_with = "deserialize_chars_fallback")]
    pub chars: Vec<CharacterItem>,
    #[serde(default)]
    pub dungeon: Option<serde_json::Value>,
    #[serde(default)]
    pub bp_system: Option<BpSystem>,
    #[serde(default)]
    pub daily_mission: Option<DailyMission>,
    #[serde(default)]
    pub weekly_mission: Option<WeeklyMission>,
    #[serde(default)]
    pub space_ship: Option<serde_json::Value>,
    #[serde(default)]
    pub domain: Option<serde_json::Value>,
    #[serde(default)]
    pub quickaccess: Option<serde_json::Value>,
    #[serde(default)]
    pub config: Option<serde_json::Value>,
    #[serde(default)]
    pub achieve: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "deserialize_string_to_i64")]
    pub current_ts: Option<i64>,
}

// 自定义反序列化器：将字符串或数字转换为 i64
fn deserialize_string_to_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    // 尝试解析为 serde_json::Value
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;

    match value {
        None => Ok(None),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64()),
        Some(serde_json::Value::String(s)) => s
            .parse::<i64>()
            .map(Some)
            .map_err(|e| Error::custom(format!("Failed to parse string '{}' as i64: {}", s, e))),
        _ => Err(Error::custom("Expected a number or string")),
    }
}

// 自定义反序列化器：如果 chars 解析失败，返回空数组
fn deserialize_chars_fallback<'de, D>(deserializer: D) -> Result<Vec<CharacterItem>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // 尝试解析为 Vec<CharacterItem>
    let result: Result<Vec<CharacterItem>, _> = Vec::deserialize(deserializer);

    match result {
        Ok(chars) => Ok(chars),
        Err(e) => {
            // 记录错误但返回空数组，避免整个解析失败
            crate::safe_eprintln!(
                "Warning: Failed to deserialize chars array: {}. Returning empty array.",
                e
            );
            Ok(Vec::new())
        }
    }
}

/// 基础玩家信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BaseInfo {
    pub server_name: String,
    pub role_id: String,
    pub name: String,
    pub create_time: String,
    pub save_time: String,
    pub last_login_time: String,
    pub exp: i64,
    pub level: i32,
    pub world_level: i32,
    pub gender: i32,
    pub avatar_url: String,
    pub main_mission: MainMission,
    pub char_num: i32,
    pub weapon_num: i32,
    pub doc_num: i32,
}

/// 主线任务信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MainMission {
    pub id: String,
    pub description: String,
}

/// 干员项（API 返回的格式）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharacterItem {
    #[serde(default)]
    pub char_data: Option<CharacterData>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub level: Option<i32>,
    #[serde(default)]
    pub evolve_phase: Option<i32>,
    #[serde(default)]
    pub potential_level: Option<i32>,
    #[serde(default)]
    pub user_skills: Option<serde_json::Value>,
    #[serde(default)]
    pub body_equip: Option<serde_json::Value>,
    #[serde(default)]
    pub arm_equip: Option<serde_json::Value>,
    #[serde(default)]
    pub first_accessory: Option<serde_json::Value>,
    #[serde(default)]
    pub second_accessory: Option<serde_json::Value>,
    #[serde(default)]
    pub weapon: Option<serde_json::Value>,
    #[serde(default)]
    pub tactical_item: Option<serde_json::Value>,
    #[serde(default)]
    pub wiki_item_id: Option<String>,
    #[serde(default)]
    pub talent: Option<TalentNodes>,
}

/// 天赋节点信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TalentNodes {
    pub latest_break_node: String,
    pub attr_nodes: Vec<String>,                   // 能力天赋节点 ID
    pub latest_passive_skill_nodes: Vec<String>,   // 战斗天赋节点 ID
    pub latest_factory_skill_nodes: Vec<String>,   // 制造天赋节点 ID
    pub latest_spaceship_skill_nodes: Vec<String>, // 培养天赋节点 ID
}

/// 干员详细数据
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharacterData {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_sq_url: Option<String>,
    #[serde(default)]
    pub avatar_rt_url: Option<String>,
    #[serde(default)]
    pub rarity: Option<RarityInfo>,
    #[serde(default)]
    pub profession: Option<ProfessionInfo>,
    #[serde(default)]
    pub property: Option<PropertyInfo>,
    #[serde(default)]
    pub weapon_type: Option<WeaponTypeInfo>,
    #[serde(default)]
    pub skills: Option<Vec<SkillInfo>>,
    #[serde(default)]
    pub illustration_url: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub ability_talents: Option<Vec<TalentInfo>>,
    #[serde(default)]
    pub combat_talents: Option<Vec<TalentInfo>>,
    #[serde(default)]
    pub cultivation_talents: Option<Vec<TalentInfo>>,
}

/// 稀有度信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RarityInfo {
    pub key: String,
    pub value: String,
}

/// 职业信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProfessionInfo {
    pub key: String,
    pub value: String,
}

/// 属性信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PropertyInfo {
    pub key: String,
    pub value: String,
}

/// 武器类型信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeaponTypeInfo {
    pub key: String,
    pub value: String,
}

/// 技能信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub skill_type: SkillTypeInfo,
    pub property: PropertyInfo,
    pub icon_url: String,
    pub desc: String,
    pub desc_params: serde_json::Value,
    pub desc_level_params: serde_json::Value,
    #[serde(default)]
    pub forms: Vec<SkillForm>,
}

/// 技能形态信息（多形态技能，如阵诀·智/阵诀·意）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillForm {
    #[serde(rename = "type")]
    pub form_type: String,
    pub name: String,
    pub icon_url: String,
    #[serde(default)]
    pub descs: Vec<String>,
}

/// 技能类型信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillTypeInfo {
    pub key: String,
    pub value: String,
}

/// 天赋信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TalentInfo {
    pub id: String,
    pub name: String,
    pub icon_url: String,
    pub desc: String,
    pub desc_params: Option<serde_json::Value>,
    pub locked_icon_url: String,
}

/// 战斗通行证系统
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BpSystem {
    pub cur_level: i32,
    pub max_level: i32,
}

/// 每日任务
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailyMission {
    pub daily_activation: i32,
    pub max_daily_activation: i32,
}

/// 每周任务
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyMission {
    pub score: i32,
    pub total: i32,
}
