use chrono::{DateTime, Local};
use serde::Serialize;
use std::backtrace::Backtrace;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

use super::paths;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);
static IN_HOOK: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
pub struct CrashReportInfo {
    pub path: String,
    pub file_name: String,
    pub timestamp: String,
    pub message: String,
    pub content: String,
    pub acknowledged: bool,
}

#[derive(Clone, Serialize)]
pub struct CrashEventPayload {
    pub message: String,
    pub location: Option<String>,
    pub thread: String,
    pub backtrace: String,
    pub report_path: Option<String>,
    pub timestamp: String,
}

/// 记录 AppHandle，供 panic hook 向前端广播事件。
pub fn set_app_handle(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// 安装全局 panic hook。必须在 logger / Tauri 初始化之前调用，
/// 这样即使初始化阶段崩溃也能留下崩溃报告。
pub fn install_panic_hook() {
    if HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::panic::set_hook(Box::new(|info| handle_panic(info)));
}

fn handle_panic(info: &std::panic::PanicHookInfo<'_>) {
    // 防止 panic hook 自身 panic 导致递归。
    if IN_HOOK.swap(true, Ordering::SeqCst) {
        return;
    }

    let message = panic_message(info);
    let location = info.location().map(|location| {
        format!(
            "{}:{}:{}",
            location.file(),
            location.line(),
            location.column()
        )
    });
    let thread = std::thread::current()
        .name()
        .unwrap_or("<unnamed>")
        .to_string();
    let backtrace = format!("{}", Backtrace::force_capture());
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let version = APP_HANDLE
        .get()
        .map(|app| app.package_info().version.to_string())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let content = format!(
        "EndProtocol crash report\n\
         Time: {timestamp}\n\
         Version: {version}\n\
         OS: {} {}\n\
         Thread: {thread}\n\
         Panic: {message}\n\
         Location: {}\n\
         Backtrace:\n{backtrace}\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        location.as_deref().unwrap_or("<unknown>"),
    );

    let report_path = write_report(&content).ok();

    if let Some(logger) = super::logger::try_get_logger() {
        logger.error_with_module(
            "panic",
            &format!(
                "thread '{thread}' panicked at {}: {message}\n{backtrace}",
                location.as_deref().unwrap_or("<unknown>")
            ),
        );
    }

    // GUI 子系统下没有控制台，safe_eprintln 会自动跳过。
    crate::safe_eprintln!("{content}");

    if let Some(app) = APP_HANDLE.get() {
        let payload = CrashEventPayload {
            message: message.clone(),
            location,
            thread,
            backtrace,
            report_path: report_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            timestamp,
        };
        let _ = app.emit("app:crash", &payload);
    }

    IN_HOOK.store(false, Ordering::SeqCst);
}

fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(value) = info.payload().downcast_ref::<&str>() {
        (*value).to_string()
    } else if let Some(value) = info.payload().downcast_ref::<String>() {
        value.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

pub fn crash_dir() -> Result<PathBuf, String> {
    paths::log_dir()
        .map(|dir| dir.join("crashes"))
        .map_err(|error| error.to_string())
}

fn write_report(content: &str) -> Result<PathBuf, String> {
    let dir = crash_dir()?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file_name = format!(
        "crash-{}-{}.log",
        Local::now().format("%Y%m%d-%H%M%S"),
        std::process::id()
    );
    let path = dir.join(file_name);
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path)
}

/// 读取尚未确认（未生成 .ack）的崩溃报告，按时间倒序返回最近 5 条。
pub fn pending_reports() -> Vec<CrashReportInfo> {
    let Ok(dir) = crash_dir() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut reports = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("crash-") || !file_name.ends_with(".log") {
            continue;
        }
        let acknowledged = ack_path(&path).exists();
        if acknowledged {
            continue;
        }

        let content = fs::read(&path)
            .map(|bytes| truncate_chars(&String::from_utf8_lossy(&bytes), 24_000))
            .unwrap_or_default();
        let message = content
            .lines()
            .find_map(|line| line.strip_prefix("Panic: "))
            .unwrap_or("Unknown panic")
            .to_string();
        let timestamp = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(|modified| {
                let datetime: DateTime<Local> = modified.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        reports.push(CrashReportInfo {
            path: path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            timestamp,
            message,
            content,
            acknowledged,
        });
    }

    reports.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    reports.truncate(5);
    reports
}

/// 标记崩溃报告为已读。只允许操作崩溃目录下的 .log 文件。
pub fn acknowledge(paths: &[String]) -> Result<(), String> {
    let dir = crash_dir()?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let dir = fs::canonicalize(&dir).map_err(|error| error.to_string())?;

    for raw_path in paths {
        let path = Path::new(raw_path);
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("crash-") || !file_name.ends_with(".log") {
            continue;
        }
        let Some(parent) = path.parent() else {
            continue;
        };
        let parent = match fs::canonicalize(parent) {
            Ok(parent) => parent,
            Err(_) => continue,
        };
        if parent != dir {
            continue;
        }
        fs::write(ack_path(path), Local::now().to_rfc3339())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ack_path(path: &Path) -> PathBuf {
    path.with_extension("log.ack")
}

fn truncate_chars(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let mut truncated: String = input.chars().take(max).collect();
    truncated.push_str("\n... [truncated]");
    truncated
}
