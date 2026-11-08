#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::Emitter;

use crate::models::game::*;
use crate::services::config_service::ConfigService;
use crate::services::game_launcher_service::GameLauncherService;
use crate::utils::game_playtime::GamePlaytime;
use crate::utils::official_launcher::{LaunchError, LaunchToken};

/// å¯ç”¨ DX11 æ—¶é™„åŠ ç»™æ¸¸æˆçš„å‘½ä»¤è¡Œå‚æ•°ã€‚
const DX11_GAME_ARG: &str = "-force-d3d11";
const DX11_CONFIG_KEY: &str = "launcher_dx11";

/// Steam å¯åŠ¨æ¸¸æˆæ—¶å†™å…¥çš„çŽ¯å¢ƒå˜é‡ï¼ˆéž Steam å¿«æ·æ–¹å¼åŒæ ·é€‚ç”¨ï¼‰ã€‚
/// ä»»ä¸€é¡¹å­˜åœ¨å³å¯è®¤ä¸ºå½“å‰è¿›ç¨‹ç”± Steam æ‹‰èµ·ã€‚
#[cfg(target_os = "windows")]
const STEAM_LAUNCH_MARKERS: [&str; 4] =
    ["SteamClientLaunch", "SteamAppId", "SteamGameId", "SteamOverlayGameId"];

#[cfg(target_os = "windows")]
fn launched_by_steam() -> bool {
    STEAM_LAUNCH_MARKERS
        .iter()
        .any(|name| std::env::var_os(name).is_some())
}

/// é•¿ä»»åŠ¡å†™é—¸ï¼šå®‰è£…/æ›´æ–°ã€æ ¡éªŒä¿®å¤ã€é¢„ä¸‹è½½ã€åˆ‡æœæ‰§è¡Œå‰éƒ½è¦å…ˆæ‹¿åˆ°å®ƒã€‚
///
/// å¯åŠ¨å™¨æœåŠ¡ä¸å†è¢«ä¸€æŠŠå¤–å±‚ `Mutex<GameLauncherService>` é”ä½â€”â€”é‚£æŠŠé”ä¼šè®©ä¸€æ¬¡
/// å‡ ååˆ†é’Ÿçš„ä¸‹è½½æŠŠå…¬å‘Šã€èƒŒæ™¯å›¾ã€çŠ¶æ€æŸ¥è¯¢å…¨éƒ¨å µæ­»ï¼ˆå‰ç«¯åˆ·æ–°åŽå¯åŠ¨æµç¨‹æ­£å¥½è¦å–
/// å…¬å‘Šå’ŒèƒŒæ™¯å›¾ï¼ŒäºŽæ˜¯å¡åœ¨ã€Œæ­£åœ¨åŠ è½½åˆå§‹æ•°æ®â€¦ã€ï¼‰ã€‚è¿™é‡Œç”¨å®¹é‡ 1 çš„ä¿¡å·é‡ï¼Œåªä¿è¯
/// ã€Œä¼šå†™å®‰è£…ç›®å½•ã€çš„ä»»åŠ¡å½¼æ­¤ä¸å¹¶å‘ï¼Œpermit éšå‡½æ•°ç»“æŸè‡ªåŠ¨é‡Šæ”¾ã€‚
async fn acquire_write_gate(
    svc: &Arc<GameLauncherService>,
) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    svc.write_gate()
        .acquire_owned()
        .await
        .map_err(|e| format!("launcher write gate unavailable: {e}"))
}

/// å†™ç›®å½•ä»»åŠ¡å¼€è·‘å‰çš„**å ç”¨æ£€æµ‹ + æŒæœ‰é”**ï¼ˆåŒæ­¥å®žçŽ°ï¼Œè°ƒç”¨æ–¹åŒ…åœ¨ spawn_blocking é‡Œï¼‰ã€‚
///
/// 1. ç”¨ Restart Manager æ£€æµ‹å…³é”®æ–‡ä»¶ï¼ˆexe + æ ¸å¿ƒè¿è¡Œæ—¶ï¼‰å½“å‰è¢«è°é”ç€â€”â€”è¢«å ç”¨æ—¶
///    è¿”å›žå¸¦ `LOCKED_BY:` å‰ç¼€çš„é”™è¯¯ï¼Œå†…å®¹æ˜¯ã€Œè¿›ç¨‹å (PID n)|è¿›ç¨‹å (PID n)â€¦ã€ï¼Œ
///    å‰ç«¯è§£æžåŽç”¨ message å±•ç¤ºç»™ç”¨æˆ·ã€‚
/// 2. æ²¡è¢«å ç”¨å°±**æˆ‘ä»¬å…ˆç‹¬å æ‰“å¼€**è¿™äº›æ–‡ä»¶å¹¶æŒæœ‰åˆ°ä»»åŠ¡ç»“æŸï¼šä»»åŠ¡è¿›è¡Œä¸­ä»»ä½•åŽæ¥è€…
///    ï¼ˆç”¨æˆ·åˆç‚¹å¼€æ¸¸æˆã€æ€è½¯é‡æ‰«æï¼‰éƒ½æ‰“ä¸å¼€å…³é”®æ–‡ä»¶ï¼Œä¸ä¼šå†äº§ç”Ÿæ–°å ç”¨ã€‚
async fn check_and_lock_install_dir(
    install_path: String,
    ch: GameChannel,
) -> Result<crate::utils::dir_lock::DirLock, String> {
    // RM æŸ¥è¯¢ä¸Žç‹¬å æ‰“å¼€éƒ½æ˜¯åŽŸç”Ÿè°ƒç”¨ï¼Œæ”¾é˜»å¡žçº¿ç¨‹é¿å…å ä½ tokio å·¥ä½œçº¿ç¨‹ï¼›
    // è¿”å›žçš„ DirLock å·²åšæˆ Sendï¼ˆowned HANDLE æ— çº¿ç¨‹äº²å’Œæ€§ï¼‰ï¼Œå¯å®‰å…¨ç§»å‡ºã€‚
    tokio::task::spawn_blocking(move || check_and_lock_install_dir_sync(&install_path, &ch))
        .await
        .map_err(|e| format!("dir lock task join failed: {e}"))?
}

