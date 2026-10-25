use serde::{Deserialize, Serialize};

/// 登录请求模型（密码登录）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub phone: String,
    pub password: String,
    /// 重新登录时用于校验登录结果是否为目标森空岛账户（不匹配则拦截，不落盘凭证）
    #[serde(default)]
    pub expected_user_id: Option<String>,
}

/// 发送验证码请求模型
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SendCodeRequest {
    pub phone: String,
    #[serde(rename = "type")]
    pub code_type: i32,
}

/// 验证码登录请求模型
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodeLoginRequest {
    pub phone: String,
    pub code: String,
    /// 重新登录时用于校验登录结果是否为目标森空岛账户
    #[serde(default)]
    pub expected_user_id: Option<String>,
}

/// 扫码登录信息模型
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanLoginInfo {
    pub scan_id: String,
    pub scan_url: String,
}

/// 扫码登录状态模型
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    /// 100 = 未扫码, 101 = 已扫码, 0 = 登录成功（返回 scan_code）
    pub status: i32,
    pub scan_code: Option<String>,
    pub msg: Option<String>,
}
