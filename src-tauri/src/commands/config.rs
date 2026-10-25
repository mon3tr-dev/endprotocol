use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::services::config_service::ConfigService;

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
#[tauri::command]
pub fn set_config(
    state: State<Arc<Mutex<ConfigService>>>,
    key: String,
    value: Value,
) -> Result<(), String> {
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
#[tauri::command]
pub fn get_all_configs(state: State<Arc<Mutex<ConfigService>>>) -> HashMap<String, Value> {
    let service = state.lock().unwrap();
    service.get_all()
}
