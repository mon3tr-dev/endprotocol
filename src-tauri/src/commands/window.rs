use tauri::{Manager, Runtime};

/// 取主窗口句柄。
///
/// 这里必须用 `Manager::get_window`，**不能**用 `get_webview_window`：
/// `get_webview_window` 内部会先 `get_webview(label)` 再检查
/// `window.is_webview_window()`，而后者要求该窗口下的**所有** webview 的 label
/// 都等于窗口 label（tauri-2.12 `src/window/mod.rs:1257`）。in-app browser 打开时，
/// 主窗口 "main" 下会多出一个 label 为 `inapp-browser-N` 的子 webview，于是
/// `is_webview_window()` 为 false，`get_webview_window("main")` 返回 `None`，
/// 所有窗口命令（最小化 / 最大化 / 关闭 / 隐藏到托盘）都会静默失效。
///
/// `Manager::get_window` 按**窗口** label 查，不受子 webview 影响。
fn main_window<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Window<R>> {
    app.get_window("main")
}

#[tauri::command]
pub fn minimize_window<R: Runtime>(app: tauri::AppHandle<R>) {
    if let Some(window) = main_window(&app) {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub fn toggle_maximize_window<R: Runtime>(app: tauri::AppHandle<R>) {
    if let Some(window) = main_window(&app) {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn close_window<R: Runtime>(app: tauri::AppHandle<R>) {
    if let Some(window) = main_window(&app) {
        let _ = window.close();
    }
}

#[tauri::command]
pub fn minimize_to_tray<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = main_window(&app) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
