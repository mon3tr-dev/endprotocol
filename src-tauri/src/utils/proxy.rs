use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::utils::AppError;
use crate::{log_debug, log_warn};

/// 判断代理配置是否真的可用（启用且填了主机）。
///
/// 读取配置各处都只拿到 `serde_json::Value`，这里做一次宽松解析：
/// 字段缺失或类型不对时按「未配置」处理，避免历史配置把请求打崩。
fn is_enabled(config: &Value) -> bool {
    let enabled = config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let host = config
        .get("host")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    enabled && !host.is_empty()
}

/// 代理排除列表：逗号分隔的主机名，匹配这些主机的请求直连不走代理。
fn exclude_list(config: &Value) -> Vec<String> {
    let raw = config
        .get("exclude")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if raw.is_empty() {
        return Vec::new();
    }
    raw.split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 把配置里的 host 规范成 reqwest 需要的 `scheme://host:port` 形式。
fn proxy_server(config: &Value) -> Option<String> {
    if !is_enabled(config) {
        return None;
    }

    let host = config.get("host").and_then(Value::as_str)?.trim();
    if host.is_empty() {
        return None;
    }

    let port = config
        .get("port")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        })
        .filter(|port| *port > 0 && *port <= 65535)
        .unwrap_or(8080);

    // 用户可能直接粘贴了 `http://host:port`，此时只用 host 部分。
    let host = host
        .split("://")
        .last()
        .unwrap_or(host)
        .trim_end_matches('/');

    Some(format!("{}://{}:{}", scheme_for(config), host, port))
}

/// 代理协议对应的 URL scheme。
///
/// SOCKS5 可选「远程 DNS 解析」（`remote_dns`），此时用 `socks5h://`，
/// 域名交给代理解析，避免 DNS 污染导致的连接失败。
fn scheme_for(config: &Value) -> &'static str {
    let is_socks = config
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("http")
        == "socks5";
    if !is_socks {
        return "http";
    }

    let remote_dns = config
        .get("remoteDns")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if remote_dns {
        "socks5h"
    } else {
        "socks5"
    }
}

fn credentials(config: &Value) -> (Option<String>, Option<String>) {
    let username = config
        .get("username")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let password = config
        .get("password")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    match username {
        Some(username) => (Some(username), password.or(Some(String::new()))),
        None => (None, None),
    }
}

/// 按 `proxy_config` 生成 reqwest 代理；未启用或配置不完整时返回 `None`。
///
/// `exclude` 列表（逗号分隔的主机名）会记录但 `reqwest::Proxy` 原生
/// 不支持 per-host bypass；若需强制直连，可在构建客户端前将
/// `no_proxy` 环境变量设为排除列表。
pub fn from_config(config: &Value) -> Option<reqwest::Proxy> {
    let server = proxy_server(config)?;
    let (username, password) = credentials(config);
    let exclude = exclude_list(config);

    let proxy = match (username, password) {
        (Some(username), Some(password)) => reqwest::Proxy::all(&server)
            .map(|proxy| proxy.basic_auth(&username, &password)),
        _ => reqwest::Proxy::all(&server),
    };

    match proxy {
        Ok(proxy) => {
            if !exclude.is_empty() {
                log_debug!(
                    "[proxy] using {} via {} (exclude: {})",
                    scheme_for(config),
                    server,
                    exclude.join(", ")
                );
            } else {
                log_debug!("[proxy] using {} via {}", scheme_for(config), server);
            }
            Some(proxy)
        }
        Err(error) => {
            log_warn!("[proxy] invalid proxy config {}: {}", server, error);
            None
        }
    }
}

