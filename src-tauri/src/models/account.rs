use serde::{Deserialize, Serialize};

/// 精简版账户信息 (仅Account页面展示需要)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String, // roleId
    pub avatar: String,
    pub nickname: String,
    pub level: i32,
    pub server: String,
    pub status: String,              // online/offline/loading
    pub sync_status: Option<String>, // SYNCING/FAILED/null
}

/// 森空岛账户摘要（父级账户，游戏角色通过 user_id 关联）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SklandAccountInfo {
    pub user_id: String,
    pub game_role_count: usize,
    /// 已缓存的森空岛昵称（来自 `GET /web/v1/user`，未获取过时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    /// 已缓存的森空岛头像地址（来自 `GET /web/v1/user`，未获取过时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// 首次登录时记录的手机号（仅用于重新登录自动填充，未记录时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
}

/// 森空岛用户资料（`GET /web/v1/user` 响应中的 `data.user`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandUserInfo {
    pub id: String,
    pub nickname: String,
    pub profile: String,
    pub avatar: String,
    pub avatar_code: i64,
    pub background_code: i64,
    pub is_creator: bool,
    pub status: i32,
    pub operation_status: i32,
    pub identity: i32,
    pub kind: i32,
    pub latest_ip_location: String,
    pub moderator_status: i32,
    pub moderator_change_time: i64,
    pub gender: i32,
    pub birthday: String,
    pub hg_id: String,
    pub show_id: String,
    /// 各游戏的社区等级/积分
    pub score_info_list: Vec<SklandGameScore>,
    /// 头像挂件
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pendant: Option<SklandPendant>,
    /// `data.userRts` —— 社区互动数据（关注/粉丝/获赞等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<SklandUserStats>,
    /// `data.background` —— 个人主页背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<SklandBackground>,
}

/// 森空岛游戏基础信息（`GET /web/v1/game` 响应中的 `data.list[].game`）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandGameInfo {
    pub game_id: i64,
    pub name: String,
    pub icon_url: String,
    pub background_url: String,
}

/// 森空岛用户在单个游戏下的等级/积分
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandGameScore {
    pub game_id: i64,
    pub level: i32,
    pub icon_url: String,
    pub dark_mode_icon_url: String,
    pub checked_days: i32,
    pub score: i64,
    pub game_name: String,
    pub level_url: String,
}

/// 森空岛头像挂件
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandPendant {
    pub id: i64,
    pub icon_url: String,
    pub title: String,
    pub description: String,
}

/// 森空岛个人主页背景
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandBackground {
    pub id: i64,
    pub url: String,
    pub resource_kind: i32,
}

/// 森空岛社区互动数据（`data.userRts`，接口以字符串返回数值）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SklandUserStats {
    pub liked: String,
    pub collect: String,
    pub comment: String,
    pub follow: String,
    pub fans: String,
    pub black: String,
    #[serde(rename = "pub")]
    pub published: String,
}

/// 完整账户信息模型 (包含认证信息)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String, // roleId
    pub avatar: String,
    pub nickname: String,
    pub level: i32,
    pub server: String,
    pub status: String,              // online/offline/loading
    pub sync_status: Option<String>, // SYNCING/FAILED/null
    pub cred: Option<String>,
    pub token: Option<String>,
    pub user_id: Option<String>,
    pub server_id: Option<String>,
}

impl AccountInfo {
    /// 转换为精简版 (移除敏感信息)
    pub fn to_summary(&self) -> AccountSummary {
        AccountSummary {
            id: self.id.clone(),
            avatar: self.avatar.clone(),
            nickname: self.nickname.clone(),
            level: self.level,
            server: self.server.clone(),
            status: self.status.clone(),
            sync_status: self.sync_status.clone(),
        }
    }
}

/// 账户刷新结果
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountRefreshResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub accounts: Vec<AccountInfo>,
    pub refresh_time: String,
}

/// 账户登录结果
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub account: Option<AccountInfo>,
    pub available_roles: Option<Vec<crate::models::role::RoleDisplayInfo>>,
    pub cred: Option<String>,
    pub token: Option<String>,
    pub user_id: Option<String>,
}
