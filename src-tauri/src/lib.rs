#[cfg(debug_assertions)]
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::Mutex;

mod commands;
mod models;
mod services;
mod tray;
mod utils;

use services::account_service::AccountService;
use services::avatar_cache_service::AvatarCacheService;
use services::config_service::ConfigService;
use services::gacha_service::GachaService;
use services::game_launcher_service::GameLauncherService;
use services::network_service::NetworkService;
use services::skland_service::SklandService;
use services::system_resource_service::SystemResourceService;

const SILENT_ARG: &str = "--silent";
const LAUNCH_GAME_ARG: &str = "--launch-game";
pub(crate) const CLOSE_AFTER_LAUNCH_ARG: &str = "--close-after-launch";
const WAIT_FOR_PARENT_ARG: &str = "--endprotocol-wait-for-parent";
static PROMOTION_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // main.rs 现在无条件使用 Windows 子系统（不再创建控制台，避免被 Steam /
    // 快捷方式拉起时闪现黑窗口）；debug 构建下尝试附接父进程的终端，
    // 让 `cargo run` 的日志仍能打印到运行环境。
    #[cfg(all(target_os = "windows", debug_assertions))]
    attach_parent_console();

    // 提权启动 helper 模式（见 utils/official_launcher.rs）：
    // 必须在 logger / tracing / Tauri 初始化之前截获 —— 这个进程是被 launcher_start_game
    // 以 runas 拉起来的第二个实例，只负责「伪造官方父进程 + 启动游戏 + 转发退出码」，
    // 全程不创建任何窗口；退出码即游戏退出码。
    if let Some(code) = utils::official_launcher::try_run_helper() {
        // try_run_helper 内部已完成收尾（挂起的官方启动器已被终止并等待结束）。
        std::process::exit(code);
    }

    let args = std::env::args().collect::<Vec<_>>();

    if let Some(parent_pid) = arg_value(&args, WAIT_FOR_PARENT_ARG).and_then(|pid| pid.parse().ok())
    {
        wait_for_parent(parent_pid);
    }

    let silent_mode = args.iter().any(|arg| arg == SILENT_ARG);
    let launch_game = args.iter().any(|arg| arg == LAUNCH_GAME_ARG);
    let close_after_launch = silent_mode && args.iter().any(|arg| arg == CLOSE_AFTER_LAUNCH_ARG);
    let mode = Arc::new(AtomicBool::new(silent_mode));
    let app_ready = Arc::new(AtomicBool::new(false));
    let pending_requests = Arc::new(StdMutex::new(Vec::<Vec<String>>::new()));

    let mode_for_callback = mode.clone();
    let ready_for_callback = app_ready.clone();
    let pending_for_callback = pending_requests.clone();
    let single_instance_plugin = tauri_plugin_single_instance::init(move |app, argv, _cwd| {
        if ready_for_callback.load(Ordering::Acquire) {
            dispatch_instance_request(app, &argv, mode_for_callback.load(Ordering::Acquire));
        } else if let Ok(mut pending) = pending_for_callback.lock() {
            pending.push(argv);
        } else {
            write_startup_error("Could not queue a second-instance launch request.");
        }
    });

    if silent_mode {
        let ready_for_setup = app_ready.clone();
        let pending_for_setup = pending_requests.clone();
        let initial_launch = launch_game;
        let initial_close_after_launch = close_after_launch;
        tauri::Builder::default()
            .plugin(single_instance_plugin)
            .setup(move |app| {
                let config_service = create_config_service()?;
                app.manage(config_service.clone());
                utils::game_playtime::init(config_service.clone());
                tray::setup_silent_tray(app.handle(), config_service)
                    .map_err(|error| error.to_string())?;

                if initial_launch {
                    start_game_from_config(app.handle(), initial_close_after_launch);
                }
                ready_for_setup.store(true, Ordering::Release);
                dispatch_pending_requests(app.handle(), &pending_for_setup, true);
                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("error while running silent tauri application")
            .run(|_app_handle, event| {
                if let tauri::RunEvent::Exit = event {
                    utils::game_playtime::finalize();
                }
            });
        return;
    }

    // 初始化日志系统（静默模式刻意不初始化完整日志和业务服务）
    if let Err(e) = utils::logger::init_logger() {
        crate::safe_eprintln!("Failed to initialize logger: {}", e);
    }

    // 初始化 tracing subscriber，将 tracing 事件桥接到自定义 Logger
    utils::logger::init_tracing_subscriber();

    let builder = tauri::Builder::default()
        .plugin(single_instance_plugin)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init());

    // 开发构建下额外注册一个自定义协议，用于在没有 Vite dev server 时直接提供
    // frontendDist 中的构建产物（见 app_webview_url）。
    #[cfg(debug_assertions)]
    let builder = register_dev_asset_protocol(builder);

    builder
        .invoke_handler(tauri::generate_handler![
            // Config commands
            commands::config::get_config,
            commands::config::set_config,
            commands::config::remove_config,
            commands::config::get_all_configs,
            // Attendance commands
            commands::attendance::get_attendance,
            commands::attendance::do_attendance,
            // Gacha record commands
            commands::gacha::get_gacha_pool_meta,
            commands::gacha::sync_gacha_records,
            commands::gacha::get_saved_gacha_records,
            commands::gacha::get_gacha_record_stats,
            commands::gacha::resolve_gacha_avatar_map,
            // Weapon gacha record commands
            commands::gacha::sync_weapon_gacha_records,
            commands::gacha::get_saved_weapon_gacha_records,
            // Account commands
            commands::account::get_accounts,
            commands::account::get_skland_accounts,
            commands::account::save_skland_account,
            commands::account::get_skland_account_roles,
            commands::account::get_skland_user_info,
            commands::account::get_skland_games,
            commands::account::add_account,
            commands::account::logout_account,
            commands::account::batch_logout,
            commands::account::refresh_accounts,
            commands::account::send_verification_code,
            commands::account::add_account_by_code,
            commands::account::gen_scan_login,
            commands::account::scan_status,
            commands::account::add_account_by_scan,
            commands::account::save_selected_roles,
            commands::account::get_selected_account,
            commands::account::set_selected_account,
            commands::account::check_and_refresh_cred,
            // Card config commands
            commands::card_config::get_card_settings,
            commands::card_config::save_card_settings,
            commands::card_config::remove_card_settings,
            // System resource commands
            commands::system_resource::get_system_snapshot,
            commands::account::query_role_data,
            commands::account::set_lazy_load_enabled,
            commands::account::is_lazy_load_enabled,
            commands::account::set_current_role_id,
            // Image commands
            commands::image::read_image_file,
            commands::image::get_image_cache_dir,
            commands::image::download_image,
            commands::image::get_backgrounds_dir,
            commands::image::save_background_image,
            commands::image::delete_background_image,
            // Window commands
            commands::window::minimize_window,
            commands::window::toggle_maximize_window,
            commands::window::close_window,
            commands::window::minimize_to_tray,
            // Color picker commands
            commands::color_picker::capture_screen,
            commands::color_picker::finish_screen_pick,
            // Logger commands
            commands::logs::get_backend_logs,
            // Network capture commands
            commands::capture::capture_start,
            commands::capture::capture_stop,
            commands::capture::capture_status,
            commands::capture::capture_list_sessions,
            commands::capture::capture_read_entries,
            commands::capture::capture_delete_session,
            commands::capture::capture_dir,
            // Updater commands
            commands::updater::write_file,
            commands::updater::get_temp_dir,
            commands::updater::fetch_url,
            commands::updater::download_file,
            commands::updater::run_installer,
            commands::updater::check_update_endpoint,
            commands::updater::install_update_endpoint,
            commands::updater::cancel_download,
            commands::updater::reset_download_cancel,
            // Tray commands
            commands::tray::get_tray_user_info,
            commands::tray::set_tray_user,
            commands::tray::update_tray_user_data,
            commands::tray::show_tray_panel,
            commands::tray::hide_tray_panel,
            commands::tray::show_main_window,
            commands::tray::app_quit,
            // Launcher commands
            commands::launcher::launcher_check_status,
            commands::launcher::launcher_get_process_read_bytes,
            commands::launcher::launcher_install_or_update,
            commands::launcher::launcher_verify_and_repair,
            commands::launcher::launcher_preload_download,
            commands::launcher::launcher_install_preload,
            commands::launcher::launcher_get_remote_version,
            commands::launcher::launcher_get_payload_state,
            commands::launcher::launcher_cancel_download,
            commands::launcher::launcher_has_download_cache,
            commands::launcher::launcher_reset_download_cancel,
            commands::launcher::launcher_decrypt_file,
            commands::launcher::launcher_get_banners,
            commands::launcher::launcher_get_announcements,
            commands::launcher::launcher_get_notice_content,
            commands::launcher::launcher_get_background_image,
            commands::launcher::launcher_start_game,
            commands::launcher::launcher_browse_folder,
            commands::launcher::launcher_check_executable,
            commands::launcher::launcher_check_game_running,
            commands::launcher::launcher_kill_game,
            commands::launcher::launcher_get_game_playtime,
            commands::launcher::launcher_detect_channel,
            commands::launcher::launcher_scan_install_dir,
            commands::launcher::launcher_get_disk_space,
            commands::launcher::launcher_switch_channel,
            commands::launcher::launcher_cancel_switch,
            commands::launcher::launcher_cancel_all,
            commands::startup::get_game_launch_command,
            commands::startup::create_game_shortcut,
            commands::startup::create_launch_bat,
        ])
        .setup(move |app| {
            // 主窗口与托盘面板仅在完整模式创建，静默模式不建立 WebView。
            let config_service = create_config_service()?;
            app.manage(config_service.clone());
            utils::game_playtime::init(config_service.clone());
            create_full_windows(app.handle())?;

            // 启动时自动录制：必须在任何 API 请求发出之前开始
            let auto_capture = config_service
                .lock()
                .map(|config| config.get::<bool>("capture_autostart"))
                .unwrap_or(None)
                .unwrap_or(false);
            if auto_capture {
                match utils::capture::start() {
                    Ok(status) => {
                        log_info!("[capture] auto-started on launch: {:?}", status.session_id);
                    }
                    Err(e) => {
                        log_warn!("[capture] auto-start on launch failed: {}", e);
                    }
                }
            }

            tray::setup_tray(app.handle(), config_service.clone())
                .map_err(|error| error.to_string())?;

            // 初始化 Skland 服务
            let skland_service = Arc::new(SklandService::new(config_service.clone()));

            // 初始化头像缓存服务
            let avatar_cache_service =
                Arc::new(AvatarCacheService::new().map_err(|e| e.to_string())?);

            // 初始化抽卡记录服务
            let gacha_service = Arc::new(GachaService::new(app.handle().clone()));
            app.manage(gacha_service);

            // 初始化网络数据服务
            let network_service = Arc::new(NetworkService::new(skland_service.clone()));

            // 初始化账户服务（使用 tokio::sync::Mutex，因为它包含异步方法）
            let account_service = AccountService::new(
                config_service.clone(),
                skland_service,
                avatar_cache_service,
                network_service,
                app.handle().clone(),
            );
            let managed_service = Arc::new(Mutex::new(account_service));
            let timer_service = managed_service.clone();
            app.manage(managed_service);

            // 初始化游戏启动器服务
            let game_launcher_service = Arc::new(Mutex::new(GameLauncherService::new()));
            app.manage(game_launcher_service);

            // 初始化系统资源采集服务（CPU/内存/磁盘/网络/GPU）
            let system_resource_service =
                Arc::new(std::sync::Mutex::new(SystemResourceService::new()));
            app.manage(system_resource_service);

            // 启动自动刷新定时器（此时 tokio runtime 已启动）
            AccountService::start_auto_refresh(timer_service);

            if launch_game {
                start_game_from_config(app.handle(), false);
            }

            app_ready_for_full_instance(app.handle(), &mode, &app_ready, &pending_requests);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                utils::game_playtime::finalize();
            }
        });
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}