/// 通过指定代理地址发起一次探测请求（用于「测试连接」）。
pub async fn test_connection(
    config: &Value,
    url: &str,
    timeout_secs: u64,
) -> Result<TestConnectionResult, AppError> {
    let proxy = from_config(config).ok_or_else(|| AppError::ValidationError {
        message: "Proxy is not enabled or the host is empty".to_string(),
    })?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(timeout_secs.clamp(1, 60)))
        .build()
        .map_err(|error| AppError::NetworkError {
            message: format!("Failed to create HTTP client: {}", error),
        })?;

    let started = std::time::Instant::now();
    let response = client.get(url).send().await.map_err(|error| {
        AppError::NetworkError {
            message: format!("Proxy connection failed: {}", error),
        }
    })?;

    Ok(TestConnectionResult {
        status: response.status().as_u16(),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// 自动嗅探本地常用代理端口，返回首个可用的配置。
///
/// 按顺序探测常见端口（HTTP 8080/7890/1080，SOCKS5 1080/1081），
/// 每个端口都用短超时发起一次连通性测试，首个成功的即返回。
pub async fn auto_detect_proxy() -> Result<ProxyConfigValue, AppError> {
    use tokio::time::timeout;

    let candidates: Vec<(&'static str, &'static str, u16)> = vec![
        ("http", "127.0.0.1", 8080),
        ("http", "127.0.0.1", 7890),
        ("http", "127.0.0.1", 1080),
        ("socks5", "127.0.0.1", 1080),
        ("socks5", "127.0.0.1", 1081),
    ];

    let mut last_err: Option<AppError> = None;

    for (scheme, host, port) in candidates {
        let config = serde_json::json!({
            "enabled": true,
            "type": scheme,
            "host": host,
            "port": port,
            "username": "",
            "password": "",
            "exclude": "",
        });

        let proxy = match from_config(&config) {
            Some(p) => p,
            None => continue,
        };

        // 短超时探测，避免阻塞太久。
        let client = match reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                last_err = Some(AppError::NetworkError {
                    message: format!("Failed to build client for {}://{}:{}: {}", scheme, host, port, e),
                });
                continue;
            }
        };

        match timeout(Duration::from_secs(3), client.get("https://www.gstatic.com/generate_204").send()).await {
            Ok(Ok(resp)) if resp.status().is_success() => {
                log_debug!("[proxy] auto-detect: {}://{}:{} available", scheme, host, port);
                return Ok(ProxyConfigValue {
                    enabled: true,
                    proxy_type: scheme.to_string(),
                    host: host.to_string(),
                    port,
                    username: String::new(),
                    password: String::new(),
                    remote_dns: false,
                    exclude: String::new(),
                });
            }
            Ok(Ok(resp)) => {
                log_debug!("[proxy] auto-detect: {}://{}:{} returned {}", scheme, host, port, resp.status());
            }
            Ok(Err(e)) => {
                log_debug!("[proxy] auto-detect: {}://{}:{} failed: {}", scheme, host, port, e);
                last_err = Some(AppError::NetworkError {
                    message: format!("{}://{}:{} connection failed: {}", scheme, host, port, e),
                });
            }
            Err(_) => {
                log_debug!("[proxy] auto-detect: {}://{}:{} timeout", scheme, host, port);
                continue;
            }
        }
    }

    Err(last_err.unwrap_or_else(|| AppError::ValidationError {
        message: "No available proxy found on common local ports".to_string(),
    }))
}

/// 自动嗅探命令的返回体。
#[derive(Debug, Serialize)]
pub struct ProxyConfigValue {
    pub enabled: bool,
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub remote_dns: bool,
    pub exclude: String,
}

/// `test_proxy_connection` 的返回体。
#[derive(Debug, Serialize)]
pub struct TestConnectionResult {
    /// HTTP 状态码（能连上代理但目标站点拒绝也会返回，例如 403）。
    pub status: u16,
    /// 从发起到收到响应头的耗时。
    pub duration_ms: u64,
}

/// `read_system_proxy` 的返回体：前端「从系统代理读取」按钮使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemProxyInfo {
    /// 系统是否开启了代理。
    pub enabled: bool,
    /// `http` 或 `socks5`。
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    /// 系统代理需要认证时的用户名（通常为空）。
    pub username: String,
    pub password: String,
    /// 原始 PAC / 自动配置地址（Windows 才有，可能为空）。
    pub pac_url: String,
    /// 是否来自环境变量而非系统设置。
    pub from_env: bool,
}