fn check_and_lock_install_dir_sync(
    install_path: &str,
    ch: &GameChannel,
) -> Result<crate::utils::dir_lock::DirLock, String> {
    use crate::utils::dir_lock::{acquire_lock, check_files, sample_critical_files};

    let files = sample_critical_files(
        install_path,
        ch.executable_name(),
        ch.data_dir_name(),
    );
    if files.is_empty() {
        // ç›®å½•è¿˜æ²¡æœ‰å¯æ‰§è¡Œæ–‡ä»¶ï¼ˆé¦–æ¬¡å®‰è£…ï¼‰æ— ä»Žå ç”¨ï¼Œç›´æŽ¥æ”¾è¡Œ
        return Ok(crate::utils::dir_lock::DirLock::acquire_empty());
    }

    let files_ref: Vec<&std::path::Path> =
        files.iter().map(|p| p.as_path()).collect();
    let occupancy = check_files(&files_ref);
    if occupancy.locked {
        let listed = occupancy
            .processes
            .iter()
            .map(|p| format!("{} (PID {})", p.name, p.pid))
            .collect::<Vec<_>>()
            .join(", ");
        tracing::warn!("[dirlock] install dir {install_path} is locked by: {listed}");
        // æœºå™¨å¯è¯»æ ¼å¼ï¼ˆå‰ç«¯è§£æžå±•ç¤ºï¼‰ï¼šLOCKED_BY:è¿›ç¨‹å (PID n)|è¿›ç¨‹å (PID n)â€¦
        return Err(format!(
            "LOCKED_BY:{}",
            occupancy
                .processes
                .iter()
                .map(|p| format!("{} (PID {})", p.name, p.pid))
                .collect::<Vec<_>>()
                .join("|")
        ));
    }

    acquire_lock(&files_ref)
}

/// Return the process-level bytes read counter used by Task Manager's disk rate.
#[tauri::command]
pub fn launcher_get_process_read_bytes() -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        let mut counters = std::mem::zeroed::<windows_sys::Win32::System::Threading::IO_COUNTERS>();
        let process = windows_sys::Win32::System::Threading::GetCurrentProcess();
        if windows_sys::Win32::System::Threading::GetProcessIoCounters(process, &mut counters) == 0
        {
            return Err("Failed to read process I/O counters".to_string());
        }
        return Ok(counters.ReadTransferCount);
    }

    #[cfg(not(target_os = "windows"))]
    Ok(0)
}

/// èŽ·å–æ¸¸æˆå®‰è£…çŠ¶æ€
#[tauri::command]
pub async fn launcher_check_status(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
) -> Result<GameStatus, String> {
    tracing::info!(
        "[cmd] launcher_check_status: channel={}, path={}",
        channel,
        install_path
    );
    let ch = parse_channel(&channel)?;
    tracing::info!("[cmd] check_status acquiring lock...");
    let svc = service.inner();
    tracing::info!("[cmd] check_status lock acquired, calling check_status...");
    let result = svc.check_status(&ch, &install_path).await;
    tracing::info!("[cmd] check_status returned: {:?}", result.is_ok());
    result
}

/// å®‰è£…æˆ–æ›´æ–°æ¸¸æˆ
#[tauri::command]
pub async fn launcher_install_or_update(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    tracing::info!(
        "[cmd] launcher_install_or_update: channel={}, install_path={}",
        channel,
        install_path
    );
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    let _write = acquire_write_gate(svc).await?;
    // å†™å®‰è£…ç›®å½•å‰ï¼šæ£€æµ‹å ç”¨ï¼ˆè¢«é”åˆ™æŠ¥å‡ºå ç”¨è¿›ç¨‹ï¼‰å¹¶æŒæœ‰ç›®å½•é”åˆ°ä»»åŠ¡ç»“æŸ
    let _dir_lock = check_and_lock_install_dir(install_path.clone(), ch.clone()).await?;

    let app_handle = app.clone();
    let progress_cb = Arc::new(move |progress: DownloadProgress| {
        tracing::debug!(
            "[progress] stage={}, downloaded={}, total={}, file={:?}, {}/{}",
            progress.stage,
            progress.downloaded,
            progress.total,
            progress.current_file,
            progress.file_index,
            progress.file_count
        );
        let _ = app_handle.emit("launcher-progress", &progress);
    });

    match svc
        .install_or_update(
            &ch,
            &install_path,
            progress_cb,
            max_concurrent.unwrap_or(8),
            resume.unwrap_or(true),
        )
        .await
    {
        Ok(version) => {
            tracing::info!("[cmd] Install OK: version={}", version);
            Ok(LauncherResult {
                success: true,
                message: format!("Update to {} completed", version),
                version: Some(version),
                warning: None,
            })
        }
        Err(e) => {
            tracing::error!("[cmd] Install FAILED: {}", e);
            Ok(LauncherResult {
                success: false,
                message: e,
                version: None,
                warning: None,
            })
        }
    }
}

/// éªŒè¯æ¸¸æˆæ–‡ä»¶å®Œæ•´æ€§å¹¶ä¿®å¤
#[tauri::command]
pub async fn launcher_verify_and_repair(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    quick: Option<bool>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    let _write = acquire_write_gate(svc).await?;
    // å†™å®‰è£…ç›®å½•å‰ï¼šæ£€æµ‹å ç”¨ï¼ˆè¢«é”åˆ™æŠ¥å‡ºå ç”¨è¿›ç¨‹ï¼‰å¹¶æŒæœ‰ç›®å½•é”åˆ°ä»»åŠ¡ç»“æŸ
    let _dir_lock = check_and_lock_install_dir(install_path.clone(), ch.clone()).await?;

    tracing::info!(
        "[launcher] verify_and_repair called: channel={:?}, max_concurrent={:?}, quick={:?}, install_path={}",
        ch, max_concurrent, quick, install_path
    );

    let app_handle = app.clone();
    let progress_cb = Arc::new(move |progress: DownloadProgress| {
        let _ = app_handle.emit("launcher-progress", &progress);
    });

    match svc
        .verify_and_repair(
            &ch,
            &install_path,
            progress_cb,
            max_concurrent.unwrap_or(12),
            quick.unwrap_or(false),
            resume.unwrap_or(true),
        )
        .await
    {
        Ok(msg) => Ok(LauncherResult {
            success: true,
            message: msg,
            version: None,
            warning: None,
        }),
        Err(e) => {
            let _ = app.emit(
                "launcher-progress",
                &DownloadProgress {
                    stage: InstallStage::Error.as_str().to_string(),
                    ..Default::default()
                },
            );
            Ok(LauncherResult {
                success: false,
                message: e,
                version: None,
                warning: None,
            })
        }
    }
}

