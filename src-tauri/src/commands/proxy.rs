use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::services::config_service::ConfigService;
use crate::utils::proxy::{self, ProxyConfigValue, SystemProxyInfo, TestConnectionResult};
use crate::log_info;

/// 代理连通性测试使用的默认探测地址。
const DEFAULT_PROBE_URL: &str = "https://www.gstatic.com/generate_204";

/// 读取系统代理设置（Windows 注册表 / `HTTP(S)_PROXY` 环境变量）。
#[tauri::command]
pub fn read_system_proxy() -> SystemProxyInfo {
    let info = proxy::read_system_proxy();
    log_info!(
        "[proxy] system proxy: enabled={}, type={}, host={}:{}",
        info.enabled,
        info.proxy_type,
        info.host,
        info.port
    );
    info
}

/// 测试当前（或传入的）代理配置能否连通。
///
/// `config` 为空时回退到已保存的 `proxy_config`，便于前端「不落盘也能先测一下」。
#[tauri::command]
pub async fn test_proxy_connection(
    state: State<'_, Arc<Mutex<ConfigService>>>,
    config: Option<Value>,
    url: Option<String>,
) -> Result<TestConnectionResult, String> {
    let config = match config {
        Some(config) => config,
        None => state
            .lock()
            .map_err(|e| e.to_string())?
            .get_proxy_config()
            .unwrap_or(Value::Null),
    };

    let target = url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_PROBE_URL.to_string());

    proxy::test_connection(&config, &target, 15)
        .await
        .map_err(|error| error.to_string())
}

/// 自动嗅探本地常用代理端口，返回首个可用的配置（包括协议与端口）。
#[tauri::command]
pub async fn auto_detect_proxy() -> Result<ProxyConfigValue, String> {
    proxy::auto_detect_proxy().await.map_err(|e| e.to_string())
}

/// 读取已保存的代理配置（`proxy_config`，缺省时返回空配置）。
#[tauri::command]
pub fn get_proxy_settings(state: State<'_, Arc<Mutex<ConfigService>>>) -> Value {
    state
        .lock()
        .ok()
        .and_then(|service| service.get_proxy_config())
        .unwrap_or_else(empty_proxy_config)
}

/// 保存代理配置；写入后立即刷新全局代理缓存，后续 HTTP 请求生效。
#[tauri::command]
pub fn save_proxy_settings(
    state: State<'_, Arc<Mutex<ConfigService>>>,
    config: Value,
) -> Result<Value, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service
        .set_proxy_config(config.clone())
        .map_err(|e| e.to_string())?;
    crate::utils::http_client::set_global_proxy_config(Some(config.clone()));
    Ok(config)
}

/// 清除代理配置（恢复为「不使用代理」）。
#[tauri::command]
pub fn clear_proxy_settings(state: State<'_, Arc<Mutex<ConfigService>>>) -> bool {
    let removed = state
        .lock()
        .map(|mut service| service.remove_proxy_config())
        .unwrap_or(false);
    crate::utils::http_client::set_global_proxy_config(None);
    removed
}

fn empty_proxy_config() -> Value {
    json!({
        "enabled": false,
        "type": "http",
        "host": "",
        "port": 8080,
        "username": "",
        "password": "",
    })
}