impl SystemProxyInfo {
    fn none() -> Self {
        Self {
            enabled: false,
            proxy_type: "http".to_string(),
            host: String::new(),
            port: 0,
            username: String::new(),
            password: String::new(),
            pac_url: String::new(),
            from_env: false,
        }
    }
}
/// 读取当前系统代理设置（Windows 注册表 / 环境变量）。
pub fn read_system_proxy() -> SystemProxyInfo {
    #[cfg(windows)]
    {
        if let Some(info) = windows_registry_proxy() {
            return info;
        }
    }

    env_proxy().unwrap_or_else(SystemProxyInfo::none)
}

/// 从 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 环境变量解析（大小写都认）。
fn env_proxy() -> Option<SystemProxyInfo> {
    let keys = [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];
    let raw = keys
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|value| !value.trim().is_empty())?;

    parse_proxy_url(&raw).map(|mut info| {
        info.from_env = true;
        info
    })
}

/// 解析 `http://user:pass@host:port` / `socks5://host:port` 形式的代理地址。
fn parse_proxy_url(raw: &str) -> Option<SystemProxyInfo> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (scheme, rest) = match trimmed.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("http".to_string(), trimmed),
    };

    let (auth, host_part) = match rest.rsplit_once('@') {
        Some((auth, host)) => (Some(auth), host),
        None => (None, rest),
    };

    let host_part = host_part.trim_end_matches('/');
    let (host, default_port) = split_host_port(host_part)?;

    let (username, password) = match auth {
        Some(auth) => match auth.split_once(':') {
            Some((user, pass)) => (user.to_string(), pass.to_string()),
            None => (auth.to_string(), String::new()),
        },
        None => (String::new(), String::new()),
    };

    let proxy_type = if scheme.starts_with("socks") {
        "socks5"
    } else {
        "http"
    };

    Some(SystemProxyInfo {
        enabled: true,
        proxy_type: proxy_type.to_string(),
        host,
        port: default_port.unwrap_or(if proxy_type == "socks5" { 1080 } else { 8080 }),
        username,
        password,
        pac_url: String::new(),
        from_env: false,
    })
}

/// 拆分 `host` 与可选的 `:port`（IPv6 字面量 `[::1]:1080` 也支持）。
fn split_host_port(authority: &str) -> Option<(String, Option<u16>)> {
    let authority = authority.trim();
    if authority.is_empty() {
        return None;
    }

    if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        let port = tail
            .strip_prefix(':')
            .and_then(|port| port.parse::<u16>().ok());
        return Some((format!("[{}]", host), port));
    }

    match authority.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) => {
            port.parse::<u16>()
                .ok()
                .map(|port| (host.to_string(), Some(port)))
        }
        _ => Some((authority.to_string(), None)),
    }
}

#[cfg(windows)]
fn windows_registry_proxy() -> Option<SystemProxyInfo> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
    };

    const SETTINGS_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    let path = wide(SETTINGS_PATH);
    let mut key = std::ptr::null_mut();
    let status =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_QUERY_VALUE, &mut key) };
    if status != ERROR_SUCCESS {
        return None;
    }

    let enabled = read_dword(key, "ProxyEnable").unwrap_or(0) != 0;
    let server = read_string(key, "ProxyServer").unwrap_or_default();
    let pac_url = read_string(key, "AutoConfigURL").unwrap_or_default();
    unsafe { RegCloseKey(key) };

    // 只认已写入的显式代理；PAC 脚本无法在 reqwest 里执行，仅回传给界面展示。
    if !enabled || server.trim().is_empty() {
        return Some(SystemProxyInfo {
            pac_url,
            ..SystemProxyInfo::none()
        });
    }

    let chosen = pick_proxy_entry(&server);
    let Some((host, port)) = chosen.and_then(|entry| split_host_port(&entry)) else {
        return Some(SystemProxyInfo {
            pac_url,
            ..SystemProxyInfo::none()
        });
    };

    Some(SystemProxyInfo {
        enabled: true,
        proxy_type: "http".to_string(),
        host,
        port: port.unwrap_or(8080),
        username: String::new(),
        password: String::new(),
        pac_url,
        from_env: false,
    })
}

