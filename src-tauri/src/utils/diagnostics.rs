use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{api_health, crash, logger, paths};

/// 前端日志条目（与 src/utils/logger.ts 的 LogEntry 对齐）。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FrontendLogEntry {
    pub timestamp: String,
    pub level: i32,
    pub message: String,
    pub module: String,
    pub source: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct DiagnosticsManifest {
    app: &'static str,
    version: String,
    timestamp: String,
    os: &'static str,
    arch: &'static str,
    context: Option<String>,
    api_health: api_health::ApiHealthSnapshot,
}

pub fn export(
    app: &tauri::AppHandle,
    frontend_logs: Vec<FrontendLogEntry>,
    context: Option<String>,
) -> Result<String, String> {
    let log_dir = paths::log_dir().map_err(|error| error.to_string())?;
    let export_dir = log_dir.join("exports");
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;

    let file_name = format!(
        "endprotocol-diagnostics-{}.zip",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let archive_path = export_dir.join(file_name);
    let file = File::create(&archive_path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let result = write_archive_contents(&mut zip, &log_dir, app, &frontend_logs, context, options);
    if let Err(error) = result {
        let _ = fs::remove_file(&archive_path);
        return Err(error);
    }
    zip.finish().map_err(|error| error.to_string())?;

    Ok(archive_path.to_string_lossy().to_string())
}

fn write_archive_contents(
    zip: &mut ZipWriter<File>,
    log_dir: &Path,
    app: &tauri::AppHandle,
    frontend_logs: &[FrontendLogEntry],
    context: Option<String>,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let manifest = DiagnosticsManifest {
        app: "EndProtocol",
        version: app.package_info().version.to_string(),
        timestamp: Local::now().to_rfc3339(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        context,
        api_health: api_health::snapshot(),
    };
    add_text(
        zip,
        "manifest.json",
        &serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
        options,
    )?;

    add_text(
        zip,
        "frontend-logs.json",
        &serde_json::to_string_pretty(frontend_logs).map_err(|error| error.to_string())?,
        options,
    )?;

    let backend_logs = logger::try_get_logger()
        .map(|logger| logger.get_recent_logs())
        .unwrap_or_default();
    let backend_text = backend_logs
        .iter()
        .map(|entry| {
            format!(
                "[{}] [{:?}] [{}] {}",
                entry.timestamp, entry.level, entry.module, entry.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    add_text(zip, "backend-logs.txt", &backend_text, options)?;

    if let Ok(entries) = fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.starts_with("app-") || name == "startup.log" {
                add_file(zip, &path, &format!("logs/{name}"), options)?;
            }
        }
    }

    if let Ok(dir) = crash::crash_dir() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if name.starts_with("crash-") && name.ends_with(".log") {
                    add_file(zip, &path, &format!("crashes/{name}"), options)?;
                }
            }
        }
    }

    Ok(())
}

fn add_text(
    zip: &mut ZipWriter<File>,
    name: &str,
    content: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(content.as_bytes())
        .map_err(|error| error.to_string())
}

fn add_file(
    zip: &mut ZipWriter<File>,
    path: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&bytes).map_err(|error| error.to_string())
}
