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
}