#[cfg(all(target_os = "windows", debug_assertions))]
fn attach_parent_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};

    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

fn create_config_service() -> Result<Arc<StdMutex<ConfigService>>, String> {
    let config_service = Arc::new(StdMutex::new(
        ConfigService::new().map_err(|error| error.to_string())?,
    ));
    commands::startup::refresh_main_exe_path(&config_service)?;
    Ok(config_service)
}

fn app_ready_for_full_instance<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mode: &Arc<AtomicBool>,
    ready: &Arc<AtomicBool>,
    pending: &Arc<StdMutex<Vec<Vec<String>>>>,
) {
    ready.store(true, Ordering::Release);
    dispatch_pending_requests(app, pending, mode.load(Ordering::Acquire));
}

fn dispatch_pending_requests<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pending: &Arc<StdMutex<Vec<Vec<String>>>>,
    silent_mode: bool,
) {
    let requests = match pending.lock() {
        Ok(mut requests) => std::mem::take(&mut *requests),
        Err(error) => {
            write_startup_error(&format!(
                "Could not process queued second-instance requests: {error}"
            ));
            return;
        }
    };
    for args in requests {
        dispatch_instance_request(app, &args, silent_mode);
    }
}

fn dispatch_instance_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    args: &[String],
    silent_mode: bool,
) {
    let request_silent = args.iter().any(|arg| arg == SILENT_ARG);
    let request_launch_game = args.iter().any(|arg| arg == LAUNCH_GAME_ARG);
    let request_close_after_launch =
        request_silent && args.iter().any(|arg| arg == CLOSE_AFTER_LAUNCH_ARG);

    if silent_mode && !request_silent {
        promote_to_full_with_game(app, request_launch_game);
        return;
    }

    if request_launch_game {
        start_game_from_config(app, request_close_after_launch);
    }

    if !request_silent {
        tray::show_main_window_focus(app);
    }
}

