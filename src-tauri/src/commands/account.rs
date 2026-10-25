use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::models::account::{
    AccountInfo, AccountLoginResult, AccountRefreshResult, SklandAccountInfo, SklandGameInfo,
    SklandUserInfo,
};
use crate::models::login::{
    CodeLoginRequest, LoginRequest, ScanLoginInfo, ScanStatus, SendCodeRequest,
};
use crate::models::role::RoleDisplayInfo;
use crate::services::account_service::AccountService;

/// 获取所有账户
#[tauri::command]
pub async fn get_accounts(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<Vec<AccountInfo>, String> {
    use crate::log_debug;

    let service = state.lock().await;

    // 尝试从缓存获取 (根据懒加载状态自动选择精简版或完整版)
    {
        let config_service = service.get_config_service();
        let config = config_service.lock().unwrap();
        let all_config = config.get_all();
        drop(config);

        let mut all_accounts: Vec<AccountInfo> = Vec::new();
        let mut cache_hit = true;

        // 遍历所有 account_token_* 配置项，获取每个用户的缓存
        for (key, _) in &all_config {
            if key.starts_with("account_token_") {
                let user_id = key.trim_start_matches("account_token_");

                // 尝试从缓存获取
                if let Some(cached_accounts) = service.get_cached_accounts(user_id) {
                    all_accounts.extend(cached_accounts);
                } else {
                    cache_hit = false;
                    break; // 有任何一个用户缓存未命中，就需要重新获取
                }
            }
        }

        // 如果所有用户都缓存命中，直接返回
        if cache_hit && !all_accounts.is_empty() {
            log_debug!(
                "[get_accounts] Cache hit for all users, returning {} accounts",
                all_accounts.len()
            );
            return Ok(all_accounts);
        }
    } // MutexGuard 在这里释放

    // 否则调用 API 获取最新数据
    log_debug!("[get_accounts] Cache miss, fetching from API");
    Ok(service.get_accounts().await)
}

/// 获取已绑定的森空岛账户
#[tauri::command]
pub async fn get_skland_accounts(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<Vec<SklandAccountInfo>, String> {
    let service = state.lock().await;
    Ok(service.get_skland_accounts())
}

/// 用户确认绑定森空岛账户
#[tauri::command]
pub async fn save_skland_account(
    state: State<'_, Arc<Mutex<AccountService>>>,
    cred: String,
    token: String,
    user_id: String,
) -> Result<bool, String> {
    let service = state.lock().await;
    service
        .save_skland_account(cred, token, user_id)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

/// 获取指定森空岛账户下的游戏角色
#[tauri::command]
pub async fn get_skland_account_roles(
    state: State<'_, Arc<Mutex<AccountService>>>,
    user_id: String,
) -> Result<AccountLoginResult, String> {
    let service = state.lock().await;
    service
        .get_skland_account_roles(user_id)
        .await
        .map_err(|error| error.to_string())
}

/// 获取森空岛账户的用户资料（昵称、头像、游戏等级/积分等）
#[tauri::command]
pub async fn get_skland_user_info(
    state: State<'_, Arc<Mutex<AccountService>>>,
    user_id: String,
) -> Result<SklandUserInfo, String> {
    let service = state.lock().await;
    service
        .get_skland_user_info(user_id)
        .await
        .map_err(|error| error.to_string())
}

/// 获取森空岛游戏列表（游戏图标等基础信息，带缓存）
#[tauri::command]
pub async fn get_skland_games(
    state: State<'_, Arc<Mutex<AccountService>>>,
    user_id: String,
    force: Option<bool>,
) -> Result<Vec<SklandGameInfo>, String> {
    let service = state.lock().await;
    service
        .get_skland_games(user_id, force.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

/// 用刚登录得到的 cred/token 读取森空岛用户资料（确认绑定页面展示头像/昵称）
#[tauri::command]
pub async fn get_skland_user_info_by_cred(
    state: State<'_, Arc<Mutex<AccountService>>>,
    cred: String,
    token: String,
) -> Result<SklandUserInfo, String> {
    let service = state.lock().await;
    service
        .get_skland_user_info_by_cred(cred, token)
        .await
        .map_err(|error| error.to_string())
}

/// 添加账户（登录）
#[tauri::command]
pub async fn add_account(
    state: State<'_, Arc<Mutex<AccountService>>>,
    login_request: LoginRequest,
) -> Result<AccountLoginResult, String> {
    let service = state.lock().await;
    service
        .add_account(login_request)
        .await
        .map_err(|e| e.to_string())
}

/// 登出单个账户
#[tauri::command]
pub async fn logout_account(
    state: State<'_, Arc<Mutex<AccountService>>>,
    account_id: String,
    keep_device_token: Option<bool>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(service
        .logout_account(account_id, keep_device_token.unwrap_or(true))
        .await)
}

/// 批量登出账户
#[tauri::command]
pub async fn batch_logout(
    state: State<'_, Arc<Mutex<AccountService>>>,
    account_ids: Vec<String>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(service.batch_logout(account_ids).await)
}

/// 刷新账户数据
#[tauri::command]
pub async fn refresh_accounts(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<AccountRefreshResult, String> {
    let service = state.lock().await;
    Ok(service.refresh_accounts().await)
}

/// 发送验证码
#[tauri::command]
pub async fn send_verification_code(
    state: State<'_, Arc<Mutex<AccountService>>>,
    request: SendCodeRequest,
) -> Result<bool, String> {
    let service = state.lock().await;
    service
        .send_verification_code(request)
        .await
        .map_err(|e| e.to_string())
}

/// 通过验证码添加账户
#[tauri::command]
pub async fn add_account_by_code(
    state: State<'_, Arc<Mutex<AccountService>>>,
    login_request: CodeLoginRequest,
) -> Result<AccountLoginResult, String> {
    let service = state.lock().await;
    service
        .add_account_by_code(login_request)
        .await
        .map_err(|e| e.to_string())
}

/// 生成扫码登录二维码
#[tauri::command]
pub async fn gen_scan_login(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<ScanLoginInfo, String> {
    let service = state.lock().await;
    service.gen_scan_login().await.map_err(|e| e.to_string())
}

/// 查询扫码登录状态
#[tauri::command]
pub async fn scan_status(
    state: State<'_, Arc<Mutex<AccountService>>>,
    scan_id: String,
) -> Result<ScanStatus, String> {
    let service = state.lock().await;
    service
        .scan_status(&scan_id)
        .await
        .map_err(|e| e.to_string())
}

/// 通过扫码添加账户
#[tauri::command]
pub async fn add_account_by_scan(
    state: State<'_, Arc<Mutex<AccountService>>>,
    scan_code: String,
    expected_user_id: Option<String>,
) -> Result<AccountLoginResult, String> {
    let service = state.lock().await;
    service
        .add_account_by_scan(scan_code, expected_user_id)
        .await
        .map_err(|e| e.to_string())
}

/// 保存用户选择的角色
#[tauri::command]
pub async fn save_selected_roles(
    state: State<'_, Arc<Mutex<AccountService>>>,
    cred: String,
    token: String,
    user_id: String,
    selected_roles: Vec<RoleDisplayInfo>,
) -> Result<Vec<AccountInfo>, String> {
    let service = state.lock().await;
    service
        .save_selected_roles(cred, token, user_id, selected_roles)
        .await
        .map_err(|e| e.to_string())
}

/// 获取当前选中的账户 ID
#[tauri::command]
pub async fn get_selected_account(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<Option<String>, String> {
    let service = state.lock().await;
    let config = service.get_config_service();
    let config_guard = config.lock().unwrap();
    Ok(config_guard.get("selected_account_id"))
}

/// 设置当前选中的账户 ID
#[tauri::command]
pub async fn set_selected_account(
    state: State<'_, Arc<Mutex<AccountService>>>,
    account_id: String,
) -> Result<bool, String> {
    let service = state.lock().await;
    let config = service.get_config_service();
    let mut config_guard = config.lock().unwrap();
    config_guard
        .set(
            "selected_account_id".to_string(),
            serde_json::json!(account_id),
        )
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 检查并刷新指定用户的 cred
#[tauri::command]
pub async fn check_and_refresh_cred(
    state: State<'_, Arc<Mutex<AccountService>>>,
    user_id: String,
) -> Result<Option<(String, String)>, String> {
    let service = state.lock().await;
    service
        .check_and_refresh_user_cred(&user_id)
        .await
        .map_err(|e| e.to_string())
}

/// 设置懒加载开关
#[tauri::command]
pub async fn set_lazy_load_enabled(
    state: State<'_, Arc<Mutex<AccountService>>>,
    enabled: bool,
) -> Result<bool, String> {
    let service = state.lock().await;
    service
        .set_lazy_load_enabled(enabled)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取懒加载状态
#[tauri::command]
pub async fn is_lazy_load_enabled(
    state: State<'_, Arc<Mutex<AccountService>>>,
) -> Result<bool, String> {
    let service = state.lock().await;
    Ok(service.is_lazy_load_enabled())
}

/// 设置当前激活的角色ID
#[tauri::command]
pub async fn set_current_role_id(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: Option<String>,
) -> Result<bool, String> {
    let service = state.lock().await;
    service.set_current_role_id(role_id).await;
    Ok(true)
}

/// 统一数据查询接口
///
/// # Arguments
/// * `role_id` - 角色ID
/// * `api_name` - API名称（如 "char_detail"）
/// * `paths` - 路径列表，每个路径精确到JSON叶节点
///   - 空数组表示返回完整数据
///   - 例如: ["base.name", "chars.0.charData.id", "chars.0.charData.avatarSqUrl"]
///
/// # Returns
/// JSON Object，其中 key 是请求的路径，value 是对应的值
/// 如果路径不存在，值为 null
#[tauri::command]
pub async fn query_role_data(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
    api_name: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    use crate::{log_debug, log_error, log_info};

    log_debug!(
        "query_role_data command: role_id={}, api_name={}, paths_count={}",
        role_id,
        api_name,
        paths.len()
    );

    let service = state.lock().await;

    match service.query_role_data(&role_id, &api_name, &paths).await {
        Ok(result) => {
            log_info!(
                "query_role_data: Successfully retrieved {} paths for {}",
                result.len(),
                role_id
            );
            // 将 HashMap 转换为 JSON Object
            Ok(serde_json::to_value(result).map_err(|e| {
                log_error!("query_role_data: Failed to serialize result: {}", e);
                format!("Failed to serialize result: {}", e)
            })?)
        }
        Err(e) => {
            log_error!("query_role_data: Query failed: {}", e);
            Err(format!("Query failed: {}", e))
        }
    }
}
