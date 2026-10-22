#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::models::game::*;
use crate::services::config_service::ConfigService;
use crate::services::game_launcher_service::GameLauncherService;
use crate::utils::game_playtime::GamePlaytime;
use crate::utils::official_launcher::{LaunchError, LaunchToken};

/// 启用 DX11 时附加给游戏的命令行参数。
const DX11_GAME_ARG: &str = "-force-d3d11";
const DX11_CONFIG_KEY: &str = "launcher_dx11";

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

/// 获取游戏安装状态
#[tauri::command]
pub async fn launcher_check_status(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
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
    let svc = service.lock().await;
    tracing::info!("[cmd] check_status lock acquired, calling check_status...");
    let result = svc.check_status(&ch, &install_path).await;
    tracing::info!("[cmd] check_status returned: {:?}", result.is_ok());
    result
}

/// 安装或更新游戏
#[tauri::command]
pub async fn launcher_install_or_update(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
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
    let svc = service.lock().await;

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

/// 验证游戏文件完整性并修复
#[tauri::command]
pub async fn launcher_verify_and_repair(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    quick: Option<bool>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;

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

/// 获取远程版本信息
#[tauri::command]
pub async fn launcher_get_remote_version(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<RemotePackage, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.get_latest_package(&ch, None).await
}

/// 预下载游戏更新资源
#[tauri::command]
pub async fn launcher_preload_download(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;

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

/// 安装可解密的官方预下载补丁
#[tauri::command]
pub async fn launcher_install_preload(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
    install_path: String,
    max_concurrent: Option<usize>,
    resume: Option<bool>,
) -> Result<LauncherResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;

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

/// 获取 payload 状态（上次安装/更新的版本信息）
#[tauri::command]
pub async fn launcher_get_payload_state(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<Option<PayloadState>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    Ok(svc.get_payload_state(&ch).await)
}

/// 取消正在进行的下载并清理缓存文件
#[tauri::command]
pub async fn launcher_cancel_download(install_path: Option<String>) -> Result<(), String> {
    // 先记录清理意图再取消，避免后台任务先退出导致缓存被保留
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

/// 检查是否存在下载缓存（暂存目录或 .download 文件）
#[tauri::command]
pub async fn launcher_has_download_cache(install_path: String) -> Result<bool, String> {
    Ok(crate::services::game_launcher_service::has_download_cache(
        &install_path,
    ))
}

/// 重置下载取消标志
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

/// 获取 Banner 列表
#[tauri::command]
pub async fn launcher_get_banners(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<Vec<BannerItem>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.get_banners(&ch).await
}

/// 获取公告列表
#[tauri::command]
pub async fn launcher_get_announcements(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<Vec<AnnouncementItem>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.get_announcements(&ch).await
}

/// 获取启动器公告内容（Banner + 公告合并）
#[tauri::command]
pub async fn launcher_get_notice_content(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<LauncherNoticeContent, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.get_notice_content(&ch).await
}

/// 获取启动器背景媒体 URL
#[tauri::command]
pub async fn launcher_get_background_image(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
) -> Result<Option<BackgroundMedia>, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.get_background_image(&ch).await
}

/// 组装给前端的失败消息：`<token>: <detail>`（见 utils/official_launcher.rs 的契约）。
fn launch_message(token: LaunchToken, detail: impl Into<String>) -> String {
    LaunchError::new(token, detail).message()
}

/// 同一时刻只允许一次启动：避免重复点击弹出两次 UAC、留下两套挂起的官方父进程。
#[cfg(target_os = "windows")]
static LAUNCH_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 直接启动游戏（旧行为）：交给 shell，靠 exe 自身的 manifest 自动提权。
/// 只在找不到签名有效的官方启动器时作为回退使用。
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

/// 启动游戏。
///
/// 游戏会校验自己的**直接父进程**必须是签名有效的官方 `Games.exe`，因此这里优先走
/// 「官方启动器父进程伪造」（见 `utils/official_launcher.rs`）：以提权 helper 创建一个
/// 挂起且永不运行的官方启动器，再把它指定为游戏的父进程。找不到签名有效的官方启动器时
/// 回退到直接启动（旧行为），并通过 `warning` 让界面提示原因。
///
/// `dx11` 为 `None` 时读取配置键 `launcher_dx11`（默认 false）；为 true 时给游戏附加
/// `-force-d3d11`。静默启动的 `--dx11` 参数在 `lib.rs` 中解析后通过内部 `launch_game` 传入。
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

/// `launcher_start_game` 的实际实现；静默模式没有 Tauri State，直接调用本函数。
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

    // Kill existing game processes first
    let mut kill_command = std::process::Command::new("taskkill");
    #[cfg(target_os = "windows")]
    kill_command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let _ = kill_command.args(["/F", "/IM", exe_name]).output();

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

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
        // 状态文件用于区分「helper 在启动阶段就失败了」与「游戏创建成功但很快退出」。
        let status_file = crate::utils::paths::app_data_dir()
            .ok()
            .map(|dir| dir.join("launcher_helper_status"));
        // 查找、WinVerifyTrust 与进程创建都是阻塞调用，不占用 tokio 工作线程。
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
            // 没有签名有效的官方启动器：回退到直接启动，并让界面说明为什么可能失败。
            Ok(Err(error)) if error.token == LaunchToken::NoLauncher => {
                tracing::warn!(
                    "[launcher] {} — falling back to a direct launch",
                    error.message()
                );
                direct_launch(&exe_path, &game_arguments).map(|mut result| {
                    // 用 `fallback` token 而不是原错误：前端据此显示「已直接启动」的提示，
                    // 而不是把它当成启动失败。
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
                tracing::info!(
                    "[launcher] game created through the official launcher parent (helper pid {})",
                    elevated.helper_pid
                );
                Ok(LauncherResult {
                    success: true,
                    message: format!("{exe_name} launched"),
                    version: None,
                    warning: None,
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

/// 浏览文件夹
#[tauri::command]
pub fn launcher_browse_folder() -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new().set_title("Select Game Directory");

    Ok(dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string()))
}

/// 磁盘空间信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiskSpace {
    pub total: u64,
    pub free: u64,
}

/// 获取指定路径所在磁盘的总空间和可用空间（字节）
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

/// 扫描安装目录，检查已有文件的完整性
#[tauri::command]
pub async fn launcher_scan_install_dir(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
    channel: String,
    install_path: String,
) -> Result<FileScanResult, String> {
    let ch = parse_channel(&channel)?;
    let svc = service.lock().await;
    svc.scan_install_dir(&ch, &install_path).await
}

/// 根据目录下的文件特征自动识别游戏渠道
#[tauri::command]
pub async fn launcher_detect_channel(install_path: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&install_path);

    // 检查基本游戏文件是否存在
    let has_exe = path.join("Endfield.exe").exists();
    let has_data = path.join("Endfield_Data").is_dir();
    let has_config = path.join("config.ini").exists();

    if !has_exe || !has_data || !has_config {
        // 游戏未安装或目录无效
        return Ok(None);
    }

    // 检查渠道特征文件
    let has_hgsdk = path.join("hgsdk.dll").exists();
    let has_pc_sdk = path.join("PCGameSDK.dll").exists();
    let has_gfsdk = path.join("gfsdk.dll").exists();
    let has_gl_foundation = path.join("glfoundation.dll").exists();
    let has_gl_extra = path.join("glextra.dll").exists();
    let has_play_pc_sdk = path.join("play_pc_sdk.dll").exists();
    let has_manifest_xml = path.join("manifest.xml").exists();

    // 渠道识别逻辑：
    // Google Play: glextra.dll + play_pc_sdk.dll + manifest.xml
    // Global: gfsdk.dll + glfoundation.dll (无 PCGameSDK)
    // B服: PCGameSDK.dll
    // 官服: hgsdk.dll (无 PCGameSDK)

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

    // 无法识别渠道
    Ok(None)
}

/// 检查可执行文件是否存在
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

/// 获取游戏累计运行时长快照（仅统计本软件运行期间）。
#[tauri::command]
pub fn launcher_get_game_playtime() -> GamePlaytime {
    crate::utils::game_playtime::snapshot()
}

#[tauri::command]
pub async fn launcher_kill_game(channel: String) -> Result<bool, String> {
    let ch = parse_channel(&channel)?;
    let process_name = ch.process_name();
    let exe_name = ch.executable_name();

    // 先用 taskkill /T /F /IM 杀进程树（非阻塞）
    let mut command = tokio::process::Command::new("taskkill");
    #[cfg(target_os = "windows")]
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let output = command
        .args(["/T", "/F", "/IM", &process_name])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        // 尝试用可执行文件名杀
        let mut command = tokio::process::Command::new("taskkill");
        #[cfg(target_os = "windows")]
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        let output2 = command
            .args(["/T", "/F", "/IM", &exe_name])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        if !output2.status.success() {
            // 最后尝试 wmic 按标题模糊杀
            let mut command = tokio::process::Command::new("wmic");
            #[cfg(target_os = "windows")]
            command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
            let _ = command
                .args([
                    "process",
                    "where",
                    &format!("name like '%Endfield%'"),
                    "call",
                    "terminate",
                ])
                .output()
                .await;
        }
    }

    Ok(true)
}

/// 切换游戏渠道
#[tauri::command]
pub async fn launcher_switch_channel(
    service: tauri::State<'_, Arc<Mutex<GameLauncherService>>>,
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
    let svc = service.lock().await;
    svc.switch_channel(&from, &to, &install_path, app).await
}

fn parse_channel(s: &str) -> Result<GameChannel, String> {
    match s.to_lowercase().as_str() {
        "official" | "cn" => Ok(GameChannel::Official),
        "bilibili" | "b服" | "bili" => Ok(GameChannel::Bilibili),
        "global" | "国际服" => Ok(GameChannel::Global),
        "google_play" | "play" | "gp" => Ok(GameChannel::GooglePlay),
        _ => Err(format!(
            "Unknown channel: '{}'. Use: official, bilibili, global, google_play",
            s
        )),
    }
}
