//! in-app browser 的原生 Webview 导航能力。
//!
//! 背景：前端 `src/components/in-app-browser.tsx` 用 `@tauri-apps/api/webview` 的
//! `new Webview(window, label, options)` 在主窗口内挂一个「子 Webview」来加载被
//! `X-Frame-Options` / CSP 禁止内嵌的站点。但 JS 侧的 `Webview` 类只有生命周期与
//! 布局方法（`close/setSize/setPosition/show/hide/...`），**没有** `eval`、
//! `navigate`、`reload`、`url`、`onPageLoad`、`onNavigation`（见
//! `node_modules/@tauri-apps/api/webview.d.ts`，@tauri-apps/api 2.12.1）。
//! 这些能力只在 Rust 侧的 `tauri::Webview` 上存在，所以这里用 app command 把它们
//! 暴露给前端；页面加载事件则反向由 `lib.rs` 的 `Builder::on_page_load` 桥接成
//! `browser://page-load` 事件发给主 webview。
//!
//! 安全边界：`webview_label` 只能由主 webview（local origin）指定。子 webview 加载的是
//! 远程站点，属于 remote origin，Tauri 的 ACL 会直接拒绝它调用任何 app command
//! （没有匹配 `remote` context 的 capability），因此远程页面无法用这些命令操纵
//! 自身或其它 webview。

use tauri::{AppHandle, Manager, Runtime, Url};

/// 按 label 取子 webview 实例。
///
/// 取不到时返回可读错误：前端会把它降级为日志，不阻塞 UI。
fn get_webview<R: Runtime>(
    app: &AppHandle<R>,
    webview_label: &str,
) -> Result<tauri::Webview<R>, String> {
    app.get_webview(webview_label)
        .ok_or_else(|| format!("webview not found: {webview_label}"))
}

/// 后退回一页。
///
/// Rust 侧没有 `back()`，走 `Webview::eval("history.back()")`；远程页面自身的
/// 同源 history 由它自己的 webview 执行，不受宿主限制（这是 iframe 方案里跨域
/// 静默失败的那部分能力）。
#[tauri::command]
pub async fn browser_go_back<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
) -> Result<(), String> {
    let webview = get_webview(&app, &webview_label)?;
    webview
        .eval("window.history.back();")
        .map_err(|error| error.to_string())
}

/// 前进一步。
#[tauri::command]
pub async fn browser_go_forward<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
) -> Result<(), String> {
    let webview = get_webview(&app, &webview_label)?;
    webview
        .eval("window.history.forward();")
        .map_err(|error| error.to_string())
}

/// 重新加载当前页面。
///
/// 用 `Webview::reload()` 而不是 `eval("location.reload()")`：前者会重跑 Tauri 注入
/// 的初始化脚本并照常触发 `on_page_load`，loading 状态才能正确回到加载中。
#[tauri::command]
pub async fn browser_reload<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
) -> Result<(), String> {
    let webview = get_webview(&app, &webview_label)?;
    webview.reload().map_err(|error| error.to_string())
}

/// 在当前子 webview 内导航到新地址（不销毁重建实例，保留其浏览历史）。
///
/// 地址必须带 `http` / `https` scheme：`WindowConfig.url` 的反序列化会把其它 scheme
/// 当作 `CustomProtocol`，而 `Webview::navigate` 只接受 http/https，否则远程内容会被
/// 引导到自定义协议上。
#[tauri::command]
pub async fn browser_navigate<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
    url: String,
) -> Result<(), String> {
    let webview = get_webview(&app, &webview_label)?;
    let parsed = Url::parse(&url).map_err(|error| format!("invalid url: {error}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("unsupported url scheme: {}", parsed.scheme()));
    }
    webview.navigate(parsed).map_err(|error| error.to_string())
}

/// 读取子 webview 当前地址，用于工具栏地址栏与实际页面同步。
#[tauri::command]
pub async fn browser_current_url<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
) -> Result<String, String> {
    let webview = get_webview(&app, &webview_label)?;
    webview.url().map(|url| url.to_string()).map_err(|error| error.to_string())
}