/// èŽ·å–è¿œç¨‹ç‰ˆæœ¬ä¿¡æ¯
#[tauri::command]
pub async fn launcher_get_remote_version(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<RemotePackage, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.get_latest_package(&ch, None).await
}

/// é¢„ä¸‹è½½æ¸¸æˆæ›´æ–°èµ„æº
#[tauri::command]
pub async fn launcher_preload_download(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    let _write = acquire_write_gate(svc).await?;
    // é¢„ä¸‹è½½åªå†™ç‹¬ç«‹æš‚å­˜ç›®å½•ï¼ˆ.staging.preload.*ï¼‰ï¼Œä¸è¦†ç›–ä»»ä½•æ¸¸æˆæ–‡ä»¶ï¼Œ
    // å› æ­¤ä¸åšå ç”¨æ£€æµ‹ã€ä¸ä¸Šç›®å½•é”â€”â€”æ¸¸æˆç…§å¸¸å¯çŽ©ï¼Œä¸‹è½½ç…§å¸¸è¿›è¡Œã€‚

    let app_handle = app.clone();
    let progress_cb = Arc::new(move |progress: DownloadProgress| {
        let _ = app_handle.emit("launcher-progress", &progress);
    });

    match svc
        .preload_download(
            &ch,
            &install_path,
            progress_cb,
            max_concurrent.unwrap_or(8),
            resume.unwrap_or(true),
            None,
        )
        .await
    {
        Ok(msg) => Ok(LauncherResult {
            success: true,
            message: msg,
            version: None,
            warning: None,
        }),
        Err(e) => Ok(LauncherResult {
            success: false,
            message: e,
            version: None,
            warning: None,
        }),
    }
}

/// å®‰è£…å¯è§£å¯†çš„å®˜æ–¹é¢„ä¸‹è½½è¡¥ä¸
#[tauri::command]
pub async fn launcher_install_preload(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    let _write = acquire_write_gate(svc).await?;
    // å®‰è£…é¢„ä¸‹è½½ä¼šè¦†ç›–æ¸¸æˆæ–‡ä»¶ï¼šä¸Žå®‰è£…/æ ¡éªŒåŒä¸€å¥—å ç”¨æ£€æµ‹ + ç›®å½•é”
    let _dir_lock = check_and_lock_install_dir(install_path.clone(), ch.clone()).await?;

    let app_handle = app.clone();
    let progress_cb = Arc::new(move |progress: DownloadProgress| {
        let _ = app_handle.emit("launcher-progress", &progress);
    });

    match svc
        .install_preload(
            &ch,
            &install_path,
            progress_cb,
            max_concurrent.unwrap_or(8),
            resume.unwrap_or(true),
        )
        .await
    {
        Ok(version) => Ok(LauncherResult {
            success: true,
            message: format!("Preload installed: {}", version),
            version: Some(version),
            warning: None,
        }),
        Err(error) => Ok(LauncherResult {
            success: false,
            message: error,
            version: None,
            warning: None,
        }),
    }
}

/// èŽ·å– payload çŠ¶æ€ï¼ˆä¸Šæ¬¡å®‰è£…/æ›´æ–°çš„ç‰ˆæœ¬ä¿¡æ¯ï¼‰
#[tauri::command]
pub async fn launcher_get_payload_state(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<Option<PayloadState>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    Ok(svc.get_payload_state(&ch).await)
}

/// å–æ¶ˆæ­£åœ¨è¿›è¡Œçš„ä¸‹è½½å¹¶æ¸…ç†ç¼“å­˜æ–‡ä»¶
#[tauri::command]
pub async fn launcher_cancel_download(install_path: Option<String>) -> Result<(), String> {
    // å…ˆè®°å½•æ¸…ç†æ„å›¾å†å–æ¶ˆï¼Œé¿å…åŽå°ä»»åŠ¡å…ˆé€€å‡ºå¯¼è‡´ç¼“å­˜è¢«ä¿ç•™
    if let Some(path) = install_path.as_deref() {
        if !path.is_empty() {
            crate::services::game_launcher_service::request_cancel_cleanup();
        }
    }
    crate::services::game_launcher_service::cancel_download();
    if let Some(path) = install_path {
        if !path.is_empty() {
            tracing::info!("[cmd] cancel_download: cleaning staging files for {}", path);
            crate::services::game_launcher_service::cleanup_staging_files(&path);
        }
    }
    Ok(())
}

/// æ£€æŸ¥æ˜¯å¦å­˜åœ¨ä¸‹è½½ç¼“å­˜ï¼ˆæš‚å­˜ç›®å½•æˆ– .download æ–‡ä»¶ï¼‰
#[tauri::command]
pub async fn launcher_has_download_cache(install_path: String) -> Result<bool, String> {
    Ok(crate::services::game_launcher_service::has_download_cache(
        &install_path,
    ))
}

/// é‡ç½®ä¸‹è½½å–æ¶ˆæ ‡å¿—
#[tauri::command]
pub async fn launcher_reset_download_cancel() -> Result<(), String> {
    crate::services::game_launcher_service::reset_download_cancel();
    Ok(())
}

#[tauri::command]
pub async fn launcher_cancel_switch() -> Result<(), String> {
    crate::services::game_launcher_service::cancel_switch();
    Ok(())
}

#[tauri::command]
pub async fn launcher_cancel_all() -> Result<(), String> {
    crate::services::game_launcher_service::cancel_download();
    crate::services::game_launcher_service::cancel_switch();
    Ok(())
}

