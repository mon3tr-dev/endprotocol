use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri_plugin_updater::{Updater, UpdaterExt};

use crate::utils::capture;

static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEndpointInfo {
    version: String,
    date: Option<String>,
    body: Option<String>,
}

fn updater_for_endpoint(app: &tauri::AppHandle, endpoint: &str) -> Result<Updater, String> {
    const MIRROR_STABLE: &str = "https://updates.msk-network.cn/stable/latest.json";
    const MIRROR_PREVIEW: &str = "https://updates.msk-network.cn/preview/latest.json";
    const GITHUB_LATEST: &str =
        "https://github.com/soldiereleven/endprotocol/releases/latest/download/latest.json";
    const GITHUB_RELEASE_PREFIX: &str =
        "https://github.com/soldiereleven/endprotocol/releases/download/";

    let is_github_release = endpoint
        .strip_prefix(GITHUB_RELEASE_PREFIX)
        .and_then(|release| release.strip_suffix("/latest.json"))
        .and_then(|tag| tag.strip_prefix('v'))
        .is_some_and(|version| {
            version.starts_with(|c: char| c.is_ascii_digit())
                && version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
        });

    if endpoint != MIRROR_STABLE
        && endpoint != MIRROR_PREVIEW
        && endpoint != GITHUB_LATEST
        && !is_github_release
    {
        return Err("Unsupported updater endpoint".to_string());
    }

    let endpoint = endpoint
        .parse()
        .map_err(|error| format!("Invalid updater endpoint: {error}"))?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("Invalid updater endpoint: {error}"))?
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_update_endpoint(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<Option<UpdateEndpointInfo>, String> {
    let updater = updater_for_endpoint(&app, &endpoint)?;
    let update = updater.check().await.map_err(|error| error.to_string())?;

    Ok(update.map(|update| UpdateEndpointInfo {
        version: update.version.to_string(),
        date: update.date.map(|date| date.to_string()),
        body: update.body,
    }))
}

#[tauri::command]
pub async fn install_update_endpoint(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<(), String> {
    let updater = updater_for_endpoint(&app, &endpoint)?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No compatible update is available".to_string())?;

    let mut downloaded = 0_u64;
    update
        .download_and_install(
            |chunk_length, content_length| {
                downloaded += chunk_length as u64;
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": content_length.unwrap_or(0),
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())
}

/// Write binary data to a file at the specified path.
#[tauri::command]
pub fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
    }
    fs::write(&file_path, data).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

/// Get the system temporary directory path
#[tauri::command]
pub fn get_temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().into_owned())
}

/// Fetch a URL and return the response body as a string.
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = capture::send(&client, client.get(&url))
        .await
        .map_err(|e| format!("Failed to fetch '{}': {}", url, e))?;

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response from '{}': {}", url, e))
}

/// Signal cancellation for the current download. The next progress check in
/// the download loop will break out.
#[tauri::command]
pub fn cancel_download() {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
}

/// Reset the cancellation flag (call before starting a new download).
#[tauri::command]
pub fn reset_download_cancel() {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
}

/// Download a file from a URL to a local path, emitting progress events.
/// Supports cancellation via the cancel_download command.
/// Returns the total bytes written, or an error if cancelled or failed.
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    path: String,
) -> Result<u64, String> {
    // Reset cancellation flag at start
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let client = reqwest::Client::new();
    let resp = capture::send_stream(&client, client.get(&url))
        .await
        .map_err(|e| format!("Failed to start download from '{}': {}", url, e))?;

    let total = resp.content_length().unwrap_or(0);

    let file_path = PathBuf::from(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
    }

    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create file '{}': {}", path, e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = stream.next().await {
        // Check cancellation flag
        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
            // Clean up partial file
            drop(file);
            let _ = fs::remove_file(&file_path);
            return Err("Download cancelled".into());
        }

        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write to file: {}", e))?;
        downloaded += chunk.len() as u64;

        // Emit progress every ~256KB
        if downloaded - last_emit >= 256 * 1024 || downloaded == total {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
            last_emit = downloaded;
        }
    }

    file.flush()
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    Ok(downloaded)
}

/// Spawn an installer file silently (NSIS /S flag) and exit the app.
/// The installer will replace files and restart the app.
#[cfg(windows)]
#[tauri::command]
pub async fn run_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    std::process::Command::new(&path)
        .args(["/S"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to run installer '{}': {}", path, e))?;

    // Give the installer a moment to start, then exit the app so it can replace files.
    // The installer will restart the app after installation.
    std::thread::sleep(std::time::Duration::from_secs(2));
    app.exit(0);
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn run_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _ = (app, path);
    Err("Running downloaded installers is only supported on Windows".to_string())
}
