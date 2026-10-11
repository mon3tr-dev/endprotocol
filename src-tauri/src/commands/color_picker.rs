#[cfg(windows)]
use base64::Engine;
#[cfg(windows)]
use std::mem::size_of;
use tauri::WebviewWindow;
#[cfg(windows)]
use tokio::time::{sleep, Duration};
#[cfg(windows)]
use windows_sys::Win32::Foundation::POINT;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapture {
    width: u32,
    height: u32,
    /// RGBA 原始像素（base64 编码）
    data: String,
}

/// 启动「从屏幕取色」流程。
///
/// WebView2 中 `EyeDropper` API 存在但 `open()` 静默失效，因此改为：
/// 1. 最小化窗口（保证截图里不含应用本身）
/// 2. 截取鼠标所在屏幕
/// 3. 还原窗口并全屏，前端在该全屏覆盖层上取色
#[cfg(windows)]
#[tauri::command]
pub async fn capture_screen(window: WebviewWindow) -> Result<ScreenCapture, String> {
    let _ = window.minimize();
    sleep(Duration::from_millis(400)).await;

    let result = tauri::async_runtime::spawn_blocking(capture_screen_sync)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

    // 无论截图是否成功都要还原窗口，进入全屏取色态
    let _ = window.unminimize();
    let _ = window.set_fullscreen(true);
    let _ = window.set_focus();

    result
}

/// 取色完成或取消后退出全屏，还原窗口。
#[cfg(windows)]
#[tauri::command]
pub fn finish_screen_pick(window: WebviewWindow) {
    let _ = window.set_fullscreen(false);
    let _ = window.set_focus();
}

#[cfg(windows)]
fn capture_screen_sync() -> Result<ScreenCapture, String> {
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return Err("GetCursorPos failed".to_string());
        }

        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err("GetMonitorInfo failed".to_string());
        }
        let w = (info.rcMonitor.right - info.rcMonitor.left) as u32;
        let h = (info.rcMonitor.bottom - info.rcMonitor.top) as u32;
        if w == 0 || h == 0 {
            return Err("invalid monitor size".to_string());
        }

        let null_hwnd = std::ptr::null_mut();
        let hdc_screen = GetDC(null_hwnd);
        if hdc_screen.is_null() {
            return Err("GetDC failed".to_string());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbitmap = CreateCompatibleBitmap(hdc_screen, w as i32, h as i32);
        if hdc_mem.is_null() || hbitmap.is_null() {
            ReleaseDC(null_hwnd, hdc_screen);
            return Err("CreateCompatibleDC/Bitmap failed".to_string());
        }
        let old = SelectObject(hdc_mem, hbitmap);
        if BitBlt(
            hdc_mem,
            0,
            0,
            w as i32,
            h as i32,
            hdc_screen,
            info.rcMonitor.left,
            info.rcMonitor.top,
            SRCCOPY,
        ) == 0
        {
            SelectObject(hdc_mem, old);
            DeleteObject(hbitmap);
            DeleteDC(hdc_mem);
            ReleaseDC(null_hwnd, hdc_screen);
            return Err("BitBlt failed".to_string());
        }

        let row_size = w as usize * 4;
        let buf_len = row_size * h as usize;
        let mut buf = vec![0u8; buf_len];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: buf_len as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let copied = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            h,
            buf.as_mut_ptr() as *mut _,
            &mut bmi as *mut BITMAPINFO,
            DIB_RGB_COLORS,
        );
        SelectObject(hdc_mem, old);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(null_hwnd, hdc_screen);
        if copied == 0 {
            return Err("GetDIBits failed".to_string());
        }

        // GDI 返回 BGRA，转成 RGBA 供前端直接使用
        for px in buf.chunks_exact_mut(4) {
            let r = px[2];
            px[2] = px[0];
            px[0] = r;
        }

        Ok(ScreenCapture {
            width: w,
            height: h,
            data: base64::engine::general_purpose::STANDARD.encode(&buf),
        })
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn capture_screen(_window: WebviewWindow) -> Result<ScreenCapture, String> {
    Err("Screen color picking is only supported on Windows".to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn finish_screen_pick(_window: WebviewWindow) {}