#[tauri::command]
pub async fn launcher_decrypt_file(file_path: String) -> Result<String, String> {
    crate::utils::hg_crypto::decrypt_file_to_string(&file_path)
}

/// èŽ·å– Banner åˆ—è¡¨
#[tauri::command]
pub async fn launcher_get_banners(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<Vec<BannerItem>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.get_banners(&ch).await
}

/// èŽ·å–å…¬å‘Šåˆ—è¡¨
#[tauri::command]
pub async fn launcher_get_announcements(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<Vec<AnnouncementItem>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.get_announcements(&ch).await
}

/// èŽ·å–å¯åŠ¨å™¨å…¬å‘Šå†…å®¹ï¼ˆBanner + å…¬å‘Š + å³ä¾§æ åˆå¹¶ï¼‰
#[tauri::command]
pub async fn launcher_get_notice_content(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<LauncherNoticeContent, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.get_notice_content(&ch).await
}

/// èŽ·å–å¯åŠ¨å™¨èƒŒæ™¯åª’ä½“ URL
#[tauri::command]
pub async fn launcher_get_background_image(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
) -> Result<Option<BackgroundMedia>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.get_background_image(&ch).await
}

/// ç»„è£…ç»™å‰ç«¯çš„å¤±è´¥æ¶ˆæ¯ï¼š`<token>: <detail>`ï¼ˆè§ utils/official_launcher.rs çš„å¥‘çº¦ï¼‰ã€‚
fn launch_message(token: LaunchToken, detail: impl Into<String>) -> String {
    LaunchError::new(token, detail).message()
}

/// åŒä¸€æ—¶åˆ»åªå…è®¸ä¸€æ¬¡å¯åŠ¨ï¼šé¿å…é‡å¤ç‚¹å‡»å¼¹å‡ºä¸¤æ¬¡ UACã€ç•™ä¸‹ä¸¤å¥—æŒ‚èµ·çš„å®˜æ–¹çˆ¶è¿›ç¨‹ã€‚
#[cfg(target_os = "windows")]
static LAUNCH_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// ç›´æŽ¥å¯åŠ¨æ¸¸æˆï¼ˆæ—§è¡Œä¸ºï¼‰ï¼šäº¤ç»™ shellï¼Œé  exe è‡ªèº«çš„ manifest è‡ªåŠ¨ææƒã€‚
/// åªåœ¨æ‰¾ä¸åˆ°ç­¾åæœ‰æ•ˆçš„å®˜æ–¹å¯åŠ¨å™¨æ—¶ä½œä¸ºå›žé€€ä½¿ç”¨ã€‚
#[cfg(target_os = "windows")]
fn direct_launch(
    exe_path: &std::path::Path,
    arguments: &[String],
) -> Result<LauncherResult, String> {
    let exe_name = exe_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match crate::utils::official_launcher::shell_execute_game(exe_path, arguments) {
        Ok(()) => Ok(LauncherResult {
            success: true,
            message: format!("{exe_name} launched"),
            version: None,
            warning: None,
        }),
        Err(detail) => Ok(LauncherResult {
            success: false,
            message: launch_message(LaunchToken::Create, detail),
            version: None,
            warning: None,
        }),
    }
}

/// å¯åŠ¨æ¸¸æˆã€‚
///
/// æ¸¸æˆä¼šæ ¡éªŒè‡ªå·±çš„**ç›´æŽ¥çˆ¶è¿›ç¨‹**å¿…é¡»æ˜¯ç­¾åæœ‰æ•ˆçš„å®˜æ–¹ `Games.exe`ï¼Œå› æ­¤è¿™é‡Œä¼˜å…ˆèµ°
/// ã€Œå®˜æ–¹å¯åŠ¨å™¨çˆ¶è¿›ç¨‹ä¼ªé€ ã€ï¼ˆè§ `utils/official_launcher.rs`ï¼‰ï¼šä»¥ææƒ helper åˆ›å»ºä¸€ä¸ª
/// æŒ‚èµ·ä¸”æ°¸ä¸è¿è¡Œçš„å®˜æ–¹å¯åŠ¨å™¨ï¼Œå†æŠŠå®ƒæŒ‡å®šä¸ºæ¸¸æˆçš„çˆ¶è¿›ç¨‹ã€‚æ‰¾ä¸åˆ°ç­¾åæœ‰æ•ˆçš„å®˜æ–¹å¯åŠ¨å™¨æ—¶
/// å›žé€€åˆ°ç›´æŽ¥å¯åŠ¨ï¼ˆæ—§è¡Œä¸ºï¼‰ï¼Œå¹¶é€šè¿‡ `warning` è®©ç•Œé¢æç¤ºåŽŸå› ã€‚
///
/// `dx11` ä¸º `None` æ—¶è¯»å–é…ç½®é”® `launcher_dx11`ï¼ˆé»˜è®¤ falseï¼‰ï¼›ä¸º true æ—¶ç»™æ¸¸æˆé™„åŠ 
/// `-force-d3d11`ã€‚é™é»˜å¯åŠ¨çš„ `--dx11` å‚æ•°åœ¨ `lib.rs` ä¸­è§£æžåŽé€šè¿‡å†…éƒ¨ `launch_game` ä¼ å…¥ã€‚
#[tauri::command]
pub async fn launcher_start_game(
    config_service: tauri::State<'_, Arc<StdMutex<ConfigService>>>,
    install_path: String,
    channel: String,
    dx11: Option<bool>,
) -> Result<LauncherResult, String> {
    let dx11 = dx11.unwrap_or_else(|| {
        config_service
            .lock()
            .map(|config| config.get::<bool>(DX11_CONFIG_KEY).unwrap_or(false))
            .unwrap_or(false)
    });
    launch_game(install_path, channel, dx11).await
}

