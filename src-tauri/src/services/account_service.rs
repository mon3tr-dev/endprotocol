use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::async_runtime;
use tauri::{AppHandle, Emitter};

use crate::models::account::{
    AccountInfo, AccountLoginResult, AccountRefreshResult, AccountSummary, SklandAccountInfo,
    SklandGameInfo, SklandUserInfo,
};
use crate::models::login::{
    CodeLoginRequest, LoginRequest, ScanLoginInfo, ScanStatus, SendCodeRequest,
};
use crate::models::role::RoleDisplayInfo;
use crate::services::avatar_cache_service::AvatarCacheService;
use crate::services::config_service::ConfigService;
use crate::services::network_service::{NetworkService, PreloadRoleInfo};
use crate::services::skland_service::SklandService;
use crate::utils::{capture, http_client, AppError};
use crate::{log_debug, log_error, log_info, log_warn};

/// 森空岛游戏列表缓存配置键
const SKLAND_GAMES_CACHE_KEY: &str = "skland_games_cache";
/// 森空岛游戏列表缓存有效期（12 小时）
const SKLAND_GAMES_CACHE_TTL_SECS: i64 = 12 * 60 * 60;

/// 当前 Unix 时间戳（秒）
fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// 用于异步任务的简化版账户服务（避免 Arc<Mutex<>> 的复杂性）
struct AsyncAccountService {
    config_service: Arc<Mutex<ConfigService>>,
    skland_service: Arc<SklandService>,
}

