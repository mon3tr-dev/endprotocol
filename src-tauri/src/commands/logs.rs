use crate::utils::logger::{self, get_logger, LogEntry, LogLevel};

/// 获取后端当前会话的所有日志
#[tauri::command]
pub fn get_backend_logs() -> Vec<LogEntry> {
    get_logger().get_recent_logs()
}

/// 运行时调整后端日志级别（"debug" | "info" | "warn" | "error"）
#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    let parsed =
        LogLevel::parse(&level).ok_or_else(|| format!("Unknown log level: {}", level))?;
    logger::set_log_level(parsed);
    Ok(())
}
