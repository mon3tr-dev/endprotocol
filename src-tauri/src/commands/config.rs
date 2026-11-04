use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::services::config_service::ConfigService;
use crate::services::secret_registry;

/// 获取配置值
#[tauri::command]
pub fn get_config(state: State<Arc<Mutex<ConfigService>>>, key: String) -> Option<Value> {
    let service = state.lock().unwrap();
    service.get(&key)
}

/// 获取代理配置
#[tauri::command]
pub fn get_proxy_config(state: State<Arc<Mutex<ConfigService>>>) -> Option<Value> {
    let service = state.lock().unwrap();
    service.get_proxy_config()
}

/// 设置代理配置
#[tauri::command]
pub fn set_proxy_config(
    state: State<Arc<Mutex<ConfigService>>>,
    config: Value,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service
        .set_proxy_config(config.clone())
        .map_err(|e| e.to_string())?;
    crate::utils::http_client::set_global_proxy_config(Some(config));
    Ok(())
}

/// 删除代理配置
#[tauri::command]
pub fn remove_proxy_config(state: State<Arc<Mutex<ConfigService>>>) -> Result<bool, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    let removed = service.remove_proxy_config();
    crate::utils::http_client::set_global_proxy_config(None);
    Ok(removed)
}

/// 设置配置值
///
/// ⚠️ 机密字段（见 `secret_registry`）**不允许**通过本命令写入 —— 前端是通用
/// 配置入口，机密数据必须经由后端专用的账户流程写入凭据库。
#[tauri::command]
pub fn set_config(
    state: State<Arc<Mutex<ConfigService>>>,
    key: String,
    value: Value,
) -> Result<(), String> {
    if secret_registry::has_secret_fields(&key) {
        return Err(format!(
            "Refusing to write secret field via set_config: {key}. \
             Secret fields are managed by the backend credential store."
        ));
    }

    let mut service = state.lock().map_err(|e| e.to_string())?;
    let is_proxy = key == "proxy_config";
    let proxy_value = value.clone();
    service.set(key, value).map_err(|e| e.to_string())?;
    if is_proxy {
        crate::utils::http_client::set_global_proxy_config(Some(proxy_value));
    }
    Ok(())
}

/// 删除配置项
#[tauri::command]
pub fn remove_config(state: State<Arc<Mutex<ConfigService>>>, key: String) -> bool {
    let mut service = state.lock().unwrap();
    service.remove(&key)
}

/// 获取所有配置
///
/// 只返回**非机密**配置：机密字段被逐字段剔除。
#[tauri::command]
pub fn get_all_configs(state: State<Arc<Mutex<ConfigService>>>) -> HashMap<String, Value> {
    let service = state.lock().unwrap();
    service.get_all_public()
}

/// 查询机密存储的当前保护等级（供设置页展示）。
#[tauri::command]
pub fn get_secret_storage_status(
    state: State<Arc<Mutex<ConfigService>>>,
) -> Result<SecretStorageStatus, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(SecretStorageStatus {
        backend: service.secret_backend().as_str().to_string(),
        degraded: service.secrets_degraded(),
    })
}

/// 机密存储状态。
#[derive(serde::Serialize)]
pub struct SecretStorageStatus {
    /// 后端标识：`credential-store` / `encrypted-file` / `plaintext`。
    pub backend: String,
    /// 是否处于降级状态（未使用 OS 凭据库）。
    pub degraded: bool,
}
