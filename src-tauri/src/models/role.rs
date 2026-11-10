use serde::{Deserialize, Serialize};

/// 游戏绑定信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameBinding {
    pub app_code: String,
    pub app_name: String,
    pub binding_list: Vec<BindingInfo>,
    pub default_uid: Option<String>,
}

/// 绑定信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BindingInfo {
    pub uid: String,
    pub is_official: bool,
    pub is_default: bool,
    pub channel_master_id: String,
    pub channel_name: String,
    pub nick_name: String,
    pub is_delete: bool,
    pub game_name: String,
    pub game_id: i32,
    pub roles: Vec<RoleInfo>,
    pub default_role: Option<RoleInfo>,
}

/// 角色信息
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub server_id: String,
    pub role_id: String,
    pub nickname: String,
    pub level: i32,
    pub is_default: bool,
    pub is_banned: bool,
    pub server_type: String,
    pub server_name: String,
}

/// 绑定列表响应
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BindingResponse {
    pub code: i32,
    pub message: String,
    pub timestamp: String,
    pub data: BindingData,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BindingData {
    pub list: Vec<GameBinding>,
    pub server_default_binding: serde_json::Value,
}

/// 角色所属游戏标识（`roles[].app` / `RoleDisplayInfo.game` 的取值）
pub const GAME_ENDFIELD: &str = "endfield";
pub const GAME_ARKNIGHTS: &str = "arknights";

/// 从绑定接口展平出来的单条角色记录（不联网、只含绑定侧基础信息）
///
/// `game` 区分游戏：终末地角色随后还要拉 `/api/v1/game/endfield/card/detail`
/// 补头像与精确等级；明日方舟角色**只用这份绑定信息**（uid / 服务器 / 昵称 / 等级），
/// 因为它没有对应的终末地详情接口。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameRoleBinding {
    /// `endfield` / `arknights`
    pub game: String,
    /// 该角色所属的**渠道绑定 uid**（官服 / B 服各一个）
    pub binding_uid: String,
    pub channel_master_id: String,
    pub channel_name: String,
    pub server_id: String,
    /// 服务器展示名（绑定接口的 `serverName`，可能为空）
    pub server_name: String,
    pub role_id: String,
    pub nickname: String,
    pub level: i32,
}

/// 角色展示信息（用于前端显示）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleDisplayInfo {
    pub role_id: String,
    pub user_id: String,
    pub server_id: String,
    pub nickname: String,
    pub level: i32,
    pub avatar_url: String,
    /// 角色所属游戏：`endfield`（终末地）/ `arknights`（明日方舟）。
    ///
    /// 老数据（绑定时还没有这个字段）反序列化兜底为 `endfield`。
    #[serde(default = "default_game")]
    pub game: String,
    /// 该角色所属的**渠道绑定 uid**（官服 / B 服各一个）。
    /// 换取 u8token 必须用它：同一个鹰角通行证换出的多把 token 各自只能读自己 uid 的记录。
    #[serde(default)]
    pub binding_uid: String,
    /// 渠道主 ID（1 = 官服，2 = B 服），仅用于展示与本地文件区分
    #[serde(default)]
    pub channel_master_id: String,
    /// 渠道名（来自绑定接口的 `channelName`），仅用于展示
    #[serde(default)]
    pub channel_name: String,
    /// 该角色是否已授权抽卡数据访问。
    ///
    /// 与 `roles[].u8Authorized` 同一个开关 —— 构建角色列表时由后端从配置回填，
    /// 否则前端每次重新拉角色集都会显示成「未授权」。
    #[serde(default)]
    pub u8_authorized: bool,
}

fn default_game() -> String {
    GAME_ENDFIELD.to_string()
}

impl RoleDisplayInfo {
    /// 是否属于《明日方舟》（终末地角色走另一套数据接口）
    pub fn is_arknights(&self) -> bool {
        self.game == GAME_ARKNIGHTS
    }
}
