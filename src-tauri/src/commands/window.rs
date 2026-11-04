use tauri::{Manager, Runtime};

#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::Xps::{PrintWindow, PW_CLIENTONLY};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;

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
    // 没有系统托盘时隐藏窗口等于把用户关进一个没有入口的后台进程：窗口不可见、
    // 进程还在，单实例插件还会让之后启动的新实例直接退出。此时降级为退出应用。
    if !crate::tray::is_tray_available() {
        app.exit(0);
        return Ok(());
    }
    if let Some(window) = main_window(&app) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── 仪表盘标签页快照（窗口截图裁切） ──────────────────────────────────────────

/// 截取主窗口客户区的给定物理像素矩形，编码为 PNG 写入
/// `<app_data>/snapshots/<tab_id>.png`，返回文件路径。
///
/// 截图来自真实渲染（PrintWindow + PW_RENDERFULLCONTENT），用于主界面的
/// “上次离开时的仪表盘”缩略图；裁切位置与尺寸由前端按内容区左上角计算。
#[cfg(windows)]
#[tauri::command]
pub async fn save_tab_snapshot<R: Runtime>(
    app: tauri::AppHandle<R>,
    tab_id: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let window = main_window(&app).ok_or("main window not found")?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // HWND 非 Send：转 isize 跨线程，进 blocking 后再转回。
    let hwnd_raw = hwnd.0 as isize;

    tauri::async_runtime::spawn_blocking(move || {
        save_tab_snapshot_sync(hwnd_raw, &tab_id, x, y, width, height)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn save_tab_snapshot<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    _tab_id: String,
    _x: u32,
    _y: u32,
    _width: u32,
    _height: u32,
) -> Result<String, String> {
    Err("Tab snapshot capture is only supported on Windows".to_string())
}

/// 删除某标签页的全部快照文件（标签页被删除时调用；文件不存在视为成功）。
#[tauri::command]
pub fn delete_tab_snapshot(tab_id: String) -> Result<(), String> {
    validate_tab_id(&tab_id)?;
    let dir = snapshots_dir()?;
    prune_snapshots(&dir, &tab_id);
    Ok(())
}

fn validate_tab_id(tab_id: &str) -> Result<(), String> {
    if tab_id.is_empty()
        || tab_id.len() > 64
        || !tab_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid tab id: {tab_id}"));
    }
    Ok(())
}

fn snapshots_dir() -> Result<std::path::PathBuf, String> {
    crate::utils::paths::app_data_dir()
        .map(|d| d.join("snapshots"))
        .map_err(|e| e.to_string())
}

/// 快照文件名带时间戳：前端 imageCacheManager 与浏览器都按路径缓存图片，
/// 换新文件名才能确保重拍后的快照不被陈旧 blob 顶替。
fn snapshot_file_name(tab_id: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{tab_id}-{ts}.png")
}

/// 删除该标签页的历史快照（写新文件前调用，保证同一标签页只留最新一张）。
fn prune_snapshots(dir: &std::path::Path, tab_id: &str) {
    let prefix = format!("{tab_id}-");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let keep = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.starts_with(&prefix) && name.ends_with(".png"))
            .unwrap_or(false);
        if keep {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(windows)]
fn save_tab_snapshot_sync(
    hwnd_raw: isize,
    tab_id: &str,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    validate_tab_id(tab_id)?;
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err(format!("invalid snapshot size {width}x{height}"));
    }

    let hwnd = hwnd_raw as HWND;
    unsafe {
        // 1) 客户区尺寸（物理像素，WebView2 按 DPI 渲染到这里）
        let mut client = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(hwnd, &mut client) == 0 {
            return Err("GetClientRect failed".to_string());
        }
        let cw = client.right - client.left;
        let ch = client.bottom - client.top;
        if cw <= 0 || ch <= 0 {
            return Err("window client rect is empty (window hidden?)".to_string());
        }

        // 2) 把请求矩形夹进客户区
        let x = (x as i32).clamp(0, cw - 1);
        let y = (y as i32).clamp(0, ch - 1);
        let w = (width as i32).min(cw - x).max(1) as u32;
        let h = (height as i32).min(ch - y).max(1) as u32;

        let hdc_window = GetDC(hwnd);
        if hdc_window.is_null() {
            return Err("GetDC failed".to_string());
        }
        let hdc_mem = CreateCompatibleDC(hdc_window);
        let hbitmap = CreateCompatibleBitmap(hdc_window, cw, ch);
        if hdc_mem.is_null() || hbitmap.is_null() {
            ReleaseDC(hwnd, hdc_window);
            return Err("CreateCompatibleDC/Bitmap failed".to_string());
        }
        let old = SelectObject(hdc_mem, hbitmap as *mut core::ffi::c_void);

        // 3) PrintWindow 渲染整个客户区。
        //    PW_CLIENTONLY = 1；PW_RENDERFULLCONTENT = 2（windows-sys 0.61 未导出该常量，
        //    WebView2/DirectComposition 内容必须带这个标志才不会被截成空白）。
        const PW_RENDERFULLCONTENT: u32 = 2;
        let printed = PrintWindow(
            hwnd,
            hdc_mem,
            PW_CLIENTONLY | PW_RENDERFULLCONTENT,
        );
        if printed == 0 {
            SelectObject(hdc_mem, old);
            DeleteObject(hbitmap as *mut core::ffi::c_void);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_window);
            return Err("PrintWindow failed".to_string());
        }

        // 4) DIB 读回（负高度 = 自顶而下行序），整幅 BGRA
        let stride = cw as usize * 4;
        let mut buf = vec![0u8; stride * ch as usize];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: cw,
                biHeight: -ch,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: buf.len() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let copied = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            ch as u32,
            buf.as_mut_ptr() as *mut _,
            &mut bmi as *mut BITMAPINFO,
            DIB_RGB_COLORS,
        );
        SelectObject(hdc_mem, old);
        DeleteObject(hbitmap as *mut core::ffi::c_void);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_window);
        if copied == 0 {
            return Err("GetDIBits failed".to_string());
        }

        // 5) 裁切 + BGRA→RGBA
        let out_w = w as usize;
        let out_h = h as usize;
        let mut rgba = vec![0u8; out_w * out_h * 4];
        for row in 0..out_h {
            let src = ((y as usize + row) * stride) + (x as usize * 4);
            let dst = row * out_w * 4;
            for col in 0..out_w {
                rgba[dst + col * 4] = buf[src + col * 4 + 2]; // R ← B
                rgba[dst + col * 4 + 1] = buf[src + col * 4 + 1]; // G
                rgba[dst + col * 4 + 2] = buf[src + col * 4]; // B ← R
                rgba[dst + col * 4 + 3] = buf[src + col * 4 + 3]; // A
            }
        }

        // 6) PNG 落盘（文件名带时间戳，写新前清旧，只保留最新一张）
        let dir = snapshots_dir()?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create snapshots dir: {e}"))?;
        prune_snapshots(&dir, tab_id);
        let path = dir.join(snapshot_file_name(tab_id));
        let file = std::fs::File::create(&path)
            .map_err(|e| format!("Failed to create snapshot file: {e}"))?;
        let mut encoder = png::Encoder::new(file, out_w as u32, out_h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header failed: {e}"))?;
        writer
            .write_image_data(&rgba)
            .map_err(|e| format!("PNG write failed: {e}"))?;

        let path_str = path.to_string_lossy().to_string();
        crate::log_info!("[snapshot] saved tab {tab_id}: {path_str} ({out_w}x{out_h})");
        Ok(path_str)
    }
}