fn start_game_from_config<R: Runtime>(app: &tauri::AppHandle<R>, close_after_launch: bool) {
    let config = match app.try_state::<Arc<StdMutex<ConfigService>>>() {
        Some(config) => config.inner().clone(),
        None => {
            write_startup_error("Cannot start the game because app config is unavailable.");
            return;
        }
    };
    let config = match config.lock() {
        Ok(config) => config,
        Err(error) => {
            write_startup_error(&format!("Could not read game launch config: {error}"));
            return;
        }
    };
    let (Some(install_path), Some(channel)) = (
        config.get::<String>("launcher_install_path"),
        config.get::<String>("launcher_channel"),
    ) else {
        write_startup_error(
            "Cannot start the game: launcher_install_path or launcher_channel is not configured.",
        );
        return;
    };
    drop(config);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match commands::launcher::launcher_start_game(install_path, channel).await {
            Ok(result) if result.success => {
                if let Some(warning) = result.warning {
                    write_startup_error(&format!("Game launch warning: {warning}"));
                }
                if close_after_launch {
                    app_handle.exit(0);
                }
            }
            Ok(result) => write_startup_error(result.message.as_str()),
            Err(error) => write_startup_error(&format!("Game launch failed: {error}")),
        }
    });
}

fn write_startup_error(message: &str) {
    use std::io::Write;

    let Ok(data_dir) = utils::paths::app_data_dir() else {
        crate::safe_eprintln!("{message}");
        return;
    };
    let log_dir = data_dir.join("logs");
    if let Err(error) = std::fs::create_dir_all(&log_dir) {
        crate::safe_eprintln!("{message}; could not create startup log directory: {error}");
        return;
    }
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("startup.log"))
    {
        Ok(mut file) => {
            let timestamp = chrono::Local::now().to_rfc3339();
            if let Err(error) = writeln!(file, "[{timestamp}] {message}") {
                crate::safe_eprintln!("Could not write startup log: {error}");
            }
        }
        Err(error) => crate::safe_eprintln!("{message}; could not open startup log: {error}"),
    }
}

