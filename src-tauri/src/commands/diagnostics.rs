use crate::utils::api_health::{self, ApiHealthSnapshot};
use crate::utils::crash::{self, CrashReportInfo};
use crate::utils::diagnostics::{self, FrontendLogEntry};

/// 返回应用日志目录（用于“打开日志目录”操作）。
#[tauri::command]
pub fn get_log_dir() -> Result<String, String> {
    crate::utils::paths::log_dir()
        .map(|dir| dir.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

/// 打包前端日志、后端日志、崩溃报告与系统信息为 zip，返回文件路径。
#[tauri::command]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    frontend_logs: Vec<FrontendLogEntry>,
    context: Option<String>,
) -> Result<String, String> {
    diagnostics::export(&app, frontend_logs, context)
}

/// 上次运行留下的未读崩溃报告。
#[tauri::command]
pub fn get_pending_crash_reports() -> Vec<CrashReportInfo> {
    crash::pending_reports()
}

/// 标记崩溃报告为已读。
#[tauri::command]
pub fn ack_crash_reports(paths: Vec<String>) -> Result<(), String> {
    crash::acknowledge(&paths)
}

/// 当前 API 健康状态（供启动阶段轮询兜底）。
#[tauri::command]
pub fn get_api_health() -> ApiHealthSnapshot {
    api_health::snapshot()
}

/// 用户修复问题后恢复 API 请求。
#[tauri::command]
pub fn reset_api_health() {
    api_health::reset()
}
