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

/// 创建一个裸的 `ClientBuilder`，已套上平台正确的 TLS 配置。
///
/// **Android**：reqwest 0.13 的 rustls 后端固定使用 `rustls-platform-verifier`，
/// 该 crate 在 Android 上要求在 Android 侧注入 Kotlin 组件并显式初始化，否则第一次
/// HTTPS 握手就会在 worker 线程 panic（实测 `Expect rustls-platform-verifier to be
/// initialized`）。这里显式构造使用内置 Mozilla 根证书的 `rustls::ClientConfig`
/// 交给 reqwest，完全绕开平台校验器。
///
/// **桌面**：返回原 builder（继续走 native-tls / rustls 默认链路）。
pub fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();

    #[cfg(target_os = "android")]
    let builder = {
        crate::log_debug!("[http_client] android TLS: webpki-roots configured");
        builder.use_preconfigured_tls(android_tls_config())
    };

    builder
}

/// Android 专用 TLS 配置：内置 Mozilla 根证书 + 默认加密 provider（aws-lc-rs）。
#[cfg(target_os = "android")]
fn android_tls_config() -> rustls::ClientConfig {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    // 显式安装进程级默认 provider：reqwest 的 rustls feature 启用了 aws-lc-rs，
    // 但这里先建 config，确保 provider 已就绪（重复安装会返回 Err，忽略即可）。
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth()
}

/// 创建带平台默认 TLS 的客户端（不读全局代理配置的快捷方式）。
///
/// 供那些直接 `reqwest::Client::new()` 的地方替换使用，保证 Android 上不会踩
/// rustls-platform-verifier 未初始化的崩溃。
pub fn default_client() -> Client {
    client_builder().build().unwrap_or_else(|error| {
        crate::log_warn!("[http_client] default client build failed, falling back: {}", error);
        Client::new()
    })
}

/// 创建带指定代理配置的 HTTP 客户端。
///
/// `proxy_config` 为 `None` 或未启用时，**显式禁用代理**（`ClientBuilder::no_proxy()`），
/// 而不是不传任何代理。否则 reqwest 会回退到读取 `HTTP_PROXY` /
/// `HTTPS_PROXY` / `ALL_PROXY` 等环境变量，导致后台运行的 v2ray 等第三方代理
/// 仍然会被使用，即使 EndProtocol 内部代理开关已关闭。
pub fn create_proxied_client(proxy_config: Option<&Value>) -> Client {
    let mut builder = client_builder().timeout(Duration::from_secs(30));

    match proxy_config.and_then(proxy::from_config) {
        Some(proxy) => builder = builder.proxy(proxy),
        None => builder = builder.no_proxy(),
    }

    builder.build().unwrap_or_else(|error| {
        crate::log_warn!("[http_client] build failed, falling back: {}", error);
        Client::new()
    })
}
