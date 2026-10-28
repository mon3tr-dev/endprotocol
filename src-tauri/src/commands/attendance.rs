use std::sync::{Arc, Mutex as SyncMutex};
use tauri::State;
use tokio::sync::Mutex;

use crate::services::account_service::AccountService;
use crate::services::avatar_cache_service::ImageType;
use crate::services::config_service::ConfigService;
use crate::utils::api_health;
use crate::utils::AppError;
use crate::{log_error, log_info};

/// 根据 roleId 在配置中查找对应的 cred 和 token
fn lookup_cred_token(
    config_service: &Arc<SyncMutex<ConfigService>>,
    role_id: &str,
) -> Result<(String, String, String, String), AppError> {
    let config = config_service.lock().map_err(|e| AppError::ConfigError {
        message: format!("Lock failed: {}", e),
    })?;
    let all_config = config.get_all();

    for (key, value) in &all_config {
        if key.starts_with("account_token_") {
            let cred = value
                .get("cred")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let token = value
                .get("token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let user_id = key.trim_start_matches("account_token_").to_string();

            if let (Some(ref c), Some(ref t)) = (&cred, &token) {
                if let Some(roles) = value.get("roles").and_then(|v| v.as_array()) {
                    for role in roles {
                        if let Some(rid) = role.get("roleId").and_then(|v| v.as_str()) {
                            if rid == role_id {
                                if let Some(sid) = role.get("serverId").and_then(|v| v.as_str()) {
                                    return Ok((user_id, sid.to_string(), c.clone(), t.clone()));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err(AppError::AuthError {
        message: format!(
            "No cred/token found for roleId: {}. Please re-login.",
            role_id
        ),
    })
}

/// 获取签到状态（GET）
/// 根据 roleId 自动查找对应的 cred 和 token
#[tauri::command]
pub async fn get_attendance(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("get_attendance: START for role_id={}", role_id);

    let service = state.lock().await;
    let config_service = service.get_config_service().clone();

    let (user_id, server_id, cred, token) =
        lookup_cred_token(&config_service, &role_id).map_err(|e| {
            log_error!("get_attendance: cred lookup failed: {}", e);
            e.to_string()
        })?;

    let (final_cred, final_token) = match service.check_and_refresh_user_cred(&user_id).await {
        Ok(Some((new_cred, new_token))) => (new_cred, new_token),
        Ok(None) => (cred, token),
        Err(e) => {
            log_error!(
                "get_attendance: cred refresh failed for user {}: {}",
                user_id,
                e
            );
            (cred, token)
        }
    };

    let skland = service.skland_service();
    let path = "/web/v1/game/endfield/attendance";
    let extra_headers = vec![
        (
            "sk-game-role".to_string(),
            format!("3_{}_{}", role_id, server_id),
        ),
        ("token".to_string(), final_token.clone()),
    ];

    let mut json = match skland
        .call_skland_api(
            "GET",
            path,
            None,
            None,
            &final_cred,
            &final_token,
            extra_headers,
        )
        .await
    {
        Ok(json) => {
            let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            if code == 0 {
                log_info!("get_attendance: SUCCESS for role_id={}", role_id);
                json
            } else {
                let msg = json
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown");
                log_error!(
                    "get_attendance: API returned code={}, message={}",
                    code,
                    msg
                );
                return Err(format!(
                    "Attendance API error: code={}, message={}",
                    code, msg
                ));
            }
        }
        Err(e) => {
            log_error!("get_attendance: FAILED for role_id={}: {}", role_id, e);
            return Err(format!("Failed to get attendance: {}", e));
        }
    };

    // 下载 resourceInfoMap 中的奖励图标
    if let Some(data) = json.get_mut("data") {
        if let Some(map) = data
            .get_mut("resourceInfoMap")
            .and_then(|m| m.as_object_mut())
        {
            let cache_service = service.avatar_cache_service();
            for (_key, entry) in map.iter_mut() {
                if let Some(icon_url) = entry
                    .get("icon")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                {
                    match cache_service
                        .get_or_download_image(&icon_url, ImageType::AttendanceIcon)
                        .await
                    {
                        Ok(local_path) => {
                            if let Some(obj) = entry.as_object_mut() {
                                obj.insert(
                                    "icon".to_string(),
                                    serde_json::Value::String(local_path),
                                );
                            }
                        }
                        Err(e) => {
                            log_error!(
                                "get_attendance: Failed to download icon {}: {}",
                                icon_url,
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    log_info!("get_attendance: SUCCESS for role_id={}", role_id);
    Ok(json)
}

/// 执行签到（POST）
/// 根据 roleId 自动查找对应的 cred 和 token
#[tauri::command]
pub async fn do_attendance(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("do_attendance: START for role_id={}", role_id);

    let service = state.lock().await;
    let config_service = service.get_config_service().clone();

    let (user_id, server_id, cred, token) =
        lookup_cred_token(&config_service, &role_id).map_err(|e| {
            log_error!("do_attendance: cred lookup failed: {}", e);
            e.to_string()
        })?;

    let (final_cred, final_token) = match service.check_and_refresh_user_cred(&user_id).await {
        Ok(Some((new_cred, new_token))) => (new_cred, new_token),
        Ok(None) => (cred, token),
        Err(e) => {
            log_error!(
                "do_attendance: cred refresh failed for user {}: {}",
                user_id,
                e
            );
            (cred, token)
        }
    };

    let skland = service.skland_service();
    let path = "/web/v1/game/endfield/attendance";
    let extra_headers = vec![
        (
            "sk-game-role".to_string(),
            format!("3_{}_{}", role_id, server_id),
        ),
        ("token".to_string(), final_token.clone()),
    ];

    match skland
        .call_skland_api(
            "POST",
            path,
            None,
            Some(serde_json::json!({})),
            &final_cred,
            &final_token,
            extra_headers,
        )
        .await
    {
        Ok(json) => {
            let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            let msg = json
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            // 「请勿重复签到」表示今天已经签过，对签到动作而言是幂等成功，
            // 不应作为错误弹窗提示（`call_skland_api` 也已不计入 API 失败）。
            if code == 0 || api_health::is_benign_business_error(code, msg) {
                log_info!(
                    "do_attendance: SUCCESS for role_id={} (code={}, message={})",
                    role_id,
                    code,
                    msg
                );
                Ok(json)
            } else {
                log_error!("do_attendance: API returned code={}, message={}", code, msg);
                Err(format!(
                    "Attendance API error: code={}, message={}",
                    code, msg
                ))
            }
        }
        Err(e) => {
            log_error!("do_attendance: FAILED for role_id={}: {}", role_id, e);
            Err(format!("Failed to do attendance: {}", e))
        }
    }
}