/// `launcher_start_game` çš„å®žé™…å®žçŽ°ï¼›é™é»˜æ¨¡å¼æ²¡æœ‰ Tauri Stateï¼Œç›´æŽ¥è°ƒç”¨æœ¬å‡½æ•°ã€‚
pub(crate) async fn launch_game(
    install_path: String,
    channel: String,
    dx11: bool,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let exe_name = ch.executable_name();
    let exe_path = std::path::Path::new(&install_path).join(exe_name);
    let game_arguments: Vec<String> = if dx11 {
        vec![DX11_GAME_ARG.to_string()]
    } else {
        Vec::new()
    };

    if !exe_path.exists() {
        return Ok(LauncherResult {
            success: false,
            message: launch_message(
                LaunchToken::NotFound,
                format!("{exe_name} not found in {install_path}"),
            ),
            version: None,
            warning: None,
        });
    }

    // æ˜Žæ—¥æ–¹èˆŸä¸åšçˆ¶è¿›ç¨‹æ ¡éªŒï¼šå®žæµ‹ `Arknights.exe`ï¼ˆåªå¯¼å…¥ `ArknightsBase.dll` ä¸€ä¸ªæ¨¡å—ï¼‰ã€
    // `ArknightsBase.dll`ã€`GameAssembly.dll` é‡Œéƒ½ä¸å­˜åœ¨ `Games.exe` / `WinVerifyTrust`
    // ç›¸å…³å­—ç¬¦ä¸²ï¼Œç›´æŽ¥å¯åŠ¨å³å¯ã€‚ç»ˆæœ«åœ°ä¼šæ ¡éªŒè‡ªå·±çš„ç›´æŽ¥çˆ¶è¿›ç¨‹å¿…é¡»æ˜¯ç­¾åæœ‰æ•ˆçš„å®˜æ–¹å¯åŠ¨å™¨ï¼Œ
    // æ‰€ä»¥åªæœ‰ç»ˆæœ«åœ°éœ€è¦èµ°ã€Œå®˜æ–¹çˆ¶è¿›ç¨‹ä¼ªé€ ã€é‚£æ¡è·¯ã€‚
    //
    // æ³¨æ„ä¸¤ä¸ªæ¸¸æˆçš„ exe manifest éƒ½æ˜¯ `requireAdministrator`ï¼ˆå®žæµ‹ RT_MANIFESTï¼‰ï¼Œ
    // æ‰€ä»¥ `direct_launch` çš„ ShellExecute ä»ä¼šå¼¹ UAC â€”â€” ä¸Žã€Œæ‰¾ä¸åˆ°å®˜æ–¹å¯åŠ¨å™¨æ—¶ç»ˆæœ«åœ°çš„
    // å›žé€€è·¯å¾„ã€å®Œå…¨ä¸€è‡´ã€‚
    if ch.is_arknights() {
        let _ = crate::utils::process::terminate_processes(exe_name);
        tracing::info!("[launcher] {exe_name} launched directly (no parent-process check)");
        return direct_launch(&exe_path, &game_arguments).map(|mut result| {
            // ä¸Žç»ˆæœ«åœ°åˆ†æ”¯åŒä¸€å¥—åˆ¤æ–­ï¼šæ¸¸æˆç» UAC ä»¥ç®¡ç†å‘˜è¿è¡Œã€Steam æœªææƒæ—¶ overlay æ³¨å…¥ä¸è¿›åŽ»
            if result.success
                && launched_by_steam()
                && !crate::utils::official_launcher::process_is_elevated()
            {
                result.warning = Some(
                    LaunchError::new(
                        LaunchToken::OverlayUnavailable,
                        "the game runs elevated while Steam does not; run Steam as administrator for the overlay",
                    )
                    .message(),
                );
            }
            result
        });
    }

    // Kill existing game processes firstï¼ˆåŽŸç”Ÿå¿«ç…§ï¼Œå«å­è¿›ç¨‹æ ‘ï¼›æ— æ®‹ç•™æ—¶ç«‹åˆ»è¿”å›žï¼‰
    let _ = crate::utils::process::terminate_processes(exe_name);

    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;

        if LAUNCH_IN_FLIGHT.swap(true, Ordering::SeqCst) {
            return Ok(LauncherResult {
                success: false,
                message: launch_message(LaunchToken::Unknown, "a launch is already in progress"),
                version: None,
                warning: None,
            });
        }

        let game = exe_path.clone();
        let launch_arguments = game_arguments.clone();
        // çŠ¶æ€æ–‡ä»¶ç”¨äºŽåŒºåˆ†ã€Œhelper åœ¨å¯åŠ¨é˜¶æ®µå°±å¤±è´¥äº†ã€ä¸Žã€Œæ¸¸æˆåˆ›å»ºæˆåŠŸä½†å¾ˆå¿«é€€å‡ºã€ã€‚
        let status_file = crate::utils::paths::app_data_dir()
            .ok()
            .map(|dir| dir.join("launcher_helper_status"));
        // æŸ¥æ‰¾ã€WinVerifyTrust ä¸Žè¿›ç¨‹åˆ›å»ºéƒ½æ˜¯é˜»å¡žè°ƒç”¨ï¼Œä¸å ç”¨ tokio å·¥ä½œçº¿ç¨‹ã€‚
        let attempt = tokio::task::spawn_blocking(move || {
            crate::utils::official_launcher::launch_via_official_parent(
                &game,
                None,
                &launch_arguments,
                status_file.as_deref(),
            )
        })
        .await;
        LAUNCH_IN_FLIGHT.store(false, Ordering::SeqCst);

        match attempt {
            Err(join_error) => Ok(LauncherResult {
                success: false,
                message: launch_message(
                    LaunchToken::Unknown,
                    format!("launch task failed: {join_error}"),
                ),
                version: None,
                warning: None,
            }),
            // æ²¡æœ‰ç­¾åæœ‰æ•ˆçš„å®˜æ–¹å¯åŠ¨å™¨ï¼šå›žé€€åˆ°ç›´æŽ¥å¯åŠ¨ï¼Œå¹¶è®©ç•Œé¢è¯´æ˜Žä¸ºä»€ä¹ˆå¯èƒ½å¤±è´¥ã€‚
            Ok(Err(error)) if error.token == LaunchToken::NoLauncher => {
                tracing::warn!(
                    "[launcher] {} â€” falling back to a direct launch",
                    error.message()
                );
                direct_launch(&exe_path, &game_arguments).map(|mut result| {
                    // ç”¨ `fallback` token è€Œä¸æ˜¯åŽŸé”™è¯¯ï¼šå‰ç«¯æ®æ­¤æ˜¾ç¤ºã€Œå·²ç›´æŽ¥å¯åŠ¨ã€çš„æç¤ºï¼Œ
                    // è€Œä¸æ˜¯æŠŠå®ƒå½“æˆå¯åŠ¨å¤±è´¥ã€‚
                    result.warning = Some(
                        LaunchError::new(LaunchToken::Fallback, error.detail.clone()).message(),
                    );
                    result
                })
            }
            Ok(Err(error)) => {
                tracing::error!("[launcher] {}", error.message());
                Ok(LauncherResult {
                    success: false,
                    message: error.message(),
                    version: None,
                    warning: None,
                })
            }
            Ok(Ok(elevated)) => {
                match elevated.helper_pid {
                    Some(pid) => tracing::info!(
                        "[launcher] game created through the official launcher parent (helper pid {pid})"
                    ),
                    None => tracing::info!(
                        "[launcher] game created through the official launcher parent (in-process)"
                    ),
                }
                // Steam åªèƒ½æŠŠ overlay æ³¨å…¥åˆ°ä¸Žè‡ªå·±åŒæƒé™çº§åˆ«çš„è¿›ç¨‹ã€‚æ¸¸æˆ manifest è¦æ±‚
                // ç®¡ç†å‘˜ï¼›æœ¬è¿›ç¨‹æœªææƒæ—¶åªèƒ½ç» runas helper åˆ›å»ºæ¸¸æˆï¼Œoverlay æ— æ³•è¶Šè¿‡
                // è¿™æ¡å®Œæ•´æ€§çº§åˆ«è¾¹ç•Œã€‚ææƒåŽï¼ˆSteam ä»¥ç®¡ç†å‘˜è¿è¡Œï¼‰æ¸¸æˆç”±æœ¬è¿›ç¨‹ç›´æŽ¥åˆ›å»ºï¼Œ
                // æ³¨å…¥é“¾å¾—ä»¥ä¿ç•™ã€‚
                let warning = (launched_by_steam()
                    && !crate::utils::official_launcher::process_is_elevated())
                .then(|| {
                    LaunchError::new(
                        LaunchToken::OverlayUnavailable,
                        "the game runs elevated while Steam does not; run Steam as administrator for the overlay",
                    )
                    .message()
                });
                Ok(LauncherResult {
                    success: true,
                    message: format!("{exe_name} launched"),
                    version: None,
                    warning,
                })
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut command = std::process::Command::new(&exe_path);
        command.current_dir(&install_path).args(&game_arguments);
        match command.spawn() {
            Ok(_) => Ok(LauncherResult {
                success: true,
                message: format!("{} launched", exe_name),
                version: None,
                warning: None,
            }),
            Err(e) => Ok(LauncherResult {
                success: false,
                message: launch_message(
                    LaunchToken::Unknown,
                    format!("failed to launch {exe_name}: {e}"),
                ),
                version: None,
                warning: None,
            }),
        }
    }
}

/// æµè§ˆæ–‡ä»¶å¤¹
#[tauri::command]
pub fn launcher_browse_folder() -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new().set_title("Select Game Directory");

    Ok(dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string()))
}