pub(crate) fn promote_to_full<R: Runtime>(app: &tauri::AppHandle<R>) {
    promote_to_full_with_game(app, false);
}

fn promote_to_full_with_game<R: Runtime>(app: &tauri::AppHandle<R>, launch_game: bool) {
    if PROMOTION_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            PROMOTION_STARTED.store(false, Ordering::Release);
            write_startup_error(&format!("Could not relaunch the full application: {error}"));
            return;
        }
    };
    let mut command = std::process::Command::new(exe);
    command
        .arg(WAIT_FOR_PARENT_ARG)
        .arg(std::process::id().to_string());
    if launch_game {
        command.arg(LAUNCH_GAME_ARG);
    }
    match command.spawn() {
        Ok(_) => app.exit(0),
        Err(error) => {
            PROMOTION_STARTED.store(false, Ordering::Release);
            write_startup_error(&format!("Could not relaunch the full application: {error}"))
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_parent(parent_pid: u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_pid);
        if !process.is_null() {
            let result = WaitForSingleObject(process, INFINITE);
            CloseHandle(process);
            if result != WAIT_OBJECT_0 {
                write_startup_error("Could not wait for the previous silent instance to exit.");
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_parent(_parent_pid: u32) {
    std::thread::sleep(std::time::Duration::from_millis(500));
}

fn create_full_windows<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    create_main_window(app)?;
    if app.get_webview_window("tray-panel").is_none() {
        WebviewWindowBuilder::new(app, "tray-panel", app_webview_url(app, "tray-panel.html")?)
            .title("tray-panel")
            .inner_size(260.0, 340.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .effects(
                tauri::window::EffectsBuilder::new()
                    .effect(tauri::window::Effect::Acrylic)
                    .color(tauri::window::Color(18, 18, 20, 30))
                    .build(),
            )
            .build()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn create_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(app, "main", app_webview_url(app, "index.html")?)
        .title("endprotocol")
        .inner_size(1200.0, 700.0)
        .resizable(true)
        .center()
        .decorations(false)
        .transparent(true)
        .effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Acrylic)
                .color(tauri::window::Color(18, 18, 20, 30))
                .build(),
        )
        .build()
        .map_err(|error| error.to_string())?;

    if let Some(config) = app.try_state::<Arc<StdMutex<ConfigService>>>() {
        let config = config.inner().clone();
        let window_for_close = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let action = config
                    .lock()
                    .ok()
                    .and_then(|config| config.get::<String>("close_action"))
                    .unwrap_or_else(|| "ask".to_string());

                if action != "close" {
                    api.prevent_close();
                    let _ = window_for_close.hide();
                }
            }
        });
    }
    Ok(window)
}