impl AsyncAccountService {
    /// 检查并刷新用户的 cred（如果需要）
    async fn check_and_refresh_user_cred(
        &self,
        user_id: &str,
    ) -> Result<Option<(String, String)>, AppError> {
        // 获取当前用户的配置
        let token_key = format!("account_token_{}", user_id);

        let (token_data, cred, token, hytoken, u8token, device_token) = {
            let config = self.config_service.lock().unwrap();
            let token_data: Option<serde_json::Value> = config.get(&token_key);

            let (cred, token, hytoken, u8token, device_token) = match &token_data {
                Some(data) => {
                    let cred = data
                        .get("cred")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let token = data
                        .get("token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let hytoken = data
                        .get("hytoken")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let u8token = data
                        .get("u8token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let device_token = data
                        .get("device_token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (cred, token, hytoken, u8token, device_token)
                }
                None => return Ok(None),
            };

            (token_data, cred, token, hytoken, u8token, device_token)
        }; // MutexGuard 在这里被释放

        let cred = match cred {
            Some(c) => c,
            None => return Ok(None),
        };

        if token.is_none() {
            return Ok(None);
        }

        // 检查 cred 是否有效
        match self.skland_service.check_cred(&cred).await {
            Ok(true) => {
                // cred 有效，无需刷新
                tracing::debug!("Cred is valid for user {}", user_id);
                log_debug!(
                    "check_and_refresh_user_cred: Cred is VALID for user {}",
                    user_id
                );

                // 若 u8token 缺失，则补充获取（为升级前已存在的账号迁移）
                if u8token.is_none() {
                    if let (Some(hyt), Some(dev_tok)) = (&hytoken, &device_token) {
                        log_info!(
                            "check_and_refresh_user_cred: u8token MISSING for user {}, backfilling...",
                            user_id
                        );
                        match self
                            .skland_service
                            .get_u8_token_by_hytoken(hyt, dev_tok)
                            .await
                        {
                            Ok(u8t) => {
                                log_debug!(
                                    "check_and_refresh_user_cred: u8token backfill SUCCESS (len={})",
                                    u8t.len()
                                );
                                let mut config = self.config_service.lock().unwrap();
                                let mut updated_data = token_data.unwrap();
                                if let Some(obj) = updated_data.as_object_mut() {
                                    obj.insert("u8token".to_string(), json!(u8t));
                                }
                                config.set(token_key, updated_data)?;
                                log_debug!(
                                    "check_and_refresh_user_cred: u8token backfill saved to config"
                                );
                            }
                            Err(e) => {
                                log_warn!(
                                    "check_and_refresh_user_cred: u8token backfill FAILED (non-fatal): {}",
                                    e
                                );
                            }
                        }
                    } else {
                        log_warn!(
                            "check_and_refresh_user_cred: u8token missing, but hytoken/device_token not found, cannot backfill"
                        );
                    }
                }

                Ok(None)
            }
            Ok(false) => {
                // cred 无效，需要刷新
                tracing::info!("Cred expired for user {}, refreshing...", user_id);
                log_info!(
                    "check_and_refresh_user_cred: Cred EXPIRED for user {}, attempting refresh...",
                    user_id
                );

                let hytoken = match hytoken {
                    Some(h) => {
                        log_debug!(
                            "check_and_refresh_user_cred: Found hytoken (len={})",
                            h.len()
                        );
                        h
                    }
                    None => {
                        log_error!("check_and_refresh_user_cred: hytoken NOT FOUND for user {}, cannot refresh", user_id);
                        return Err(AppError::AuthError {
                            message: format!("hytoken not found for user {}, cannot refresh cred. Please re-login.", user_id),
                        });
                    }
                };

                // 使用 hytoken 重新换取 cred 和 token
                log_debug!("check_and_refresh_user_cred: Calling refresh_cred_by_hytoken...");
                match self
                    .skland_service
                    .refresh_cred_by_hytoken(&hytoken, device_token.as_deref())
                    .await
                {
                    Ok((new_cred, new_token, new_u8token, _)) => {
                        log_debug!("check_and_refresh_user_cred: refresh_cred_by_hytoken SUCCESS, new_cred_len={}, new_token_len={}", new_cred.len(), new_token.len());
                        // 更新配置中的 cred 和 token
                        let mut config = self.config_service.lock().unwrap();
                        let mut updated_data = token_data.unwrap();
                        if let Some(obj) = updated_data.as_object_mut() {
                            obj.insert("cred".to_string(), json!(new_cred));
                            obj.insert("token".to_string(), json!(new_token));
                            if let Some(u8t) = new_u8token {
                                obj.insert("u8token".to_string(), json!(u8t));
                                log_debug!(
                                    "check_and_refresh_user_cred: Updated u8token in config"
                                );
                            }
                            log_debug!(
                                "check_and_refresh_user_cred: Updated cred and token in config"
                            );
                        }
                        config.set(token_key, updated_data)?;
                        log_debug!("check_and_refresh_user_cred: Config saved successfully");

                        tracing::info!("Cred refreshed successfully for user {}", user_id);
                        Ok(Some((new_cred, new_token)))
                    }
                    Err(e) => {
                        log_error!(
                            "check_and_refresh_user_cred: refresh_cred_by_hytoken FAILED: {}",
                            e
                        );
                        tracing::error!("Failed to refresh cred for user {}: {}", user_id, e);
                        Err(e)
                    }
                }
            }
            Err(e) => {
                // check_cred API 调用失败
                log_error!(
                    "check_and_refresh_user_cred: check_cred API call failed: {}",
                    e
                );
                tracing::warn!(
                    "check_cred API failed for user {}: {}, treating as expired",
                    user_id,
                    e
                );

                let hytoken = match hytoken {
                    Some(h) => {
                        log_debug!("check_and_refresh_user_cred: Found hytoken (len={}), attempting refresh despite API error", h.len());
                        h
                    }
                    None => {
                        log_error!("check_and_refresh_user_cred: hytoken NOT FOUND and check_cred failed, cannot proceed");
                        return Err(AppError::AuthError {
                            message: format!("hytoken not found for user {} and check_cred failed: {}. Please re-login.", user_id, e),
                        });
                    }
                };

                log_debug!(
                    "check_and_refresh_user_cred: Attempting refresh despite check_cred failure..."
                );
                match self
                    .skland_service
                    .refresh_cred_by_hytoken(&hytoken, device_token.as_deref())
                    .await
                {
                    Ok((new_cred, new_token, new_u8token, _)) => {
                        log_debug!("check_and_refresh_user_cred: Refresh succeeded despite check_cred failure");
                        let mut config = self.config_service.lock().unwrap();
                        let mut updated_data = token_data.unwrap();
                        if let Some(obj) = updated_data.as_object_mut() {
                            obj.insert("cred".to_string(), json!(new_cred));
                            obj.insert("token".to_string(), json!(new_token));
                            if let Some(u8t) = new_u8token {
                                obj.insert("u8token".to_string(), json!(u8t));
                                log_debug!(
                                    "check_and_refresh_user_cred: Updated u8token in config"
                                );
                            }
                        }
                        config.set(token_key, updated_data)?;

                        tracing::info!(
                            "Cred refreshed successfully for user {} (after check_cred failure)",
                            user_id
                        );
                        Ok(Some((new_cred, new_token)))
                    }
                    Err(refresh_err) => {
                        log_error!(
                            "check_and_refresh_user_cred: Both check_cred and refresh failed: {}",
                            refresh_err
                        );
                        Err(AppError::AuthError {
                            message: format!(
                                "check_cred failed: {}. Refresh also failed: {}. Please re-login.",
                                e, refresh_err
                            ),
                        })
                    }
                }
            }
        }
    }
}

/// 当已获取 hytoken 但缺少 device token（新设备）时的处理策略
enum MissingDeviceTokenPolicy {
    /// 不发送验证码，仅返回 NEW_DEVICE_VERIFICATION_REQUIRED，
    /// 由前端引导用户在验证码登录/扫码登录之间选择继续（密码登录）
    RequireUserVerification,
    /// 无短信验证码渠道，继续登录但不记录 u8token（验证码/扫码登录）
    ContinueWithoutDeviceToken,
}

/// 账户服务
pub struct AccountService {
    config_service: Arc<Mutex<ConfigService>>,
    skland_service: Arc<SklandService>,
    avatar_cache_service: Arc<AvatarCacheService>,
    network_service: Arc<NetworkService>,
    // 账户基本信息缓存 - 懒加载时只存精简版，关闭时存完整版
    account_list_cache: Arc<Mutex<HashMap<String, Vec<AccountInfo>>>>,
    // 精简版账户列表缓存 (仅懒加载时使用)
    account_summary_cache: Arc<Mutex<HashMap<String, Vec<AccountSummary>>>>,
    // 懒加载开关
    lazy_load_enabled: Arc<Mutex<bool>>,
    // Tauri AppHandle，用于向前端发送事件通知
    app_handle: Option<AppHandle>,
}

impl AccountService {
    /// 创建新的账户服务实例
    pub fn new(
        config_service: Arc<Mutex<ConfigService>>,
        skland_service: Arc<SklandService>,
        avatar_cache_service: Arc<AvatarCacheService>,
        network_service: Arc<NetworkService>,
        app_handle: AppHandle,
    ) -> Self {
        // 从配置中读取懒加载设置，默认为true
        let lazy_load = {
            let config = config_service.lock().unwrap();
            config.get("lazy_load_enabled").unwrap_or(true)
        };

        Self {
            config_service,
            skland_service,
            avatar_cache_service,
            network_service,
            account_list_cache: Arc::new(Mutex::new(HashMap::new())),
            account_summary_cache: Arc::new(Mutex::new(HashMap::new())),
            lazy_load_enabled: Arc::new(Mutex::new(lazy_load)),
            app_handle: Some(app_handle),
        }
    }

    /// 获取配置服务引用
    pub fn get_config_service(&self) -> &Arc<Mutex<ConfigService>> {
        &self.config_service
    }

    /// 获取 Skland 服务引用
    pub fn skland_service(&self) -> &Arc<SklandService> {
        &self.skland_service
    }

    /// 获取图片缓存服务引用
    pub fn avatar_cache_service(&self) -> &Arc<AvatarCacheService> {
        &self.avatar_cache_service
    }

    /// 设置懒加载开关
    pub async fn set_lazy_load_enabled(&self, enabled: bool) -> Result<(), AppError> {
        {
            let mut lazy_load = self.lazy_load_enabled.lock().unwrap();
            *lazy_load = enabled;
        }

        // 保存到配置
        {
            let mut config = self.config_service.lock().unwrap();
            config.set("lazy_load_enabled".to_string(), json!(enabled))?;
        }

        log_info!("Lazy load {}", if enabled { "enabled" } else { "disabled" });

        // 如果开启懒加载，清除完整版缓存，保留精简版
        if enabled {
            // 先收集需要转换的数据
            let items_to_convert: Vec<(String, Vec<AccountInfo>)> = {
                let full_cache = self.account_list_cache.lock().unwrap();

                // 检查哪些用户还没有精简版缓存
                let summary_cache = self.account_summary_cache.lock().unwrap();
                let users_without_summary: Vec<String> = full_cache
                    .keys()
                    .filter(|user_id| !summary_cache.contains_key(*user_id))
                    .cloned()
                    .collect();
                drop(summary_cache);

                // 收集需要转换的账户
                users_without_summary
                    .iter()
                    .filter_map(|user_id| {
                        full_cache
                            .get(user_id)
                            .map(|accounts| (user_id.clone(), accounts.clone()))
                    })
                    .collect()
            };

            // 转换为精简版并缓存
            for (user_id, accounts) in items_to_convert {
                let summaries: Vec<AccountSummary> =
                    accounts.iter().map(|acc| acc.to_summary()).collect();
                self.cache_account_summary(&user_id, summaries);
            }

            // 清除所有完整版缓存 (避免浪费内存)
            {
                let mut full_cache = self.account_list_cache.lock().unwrap();
                full_cache.clear();
            }
            log_info!("Cleared full account cache (lazy load enabled), using summary cache");

            // 清除除当前角色外的所有详情缓存
            let current_role = self.network_service.get_current_role_id();
            self.network_service.retain_only_char_detail(current_role);
        } else {
            // 如果关闭懒加载，需要合并缓存
            // 先收集需要合并的数据
            let items_to_merge: Vec<(String, Vec<AccountSummary>)> = {
                let summary_cache = self.account_summary_cache.lock().unwrap();
                let full_cache = self.account_list_cache.lock().unwrap();

                summary_cache
                    .iter()
                    .filter(|(user_id, _)| !full_cache.contains_key(*user_id))
                    .map(|(user_id, summaries)| (user_id.clone(), summaries.clone()))
                    .collect()
            };

            // 合并到完整版缓存
            for (user_id, summaries) in items_to_merge {
                // 从配置文件获取完整信息
                let token_key = format!("account_token_{}", user_id);
                let config = self.config_service.lock().unwrap();
                if let Some(token_data) = config.get::<serde_json::Value>(&token_key) {
                    let cred = token_data
                        .get("cred")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let token = token_data
                        .get("token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let full_accounts: Vec<AccountInfo> = summaries
                        .iter()
                        .map(|s| AccountInfo {
                            id: s.id.clone(),
                            avatar: s.avatar.clone(),
                            nickname: s.nickname.clone(),
                            level: s.level,
                            server: s.server.clone(),
                            status: s.status.clone(),
                            sync_status: s.sync_status.clone(),
                            cred: cred.clone(),
                            token: token.clone(),
                            user_id: Some(user_id.clone()),
                            server_id: Some(s.server.clone()),
                        })
                        .collect();

                    drop(config); // 释放锁
                    {
                        let mut full_cache = self.account_list_cache.lock().unwrap();
                        full_cache.insert(user_id.clone(), full_accounts);
                    }
                    log_debug!("Merged summary to full cache for user: {}", user_id);
                }
            }

            // 清除精简版缓存 (避免重复存储浪费内存)
            {
                let mut summary_cache = self.account_summary_cache.lock().unwrap();
                summary_cache.clear();
            }
            log_info!("Cleared summary cache (lazy load disabled), using full cache");

            // 预加载所有角色详情
            let role_infos = self.gather_preload_role_infos().await;
            self.network_service
                .preload_all_char_details(&role_infos)
                .await?;
        }

        Ok(())
    }

    /// 获取懒加载状态
    pub fn is_lazy_load_enabled(&self) -> bool {
        *self.lazy_load_enabled.lock().unwrap()
    }

    /// 设置当前激活的角色ID
    pub async fn set_current_role_id(&self, role_id: Option<String>) {
        let lazy_load = self.is_lazy_load_enabled();
        self.network_service
            .set_current_role_id(role_id, lazy_load)
            .await;
    }

    /// 缓存账户列表
    pub fn cache_account_list(&self, user_id: &str, accounts: Vec<AccountInfo>) {
        let mut cache = self.account_list_cache.lock().unwrap();
        cache.insert(user_id.to_string(), accounts);
        log_debug!("Cached full account list for user: {}", user_id);
    }

    /// 缓存精简版账户列表 (仅懒加载时使用)
    pub fn cache_account_summary(&self, user_id: &str, summaries: Vec<AccountSummary>) {
        let mut cache = self.account_summary_cache.lock().unwrap();
        cache.insert(user_id.to_string(), summaries);
        log_debug!("Cached account summary for user: {}", user_id);
    }

    /// 获取缓存的账户列表 (根据懒加载状态返回不同版本)
    pub fn get_cached_accounts(&self, user_id: &str) -> Option<Vec<AccountInfo>> {
        let lazy_load = self.is_lazy_load_enabled();

        if lazy_load {
            // 懒加载时：从精简版缓存读取，转换为完整版
            let summary_cache = self.account_summary_cache.lock().unwrap();
            if let Some(summaries) = summary_cache.get(user_id) {
                log_debug!("Cache hit for account summary: {}", user_id);
                // 将精简版转换为完整版 (敏感字段为None)
                let accounts = summaries
                    .iter()
                    .map(|s| AccountInfo {
                        id: s.id.clone(),
                        avatar: s.avatar.clone(),
                        nickname: s.nickname.clone(),
                        level: s.level,
                        server: s.server.clone(),
                        status: s.status.clone(),
                        sync_status: s.sync_status.clone(),
                        cred: None,
                        token: None,
                        user_id: Some(user_id.to_string()),
                        server_id: Some(s.server.clone()),
                    })
                    .collect();
                return Some(accounts);
            }
        } else {
            // 非懒加载：从完整版缓存读取
            let cache = self.account_list_cache.lock().unwrap();
            let accounts = cache.get(user_id).cloned();
            if accounts.is_some() {
                log_debug!("Cache hit for full account list: {}", user_id);
            }
            return accounts;
        }

        None
    }

    /// 清除指定用户的账户缓存 (包括完整版和精简版)
    pub fn clear_account_cache(&self, user_id: &str) {
        let mut full_cache = self.account_list_cache.lock().unwrap();
        let mut summary_cache = self.account_summary_cache.lock().unwrap();
        full_cache.remove(user_id);
        summary_cache.remove(user_id);
        log_debug!("Cleared all account cache for user: {}", user_id);
    }

    /// 收集所有角色的预加载信息
    async fn gather_preload_role_infos(&self) -> Vec<PreloadRoleInfo> {
        let config = self.config_service.lock().unwrap();
        let all_config = config.get_all();
        let mut infos = Vec::new();

        for (key, value) in &all_config {
            if key.starts_with("account_token_") {
                let user_id = key.trim_start_matches("account_token_").to_string();
                let cred = value
                    .get("cred")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let token = value
                    .get("token")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                    for role in roles {
                        if let (Some(role_id), Some(server_id)) = (
                            role.get("roleId").and_then(|v| v.as_str()),
                            role.get("serverId").and_then(|v| v.as_str()),
                        ) {
                            if let (Some(ref c), Some(ref t)) = (&cred, &token) {
                                infos.push(PreloadRoleInfo {
                                    role_id: role_id.to_string(),
                                    server_id: server_id.to_string(),
                                    user_id: user_id.clone(),
                                    cred: c.clone(),
                                    token: t.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        infos
    }

    /// 创建一个可用于 async spawn 的克隆（简化版，仅包含必要的服务引用）
    fn clone_for_async(&self) -> AsyncAccountService {
        AsyncAccountService {
            config_service: self.config_service.clone(),
            skland_service: self.skland_service.clone(),
        }
    }

    /// 公开方法：检查并刷新用户的 cred（供 Tauri command 调用）
    pub async fn check_and_refresh_user_cred(
        &self,
        user_id: &str,
    ) -> Result<Option<(String, String)>, AppError> {
        let async_service = self.clone_for_async();
        async_service.check_and_refresh_user_cred(user_id).await
    }

    /// 为指定用户设置 hytoken（在登录成功后调用）
    pub async fn set_hytoken_for_user(&self, user_id: &str, hytoken: &str) -> Result<(), AppError> {
        log_debug!(
            "set_hytoken_for_user: START for user_id={}, hytoken_len={}",
            user_id,
            hytoken.len()
        );
        let mut config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);

        let mut token_data: serde_json::Value = config.get(&token_key).unwrap_or(json!({}));
        log_debug!(
            "set_hytoken_for_user: Current token_data keys: {:?}",
            token_data
                .as_object()
                .map(|obj| obj.keys().collect::<Vec<_>>())
        );

        if let Some(obj) = token_data.as_object_mut() {
            obj.insert("hytoken".to_string(), json!(hytoken));
            log_debug!("set_hytoken_for_user: hytoken inserted successfully");
        } else {
            log_error!("set_hytoken_for_user: token_data is not an object!");
            return Err(AppError::ConfigError {
                message: "token_data is not a valid JSON object".to_string(),
            });
        }

        config.set(token_key, token_data)?;
        log_debug!("set_hytoken_for_user: Config saved successfully");
        Ok(())
    }

    /// 为指定用户设置 u8 token（在登录成功后调用）
    pub async fn set_u8token_for_user(&self, user_id: &str, u8token: &str) -> Result<(), AppError> {
        log_debug!(
            "set_u8token_for_user: START for user_id={}, u8token_len={}",
            user_id,
            u8token.len()
        );
        let mut config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);

        let mut token_data: serde_json::Value = config.get(&token_key).unwrap_or(json!({}));
        log_debug!(
            "set_u8token_for_user: Current token_data keys: {:?}",
            token_data
                .as_object()
                .map(|obj| obj.keys().collect::<Vec<_>>())
        );

        if let Some(obj) = token_data.as_object_mut() {
            obj.insert("u8token".to_string(), json!(u8token));
            log_debug!("set_u8token_for_user: u8token inserted successfully");
        } else {
            log_error!("set_u8token_for_user: token_data is not an object!");
            return Err(AppError::ConfigError {
                message: "token_data is not a valid JSON object".to_string(),
            });
        }

        config.set(token_key, token_data)?;
        log_debug!("set_u8token_for_user: Config saved successfully");
        Ok(())
    }

    /// 主动刷新指定用户的 u8 token（每次同步前调用，避免旧 token 过期导致接口返回非 JSON）。
    /// 成功时保存并返回新 u8 token；缺少 hytoken/device_token 或获取失败时返回 None（非致命，保留旧值）。
    pub async fn refresh_u8token_for_user(
        &self,
        user_id: &str,
    ) -> Result<Option<String>, AppError> {
        log_info!("refresh_u8token_for_user: START for user_id={}", user_id);

        let (hytoken, device_token) = {
            let config = self.config_service.lock().unwrap();
            let token_key = format!("account_token_{}", user_id);
            let value: Option<serde_json::Value> = config.get(&token_key);
            let hytoken = value
                .as_ref()
                .and_then(|v| v.get("hytoken"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let device_token = value
                .as_ref()
                .and_then(|v| v.get("device_token"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            (hytoken, device_token)
        };

        let (hytoken, device_token) = match (hytoken, device_token) {
            (Some(hyt), Some(dev_tok)) => (hyt, dev_tok),
            _ => {
                log_warn!(
                    "refresh_u8token_for_user: hytoken/device_token MISSING for user {}, skip refresh",
                    user_id
                );
                return Ok(None);
            }
        };

        match self
            .skland_service
            .get_u8_token_by_hytoken(&hytoken, &device_token)
            .await
        {
            Ok(u8t) => {
                log_debug!(
                    "refresh_u8token_for_user: u8token refresh SUCCESS (len={})",
                    u8t.len()
                );
                self.set_u8token_for_user(user_id, &u8t).await?;
                log_info!("refresh_u8token_for_user: SUCCESS for user_id={}", user_id);
                Ok(Some(u8t))
            }
            Err(e) => {
                log_warn!(
                    "refresh_u8token_for_user: u8token refresh FAILED (non-fatal): {}",
                    e
                );
                Ok(None)
            }
        }
    }

    /// 在本地按用户 id 查找已保存的 device token（用于新设备登录时跳过验证）
    fn get_local_device_token(&self, user_id: &str) -> Option<String> {
        let config = self.config_service.lock().unwrap();
        let value: Option<serde_json::Value> = config.get(&format!("account_token_{}", user_id));
        value
            .as_ref()
            .and_then(|v| v.get("device_token"))
            .and_then(|d| d.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    }

    /// 为指定用户设置 device token（登录成功后调用）
    pub async fn set_device_token_for_user(
        &self,
        user_id: &str,
        device_token: &str,
    ) -> Result<(), AppError> {
        log_debug!(
            "set_device_token_for_user: START for user_id={}, device_token_len={}",
            user_id,
            device_token.len()
        );
        let mut config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);

        let mut token_data: serde_json::Value = config.get(&token_key).unwrap_or(json!({}));
        if let Some(obj) = token_data.as_object_mut() {
            obj.insert("device_token".to_string(), json!(device_token));
            log_debug!("set_device_token_for_user: device_token inserted successfully");
        } else {
            log_error!("set_device_token_for_user: token_data is not an object!");
            return Err(AppError::ConfigError {
                message: "token_data is not a valid JSON object".to_string(),
            });
        }

        config.set(token_key, token_data)?;
        log_debug!("set_device_token_for_user: Config saved successfully (per-account only)");
        Ok(())
    }

    /// 通知前端缓存已刷新
    fn notify_cache_refreshed(&self, result: &AccountRefreshResult) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit("accounts-refreshed", result);
        }
    }

    /// 缓存账户数据到内存
    fn cache_accounts_by_user(&self, accounts: &[AccountInfo]) {
        let lazy_load = self.is_lazy_load_enabled();
        let mut accounts_by_user: HashMap<String, Vec<AccountInfo>> = HashMap::new();
        for account in accounts {
            if let Some(user_id) = &account.user_id {
                accounts_by_user
                    .entry(user_id.clone())
                    .or_insert_with(Vec::new)
                    .push(account.clone());
            }
        }
        for (user_id, user_accounts) in &accounts_by_user {
            if lazy_load {
                let summaries: Vec<AccountSummary> =
                    user_accounts.iter().map(|acc| acc.to_summary()).collect();
                self.cache_account_summary(user_id, summaries);
            } else {
                self.cache_account_list(user_id, user_accounts.clone());
            }
        }
    }

    /// 获取开启了自动签到的角色列表
    pub fn get_auto_sign_roles(&self) -> Vec<String> {
        let config = self.config_service.lock().unwrap();
        config
            .get::<Vec<String>>("card_auto_sign_users")
            .unwrap_or_default()
    }

    /// 查询角色今天是否已在服务器签到
    pub async fn check_attendance_today(&self, role_id: &str) -> Result<bool, AppError> {
        let (server_id, cred, token) = {
            let config_guard = self.config_service.lock().unwrap();
            let all_config = config_guard.get_all();
            let mut found = None;
            for (key, value) in &all_config {
                if key.starts_with("account_token_") {
                    let cred = value.get("cred").and_then(|v| v.as_str());
                    let token = value.get("token").and_then(|v| v.as_str());
                    if let (Some(c), Some(t)) = (cred, token) {
                        if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                            for role in roles {
                                if let Some(rid) = role.get("roleId").and_then(|v| v.as_str()) {
                                    if rid == role_id {
                                        if let Some(sid) =
                                            role.get("serverId").and_then(|v| v.as_str())
                                        {
                                            found = Some((
                                                sid.to_string(),
                                                c.to_string(),
                                                t.to_string(),
                                            ));
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if found.is_some() {
                    break;
                }
            }
            found.ok_or_else(|| AppError::AuthError {
                message: format!(
                    "No cred/token found for roleId: {}. Please re-login.",
                    role_id
                ),
            })?
        };
        let skland = self.skland_service();
        let extra_headers = vec![
            (
                "sk-game-role".to_string(),
                format!("3_{}_{}", role_id, server_id),
            ),
            ("token".to_string(), token.clone()),
        ];
        let json = skland
            .call_skland_api(
                "GET",
                "/web/v1/game/endfield/attendance",
                None,
                None,
                &cred,
                &token,
                extra_headers,
            )
            .await?;
        let has_today = json
            .get("data")
            .and_then(|d| d.get("hasToday"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        Ok(has_today)
    }

    /// 为指定角色执行签到
    pub async fn do_attendance_for_role(&self, role_id: &str) -> Result<(), AppError> {
        let (user_id, server_id, cred, token) = {
            let config_guard = self.config_service.lock().unwrap();
            let all_config = config_guard.get_all();
            let mut found = None;
            for (key, value) in &all_config {
                if key.starts_with("account_token_") {
                    let cred = value.get("cred").and_then(|v| v.as_str());
                    let token = value.get("token").and_then(|v| v.as_str());
                    let uid = key.trim_start_matches("account_token_").to_string();
                    if let (Some(c), Some(t)) = (cred, token) {
                        if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                            for role in roles {
                                if let Some(rid) = role.get("roleId").and_then(|v| v.as_str()) {
                                    if rid == role_id {
                                        if let Some(sid) =
                                            role.get("serverId").and_then(|v| v.as_str())
                                        {
                                            found = Some((
                                                uid,
                                                sid.to_string(),
                                                c.to_string(),
                                                t.to_string(),
                                            ));
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if found.is_some() {
                    break;
                }
            }
            found.ok_or_else(|| AppError::AuthError {
                message: format!(
                    "No cred/token found for roleId: {}. Please re-login.",
                    role_id
                ),
            })?
        };
        let (final_cred, final_token) = match self.check_and_refresh_user_cred(&user_id).await {
            Ok(Some((new_cred, new_token))) => (new_cred, new_token),
            Ok(None) => (cred, token),
            Err(e) => {
                log_error!(
                    "do_attendance_for_role: cred refresh failed for user {}: {}",
                    user_id,
                    e
                );
                (cred, token)
            }
        };
        let skland = self.skland_service();
        let extra_headers = vec![
            (
                "sk-game-role".to_string(),
                format!("3_{}_{}", role_id, server_id),
            ),
            ("token".to_string(), final_token.clone()),
        ];
        skland
            .call_skland_api(
                "POST",
                "/web/v1/game/endfield/attendance",
                None,
                Some(serde_json::json!({})),
                &final_cred,
                &final_token,
                extra_headers,
            )
            .await?;
        log_info!("do_attendance_for_role: SUCCESS for role_id={}", role_id);
        Ok(())
    }

    /// 启动自动刷新定时器（应在 Tauri runtime 启动后调用）
    pub fn start_auto_refresh(account_service: Arc<tokio::sync::Mutex<AccountService>>) {
        async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                tracing::debug!("Auto-refresh timer triggered");

                // Step 1: 刷新账户数据
                {
                    let service = account_service.lock().await;
                    service.refresh_accounts().await;
                }

                // Step 2: 自动签到 — 查询开启自动签到的角色，未签到的执行签到
                let auto_sign_roles = {
                    let service = account_service.lock().await;
                    service.get_auto_sign_roles()
                };

                for role_id in auto_sign_roles {
                    let already_signed = {
                        let service = account_service.lock().await;
                        match service.check_attendance_today(&role_id).await {
                            Ok(true) => true,
                            _ => false,
                        }
                    };
                    if already_signed {
                        tracing::debug!("Auto-attendance: already signed in for role {}", role_id);
                        continue;
                    }

                    tracing::info!("Auto-attendance: signing in for role {}", role_id);
                    let service = account_service.lock().await;
                    if let Err(e) = service.do_attendance_for_role(&role_id).await {
                        tracing::warn!("Auto-attendance: failed for role {}: {}", role_id, e);
                    }
                }
            }
        });
    }

    /// 获取所有账户（同步获取完整数据）
    pub async fn get_accounts(&self) -> Vec<AccountInfo> {
        log_debug!("get_accounts: START");

        // 先收集所有需要获取详情的角色信息
        let role_infos = {
            let config = self.config_service.lock().unwrap();
            let all_config = config.get_all();

            log_debug!(
                "get_accounts: all_config keys = {:?}",
                all_config.keys().collect::<Vec<_>>()
            );

            let mut role_infos = Vec::new();

            // 遍历所有 account_token_* 配置项
            for (key, value) in &all_config {
                if key.starts_with("account_token_") {
                    // 提取 userId (key 的格式是 account_token_{userId})
                    let user_id = key.trim_start_matches("account_token_");

                    let cred = value
                        .get("cred")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let token = value
                        .get("token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    log_debug!(
                        "get_accounts: user_id={}, cred_len={}, token_len={}",
                        user_id,
                        cred.as_ref().map(|s| s.len()).unwrap_or(0),
                        token.as_ref().map(|s| s.len()).unwrap_or(0)
                    );

                    // 获取 roles 数组
                    if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                        for role in roles {
                            if let (Some(role_id), Some(server_id)) = (
                                role.get("roleId").and_then(|v| v.as_str()),
                                role.get("serverId").and_then(|v| v.as_str()),
                            ) {
                                role_infos.push((
                                    role_id.to_string(),
                                    server_id.to_string(),
                                    user_id.to_string(),
                                    cred.clone(),
                                    token.clone(),
                                ));
                            }
                        }
                    }
                }
            }

            log_debug!("get_accounts: found {} roles to fetch", role_infos.len());
            role_infos
            // config 在这里被自动 drop
        };

        // 如果没有角色，直接返回空数组
        if role_infos.is_empty() {
            log_debug!("get_accounts: No roles found, returning empty");
            return Vec::new();
        }

        // 同步获取所有账户的完整数据
        let mut accounts = Vec::new();

        for (role_id, server_id, user_id, cred_opt, token_opt) in role_infos {
            if let (Some(cred), Some(token)) = (cred_opt, token_opt) {
                log_debug!(
                    "get_accounts: Processing role_id={}, user_id={}",
                    role_id,
                    user_id
                );

                // 先检查并刷新 cred（如果需要）
                log_debug!("get_accounts: Checking cred for user_id={}", user_id);
                let (final_cred, final_token) = match self
                    .check_and_refresh_user_cred(&user_id)
                    .await
                {
                    Ok(Some((new_cred, new_token))) => {
                        tracing::info!("Cred refreshed for user {}", user_id);
                        log_debug!("get_accounts: Cred refreshed for user {}", user_id);
                        (new_cred, new_token)
                    }
                    Ok(None) => {
                        // cred 仍然有效，使用原有的
                        log_debug!("get_accounts: Cred still valid for user {}", user_id);
                        (cred, token)
                    }
                    Err(e) => {
                        tracing::error!("Failed to check/refresh cred for user {}: {}", user_id, e);
                        log_error!(
                            "get_accounts: Failed to check/refresh cred for user {}: {}",
                            user_id,
                            e
                        );

                        // 判断是否是 hytoken 失效
                        let error_string = e.to_string();
                        let is_hytoken_expired = error_string.contains("hytoken")
                            || error_string.contains("OAuth")
                            || error_string.contains("grant failed");

                        log_debug!("get_accounts: Error string = '{}'", error_string);
                        log_debug!("get_accounts: is_hytoken_expired = {}", is_hytoken_expired);

                        // 刷新失败，创建 FAILED 状态的账户
                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: String::new(),
                            nickname: format!("Role {}", &role_id[..8.min(role_id.len())]),
                            level: 0,
                            server: server_id.clone(),
                            status: "offline".to_string(),
                            sync_status: if is_hytoken_expired {
                                Some("HYTOKEN_EXPIRED".to_string()) // hytoken 失效，无法刷新
                            } else {
                                Some("FAILED".to_string()) // 其他错误
                            },
                            cred: Some(cred),
                            token: Some(token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id.clone()),
                        };
                        log_debug!(
                            "get_accounts: Created account with sync_status = {:?}",
                            account.sync_status
                        );
                        accounts.push(account);
                        continue;
                    }
                };

                match self
                    .network_service
                    .char_detail_service()
                    .get_with_cache(&role_id, &final_cred, &final_token, &server_id, &user_id)
                    .await
                {
                    Ok(Some(detail)) => {
                        let base = &detail.base;

                        // 下载并缓存头像（返回 base64）
                        let cached_avatar = self
                            .avatar_cache_service
                            .get_or_download_avatar(&base.avatar_url)
                            .await
                            .unwrap_or_else(|_| base.avatar_url.clone());

                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: cached_avatar,
                            nickname: base.name.clone(),
                            level: base.level,
                            server: server_id.clone(),
                            status: "online".to_string(),
                            sync_status: None, // 同步成功，清除状态
                            cred: Some(final_cred),
                            token: Some(final_token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id.clone()),
                        };
                        accounts.push(account);
                    }
                    Ok(None) => {
                        log_error!("get_accounts: No detail found for role {}", role_id);
                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: String::new(),
                            nickname: format!("Role {}", &role_id[..8.min(role_id.len())]),
                            level: 0,
                            server: server_id.clone(),
                            status: "offline".to_string(),
                            sync_status: Some("FAILED".to_string()),
                            cred: Some(final_cred),
                            token: Some(final_token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id.clone()),
                        };
                        accounts.push(account);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to get role detail for {}: {}", role_id, e);
                        log_error!(
                            "get_accounts: Failed to get role detail for {}: {}",
                            role_id,
                            e
                        );

                        // 检查是否是 SYNC FAILED 错误，尝试自动刷新 cred
                        let error_string = e.to_string();
                        let is_sync_failed = error_string.contains("API error")
                            || error_string.contains("Failed to parse JSON")
                            || error_string.contains("HTTP request failed");

                        if is_sync_failed {
                            log_debug!("get_accounts: Detected SYNC FAILED, attempting auto-refresh for user {}", user_id);

                            // 尝试使用 hytoken 重新获取 cred
                            let hytoken_key = format!("account_token_{}", user_id);
                            let (hytoken, device_token): (Option<String>, Option<String>) = {
                                let config = self.config_service.lock().unwrap();
                                let value: Option<serde_json::Value> = config.get(&hytoken_key);
                                let hytoken = value.as_ref().and_then(|v| {
                                    v.get("hytoken")
                                        .and_then(|h| h.as_str())
                                        .map(|s| s.to_string())
                                });
                                let device_token = value.as_ref().and_then(|v| {
                                    v.get("device_token")
                                        .and_then(|h| h.as_str())
                                        .map(|s| s.to_string())
                                });
                                (hytoken, device_token)
                            };

                            if let Some(hyt) = hytoken {
                                log_debug!("get_accounts: Found hytoken, attempting refresh...");
                                match self
                                    .skland_service
                                    .refresh_cred_by_hytoken(&hyt, device_token.as_deref())
                                    .await
                                {
                                    Ok((new_cred, new_token, new_u8token, _)) => {
                                        log_debug!("get_accounts: Auto-refresh succeeded, retrying get_role_detail...");

                                        // 更新配置中的 cred 和 token
                                        {
                                            let mut config = self.config_service.lock().unwrap();
                                            let mut token_data: serde_json::Value =
                                                config.get(&hytoken_key).unwrap_or(json!({}));
                                            if let Some(obj) = token_data.as_object_mut() {
                                                obj.insert("cred".to_string(), json!(new_cred));
                                                obj.insert("token".to_string(), json!(new_token));
                                                if let Some(u8t) = new_u8token {
                                                    obj.insert("u8token".to_string(), json!(u8t));
                                                }
                                            }
                                            let _ = config.set(hytoken_key, token_data);
                                        }

                                        // 重试获取角色详情
                                        match self
                                            .network_service
                                            .char_detail_service()
                                            .get_with_cache(
                                                &role_id, &new_cred, &new_token, &server_id,
                                                &user_id,
                                            )
                                            .await
                                        {
                                            Ok(Some(detail)) => {
                                                let base = &detail.base;

                                                // 下载并缓存头像（返回 base64）
                                                let cached_avatar = self
                                                    .avatar_cache_service
                                                    .get_or_download_avatar(&base.avatar_url)
                                                    .await
                                                    .unwrap_or_else(|_| base.avatar_url.clone());

                                                let account = AccountInfo {
                                                    id: role_id.clone(),
                                                    avatar: cached_avatar,
                                                    nickname: base.name.clone(),
                                                    level: base.level,
                                                    server: server_id.clone(),
                                                    status: "online".to_string(),
                                                    sync_status: None, // 同步成功，清除状态
                                                    cred: Some(new_cred),
                                                    token: Some(new_token),
                                                    user_id: Some(user_id.clone()),
                                                    server_id: Some(server_id.clone()),
                                                };
                                                accounts.push(account);
                                                continue; // 跳过下面的 FAILED 状态创建
                                            }
                                            Ok(None) => {
                                                log_error!("get_accounts: No detail found for role {} after refresh", role_id);
                                                let account = AccountInfo {
                                                    id: role_id.clone(),
                                                    avatar: String::new(),
                                                    nickname: format!(
                                                        "Role {}",
                                                        &role_id[..8.min(role_id.len())]
                                                    ),
                                                    level: 0,
                                                    server: server_id.clone(),
                                                    status: "offline".to_string(),
                                                    sync_status: Some("FAILED".to_string()),
                                                    cred: Some(new_cred),
                                                    token: Some(new_token),
                                                    user_id: Some(user_id.clone()),
                                                    server_id: Some(server_id.clone()),
                                                };
                                                accounts.push(account);
                                            }
                                            Err(retry_e) => {
                                                log_error!("get_accounts: Auto-refresh retry also failed: {}", retry_e);
                                                // 重试也失败了，继续创建 FAILED 状态
                                            }
                                        }
                                    }
                                    Err(refresh_e) => {
                                        log_error!(
                                            "get_accounts: Auto-refresh failed: {}",
                                            refresh_e
                                        );
                                        // 刷新失败，继续创建 FAILED 状态
                                    }
                                }
                            } else {
                                log_warn!("get_accounts: No hytoken found for auto-refresh");
                            }
                        }

                        // 创建失败状态的账户
                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: String::new(),
                            nickname: format!("Role {}", &role_id[..8.min(role_id.len())]),
                            level: 0,
                            server: server_id.clone(),
                            status: "offline".to_string(),
                            sync_status: Some("FAILED".to_string()),
                            cred: Some(final_cred),
                            token: Some(final_token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id.clone()),
                        };
                        accounts.push(account);
                    }
                }
            }
        }

        log_debug!("get_accounts: Completed with {} accounts", accounts.len());

        // 按 user_id 分组
        let mut accounts_by_user: HashMap<String, Vec<AccountInfo>> = HashMap::new();
        for account in &accounts {
            if let Some(user_id) = &account.user_id {
                accounts_by_user
                    .entry(user_id.clone())
                    .or_insert_with(Vec::new)
                    .push(account.clone());
            }
        }

        // 根据懒加载状态缓存不同版本
        let lazy_load = self.is_lazy_load_enabled();
        for (user_id, user_accounts) in &accounts_by_user {
            if lazy_load {
                // 懒加载时：只缓存精简版 (节省内存)
                let summaries: Vec<AccountSummary> =
                    user_accounts.iter().map(|acc| acc.to_summary()).collect();
                self.cache_account_summary(user_id, summaries);
                log_debug!("Cached summary for user {} (lazy load enabled)", user_id);
            } else {
                // 非懒加载：缓存完整版
                self.cache_account_list(user_id, user_accounts.clone());
                log_debug!(
                    "Cached full accounts for user {} (lazy load disabled)",
                    user_id
                );
            }
        }

        accounts
    }

    /// 添加账户（密码登录）
    ///
    /// 密码登录无法直接拿到 device token（新设备）时：
    /// 先用 hytoken 访问森空岛 API 换取 userId，再用 userId 在本地匹配已保存的
    /// device token。命中则直接登录；未命中则返回 NEW_DEVICE_VERIFICATION_REQUIRED，
    /// 由前端引导用户改用验证码登录或扫码登录完成身份验证。
    pub async fn add_account(
        &self,
        login_request: LoginRequest,
    ) -> Result<AccountLoginResult, AppError> {
        // Step 1: 密码 → Hypergryph Token (+ deviceToken)
        let (hy_token, device_token, _hgld) = match self
            .get_hypergryph_token(&login_request.phone, &login_request.password)
            .await
        {
            Ok((token, device_token, hgld)) => {
                log_debug!(
                    "add_account: Password login OK, hgld={:?}, device_token_len={}",
                    hgld,
                    device_token.as_ref().map(|d| d.len()).unwrap_or(0)
                );
                (token, device_token, hgld)
            }
            Err(e) => {
                // 密码 API 直接提示需要新设备验证 → 返回验证提示，由前端引导用户换用验证码/扫码登录
                if Self::is_new_device_verification_error(&e) {
                    log_warn!("add_account: New device detected (API error), requiring user verification for phone {}", login_request.phone);
                    return Ok(AccountLoginResult {
                        success: false,
                        error_message: Some("NEW_DEVICE_VERIFICATION_REQUIRED".to_string()),
                        account: None,
                        available_roles: None,
                        cred: None,
                        token: None,
                        user_id: None,
                    });
                }
                return Ok(AccountLoginResult {
                    success: false,
                    error_message: Some(format!("Step 1 failed: {}", e)),
                    account: None,
                    available_roles: None,
                    cred: None,
                    token: None,
                    user_id: None,
                });
            }
        };

        // 后续流程（hytoken → skland code/cred → 用 userId 本地匹配 device token →
        // 保存凭证 → 获取角色列表）在 complete_login_from_token 中统一处理
        self.complete_login_from_token(
            hy_token,
            device_token,
            MissingDeviceTokenPolicy::RequireUserVerification,
        )
        .await
    }

    /// 登出单个账户
    ///
    /// 解绑游戏角色，但保留父级森空岛账户和凭证。
    pub async fn logout_account(&self, account_id: String, keep_device_token: bool) -> bool {
        let mut config = self.config_service.lock().unwrap();

        // account_id 实际上是 roleId，我们需要找到它对应的 userId
        // 遍历所有 account_token_* 配置项来找到匹配的 role
        let all_config = config.get_all();
        let mut keys_to_update = Vec::new();

        for (key, value) in &all_config {
            if key.starts_with("account_token_") {
                if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                    // 检查这个用户是否有该角色
                    let has_role = roles.iter().any(|role| {
                        role.get("roleId").and_then(|v| v.as_str()) == Some(account_id.as_str())
                    });

                    if has_role {
                        // 从 roles 数组中移除该角色
                        let mut updated_value = value.clone();
                        if let Some(roles_array) = updated_value.get_mut("roles") {
                            if let Some(roles_vec) = roles_array.as_array_mut() {
                                roles_vec.retain(|role| {
                                    role.get("roleId").and_then(|v| v.as_str())
                                        != Some(account_id.as_str())
                                });

                                keys_to_update.push((key.clone(), updated_value));
                            }
                        }
                    }
                }
            }
        }

        let changed_user_ids: Vec<String> = keys_to_update
            .iter()
            .filter_map(|(key, _)| key.strip_prefix("account_token_").map(str::to_string))
            .collect();

        // 更新配置
        for (key, mut value) in keys_to_update {
            if !keep_device_token
                && value
                    .get("roles")
                    .and_then(|roles| roles.as_array())
                    .is_some_and(Vec::is_empty)
            {
                if let Some(object) = value.as_object_mut() {
                    object.remove("device_token");
                }
            }
            let _ = config.set(key, value);
        }
        for user_id in changed_user_ids {
            self.clear_account_cache(&user_id);
        }

        // 更新 account_list（如果需要的话）
        let mut account_list: Vec<String> = config.get("account_list").unwrap_or_default();
        account_list.retain(|id| id != &account_id);
        let _ = config.set("account_list".to_string(), json!(account_list));

        true
    }

    /// 批量登出账户
    pub async fn batch_logout(&self, account_ids: Vec<String>) -> bool {
        let mut config = self.config_service.lock().unwrap();

        // 从账户列表中移除
        let mut account_list: Vec<String> = config.get("account_list").unwrap_or_default();
        account_list.retain(|id| !account_ids.contains(id));
        let _ = config.set("account_list".to_string(), json!(account_list));

        // 删除所有指定账户的凭证
        for account_id in &account_ids {
            config.remove(&format!("account_token_{}", account_id));
        }

        true
    }

    /// 刷新账户数据（手动刷新时也会检查 cred）
    pub async fn refresh_accounts(&self) -> AccountRefreshResult {
        log_debug!("refresh_accounts: START");

        // 先收集所有需要刷新的角色信息
        let role_infos = {
            let config = self.config_service.lock().unwrap();
            let all_config = config.get_all();
            let mut role_infos = Vec::new();

            for (key, value) in &all_config {
                if key.starts_with("account_token_") {
                    let user_id = key.trim_start_matches("account_token_");
                    let cred = value
                        .get("cred")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let token = value
                        .get("token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    log_debug!(
                        "refresh_accounts: user_id={}, cred_len={}, token_len={}",
                        user_id,
                        cred.as_ref().map(|s| s.len()).unwrap_or(0),
                        token.as_ref().map(|s| s.len()).unwrap_or(0)
                    );

                    if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                        for role in roles {
                            if let (Some(role_id), Some(server_id)) = (
                                role.get("roleId").and_then(|v| v.as_str()),
                                role.get("serverId").and_then(|v| v.as_str()),
                            ) {
                                role_infos.push((
                                    role_id.to_string(),
                                    server_id.to_string(),
                                    user_id.to_string(),
                                    cred.clone(),
                                    token.clone(),
                                ));
                            }
                        }
                    }
                }
            }
            log_debug!(
                "refresh_accounts: found {} roles to refresh",
                role_infos.len()
            );
            role_infos
        };

        // 为每个账户获取最新的角色详情
        let mut refreshed_accounts = Vec::new();
        for (role_id, server_id, user_id, cred_opt, token_opt) in role_infos {
            if let (Some(cred), Some(token)) = (cred_opt, token_opt) {
                log_debug!(
                    "refresh_accounts: Processing role_id={}, user_id={}",
                    role_id,
                    user_id
                );

                // 先检查并刷新 cred（如果需要）
                log_debug!("refresh_accounts: Checking cred for user_id={}", user_id);
                let (final_cred, final_token) = match self
                    .check_and_refresh_user_cred(&user_id)
                    .await
                {
                    Ok(Some((new_cred, new_token))) => {
                        tracing::info!("Cred refreshed for user {} during manual refresh", user_id);
                        log_debug!("refresh_accounts: Cred refreshed for user {}", user_id);
                        (new_cred, new_token)
                    }
                    Ok(None) => {
                        // cred 仍然有效，使用原有的
                        log_debug!("refresh_accounts: Cred still valid for user {}", user_id);
                        (cred, token)
                    }
                    Err(e) => {
                        tracing::error!("Failed to check/refresh cred for user {}: {}", user_id, e);
                        log_error!(
                            "refresh_accounts: Failed to check/refresh cred for user {}: {}",
                            user_id,
                            e
                        );

                        // 判断是否是 hytoken 失效
                        let is_hytoken_expired = e.to_string().contains("hytoken")
                            || e.to_string().contains("OAuth")
                            || e.to_string().contains("grant failed");

                        // 刷新失败，创建 FAILED 状态的账户
                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: String::new(),
                            nickname: format!("Role {}", &role_id[..8.min(role_id.len())]),
                            level: 0,
                            server: server_id.clone(),
                            status: "offline".to_string(),
                            sync_status: if is_hytoken_expired {
                                Some("HYTOKEN_EXPIRED".to_string()) // hytoken 失效，无法刷新
                            } else {
                                Some("FAILED".to_string()) // 其他错误
                            },
                            cred: Some(cred),
                            token: Some(token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id.clone()),
                        };
                        refreshed_accounts.push(account);
                        continue;
                    }
                };

                match self
                    .skland_service
                    .get_role_detail(&final_cred, &final_token, &role_id, &server_id, &user_id)
                    .await
                {
                    Ok(char_detail_response) => {
                        // 从完整响应中提取 AccountInfo 所需字段
                        let base = &char_detail_response.data.detail.base;

                        // 下载并缓存头像（返回 base64）
                        let cached_avatar = self
                            .avatar_cache_service
                            .get_or_download_avatar(&base.avatar_url)
                            .await
                            .unwrap_or_else(|_| base.avatar_url.clone());

                        let refreshed_account = AccountInfo {
                            id: role_id,
                            avatar: cached_avatar,
                            nickname: base.name.clone(),
                            level: base.level,
                            server: server_id.clone(),
                            status: "online".to_string(),
                            sync_status: None, // 同步成功，清除状态
                            cred: Some(final_cred),
                            token: Some(final_token),
                            user_id: Some(user_id),
                            server_id: Some(server_id.clone()),
                        };
                        refreshed_accounts.push(refreshed_account);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to refresh account {}: {}", role_id, e);
                        log_error!(
                            "refresh_accounts: Failed to refresh account {}: {}",
                            role_id,
                            e
                        );

                        // 检查是否是 SYNC FAILED 错误，尝试自动刷新 cred
                        let error_string = e.to_string();
                        let is_sync_failed = error_string.contains("API error")
                            || error_string.contains("Failed to parse JSON")
                            || error_string.contains("HTTP request failed");

                        if is_sync_failed {
                            log_debug!("refresh_accounts: Detected SYNC FAILED, attempting auto-refresh for user {}", user_id);

                            // 尝试使用 hytoken 重新获取 cred
                            let hytoken_key = format!("account_token_{}", user_id);
                            let (hytoken, device_token): (Option<String>, Option<String>) = {
                                let config = self.config_service.lock().unwrap();
                                let value: Option<serde_json::Value> = config.get(&hytoken_key);
                                let hytoken = value.as_ref().and_then(|v| {
                                    v.get("hytoken")
                                        .and_then(|h| h.as_str())
                                        .map(|s| s.to_string())
                                });
                                let device_token = value.as_ref().and_then(|v| {
                                    v.get("device_token")
                                        .and_then(|h| h.as_str())
                                        .map(|s| s.to_string())
                                });
                                (hytoken, device_token)
                            };

                            if let Some(hyt) = hytoken {
                                log_debug!(
                                    "refresh_accounts: Found hytoken, attempting refresh..."
                                );
                                match self
                                    .skland_service
                                    .refresh_cred_by_hytoken(&hyt, device_token.as_deref())
                                    .await
                                {
                                    Ok((new_cred, new_token, new_u8token, _)) => {
                                        log_debug!("refresh_accounts: Auto-refresh succeeded, retrying get_role_detail...");

                                        // 更新配置中的 cred 和 token
                                        {
                                            let mut config = self.config_service.lock().unwrap();
                                            let mut token_data: serde_json::Value =
                                                config.get(&hytoken_key).unwrap_or(json!({}));
                                            if let Some(obj) = token_data.as_object_mut() {
                                                obj.insert("cred".to_string(), json!(new_cred));
                                                obj.insert("token".to_string(), json!(new_token));
                                                if let Some(u8t) = new_u8token {
                                                    obj.insert("u8token".to_string(), json!(u8t));
                                                }
                                            }
                                            let _ = config.set(hytoken_key, token_data);
                                        }

                                        // 重试获取角色详情
                                        match self
                                            .skland_service
                                            .get_role_detail(
                                                &new_cred, &new_token, &role_id, &server_id,
                                                &user_id,
                                            )
                                            .await
                                        {
                                            Ok(char_detail_response) => {
                                                // 从完整响应中提取 AccountInfo 所需字段
                                                let base = &char_detail_response.data.detail.base;

                                                // 下载并缓存头像（返回 base64）
                                                let cached_avatar = self
                                                    .avatar_cache_service
                                                    .get_or_download_avatar(&base.avatar_url)
                                                    .await
                                                    .unwrap_or_else(|_| base.avatar_url.clone());

                                                let refreshed_account = AccountInfo {
                                                    id: role_id.clone(),
                                                    avatar: cached_avatar,
                                                    nickname: base.name.clone(),
                                                    level: base.level,
                                                    server: server_id.clone(),
                                                    status: "online".to_string(),
                                                    sync_status: None, // 同步成功，清除状态
                                                    cred: Some(new_cred),
                                                    token: Some(new_token),
                                                    user_id: Some(user_id.clone()),
                                                    server_id: Some(server_id.clone()),
                                                };
                                                refreshed_accounts.push(refreshed_account);
                                                continue; // 跳过下面的 FAILED 状态创建
                                            }
                                            Err(retry_e) => {
                                                log_error!("refresh_accounts: Auto-refresh retry also failed: {}", retry_e);
                                                // 重试也失败了，继续创建 FAILED 状态
                                            }
                                        }
                                    }
                                    Err(refresh_e) => {
                                        log_error!(
                                            "refresh_accounts: Auto-refresh failed: {}",
                                            refresh_e
                                        );
                                        // 刷新失败，继续创建 FAILED 状态
                                    }
                                }
                            } else {
                                log_warn!("refresh_accounts: No hytoken found for auto-refresh");
                            }
                        }

                        // 保留旧数据，但标记为离线和 FAILED
                        let account = AccountInfo {
                            id: role_id.clone(),
                            avatar: String::new(),
                            nickname: format!("Role {}", &role_id[..8.min(role_id.len())]),
                            level: 0,
                            server: server_id.clone(),
                            status: "offline".to_string(),
                            sync_status: Some("FAILED".to_string()),
                            cred: Some(final_cred),
                            token: Some(final_token),
                            user_id: Some(user_id.clone()),
                            server_id: Some(server_id),
                        };
                        refreshed_accounts.push(account);
                    }
                }
            }
        }

        log_debug!(
            "refresh_accounts: Completed with {} accounts",
            refreshed_accounts.len()
        );

        let result = AccountRefreshResult {
            success: true,
            error_message: None,
            accounts: refreshed_accounts,
            refresh_time: chrono::Utc::now().to_rfc3339(),
        };

        self.cache_accounts_by_user(&result.accounts);
        self.notify_cache_refreshed(&result);

        result
    }

    /// 发送手机验证码
    pub async fn send_verification_code(&self, request: SendCodeRequest) -> Result<bool, AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "phone": request.phone,
            "type": request.code_type
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 发送验证码 ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/general/v1/send_phone_code");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/general/v1/send_phone_code")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 发送验证码 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            Ok(true)
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Failed to send verification code: {}", msg),
            })
        }
    }

    /// 通过验证码登录（获取 Hypergryph Token + deviceToken）
    async fn get_hypergryph_token_by_code(
        &self,
        phone: &str,
        code: &str,
    ) -> Result<(String, String), AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "phone": phone,
            "code": code
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 验证码登录 ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/user/auth/v2/token_by_phone_code");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/auth/v2/token_by_phone_code")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 验证码登录 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            let data = json.get("data").ok_or_else(|| AppError::AuthError {
                message: "Data not found in response".to_string(),
            })?;
            let token = data
                .get("token")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "Token not found in response".to_string(),
                })?;
            let device_token = data
                .get("deviceToken")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Ok((token, device_token))
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Hypergryph API error: {}", msg),
            })
        }
    }

    /// 通过验证码添加账户
    pub async fn add_account_by_code(
        &self,
        login_request: CodeLoginRequest,
    ) -> Result<AccountLoginResult, AppError> {
        // Step 1: 通过验证码获取 Hypergryph Token (+ deviceToken)
        let (hy_token, device_token) = match self
            .get_hypergryph_token_by_code(&login_request.phone, &login_request.code)
            .await
        {
            Ok((token, device_token)) => (token, Some(device_token).filter(|d| !d.is_empty())),
            Err(e) => {
                return Ok(AccountLoginResult {
                    success: false,
                    error_message: Some(format!("Step 1 failed: {}", e)),
                    account: None,
                    available_roles: None,
                    cred: None,
                    token: None,
                    user_id: None,
                });
            }
        };

        // 后续流程（hytoken → skland code/cred → 用 userId 本地匹配 device token →
        // 保存凭证 → 获取角色列表）在 complete_login_from_token 中统一处理。
        // 验证码登录无短信验证码渠道，缺少 device token 时继续登录但不记录 u8token
        self.complete_login_from_token(
            hy_token,
            device_token,
            MissingDeviceTokenPolicy::ContinueWithoutDeviceToken,
        )
        .await
    }

    /// 生成扫码登录二维码
    pub async fn gen_scan_login(&self) -> Result<ScanLoginInfo, AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "appCode": "dd7b852d5f1dd9da",
            "enableRememberLogin": true
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 生成扫码登录 ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/general/v1/gen_scan/login");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/general/v1/gen_scan/login")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 生成扫码登录 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            let data = json.get("data").ok_or_else(|| AppError::AuthError {
                message: "Data not found in gen_scan_login response".to_string(),
            })?;
            let scan_id = data
                .get("scanId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "scanId not found in response".to_string(),
                })?;
            let scan_url = data
                .get("scanUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "scanUrl not found in response".to_string(),
                })?;
            Ok(ScanLoginInfo { scan_id, scan_url })
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Gen scan login failed: {}", msg),
            })
        }
    }

    /// 查询扫码登录状态
    pub async fn scan_status(&self, scan_id: &str) -> Result<ScanStatus, AppError> {
        let client = http_client::create_client();

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 查询扫码状态 ===");
        log_info!("Method: GET");
        log_info!("URL: https://as.hypergryph.com/general/v1/scan_status");

        let response = capture::send(
            &client,
            client
                .get("https://as.hypergryph.com/general/v1/scan_status")
                .query(&[("scanId", scan_id)]),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 查询扫码状态 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        let data = json.get("data");
        let scan_status = data
            .and_then(|v| v.get("status"))
            .or_else(|| json.get("status"))
            .and_then(|v| v.as_i64())
            .unwrap_or(-1) as i32;
        let scan_code = data
            .and_then(|v| v.get("scanCode"))
            .or_else(|| json.get("scanCode"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let msg = data
            .and_then(|v| v.get("msg"))
            .or_else(|| json.get("msg"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(ScanStatus {
            status: scan_status,
            scan_code,
            msg,
        })
    }

    /// 用扫码登录返回的 scanCode 换取 Hypergryph Token (+ deviceToken + hgld)
    async fn token_by_scan_code(
        &self,
        scan_code: &str,
    ) -> Result<(String, String, Option<String>), AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "appCode": "dd7b852d5f1dd9da",
            "from": 0,
            "scanCode": scan_code,
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 扫码换取 Token ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/user/auth/v1/token_by_scan_code");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/auth/v1/token_by_scan_code")
                .header("X-AppCode", "dd7b852d5f1dd9da")
                .header("X-DeviceId", "9b7a08ae4be1fe2d7520528ca45a225b")
                .header("X-DeviceId2", "632cddd5993b41590886e8b538ab2894")
                .header("X-DeviceModel", "DESKTOP-F7UQANK")
                .header("X-DeviceType", "2")
                .header("X-OSVer", "10.0.26220")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 扫码换取 Token ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            let data = json.get("data").ok_or_else(|| AppError::AuthError {
                message: "Data not found in token_by_scan_code response".to_string(),
            })?;
            let token = data
                .get("token")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "Token not found in response".to_string(),
                })?;
            let device_token = data
                .get("deviceToken")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let hgld = data
                .get("hgld")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
            log_debug!(
                "token_by_scan_code: token_len={}, device_token_len={}, hgld={:?}",
                token.len(),
                device_token.len(),
                hgld
            );
            Ok((token, device_token, hgld))
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Hypergryph API error: {}", msg),
            })
        }
    }

    /// 通过扫码添加账户
    pub async fn add_account_by_scan(
        &self,
        scan_code: String,
    ) -> Result<AccountLoginResult, AppError> {
        // Step 1: 用 scanCode 换取 Hypergryph Token (+ deviceToken + hgld)
        let (hy_token, device_token, _hgld) = match self.token_by_scan_code(&scan_code).await {
            Ok((token, device_token, hgld)) => {
                log_debug!(
                    "add_account_by_scan: hgld={:?}, device_token_len={}",
                    hgld,
                    device_token.len()
                );
                (token, device_token, hgld)
            }
            Err(e) => {
                return Ok(AccountLoginResult {
                    success: false,
                    error_message: Some(format!("Step 1 failed: {}", e)),
                    account: None,
                    available_roles: None,
                    cred: None,
                    token: None,
                    user_id: None,
                });
            }
        };

        // 服务器未返回 deviceToken 时，后续在 complete_login_from_token 中
        // 用 userId 在本地匹配；扫码登录无法发送验证码，继续登录但不记录 u8token
        let device_token = if device_token.is_empty() {
            None
        } else {
            Some(device_token)
        };

        self.complete_login_from_token(
            hy_token,
            device_token,
            MissingDeviceTokenPolicy::ContinueWithoutDeviceToken,
        )
        .await
    }

    /// 登录获取 token 后的公共流程（获取 skland code/cred、保存 token、获取角色列表）
    async fn complete_login_from_token(
        &self,
        hy_token: String,
        device_token: Option<String>,
        missing_policy: MissingDeviceTokenPolicy,
    ) -> Result<AccountLoginResult, AppError> {
        // Step 2: 获取 Skland Code
        let sk_code = match self.get_skland_code(&hy_token).await {
            Ok(code) => code,
            Err(e) => {
                return Ok(AccountLoginResult {
                    success: false,
                    error_message: Some(format!("Step 2 failed: {}", e)),
                    account: None,
                    available_roles: None,
                    cred: None,
                    token: None,
                    user_id: None,
                });
            }
        };

        // Step 3: 获取 Skland Cred 和 Token
        let (cred, token, user_id) = match self.get_skland_cred(&sk_code).await {
            Ok(data) => data,
            Err(e) => {
                return Ok(AccountLoginResult {
                    success: false,
                    error_message: Some(format!("Step 3 failed: {}", e)),
                    account: None,
                    available_roles: None,
                    cred: None,
                    token: None,
                    user_id: None,
                });
            }
        };

        // Step 3.5: 若服务器未返回 deviceToken（新设备），用 userId 在本地匹配已保存的 device token
        let mut device_token = device_token;
        if device_token.is_none() {
            if let Some(local_dev) = self.get_local_device_token(&user_id) {
                log_info!(
                    "complete_login_from_token: Matched local device_token for user {}, continuing login without verification",
                    user_id
                );
                device_token = Some(local_dev);
            }
        }

        // 仍无 device token → 按策略处理
        let device_token = match device_token {
            Some(d) => Some(d),
            None => match missing_policy {
                MissingDeviceTokenPolicy::RequireUserVerification => {
                    log_warn!(
                        "complete_login_from_token: No device_token for user {} (new device), requiring user verification",
                        user_id
                    );
                    return Ok(AccountLoginResult {
                        success: false,
                        error_message: Some("NEW_DEVICE_VERIFICATION_REQUIRED".to_string()),
                        account: None,
                        available_roles: None,
                        cred: None,
                        token: None,
                        user_id: None,
                    });
                }
                MissingDeviceTokenPolicy::ContinueWithoutDeviceToken => {
                    log_warn!(
                        "complete_login_from_token: No device_token for user {} from server or local cache, u8 token will be unavailable",
                        user_id
                    );
                    None
                }
            },
        };

        // 保存 hytoken（与 cred 同级存储）
        log_debug!("About to save hytoken for user_id={}", user_id);
        if let Err(e) = self.set_hytoken_for_user(&user_id, &hy_token).await {
            tracing::warn!("Failed to save hytoken for user {}: {}", user_id, e);
            log_error!("Failed to save hytoken: {}", e);
        } else {
            log_debug!("hytoken saved successfully");
        }

        // 保存 device token（与 cred 同级存储，失败不阻断登录）
        if let Some(dev_tok) = &device_token {
            log_debug!("About to save device_token for user_id={}", user_id);
            if let Err(e) = self.set_device_token_for_user(&user_id, dev_tok).await {
                tracing::warn!("Failed to save device_token for user {}: {}", user_id, e);
                log_error!("Failed to save device_token: {}", e);
            } else {
                log_debug!("device_token saved successfully");
            }
        }

        // 保存 u8 token（与 cred 同级存储，失败不阻断登录）
        log_debug!("About to fetch u8 token for user_id={}", user_id);
        match device_token.as_deref() {
            Some(dev_tok) => {
                match self
                    .skland_service
                    .get_u8_token_by_hytoken(&hy_token, dev_tok)
                    .await
                {
                    Ok(u8_token) => {
                        log_debug!("u8 token fetched (len={})", u8_token.len());
                        if let Err(e) = self.set_u8token_for_user(&user_id, &u8_token).await {
                            tracing::warn!("Failed to save u8token for user {}: {}", user_id, e);
                            log_error!("Failed to save u8token: {}", e);
                        } else {
                            log_debug!("u8token saved successfully");
                        }
                    }
                    Err(e) => {
                        log_warn!("Failed to fetch u8 token for user {}: {}", user_id, e);
                    }
                }
            }
            None => {
                log_warn!(
                    "No device_token, skipping u8 token fetch for user {}",
                    user_id
                );
            }
        }

        // Return the parent credentials first. The UI loads its game roles only
        // after the user confirms binding this Skland account.
        Ok(AccountLoginResult {
            success: true,
            error_message: None,
            account: None,
            available_roles: None,
            cred: Some(cred),
            token: Some(token),
            user_id: Some(user_id),
        })
    }

    async fn fetch_endfield_roles(
        &self,
        cred: &str,
        token: &str,
        user_id: &str,
    ) -> Result<Vec<RoleDisplayInfo>, AppError> {
        let bindings = self.skland_service.get_player_binding(cred, token).await?;
        let game_roles = SklandService::extract_endfield_roles(&bindings);
        let mut roles = Vec::new();

        for (_game_uid, server_id, role_id) in game_roles {
            match self
                .skland_service
                .get_role_detail(cred, token, &role_id, &server_id, user_id)
                .await
            {
                Ok(response) => {
                    let base = &response.data.detail.base;
                    let avatar_url = self
                        .avatar_cache_service
                        .get_or_download_avatar(&base.avatar_url)
                        .await
                        .unwrap_or_else(|_| base.avatar_url.clone());
                    roles.push(RoleDisplayInfo {
                        role_id,
                        user_id: user_id.to_string(),
                        server_id,
                        nickname: base.name.clone(),
                        level: base.level,
                        avatar_url,
                    });
                }
                Err(error) => {
                    log_error!("Failed to get role detail for {}: {}", role_id, error);
                }
            }
        }

        Ok(roles)
    }

    /// 读取指定森空岛账户已保存的 cred / token
    fn read_skland_credentials(&self, user_id: &str) -> Result<(String, String), AppError> {
        let config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);
        let data: serde_json::Value =
            config.get(&token_key).ok_or_else(|| AppError::AuthError {
                message: "Skland account was not found".to_string(),
            })?;
        let cred = data
            .get("cred")
            .and_then(|value| value.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "Skland cred was not found".to_string(),
            })?
            .to_string();
        let token = data
            .get("token")
            .and_then(|value| value.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "Skland token was not found".to_string(),
            })?
            .to_string();
        Ok((cred, token))
    }

    /// 将森空岛用户资料写入 `account_token_{user_id}.user_info` 缓存
    fn cache_skland_user_info(&self, user_id: &str, info: &SklandUserInfo) -> Result<(), AppError> {
        let mut config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);
        let mut data: serde_json::Value = config.get(&token_key).unwrap_or_else(|| json!({}));
        if !data.is_object() {
            data = json!({});
        }
        let serialized = serde_json::to_value(info).map_err(|error| AppError::ConfigError {
            message: format!("Failed to serialize Skland user info: {}", error),
        })?;
        if let Some(object) = data.as_object_mut() {
            object.insert("user_info".to_string(), serialized);
        }
        config.set(token_key, data)
    }

    /// 获取森空岛用户资料（昵称、头像、游戏等级/积分、社区互动数据）
    ///
    /// 请求 `GET /web/v1/user`，成功后把结果缓存进账户配置，
    /// 供 [`Self::get_skland_accounts`] 在列表中直接展示昵称与头像。
    pub async fn get_skland_user_info(&self, user_id: String) -> Result<SklandUserInfo, AppError> {
        log_debug!("get_skland_user_info: START for user_id={}", user_id);

        // cred 过期时自动通过 hytoken 刷新
        self.check_and_refresh_user_cred(&user_id).await?;
        let (cred, token) = self.read_skland_credentials(&user_id)?;
        let info = self.skland_service.get_user_info(&cred, &token).await?;

        if let Err(error) = self.cache_skland_user_info(&user_id, &info) {
            log_warn!(
                "get_skland_user_info: failed to cache user info for {}: {}",
                user_id,
                error
            );
        }

        log_debug!(
            "get_skland_user_info: DONE for user_id={}, nickname={}",
            user_id,
            info.nickname
        );
        Ok(info)
    }

    /// 获取森空岛游戏列表（游戏图标等基础信息）
    ///
    /// `GET /web/v1/game` 与账户无关，因此统一缓存在配置项 `skland_games_cache` 中，
    /// 缓存有效期 [`SKLAND_GAMES_CACHE_TTL_SECS`]；过期后重新拉取，
    /// 拉取失败时退回旧缓存（图标不会因为一次网络异常而消失）。
    pub async fn get_skland_games(
        &self,
        user_id: String,
        force: bool,
    ) -> Result<Vec<SklandGameInfo>, AppError> {
        let cached = self.read_skland_games_cache();
        if !force {
            if let Some((fetched_at, games)) = &cached {
                if now_unix_secs() - fetched_at < SKLAND_GAMES_CACHE_TTL_SECS {
                    return Ok(games.clone());
                }
            }
        }

        let fetched = async {
            self.check_and_refresh_user_cred(&user_id).await?;
            let (cred, token) = self.read_skland_credentials(&user_id)?;
            self.skland_service.get_game_list(&cred, &token).await
        }
        .await;

        match fetched {
            Ok(games) => {
                if let Err(error) = self.cache_skland_games(&games) {
                    log_warn!("get_skland_games: failed to cache game list: {}", error);
                }
                Ok(games)
            }
            Err(error) => match cached {
                Some((_, games)) => {
                    log_warn!(
                        "get_skland_games: refresh failed ({}), falling back to cached list",
                        error
                    );
                    Ok(games)
                }
                None => Err(error),
            },
        }
    }

    /// 读取 `skland_games_cache`（返回 `(fetched_at, games)`）
    fn read_skland_games_cache(&self) -> Option<(i64, Vec<SklandGameInfo>)> {
        let config = self.config_service.lock().unwrap();
        let value: serde_json::Value = config.get(SKLAND_GAMES_CACHE_KEY)?;
        let fetched_at = value
            .get("fetched_at")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let games: Vec<SklandGameInfo> =
            serde_json::from_value(value.get("games")?.clone()).ok()?;
        (!games.is_empty()).then_some((fetched_at, games))
    }

    /// 写入 `skland_games_cache`
    fn cache_skland_games(&self, games: &[SklandGameInfo]) -> Result<(), AppError> {
        let mut config = self.config_service.lock().unwrap();
        let value = json!({
            "fetched_at": now_unix_secs(),
            "games": serde_json::to_value(games).map_err(|error| AppError::ConfigError {
                message: format!("Failed to serialize Skland game list: {}", error),
            })?,
        });
        config.set(SKLAND_GAMES_CACHE_KEY.to_string(), value)
    }

    /// 获取已绑定森空岛账户的游戏角色，供后续绑定和解绑使用
    pub async fn get_skland_account_roles(
        &self,
        user_id: String,
    ) -> Result<AccountLoginResult, AppError> {
        self.check_and_refresh_user_cred(&user_id).await?;
        let (cred, token) = self.read_skland_credentials(&user_id)?;
        let available_roles = self.fetch_endfield_roles(&cred, &token, &user_id).await?;

        Ok(AccountLoginResult {
            success: true,
            error_message: None,
            account: None,
            available_roles: Some(available_roles),
            cred: Some(cred),
            token: Some(token),
            user_id: Some(user_id),
        })
    }

    /// 获取已确认绑定的森空岛账户
    pub fn get_skland_accounts(&self) -> Vec<SklandAccountInfo> {
        let config = self.config_service.lock().unwrap();
        config
            .get_all()
            .iter()
            .filter_map(|(key, value)| {
                let user_id = key.strip_prefix("account_token_")?;
                let roles = value.get("roles").and_then(|v| v.as_array());
                let is_bound = value
                    .get("skland_account_bound")
                    .and_then(|v| v.as_bool())
                    .unwrap_or_else(|| roles.is_some_and(|roles| !roles.is_empty()));
                // 已缓存的森空岛用户资料（可能尚未获取过）
                let user_info: Option<SklandUserInfo> = value
                    .get("user_info")
                    .and_then(|info| serde_json::from_value(info.clone()).ok());
                is_bound.then(|| SklandAccountInfo {
                    user_id: user_id.to_string(),
                    game_role_count: roles.map_or(0, Vec::len),
                    nickname: user_info
                        .as_ref()
                        .map(|info| info.nickname.clone())
                        .filter(|nickname| !nickname.is_empty()),
                    avatar: user_info
                        .as_ref()
                        .map(|info| info.avatar.clone())
                        .filter(|avatar| !avatar.is_empty()),
                })
            })
            .collect()
    }

    /// 用户确认绑定森空岛账户后保存其 Skland 凭证
    pub fn save_skland_account(
        &self,
        cred: String,
        token: String,
        user_id: String,
    ) -> Result<(), AppError> {
        let mut config = self.config_service.lock().unwrap();
        let token_key = format!("account_token_{}", user_id);
        let mut data = config
            .get::<serde_json::Value>(&token_key)
            .unwrap_or_else(|| json!({}));
        if !data.is_object() {
            data = json!({});
        }
        let object = data.as_object_mut().expect("object checked above");
        object.insert("cred".to_string(), json!(cred));
        object.insert("token".to_string(), json!(token));
        object.insert("skland_account_bound".to_string(), json!(true));
        object
            .entry("roles".to_string())
            .or_insert_with(|| json!([]));
        config.set(token_key, data)?;
        Ok(())
    }

    /// 保存用户选择的角色
    pub async fn save_selected_roles(
        &self,
        cred: String,
        token: String,
        user_id: String,
        selected_roles: Vec<crate::models::role::RoleDisplayInfo>,
    ) -> Result<Vec<AccountInfo>, AppError> {
        log_debug!("save_selected_roles: START for user_id={}", user_id);

        // Step 1: 保存配置（在 MutexGuard 作用域内）
        {
            let mut config = self.config_service.lock().unwrap();

            // 迁移旧配置：为缺少 app 标识的角色自动补上 endfield
            Self::migrate_roles_app_field(&mut config)?;

            // 保存或更新 account_token_{user_id}
            let token_key = format!("account_token_{}", user_id);

            // 先读取现有配置，保留 hytoken、u8token 和 device_token（如果存在）
            let existing_data: Option<serde_json::Value> = config.get(&token_key);
            let hytoken = existing_data
                .as_ref()
                .and_then(|d| d.get("hytoken"))
                .and_then(|h| h.as_str())
                .map(|s| s.to_string());
            let u8token = existing_data
                .as_ref()
                .and_then(|d| d.get("u8token"))
                .and_then(|h| h.as_str())
                .map(|s| s.to_string());
            let device_token = existing_data
                .as_ref()
                .and_then(|d| d.get("device_token"))
                .and_then(|h| h.as_str())
                .map(|s| s.to_string());
            let existing_role_ids: Vec<String> = existing_data
                .as_ref()
                .and_then(|data| data.get("roles"))
                .and_then(|roles| roles.as_array())
                .map(|roles| {
                    roles
                        .iter()
                        .filter_map(|role| {
                            role.get("roleId")
                                .and_then(|value| value.as_str())
                                .map(str::to_string)
                        })
                        .collect()
                })
                .unwrap_or_default();

            log_debug!(
                "save_selected_roles: Existing hytoken exists: {}",
                hytoken.is_some()
            );
            log_debug!(
                "save_selected_roles: Existing u8token exists: {}",
                u8token.is_some()
            );
            log_debug!(
                "save_selected_roles: Existing device_token exists: {}",
                device_token.is_some()
            );

            // 构建 roles 列表
            let roles: Vec<serde_json::Value> = selected_roles
                .iter()
                .map(|role| {
                    json!({
                        "userId": role.user_id,
                        "serverId": role.server_id,
                        "roleId": role.role_id,
                        "app": "endfield"
                    })
                })
                .collect();

            // 构建完整的 token_data，包含 hytoken（如果存在）
            let mut token_data_obj = serde_json::Map::new();
            token_data_obj.insert("cred".to_string(), json!(cred));
            token_data_obj.insert("token".to_string(), json!(token));
            token_data_obj.insert("roles".to_string(), json!(roles));
            token_data_obj.insert("skland_account_bound".to_string(), json!(true));
            if let Some(hyt) = hytoken {
                token_data_obj.insert("hytoken".to_string(), json!(hyt));
                log_debug!("save_selected_roles: Preserved hytoken in config");
            }
            if let Some(u8t) = u8token {
                token_data_obj.insert("u8token".to_string(), json!(u8t));
                log_debug!("save_selected_roles: Preserved u8token in config");
            }
            if let Some(dev_tok) = device_token {
                token_data_obj.insert("device_token".to_string(), json!(dev_tok));
                log_debug!("save_selected_roles: Preserved device_token in config");
            }
            let token_data = serde_json::Value::Object(token_data_obj);

            config.set(token_key, token_data)?;
            log_debug!("save_selected_roles: Config saved successfully");

            // 更新 account_list
            let mut account_list: Vec<String> = config.get("account_list").unwrap_or_default();
            account_list.retain(|role_id| !existing_role_ids.contains(role_id));
            for role in &selected_roles {
                if !account_list.contains(&role.role_id) {
                    account_list.push(role.role_id.clone());
                }
            }
            config.set("account_list".to_string(), json!(account_list))?;
        } // MutexGuard 在这里释放

        // Step 2: 获取 base64 编码的头像（在 MutexGuard 释放后）
        let mut accounts = Vec::new();
        for role in &selected_roles {
            // 获取 base64 编码的头像
            let avatar_base64 = if !role.avatar_url.is_empty() {
                match self
                    .avatar_cache_service
                    .get_or_download_avatar(&role.avatar_url)
                    .await
                {
                    Ok(base64_str) => base64_str,
                    Err(e) => {
                        tracing::warn!("Failed to get avatar for {}: {}", role.role_id, e);
                        String::new()
                    }
                }
            } else {
                String::new()
            };

            let account = AccountInfo {
                id: role.role_id.clone(),
                avatar: avatar_base64,
                nickname: role.nickname.clone(),
                level: role.level,
                server: role.server_id.clone(),
                status: "online".to_string(),
                sync_status: None,
                cred: Some(cred.clone()),
                token: Some(token.clone()),
                user_id: Some(role.user_id.clone()),
                server_id: Some(role.server_id.clone()),
            };
            accounts.push(account);
        }

        self.cache_account_list(&user_id, accounts.clone());
        self.cache_account_summary(
            &user_id,
            accounts.iter().map(AccountInfo::to_summary).collect(),
        );

        Ok(accounts)
    }

    /// 迁移旧配置：为所有 account_token_* 中缺少 app 标识的角色自动补上 "endfield"
    fn migrate_roles_app_field(config: &mut ConfigService) -> Result<(), AppError> {
        let keys: Vec<String> = config
            .get_all()
            .keys()
            .filter(|k| k.starts_with("account_token_"))
            .cloned()
            .collect();

        for key in keys {
            let value: Option<serde_json::Value> = config.get(&key);
            let Some(mut value) = value else {
                continue;
            };
            let Some(roles) = value.get_mut("roles").and_then(|v| v.as_array_mut()) else {
                continue;
            };

            let mut changed = false;
            for role in roles.iter_mut() {
                if role.is_object() && role.get("app").is_none() {
                    role["app"] = json!("endfield");
                    changed = true;
                }
            }

            if changed {
                config.set(key, value)?;
            }
        }

        Ok(())
    }

    /// Step 1: 手机号密码 → Hypergryph Token (+ deviceToken + hgld)
    ///
    /// 返回 (token, device_token, hgld)。hgld 为 Hypergryph 用户 id，
    /// 用于在本地按账户匹配已保存的 device token。
    async fn get_hypergryph_token(
        &self,
        phone: &str,
        password: &str,
    ) -> Result<(String, Option<String>, Option<String>), AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "phone": phone,
            "password": password,
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 密码登录 ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/user/auth/v1/token_by_phone_password");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/auth/v1/token_by_phone_password")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 密码登录 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            let data = json.get("data").ok_or_else(|| AppError::AuthError {
                message: "Data not found in response".to_string(),
            })?;
            let token = data
                .get("token")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "Token not found in response".to_string(),
                })?;
            let device_token = data
                .get("deviceToken")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let hgld = data
                .get("hgld")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
            Ok((token, device_token, hgld))
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Hypergryph API error: {}", msg),
            })
        }
    }

    /// 判断错误是否为新设备需要验证
    fn is_new_device_verification_error(err: &AppError) -> bool {
        let msg = err.to_string();
        msg.contains("新设备")
            || msg.contains("需要验证")
            || msg.contains("设备验证")
            || msg.contains("verify")
            || msg.contains("verification")
    }

    /// Step 2: Hypergryph Token → Skland Code
    async fn get_skland_code(&self, hy_token: &str) -> Result<String, AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "token": hy_token,
            "appCode": "4ca99fa6b56cc2ba",
            "type": 0
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: OAuth授权 ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/user/oauth2/v2/grant");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/oauth2/v2/grant")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: OAuth授权 ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("status").and_then(|v| v.as_i64()) == Some(0) {
            json.get("data")
                .and_then(|d| d.get("code"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::AuthError {
                    message: "Code not found in response".to_string(),
                })
        } else {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Hypergryph OAuth error: {}", msg),
            })
        }
    }

    /// Step 3: Skland Code → Cred + Token + UserId
    async fn get_skland_cred(&self, sk_code: &str) -> Result<(String, String, String), AppError> {
        let client = http_client::create_client();
        let payload = json!({
            "kind": 1,
            "code": sk_code
        });

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 获取Cred ===");
        log_info!("Method: POST");
        log_info!("URL: https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code");

        let response = capture::send(
            &client,
            client
                .post("https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code")
                .json(&payload),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await?;

        log_info!("=== HTTP RESPONSE: 获取Cred ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }

        if json.get("code").and_then(|v| v.as_i64()) == Some(0) {
            let data = json.get("data").ok_or_else(|| AppError::AuthError {
                message: "Data not found in response".to_string(),
            })?;

            let cred =
                data.get("cred")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::AuthError {
                        message: "Cred not found".to_string(),
                    })?;

            let token =
                data.get("token")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::AuthError {
                        message: "Token not found".to_string(),
                    })?;

            let user_id =
                data.get("userId")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::AuthError {
                        message: "UserId not found".to_string(),
                    })?;

            Ok((cred.to_string(), token.to_string(), user_id.to_string()))
        } else {
            let msg = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            Err(AppError::AuthError {
                message: format!("Skland API error: {}", msg),
            })
        }
    }

    /// 统一数据查询入口
    pub async fn query_role_data(
        &self,
        role_id: &str,
        api_name: &str,
        paths: &[String],
    ) -> Result<HashMap<String, serde_json::Value>, AppError> {
        log_debug!(
            "query_role_data: role_id={}, api_name={}, paths_count={}",
            role_id,
            api_name,
            paths.len()
        );

        let accounts = self.get_accounts().await;
        let account = accounts.iter().find(|acc| acc.id == role_id);

        if let Some(acc) = account {
            if let (Some(cred), Some(token), Some(user_id), Some(server_id)) =
                (&acc.cred, &acc.token, &acc.user_id, &acc.server_id)
            {
                return self
                    .network_service
                    .query_role_data(role_id, api_name, paths, cred, token, server_id, user_id)
                    .await;
            }
        }

        log_error!("Account not found or incomplete for role_id: {}", role_id);
        Err(AppError::ConfigError {
            message: format!("Account not found or incomplete for role_id: {}", role_id),
        })
    }
}