/// ç£ç›˜ç©ºé—´ä¿¡æ¯
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiskSpace {
    pub total: u64,
    pub free: u64,
}

/// èŽ·å–æŒ‡å®šè·¯å¾„æ‰€åœ¨ç£ç›˜çš„æ€»ç©ºé—´å’Œå¯ç”¨ç©ºé—´ï¼ˆå­—èŠ‚ï¼‰
#[tauri::command]
pub async fn launcher_get_disk_space(path: String) -> Result<DiskSpace, String> {
    let p = std::path::Path::new(&path);
    let root = if let Some(root) = p.ancestors().find(|a| a.exists()) {
        root.to_path_buf()
    } else {
        p.to_path_buf()
    };

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let root_str = root.to_str().unwrap_or("C:\\");
        let mut command = Command::new("powershell");
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        let output = command
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "$d = Get-PSDrive -Name (Get-Item '{}').PSDrive.Name; \"$($d.Used)|$($d.Free)\"",
                    root_str
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to get disk space: {}", e))?;

        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = s.split('|').collect();
            if parts.len() == 2 {
                let used = parts[0]
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid used value: {}", parts[0]))?;
                let free = parts[1]
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid free value: {}", parts[1]))?;
                Ok(DiskSpace {
                    total: used + free,
                    free,
                })
            } else {
                Err(format!("Unexpected output format: {}", s))
            }
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(DiskSpace {
            total: u64::MAX,
            free: u64::MAX,
        })
    }
}

/// æ‰«æå®‰è£…ç›®å½•ï¼Œæ£€æŸ¥å·²æœ‰æ–‡ä»¶çš„å®Œæ•´æ€§
#[tauri::command]
pub async fn launcher_scan_install_dir(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    channel: String,
    install_path: String,
) -> Result<FileScanResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.inner();
    svc.scan_install_dir(&ch, &install_path).await
}

/// è§£å¯† `config.ini` å¹¶å–å‡º `appcode` ä¸Ž `channel` ä¸¤ä¸ªå­—æ®µã€‚
///
/// `config.ini` æ˜¯å®˜æ–¹å®¢æˆ·ç«¯è‡ªå·±å†™å…¥çš„æ¸ é“æ¡£æ¡ˆï¼ˆå›ºå®š AES-256-CBC åŠ å¯†ï¼Œä¸Ž `game_files`
/// åŒä¸€å¥—å¯†é’¥ï¼‰ï¼Œæ¯”é ç‰¹å¾ DLL çŒœæ¸ é“æ›´æƒå¨ï¼šç»ˆæœ«åœ°å®˜æœä¸Ž B æœã€æ˜Žæ—¥æ–¹èˆŸå®˜æœä¸Ž B æœéƒ½æ˜¯
/// åŒä¸€ä¸ªæ¸¸æˆ exeï¼Œåªæœ‰ `config.ini` é‡Œçš„ `channel` èƒ½åŒºåˆ†ã€‚
fn read_config_profile(install_dir: &std::path::Path) -> Option<(String, String)> {
    let config_path = install_dir.join("config.ini");
    let text =
        crate::utils::hg_crypto::decrypt_file_to_string(&config_path.to_string_lossy()).ok()?;

    let value_of = |key: &str| -> Option<String> {
        text.lines().find_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix(key)?;
            let rest = rest.trim_start();
            let rest = rest.strip_prefix('=')?.trim();
            let value = rest.trim_matches('"').trim();
            (!value.is_empty()).then(|| value.to_string())
        })
    };

    Some((value_of("appcode")?, value_of("channel")?))
}