fn app_webview_url<R: Runtime>(
    app: &tauri::AppHandle<R>,
    asset_path: &str,
) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let dev_url = app.config().build.dev_url.as_ref();
        let dev_server_available = dev_url.is_some_and(|url| {
            let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
                return false;
            };
            (host, port)
                .to_socket_addrs()
                .map(|addresses| {
                    addresses.into_iter().any(|address| {
                        TcpStream::connect_timeout(&address, std::time::Duration::from_millis(250))
                            .is_ok()
                    })
                })
                .unwrap_or(false)
        });

        if !dev_server_available {
            if app.asset_resolver().get(asset_path.to_string()).is_none() {
                return Err(format!(
                    "The frontend dev server is unavailable and the built asset '{asset_path}' is missing. Run `npm run dev` or `npm run build`."
                ));
            }

            log_info!(
                "Frontend dev server is unavailable; serving built asset '{asset_path}' over the '{DEV_ASSET_SCHEME}' protocol."
            );
            return dev_asset_url(asset_path);
        }
    }

    Ok(WebviewUrl::App(asset_path.into()))
}

// 开发构建下，Vite dev server 不可用时（例如被游戏以 `--silent` 拉起、再经托盘唤醒的
// 进程），Tauri 自身不会内嵌任何前端资源：tauri-codegen 在 dev + devUrl 存在时使用空资源，
// 而 `tauri://localhost` / `http://tauri.localhost` 协议处理器只查这些空资源，于是报
// "asset not found: index.html"。这里的自定义协议改为通过 `asset_resolver()` 读取
// frontendDist（dev 下 `AssetResolver::get` 会回退到磁盘），从而与 release 行为一致。
#[cfg(debug_assertions)]
const DEV_ASSET_SCHEME: &str = "endprotocol";

#[cfg(debug_assertions)]
fn dev_asset_url(asset_path: &str) -> Result<WebviewUrl, String> {
    #[cfg(target_os = "windows")]
    let asset_url = format!("http://{DEV_ASSET_SCHEME}.localhost/{asset_path}");
    #[cfg(not(target_os = "windows"))]
    let asset_url = format!("{DEV_ASSET_SCHEME}://localhost/{asset_path}");
    asset_url
        .parse()
        .map(WebviewUrl::External)
        .map_err(|error| format!("Could not construct frontend asset URL: {error}"))
}

#[cfg(debug_assertions)]
fn register_dev_asset_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol(DEV_ASSET_SCHEME, |context, request| {
        let resolver = context.app_handle().asset_resolver();
        let requested = request.uri().path().trim_start_matches('/').to_string();

        // 与生产环境 tauri 协议一致：优先精确匹配，其次补 `.html`，再尝试目录
        // index.html，最后回退到入口 index.html（前端使用 BrowserRouter）。
        let asset = if requested.is_empty() {
            resolver.get("index.html".to_string())
        } else {
            resolver
                .get(requested.clone())
                .or_else(|| resolver.get(format!("{requested}.html")))
                .or_else(|| resolver.get(format!("{requested}/index.html")))
                .or_else(|| resolver.get("index.html".to_string()))
        };

        match asset {
            Some(asset) => http::Response::builder()
                .status(http::StatusCode::OK)
                .header(http::header::CONTENT_TYPE, asset.mime_type.to_string())
                .body(asset.bytes)
                .unwrap_or_else(|_| dev_asset_error_response("invalid asset response")),
            None => dev_asset_error_response(&format!("asset not found: {requested}")),
        }
    })
}

#[cfg(debug_assertions)]
fn dev_asset_error_response(message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(http::StatusCode::NOT_FOUND)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}
