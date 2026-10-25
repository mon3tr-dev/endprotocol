use reqwest::Client;
use serde_json::Value;
use std::sync::RwLock;
use std::time::Duration;

use crate::utils::proxy;

/// 全局代理配置缓存：设置页改动后立即更新，所有 HTTP 客户端共用。
static PROXY_CONFIG: RwLock<Option<Value>> = RwLock::new(None);

/// 更新全局代理配置（由 `set_config("proxy_config")` 触发）。
///
/// 同时将排除主机名写入 `no_proxy` 环境变量，使 reqwest 对这些主机
/// 直连不走代理（reqwest 会读取该环境变量）。
pub fn set_global_proxy_config(config: Option<Value>) {
    if let Ok(mut guard) = PROXY_CONFIG.write() {
        *guard = config.clone();
    }

    // 同步 no_proxy 环境变量：逗号分隔的主机名，匹配这些主机直连。
    let exclude = config
        .and_then(|c| c.get("exclude").and_then(Value::as_str).map(|s| s.to_string()))
        .unwrap_or_default();
    let exclude = exclude.trim();
    if exclude.is_empty() {
        let _ = std::env::remove_var("no_proxy");
    } else {
        let _ = std::env::set_var("no_proxy", exclude);
    }
}

/// 读取当前生效的代理配置快照。
pub fn global_proxy_config() -> Option<Value> {
    PROXY_CONFIG.read().ok().and_then(|guard| guard.clone())
}

/// 创建配置好的 HTTP 客户端（跟随全局代理设置）
pub fn create_client() -> Client {
    create_proxied_client(global_proxy_config().as_ref())
}

/// 创建带指定代理配置的 HTTP 客户端；`proxy_config` 为 `None` 时不走代理。
pub fn create_proxied_client(proxy_config: Option<&Value>) -> Client {
    let mut builder = Client::builder().timeout(Duration::from_secs(30));

    if let Some(proxy) = proxy_config.and_then(proxy::from_config) {
        builder = builder.proxy(proxy);
    }

    builder.build().unwrap_or_else(|error| {
        crate::log_warn!("[http_client] build failed, falling back: {}", error);
        Client::new()
    })
}