/// æ ¹æ®ç›®å½•ä¸‹çš„æ–‡ä»¶ç‰¹å¾ä¸Ž `config.ini` æ¡£æ¡ˆè‡ªåŠ¨è¯†åˆ«æ¸¸æˆæ¸ é“
#[tauri::command]
pub async fn launcher_detect_channel(install_path: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&install_path);

    // æ£€æŸ¥åŸºæœ¬æ¸¸æˆæ–‡ä»¶æ˜¯å¦å­˜åœ¨
    let has_endfield = path.join("Endfield.exe").exists() && path.join("Endfield_Data").is_dir();
    let has_arknights =
        path.join("Arknights.exe").exists() && path.join("Arknights_Data").is_dir();
    let has_config = path.join("config.ini").exists();

    if (!has_endfield && !has_arknights) || !has_config {
        // æ¸¸æˆæœªå®‰è£…æˆ–ç›®å½•æ— æ•ˆ
        return Ok(None);
    }

    let profile = read_config_profile(path);

    // æ˜Žæ—¥æ–¹èˆŸï¼šappcode `GzD1CpaWgmSq1wew`ï¼Œæ¸ é“é  channel=1ï¼ˆå®˜æœï¼‰/ channel=2ï¼ˆB æœï¼‰åŒºåˆ†
    if has_arknights {
        let channel = profile.as_ref().map(|(_, channel)| channel.as_str());
        return Ok(Some(
            match channel {
                Some("2") => "arknights_bilibili",
                _ => "arknights",
            }
            .to_string(),
        ));
    }

    // ç»ˆæœ«åœ°ï¼šå…ˆæŒ‰æ¸ é“ç‰¹å¾åº“åˆ¤å®šï¼ˆåŽŸæœ‰é€»è¾‘ï¼‰ï¼Œè¯†åˆ«ä¸å‡ºæ—¶å›žé€€åˆ° config.ini çš„ channel
    let has_hgsdk = path.join("hgsdk.dll").exists();
    let has_pc_sdk = path.join("PCGameSDK.dll").exists();
    let has_gfsdk = path.join("gfsdk.dll").exists();
    let has_gl_foundation = path.join("glfoundation.dll").exists();
    let has_gl_extra = path.join("glextra.dll").exists();
    let has_play_pc_sdk = path.join("play_pc_sdk.dll").exists();
    let has_manifest_xml = path.join("manifest.xml").exists();

    // æ¸ é“è¯†åˆ«é€»è¾‘ï¼š
    // Google Play: glextra.dll + play_pc_sdk.dll + manifest.xml
    // Global: gfsdk.dll + glfoundation.dll (æ—  PCGameSDK)
    // Bæœ: PCGameSDK.dll
    // å®˜æœ: hgsdk.dll (æ—  PCGameSDK)

    if has_gl_extra && has_play_pc_sdk && has_manifest_xml {
        return Ok(Some("google_play".to_string()));
    }

    if has_gfsdk && has_gl_foundation {
        return Ok(Some("global".to_string()));
    }

    if has_pc_sdk {
        return Ok(Some("bilibili".to_string()));
    }

    if has_hgsdk {
        return Ok(Some("official".to_string()));
    }

    // ç‰¹å¾åº“è®¤ä¸å‡ºæ¥æ—¶ï¼Œç”¨ config.ini é‡Œçš„ channel å…œåº•ï¼ˆå›½æœä¸¤æ¸ é“éƒ½èƒ½è®¤ï¼‰
    if let Some((app_code, channel)) = profile {
        let endfield_app_code = crate::models::game::GameChannel::Official.app_code();
        if app_code == endfield_app_code {
            return Ok(Some(
                if channel == "2" { "bilibili" } else { "official" }.to_string(),
            ));
        }
    }

    // æ— æ³•è¯†åˆ«æ¸ é“
    Ok(None)
}

/// æ£€æŸ¥å¯æ‰§è¡Œæ–‡ä»¶æ˜¯å¦å­˜åœ¨
#[tauri::command]
pub fn launcher_check_executable(install_path: String, channel: String) -> Result<bool, String> {
    let ch = parse_channel(&channel)?;
    let exe_name = ch.executable_name();
    let exe_path = std::path::Path::new(&install_path).join(exe_name);
    Ok(exe_path.exists())
}

#[tauri::command]
pub async fn launcher_check_game_running(channel: String) -> Result<bool, String> {
    let ch = parse_channel(&channel)?;
    Ok(crate::utils::process::is_process_running(ch.process_name()).await)
}

/// èŽ·å–æ¸¸æˆç´¯è®¡è¿è¡Œæ—¶é•¿å¿«ç…§ï¼ˆä»…ç»Ÿè®¡æœ¬è½¯ä»¶è¿è¡ŒæœŸé—´ï¼‰ã€‚
#[tauri::command]
pub fn launcher_get_game_playtime() -> GamePlaytime {
    crate::utils::game_playtime::snapshot()
}