/// Windows `ProxyServer` 支持 `http=host:port;https=host:port` 与单一 `host:port` 两种写法。
#[cfg(windows)]
fn pick_proxy_entry(server: &str) -> Option<String> {
    let entries = server
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty());

    let mut fallback: Option<String> = None;
    let mut preferred: Option<String> = None;
    for entry in entries {
        let (scheme, value) = match entry.split_once('=') {
            Some((scheme, value)) => (scheme.trim().to_ascii_lowercase(), value.trim()),
            None => (String::new(), entry),
        };
        if scheme == "https" {
            preferred = Some(value.to_string());
        } else if scheme == "http" && preferred.is_none() {
            preferred = Some(value.to_string());
        } else if scheme.is_empty() && fallback.is_none() {
            fallback = Some(value.to_string());
        }
    }

    preferred.or(fallback)
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn read_raw_value(
    key: windows_sys::Win32::System::Registry::HKEY,
    name: &str,
) -> Option<(u32, Vec<u8>)> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::RegQueryValueExW;

    let name = wide(name);
    let mut kind = 0u32;
    let mut bytes = 0u32;
    let status = unsafe {
        RegQueryValueExW(
            key,
            name.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if status != ERROR_SUCCESS || bytes == 0 || bytes > 65536 {
        return None;
    }

    let mut buffer = vec![0u8; bytes as usize + 2];
    let status = unsafe {
        RegQueryValueExW(
            key,
            name.as_ptr(),
            std::ptr::null(),
            &mut kind,
            buffer.as_mut_ptr(),
            &mut bytes,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }

    Some((kind, buffer))
}

#[cfg(windows)]
fn read_dword(key: windows_sys::Win32::System::Registry::HKEY, name: &str) -> Option<u32> {
    use windows_sys::Win32::System::Registry::REG_DWORD;

    let (kind, buffer) = read_raw_value(key, name)?;
    if kind != REG_DWORD || buffer.len() < 4 {
        return None;
    }
    Some(u32::from_le_bytes([
        buffer[0], buffer[1], buffer[2], buffer[3],
    ]))
}

#[cfg(windows)]
fn read_string(key: windows_sys::Win32::System::Registry::HKEY, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{REG_EXPAND_SZ, REG_SZ};

    let (kind, buffer) = read_raw_value(key, name)?;
    if kind != REG_SZ && kind != REG_EXPAND_SZ {
        return None;
    }

    let mut utf16 = Vec::with_capacity(buffer.len() / 2);
    for chunk in buffer.chunks_exact(2) {
        utf16.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    let value = String::from_utf16_lossy(&utf16);
    Some(value.trim_end_matches('\0').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_http_proxy_from_config() {
        let config = json!({
            "enabled": true,
            "type": "http",
            "host": "127.0.0.1",
            "port": 7890
        });
        assert_eq!(proxy_server(&config).as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn builds_socks5_proxy_with_credentials() {
        let config = json!({
            "enabled": true,
            "type": "socks5",
            "host": "127.0.0.1",
            "port": 1080,
            "username": "user",
            "password": "pass"
        });
        assert_eq!(
            proxy_server(&config).as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
        assert_eq!(
            credentials(&config),
            (Some("user".to_string()), Some("pass".to_string()))
        );
    }

    #[test]
    fn ignores_disabled_or_empty_host() {
        assert!(proxy_server(&json!({ "enabled": false, "host": "127.0.0.1" })).is_none());
        assert!(proxy_server(&json!({ "enabled": true, "host": "  " })).is_none());
    }

    #[test]
    fn parses_system_proxy_urls() {
        let info = parse_proxy_url("http://user:pass@127.0.0.1:7890").unwrap();
        assert_eq!(info.host, "127.0.0.1");
        assert_eq!(info.port, 7890);
        assert_eq!(info.username, "user");
        assert_eq!(info.password, "pass");

        let socks = parse_proxy_url("socks5://127.0.0.1:1080").unwrap();
        assert_eq!(socks.proxy_type, "socks5");
        assert_eq!(socks.port, 1080);
    }
}
