use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri::Manager;
// updater æ’ä»¶åªåœ¨æ¡Œé¢ç›®æ ‡ç¼–è¯‘ï¼ˆè§ Cargo.tomlï¼‰ï¼›ç§»åŠ¨ç«¯ç›¸å…³å‘½ä»¤è¿”å›žæ˜Žç¡®é”™è¯¯ã€‚
#[cfg(desktop)]
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

/// åº”ç”¨è‡ªæ›´æ–°ï¼ˆä»…æ¡Œé¢ï¼‰ï¼šç§»åŠ¨ç«¯åˆ†å‘æ¸ é“ä¸èµ° updater æ’ä»¶ã€‚
#[cfg(desktop)]
fn updater_for_endpoint(app: &tauri::AppHandle, endpoint: &str) -> Result<Updater, String> {
    const MIRROR_STABLE: &str = "https://updates.msk-network.cn/stable/latest.json";
    const MIRROR_PREVIEW: &str = "https://updates.msk-network.cn/preview/latest.json";
    const GITHUB_LATEST: &str =
        "https://github.com/mon3tr-dev/endprotocol/releases/latest/download/latest.json";
    const GITHUB_RELEASE_PREFIX: &str =
        "https://github.com/mon3tr-dev/endprotocol/releases/download/";

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

/// æ£€æŸ¥æŒ‡å®šæ›´æ–°æºæ˜¯å¦æœ‰æ–°ç‰ˆæœ¬ï¼ˆä»…æ¡Œé¢ï¼‰ã€‚
#[cfg(desktop)]
#[tauri::command]
pub async fn check_update_endpoint(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<Option<UpdateEndpointInfo>, String> {
    let updater = updater_for_endpoint(&app, &endpoint)?;
    let update = updater.check().await.map_err(|error| error.to_string())?;

    Ok(update.map(|update| UpdateEndpointInfo {
        version: update.version.to_string(),
        // `OffsetDateTime::to_string()` äº§å‡º "2026-11-01 10:09:39.585 +00:00:00"ï¼ˆç©ºæ ¼åˆ†éš”ã€
        // å…¨é‡åç§»ï¼‰ï¼ŒJS çš„ `new Date()` è§£æžä¸äº†ï¼Œå‰ç«¯ä¼šæ˜¾ç¤º Invalid Dateã€‚
        // åºåˆ—åŒ–ä¸º RFC 3339ï¼ˆ"...T...Z"ï¼‰ï¼Œä¸Ž latest.json çš„ pub_date æ ¼å¼ä¸€è‡´ã€‚
        date: update.date.map(|date| {
            date.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| date.to_string())
        }),
        body: update.body,
    }))
}

/// ä¸‹è½½å¹¶å®‰è£…æŒ‡å®šæ›´æ–°æºçš„æ›´æ–°åŒ…ï¼ˆä»…æ¡Œé¢ï¼‰ã€‚
#[cfg(desktop)]
#[tauri::command]
pub async fn install_update_endpoint(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<(), String> {
    // Reset cancellation flag at start so a previously cancelled download
    // does not block a new one.
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let updater = updater_for_endpoint(&app, &endpoint)?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No compatible update is available".to_string())?;

    // Stream the update package to a temp file so we can honour user
    // cancellation mid-download. The file is removed on cancel or failure.
    let download_url = update.download_url.clone();
    let version = update.version.clone();

    let client = crate::utils::http_client::default_client();
    let resp = capture::send_stream(&client, client.get(download_url.clone()))
        .await
        .map_err(|e| format!("Failed to start download from '{}': {}", download_url, e))?;

    let total = resp.content_length().unwrap_or(0);
    let temp_path = std::env::temp_dir().join(format!("endprotocol-update-{version}"));

    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file '{}': {}", temp_path.display(), e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = stream.next().await {
        // Honour cancellation requested via the `cancel_download` command.
        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
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
    drop(file);

    let bytes = fs::read(&temp_path)
        .map_err(|e| format!("Failed to read downloaded update: {}", e))?;
    let _ = fs::remove_file(&temp_path);

    update
        .install(bytes)
        .map_err(|error| error.to_string())
}

/// ç§»åŠ¨ç«¯ stubï¼šè‡ªæ›´æ–°ä¸å¯ç”¨ï¼Œè¿”å›žæ˜Žç¡®é”™è¯¯ï¼ˆå‰ç«¯åœ¨ç§»åŠ¨ç«¯ä¸ä¼šå±•ç¤ºæ›´æ–°å…¥å£ï¼‰ã€‚
#[cfg(not(desktop))]
#[tauri::command]
pub async fn check_update_endpoint(
    _app: tauri::AppHandle,
    _endpoint: String,
) -> Result<Option<UpdateEndpointInfo>, String> {
    Err("Application updates are not available on this platform".to_string())
}

/// ç§»åŠ¨ç«¯ stubï¼šè‡ªæ›´æ–°ä¸å¯ç”¨ï¼Œè¿”å›žæ˜Žç¡®é”™è¯¯ã€‚
#[cfg(not(desktop))]
#[tauri::command]
pub async fn install_update_endpoint(
    _app: tauri::AppHandle,
    _endpoint: String,
) -> Result<(), String> {
    Err("Application updates are not available on this platform".to_string())
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
    let client = crate::utils::http_client::default_client();
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

    let client = crate::utils::http_client::default_client();
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

/// Download a GitHub Release APK into app-private cache for Android's package installer.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_android_apk(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let parsed_url = reqwest::Url::parse(&url)
        .map_err(|error| format!("Invalid APK download URL: {error}"))?;
    if parsed_url.scheme() != "https"
        || parsed_url.host_str() != Some("github.com")
        || !parsed_url
            .path()
            .starts_with("/mon3tr-dev/endprotocol/releases/download/")
        || !parsed_url.path().to_ascii_lowercase().ends_with(".apk")
    {
        return Err("Unsupported APK download URL".to_string());
    }

    let update_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve app cache directory: {error}"))?
        .join("updates");
    fs::create_dir_all(&update_dir)
        .map_err(|error| format!("Failed to create APK cache directory: {error}"))?;

    let partial_path = update_dir.join("endprotocol-update.apk.part");
    let apk_path = update_dir.join("endprotocol-update.apk");
    let _ = fs::remove_file(&partial_path);

    let client = crate::utils::http_client::default_client();
    let response = capture::send_stream(&client, client.get(&url))
        .await
        .map_err(|error| format!("Failed to start APK download: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("APK download failed with HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let download_result: Result<u64, String> = async {
        let mut file = fs::File::create(&partial_path)
            .map_err(|error| format!("Failed to create APK file: {error}"))?;
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        let mut downloaded = 0u64;
        let mut last_emit = 0u64;

        while let Some(chunk) = stream.next().await {
            if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                return Err("Download cancelled".to_string());
            }

            let chunk = chunk.map_err(|error| format!("APK download stream error: {error}"))?;
            file.write_all(&chunk)
                .map_err(|error| format!("Failed to write APK: {error}"))?;
            downloaded += chunk.len() as u64;

            if downloaded - last_emit >= 256 * 1024 {
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
                last_emit = downloaded;
            }
        }

        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
            return Err("Download cancelled".to_string());
        }
        if downloaded == 0 {
            return Err("The downloaded APK is empty".to_string());
        }

        file.flush()
            .map_err(|error| format!("Failed to flush APK file: {error}"))?;
        drop(file);
        let _ = app.emit(
            "download-progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
        Ok(downloaded)
    }
    .await;

    if let Err(error) = download_result {
        let _ = fs::remove_file(&partial_path);
        return Err(error);
    }

    let _ = fs::remove_file(&apk_path);
    if let Err(error) = fs::rename(&partial_path, &apk_path) {
        let _ = fs::remove_file(&partial_path);
        return Err(format!("Failed to finalize APK download: {error}"));
    }

    Ok(apk_path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_android_apk(
    _app: tauri::AppHandle,
    _url: String,
) -> Result<String, String> {
    Err("APK updates are only available on Android".to_string())
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