/// ç»“æŸæ¸¸æˆè¿›ç¨‹ã€‚
///
/// æ¸¸æˆç”±**ææƒ** helper åˆ›å»ºï¼ˆè§ `utils/official_launcher.rs`ï¼‰ï¼Œæ‰€ä»¥æœªææƒçš„æœ¬è¿›ç¨‹æ‰§è¡Œ
/// `TerminateProcess` åªä¼šæ‹¿åˆ° `ERROR_ACCESS_DENIED` â€”â€” è¿™æ­£æ˜¯ã€Œåœæ­¢ã€ç‚¹äº†æ²¡ååº”
/// çš„åŽŸå› ã€‚è¿™é‡Œå…ˆå°±åœ°è¯•ä¸€æ¬¡ï¼ˆæœ¬è¿›ç¨‹å·²ææƒæ—¶ä¸å¿…å¼¹ UACï¼‰ï¼Œä»æœ‰æ®‹ç•™åˆ™ç» UAC ä»¥ç®¡ç†å‘˜æƒé™
/// é‡è¯•åŒä¸€ä¸ªåŠ¨ä½œï¼Œå¹¶æŠŠæœ€ç»ˆå­˜æ´»çŠ¶æ€å›žç»™ç•Œé¢ã€‚
///
/// è¿”å›ž `true` = è¿›ç¨‹å·²ç»“æŸï¼›è¿”å›ž `false` ä¸”æ— é”™è¯¯ = æœ¬æ¥å°±æ²¡æœ‰åŒåè¿›ç¨‹ã€‚
#[tauri::command]
pub async fn launcher_kill_game(channel: String) -> Result<bool, String> {
    let ch = parse_channel(&channel)?;
    let process_name = ch.process_name();

    #[cfg(target_os = "windows")]
    {
        let name = process_name.to_string();
        // è¿›ç¨‹å¿«ç…§ / TerminateProcess ä¸Ž UAC ç­‰å¾…éƒ½æ˜¯é˜»å¡žè°ƒç”¨ï¼Œä¸å ç”¨ tokio å·¥ä½œçº¿ç¨‹ã€‚
        let outcome = tokio::task::spawn_blocking(move || {
            // å•æ¬¡å¿«ç…§é¢„æ£€ï¼šæœ¬æ¥å°±æ²¡æœ‰æ®‹ç•™æ—¶ç›´æŽ¥è¿”å›žï¼Œè¿žç»ˆæ­¢è°ƒç”¨éƒ½ä¸å¿…å‘èµ·ã€‚
            if !crate::utils::process::exists_once(&name) {
                return Ok(false);
            }
            crate::utils::official_launcher::kill_game_process(&name)
        })
        .await
        .map_err(|error| format!("kill task failed: {error}"))?;

        return match outcome {
            Ok(terminated) => {
                tracing::info!("[launcher] {process_name} terminated={terminated}");
                Ok(terminated)
            }
            Err(error) => {
                tracing::error!("[launcher] {}", error.message());
                Err(error.message())
            }
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        Ok(false)
    }
}

/// åˆ‡æ¢æ¸¸æˆæ¸ é“
#[tauri::command]
pub async fn launcher_switch_channel(
    service: tauri::State<'_, Arc<GameLauncherService>>,
    from_channel: String,
    to_channel: String,
    install_path: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    tracing::info!(
        "[cmd] launcher_switch_channel: {} -> {}, path={}",
        from_channel,
        to_channel,
        install_path
    );
    let from = parse_channel(&from_channel)?;
    let to = parse_channel(&to_channel)?;
    let svc = service.inner();
    let _write = acquire_write_gate(svc).await?;
    // åˆ‡æœä¼šè¦†ç›–æ¸¸æˆæ–‡ä»¶ï¼šå ç”¨æ£€æµ‹ï¼ˆæŠ¥å‡ºå ç”¨è¿›ç¨‹ï¼‰+ ç›®å½•é”åˆ°åˆ‡æ¢ç»“æŸã€‚
    // Phase 0 çš„è¿›ç¨‹é¢„æ£€ä»åœ¨æœåŠ¡é‡Œä¿ç•™â€”â€”åŒä¿é™©ï¼Œä¸”å®ƒæŒ¡çš„æ˜¯ã€Œæ¸¸æˆåœ¨è·‘ã€è¿™ä¸€
    // æœ€å¸¸è§åœºæ™¯ï¼Œè¿™é‡ŒæŒ¡çš„æ˜¯æ€è½¯/ç´¢å¼•æœåŠ¡ç­‰å…¶å®ƒå ç”¨è€…ã€‚
    let _dir_lock = check_and_lock_install_dir(install_path.clone(), to.clone()).await?;
    svc.switch_channel(&from, &to, &install_path, app).await
}

fn parse_channel(s: &str) -> Result<GameChannel, String> {
    match s.to_lowercase().as_str() {
        "official" | "cn" => Ok(GameChannel::Official),
        "bilibili" | "bæœ" | "bili" => Ok(GameChannel::Bilibili),
        "global" | "å›½é™…æœ" => Ok(GameChannel::Global),
        "google_play" | "play" | "gp" => Ok(GameChannel::GooglePlay),
        // æ˜Žæ—¥æ–¹èˆŸï¼ˆå®˜æœï¼‰ä¸Žæ˜Žæ—¥æ–¹èˆŸ B æœ
        "arknights" | "ak" | "æ˜Žæ—¥æ–¹èˆŸ" | "èˆŸ" => Ok(GameChannel::Arknights),
        "arknights_bilibili" | "ak_bili" | "ak_b" | "æ˜Žæ—¥æ–¹èˆŸbæœ" => {
            Ok(GameChannel::ArknightsBilibili)
        }
        _ => Err(format!(
            "Unknown channel: '{}'. Use: official, bilibili, global, google_play, arknights, arknights_bilibili",
            s
        )),
    }
}

/// æ¸ é“å¯¹åº”çš„æ¸¸æˆè¿›ç¨‹åï¼›æ¸ é“ä¸²ä¸è®¤è¯†æ—¶è¿”å›ž `None`ã€‚
///
/// `lib.rs` çš„é©»å®ˆå®žä¾‹ï¼ˆ`--silent --launch-game`ï¼‰è¦åœ¨å¯åŠ¨åŽç­‰å¾…æ¸¸æˆç»“æŸï¼Œ
/// éœ€è¦çŸ¥é“è¯¥ç­‰ `Endfield.exe` è¿˜æ˜¯ `Arknights.exe`ã€‚
pub(crate) fn channel_process_name(channel: &str) -> Option<String> {
    parse_channel(channel)
        .ok()
        .map(|ch| ch.process_name().to_string())
}
