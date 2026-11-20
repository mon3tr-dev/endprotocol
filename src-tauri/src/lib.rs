// 仅桌面 debug：app_webview_url 用它们探测 Vite dev server 是否在监听。
#[cfg(all(desktop, debug_assertions))]
use std::net::{TcpStream, ToSocketAddrs};
// AtomicBool/Ordering 仅用于桌面单实例插件的就绪标记。
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{Emitter, Manager, Runtime};
// 动态建窗只在桌面有实现（`WebviewWindowBuilder` 的装饰/透明/磨砂等方法均桌面限定）；
// `WebviewUrl` 仅被建窗路径（app_webview_url / dev_asset_url）使用。
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

mod commands;
mod models;
pub mod services;
mod tray;
pub mod utils;

use services::account_service::AccountService;
use services::avatar_cache_service::AvatarCacheService;
use services::config_service::ConfigService;
use services::arknights_gacha_service::ArknightsGachaService;
use services::gacha_service::GachaService;
use services::game_launcher_service::GameLauncherService;
use services::network_service::NetworkService;
use services::skland_service::SklandService;
use services::system_resource_service::SystemResourceService;

const SILENT_ARG: &str = "--silent";
const LAUNCH_GAME_ARG: &str = "--launch-game";
const DX11_ARG: &str = "--dx11";

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

    // 提权结束游戏 helper 模式（见 utils/official_launcher.rs）：同样是 runas 拉起的第二个
    // 实例，只结束游戏进程然后退出。必须在 logger / tracing / Tauri 初始化之前截获 ——
    // logger 会持有日志文件句柄，而本进程的全部使命只是一次进程终止。
    if let Some(code) = utils::official_launcher::try_run_kill_helper() {
        std::process::exit(code);
    }

    // 会话驻守模式（见 utils/official_launcher.rs）：已提权启动游戏后由本进程拉起的
    // 独立驻守实例，继承「游戏 + 挂起官方父进程 + 清理 Job」句柄，游戏退出后才收尾。
    // 它让游戏进程与应用进程生命周期彻底解耦（应用退出不再连带结束游戏），同样必须
    // 在 logger / tracing / Tauri / 单实例插件初始化之前截获。
    if let Some(code) = utils::official_launcher::try_run_session_keeper() {
        std::process::exit(code);
    }

    let args = std::env::args().collect::<Vec<_>>();
    let silent_mode = args.iter().any(|arg| arg == SILENT_ARG);
    let launch_game = args.iter().any(|arg| arg == LAUNCH_GAME_ARG);

    // 单独的 `--silent` 不做任何事：不启动应用、不创建驻守进程。
    if silent_mode && !launch_game {
        return;
    }

    // 在任何业务逻辑之前安装崩溃捕获，确保初始化阶段 panic 也能落盘。
    utils::crash::install_panic_hook();

    // `--dx11` / `--game` 只与 `--launch-game` 组合生效；缺省时在 start_game_from_config
    // 中读取应用设置（DX11 按游戏各存一份）。
    let requested_dx11 = args.iter().any(|arg| arg == DX11_ARG).then_some(true);
    let requested_game = commands::startup::game_from_args(&args);

    if silent_mode {
        // 驻守实例（`--silent --launch-game`）：不可见、无托盘、不计时、不注册单实例插件，
        // 因此可与主实例及其它驻守实例同时存在；游戏退出后本进程退出。
        let initial_dx11 = requested_dx11;
        tauri::Builder::default()
            .setup(move |app| {
                utils::crash::set_app_handle(app.handle().clone());
                let config_service = create_config_service()?;
                app.manage(config_service);
                start_game_from_config(app.handle(), initial_dx11, true, requested_game);
                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("error while running silent tauri application")
            .run(|_, _| {});
        return;
    }

    // 初始化日志系统（静默模式刻意不初始化完整日志和业务服务）。
    // 移动端推迟到 setup：日志目录依赖 utils::paths 的数据目录覆盖值，
    // 而覆盖值必须等 Tauri 路径解析器可用（setup 拿到 AppHandle）才能注入；
    // 过早初始化会因目录不可写而失败，日志从此全部落入丢弃实例。
    #[cfg(desktop)]
    if let Err(e) = utils::logger::init_logger() {
        crate::safe_eprintln!("Failed to initialize logger: {}", e);
    }

    // 初始化 tracing subscriber，将 tracing 事件桥接到自定义 Logger
    #[cfg(desktop)]
    utils::logger::init_tracing_subscriber();

    // 桌面：单实例插件（第二实例参数转发）与其就绪标记 / 请求队列。
    // 移动端（Android/iOS）没有"第二实例"概念，插件也不支持
    // （crate 级 cfg(not(android, ios))，init 不存在），整体跳过。
    #[cfg(desktop)]
    let app_ready = Arc::new(AtomicBool::new(false));
    #[cfg(desktop)]
    let pending_requests = Arc::new(StdMutex::new(Vec::<Vec<String>>::new()));
    #[cfg(desktop)]
    let single_instance_plugin = {
        let ready_for_callback = app_ready.clone();
        let pending_for_callback = pending_requests.clone();
        tauri_plugin_single_instance::init(move |app, argv, _cwd| {
            if ready_for_callback.load(Ordering::Acquire) {
                dispatch_instance_request(app, &argv);
            } else if let Ok(mut pending) = pending_for_callback.lock() {
                pending.push(argv);
            } else {
                write_startup_error("Could not queue a second-instance launch request.");
            }
        })
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_apk_installer::init())
        // 系统栏 inset 查询：Android 15+ 强制 edge-to-edge，WebView 会排到状态栏/
        // 手势条之下，而 wry 不会把 inset 告诉 WebView（`env(safe-area-inset-*)`
        // 恒为 0）。前端据此写入 CSS 变量，见 src/utils/safeArea.ts。
        .plugin(tauri_plugin_safe_area::init());

    // 桌面专属插件：单实例转发 + 自更新（两者的依赖都只在桌面目标编译）。
    #[cfg(desktop)]
    let builder = builder
        .plugin(single_instance_plugin)
        .plugin(tauri_plugin_updater::Builder::new().build());

    // 开发构建下额外注册一个自定义协议，用于在没有 Vite dev server 时直接提供
    // frontendDist 中的构建产物（见 app_webview_url）。仅桌面：移动端主窗口由
    // tauri.android.conf.json 静态创建，不走动态建窗/自定义协议路径。
    #[cfg(all(desktop, debug_assertions))]
    let builder = register_dev_asset_protocol(builder);

    // 开发构建下注册 devdeck（内存 / CPU / 资源泄漏监视器，独立窗口，Ctrl+Alt+M）。
    // release 不注册：不创建 deck 窗口、不采样进程，运行时零开销。
    #[cfg(all(desktop, debug_assertions))]
    let builder = builder.plugin(tauri_plugin_devdeck::init());

    builder
        .invoke_handler(tauri::generate_handler![
            // Config commands
            commands::config::get_config,
            commands::config::set_config,
            commands::config::remove_config,
            commands::config::get_all_configs,
            commands::config::get_secret_storage_status,
            // Proxy commands
            commands::proxy::get_proxy_settings,
            commands::proxy::save_proxy_settings,
            commands::proxy::clear_proxy_settings,
            commands::proxy::read_system_proxy,
            commands::proxy::test_proxy_connection,
            commands::proxy::auto_detect_proxy,
            // Attendance commands
            commands::attendance::get_attendance,
            commands::attendance::do_attendance,
            // 批量签到（两个游戏混传，后端按角色 app 自行分流）
            commands::arknights::do_batch_attendance,
            // Arknights (明日方舟) data commands —— 与终末地的 query_role_data 平行，
            // 走森空岛的 /api/v1/game/player/* 系列（按渠道绑定 uid 寻址）
            commands::arknights::get_arknights_player_info,
            commands::arknights::get_arknights_cultivate,
            commands::arknights::get_arknights_attendance,
            commands::arknights::do_arknights_attendance,
            // Gacha record commands（终末地 / 明日方舟按角色自动分流）
            commands::gacha::get_gacha_pool_meta,
            commands::gacha::sync_gacha_records,
            commands::gacha::get_saved_gacha_records,
            commands::gacha::get_gacha_record_stats,
            commands::gacha::resolve_gacha_avatar_map,
            // Weapon gacha record commands（仅终末地；明日方舟返回空）
            commands::gacha::sync_weapon_gacha_records,
            commands::gacha::get_saved_weapon_gacha_records,
            // Arknights gacha（明日方舟寻访：cate 分类枚举）
            commands::gacha::get_arknights_gacha_categories,
            // Account commands
            commands::account::get_accounts,
            commands::account::get_skland_accounts,
            commands::account::save_skland_account,
            commands::account::get_skland_account_roles,
            commands::account::get_skland_user_info,
            commands::account::get_skland_user_info_by_cred,
            commands::account::get_skland_games,
            commands::account::add_account,
            commands::account::logout_account,
            commands::account::delete_skland_account,
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
            commands::account::authorize_role_u8token,
            commands::account::revoke_role_u8token,
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
            commands::window::save_tab_snapshot,
            commands::window::delete_tab_snapshot,
            // In-app browser commands (native child webview navigation)
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_reload,
            commands::browser::browser_navigate,
            commands::browser::browser_current_url,
            // Color picker commands
            commands::color_picker::capture_screen,
            commands::color_picker::finish_screen_pick,
            // Logger commands
            commands::logs::get_backend_logs,
            commands::logs::set_log_level,
            // Diagnostics & crash handling commands
            commands::diagnostics::get_log_dir,
            commands::diagnostics::export_diagnostics,
            commands::diagnostics::get_pending_crash_reports,
            commands::diagnostics::ack_crash_reports,
            commands::diagnostics::get_api_health,
            commands::diagnostics::reset_api_health,
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
            commands::updater::download_android_apk,
            commands::updater::get_android_abi,
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
            commands::tray::tray_available,
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
            commands::startup::steam_shortcut_defaults,
            commands::startup::pick_steam_icon,
            commands::startup::pick_steam_icon_source,
            commands::startup::extract_steam_icon,
            commands::startup::add_steam_shortcut,
        ])
        // 页面加载钩子：把子 Webview（in-app browser）的加载事件桥接成
        // `browser://page-load` 事件发给前端。JS 侧 Webview 类没有
        // onPageLoad/onNavigation，只能在 Rust 侧 on_page_load 里 emit。
        .on_page_load(|webview, payload| {
            if !webview.label().starts_with("inapp-browser-") {
                return;
            }
            let kind = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let data = serde_json::json!({
                "label": webview.label(),
                "url": payload.url().as_str(),
                "event": kind,
            });
            let _ = webview.app_handle().emit("browser://page-load", &data);
        })
        .setup(move |app| {
            // 移动端（Android/iOS）没有 HOME/XDG 目录，`dirs` 系列全部返回 None。
            // 必须在创建任何服务之前把 Tauri 路径解析器拿到的应用数据目录注入
            // utils::paths（桌面保持 dirs 行为不变，历史数据位置不受影响）。
            #[cfg(mobile)]
            {
                if let Ok(data_dir) = app.path().app_data_dir() {
                    utils::paths::set_app_data_dir_override(data_dir);
                }
                // 数据目录就绪后初始化日志（桌面在 run() 早期完成）。
                if let Err(error) = utils::logger::init_logger() {
                    crate::safe_eprintln!("Failed to initialize logger: {error}");
                }
                utils::logger::init_tracing_subscriber();
            }

            // 主窗口与托盘面板仅在完整模式创建，静默模式不建立 WebView。
            utils::crash::set_app_handle(app.handle().clone());
            utils::api_health::init(app.handle().clone());
            let config_service = create_config_service()?;
            app.manage(config_service.clone());

            // 在业务服务启动前应用开发者模式 / 日志级别配置。
            {
                let (developer_mode, preferred_level) = {
                    let service = config_service.lock().map_err(|e| e.to_string())?;
                    (
                        service.get::<bool>("developer_mode").unwrap_or(false),
                        service
                            .get::<String>("log_level")
                            .and_then(|value| utils::logger::LogLevel::parse(&value))
                            .unwrap_or(utils::logger::LogLevel::Debug),
                    )
                };
                // 未开启开发者模式时屏蔽 DEBUG。
                let effective = if developer_mode {
                    preferred_level
                } else {
                    preferred_level.max(utils::logger::LogLevel::Info)
                };
                utils::logger::set_log_level(effective);
            }

            // 游戏在线时长统计依赖进程枚举（桌面语义），移动端没有可执行游戏进程。
            #[cfg(desktop)]
            utils::game_playtime::init(config_service.clone());
            // 移动端主窗口来自 tauri.conf.json 的静态配置（tauri.android.conf.json），
            // 不支持运行时动态建窗；托盘面板等辅助窗口同样是桌面专属。
            #[cfg(desktop)]
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

            // 托盘只是增强功能：Linux 上没有 StatusNotifier 宿主时创建失败或不可见，
            // 不能因此让整个应用起不来，也不能允许把窗口藏进托盘。
            if let Err(error) = tray::setup_tray(app.handle(), config_service.clone()) {
                log_warn!(
                    "[tray] system tray unavailable, minimize-to-tray disabled: {error}"
                );
            }

            // 初始化 Skland 服务
            let skland_service = Arc::new(SklandService::new(config_service.clone()));

            // 初始化头像缓存服务
            let avatar_cache_service =
                Arc::new(AvatarCacheService::new().map_err(|e| e.to_string())?);

            // 初始化抽卡记录服务（终末地：ef-webview）
            let gacha_service = Arc::new(GachaService::new(app.handle().clone()));
            app.manage(gacha_service);

            // 初始化《明日方舟》寻访记录服务（ak-webview）
            // 与终末地是两套独立的 API，另起一个服务而不是在 GachaService 里加分支
            let arknights_gacha_service =
                Arc::new(ArknightsGachaService::new(app.handle().clone()));
            app.manage(arknights_gacha_service);

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

            // 初始化游戏启动器服务（内部状态自带 Arc/Mutex，长任务另有 write_gate 串行，
            // 不再用一把外层锁把整个服务锁住——下载期间公告/背景/状态查询仍要能返回）
            let game_launcher_service = Arc::new(GameLauncherService::new());
            app.manage(game_launcher_service);

            // 初始化系统资源采集服务（CPU/内存/磁盘/网络/GPU）
            let system_resource_service =
                Arc::new(std::sync::Mutex::new(SystemResourceService::new()));
            app.manage(system_resource_service);

            // 启动自动刷新定时器（此时 tokio runtime 已启动）
            AccountService::start_auto_refresh(timer_service);

            if launch_game {
                start_game_from_config(app.handle(), requested_dx11, false, requested_game);
            }

            // 完整模式就绪标记 + 处理单实例插件排队期间的第二实例请求（仅桌面）。
            #[cfg(desktop)]
            app_ready_for_full_instance(app.handle(), &app_ready, &pending_requests);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // 移动端从未初始化时长统计，跳过落盘。
                #[cfg(desktop)]
                utils::game_playtime::finalize();
            }
        });
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
    // 代理配置缓存在全局 RwLock 中，所有 HTTP 客户端创建时都会读取。
    utils::http_client::set_global_proxy_config(
        config_service
            .lock()
            .map_err(|error| error.to_string())?
            .get_proxy_config(),
    );
    Ok(config_service)
}

/// 完整模式 setup 完成：置就绪标记并处理排队的第二实例请求（仅桌面，配合单实例插件）。
#[cfg(desktop)]
fn app_ready_for_full_instance<R: Runtime>(
    app: &tauri::AppHandle<R>,
    ready: &Arc<AtomicBool>,
    pending: &Arc<StdMutex<Vec<Vec<String>>>>,
) {
    ready.store(true, Ordering::Release);
    dispatch_pending_requests(app, pending);
}

#[cfg(desktop)]
fn dispatch_pending_requests<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pending: &Arc<StdMutex<Vec<Vec<String>>>>,
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
        dispatch_instance_request(app, &args);
    }
}

/// 主实例收到第二实例转交的启动参数：按需启动游戏并显示主窗口（仅桌面）。
#[cfg(desktop)]
fn dispatch_instance_request<R: Runtime>(app: &tauri::AppHandle<R>, args: &[String]) {
    if args.iter().any(|arg| arg == LAUNCH_GAME_ARG) {
        let dx11 = args.iter().any(|arg| arg == DX11_ARG).then_some(true);
        let game = commands::startup::game_from_args(args);
        start_game_from_config(app, dx11, false, game);
    }
    tray::show_main_window_focus(app);
}

/// 驻留等待本次游戏会话结束。
///
/// 驻守实例被 Steam 等外部启动器拉起的进程退出后会立刻停止「游戏中」状态并停止计时，
/// 因此驻守实例在游戏运行期间保持存活，游戏退出后再退出应用。
/// 游戏在 120 秒内未出现（启动失败/被取消）时同样结束等待。
///
/// `game_process` 是要等的进程名：终末地 `Endfield.exe`、明日方舟 `Arknights.exe`。
async fn wait_for_game_session(game_process: &str) {
    use std::time::{Duration, Instant};

    const POLL_INTERVAL: Duration = Duration::from_secs(2);
    const GAME_LAUNCH_GRACE: Duration = Duration::from_secs(120);

    let started = Instant::now();
    let mut seen = false;

    loop {
        if utils::process::is_process_running(game_process).await {
            seen = true;
        } else if seen || started.elapsed() >= GAME_LAUNCH_GRACE {
            return;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

fn start_game_from_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
    dx11: Option<bool>,
    exit_when_game_ends: bool,
    game: commands::startup::LauncherGame,
) {
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
    // 安装路径 / 渠道 / DX11 都按游戏分区：静默启动带的是哪个 `--game`，就读哪一组键。
    let (Some(install_path), Some(channel), stored_dx11) = (
        config.get::<String>(game.install_path_key()),
        config.get::<String>(game.channel_key()),
        config.get::<bool>(game.dx11_key()).unwrap_or(false),
    ) else {
        write_startup_error(&format!(
            "Cannot start {}: its installation path or channel is not configured.",
            game.id()
        ));
        return;
    };
    drop(config);

    // 命令行 `--dx11` 优先；未提供时使用应用内设置（配置键 launcher_dx11[_arknights]，默认 false）。
    let dx11 = dx11.unwrap_or(stored_dx11);
    let app_handle = app.clone();
    // 驻守实例要知道自己该等哪个进程（终末地 / 明日方舟），先解析出来再移交 channel
    let game_process = commands::launcher::channel_process_name(&channel)
        .unwrap_or_else(|| models::game::GameChannel::Official.process_name().to_string());
    tauri::async_runtime::spawn(async move {
        match commands::launcher::launch_game(install_path, channel, dx11).await {
            Ok(result) if result.success => {
                if let Some(warning) = result.warning {
                    write_startup_error(&format!("Game launch warning: {warning}"));
                }
                if exit_when_game_ends {
                    wait_for_game_session(&game_process).await;
                    app_handle.exit(0);
                }
            }
            Ok(result) => {
                write_startup_error(result.message.as_str());
                if exit_when_game_ends {
                    app_handle.exit(0);
                }
            }
            Err(error) => {
                write_startup_error(&format!("Game launch failed: {error}"));
                if exit_when_game_ends {
                    app_handle.exit(0);
                }
            }
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

/// 完整模式窗口创建（仅桌面）：主窗口 + 托盘面板。
///
/// 移动端（Android/iOS）不支持运行时动态创建窗口，主窗口由
/// `tauri.android.conf.json` 的 `app.windows` 静态配置在启动时创建。
#[cfg(desktop)]
fn create_full_windows<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    create_main_window(app)?;
    if app.get_webview_window("tray-panel").is_none() {
        let tray_panel = WebviewWindowBuilder::new(
            app,
            "tray-panel",
            app_webview_url(app, "tray-panel.html")?,
        )
        .title("tray-panel")
        .inner_size(288.0, 376.0)
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
        exclude_from_alt_tab(&tray_panel);
    }
    Ok(())
}

/// 把辅助窗口从 Windows 的 Alt+Tab 列表里排除掉（仅桌面；移动端没有窗口枚举概念）。
///
/// `skip_taskbar(true)` 管不到 Alt+Tab：tao 对它只调用 `ITaskbarList::DeleteTab`
/// （摘掉任务栏按钮），既不碰扩展样式，也不影响 explorer 的窗口切换列表。而 tao 会给
/// 普通窗口加上 `WS_EX_APPWINDOW`，explorer 在窗口第一次被显示时就会把它注册成一个
/// Alt+Tab 条目 —— 之后窗口隐藏了，条目仍留在列表里，表现为一张没有界面预览的空白卡片
/// （托盘面板只要被显示过一次就会留下一个）。
///
/// Alt+Tab 的判定（explorer 的 `IsAltTabWindow`）只认 `WS_EX_TOOLWINDOW`：带这个样式
/// 的窗口既不会进任务栏，也不会进 Alt+Tab。这里把 `WS_EX_APPWINDOW` 换成它。
#[cfg(all(target_os = "windows", desktop))]
fn exclude_from_alt_tab<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let hwnd = hwnd.0;
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let tool_style = (ex_style & !(WS_EX_APPWINDOW as i32)) | WS_EX_TOOLWINDOW as i32;
        if tool_style == ex_style {
            return;
        }
        SetWindowLongW(hwnd, GWL_EXSTYLE, tool_style);
        // 换了扩展样式必须让系统重算非客户区，否则窗口仍按旧样式参与窗口枚举。
        let _ = SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED
                | SWP_NOMOVE
                | SWP_NOSIZE
                | SWP_NOZORDER
                | SWP_NOOWNERZORDER
                | SWP_NOACTIVATE,
        );
    }
}

#[cfg(all(not(target_os = "windows"), desktop))]
fn exclude_from_alt_tab<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}

/// 主窗口创建（仅桌面用动态建窗；移动端由 tauri.android.conf.json 静态创建）。
///
/// `create_full_windows` / `tray::show_main_window_focus` 在移动端仍会调用本函数
/// 兜底（托盘唤回路径），但移动端主窗口由平台配置静态建立、必然已存在，函数会在
/// 第一个 `get_window("main")` 命中后直接返回，不会走到建窗代码。
///
/// 注意：**建窗分支必须整体 `#[cfg(desktop)]`** —— `WebviewWindowBuilder` 的
/// `center` / `decorations` / `transparent` / `effects` 等方法都在
/// `#[cfg(desktop)]` 的 impl 块里，移动端编译时不存在。
pub(crate) fn create_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::Window<R>, String> {
    // 注意：这里不能用 `get_webview_window("main")` 判断窗口是否已存在——它要求窗口下
    // 所有 webview 的 label 都等于窗口 label，in-app browser 的子 webview
    // （`inapp-browser-N`）会让它返回 None，进而重复创建主窗口。
    if let Some(window) = app.get_window("main") {
        return Ok(window);
    }

    #[cfg(desktop)]
    {
        let mut window_builder =
            WebviewWindowBuilder::new(app, "main", app_webview_url(app, "index.html")?)
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
                );

        // 窗口图标必须显式挂上：`bundle.icon` 只把图标编进 exe 的 RT_GROUP_ICON
        // 资源，那决定的是 Explorer 里的文件图标；而**任务栏、Alt+Tab、窗口左上角**
        // （无边框时由 DWM 绘制的缩略图）读的是窗口自己的 WM_SETICON。
        // 不调用 `.icon()` 时 Tauri 不会自动填，窗口图标就是空白的那一项。
        // 这里复用 Tauri 从 `bundle.icon` 解析出的 `default_window_icon`
        // （托盘用的也是它），保证三处图标同源。
        if let Some(icon) = app.default_window_icon() {
            window_builder = window_builder.icon(icon.clone()).map_err(|error| error.to_string())?;
        }

        let webview_window = window_builder.build().map_err(|error| error.to_string())?;

        if let Some(config) = app.try_state::<Arc<StdMutex<ConfigService>>>() {
            let config = config.inner().clone();
            let window_for_close = webview_window.clone();
            webview_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let action = config
                        .lock()
                        .ok()
                        .and_then(|config| config.get::<String>("close_action"))
                        .unwrap_or_else(|| "ask".to_string());

                    // 没有系统托盘时不允许隐藏驻留：窗口一藏，普通用户既找不到入口也
                    // 退不掉进程（单实例插件还会让之后启动的新实例顶到旧实例上）。
                    // 此时「关闭」必须真的等于退出。
                    if !crate::tray::is_tray_available() {
                        api.prevent_close();
                        window_for_close.app_handle().exit(0);
                        return;
                    }

                    if action != "close" {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                }
            });
        }
    }

    app.get_window("main")
        .ok_or_else(|| "main window was not registered after creation".to_string())
}

/// 解析主窗口/托盘面板要加载的 URL（含 debug 下 Vite dev server 探测与自定义协议回退）。
///
/// 仅桌面使用：移动端主窗口由 `tauri.android.conf.json` 静态创建，不做运行时建窗，
/// 因此移动端不引用本函数（加 `cfg(desktop)` 避免 dead_code 告警）。
#[cfg(desktop)]
fn app_webview_url<R: Runtime>(
    #[cfg_attr(not(debug_assertions), allow(unused_variables))]
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
/// 自定义协议名（桌面 debug 专用：Vite dev server 不可用时提供构建产物）。
#[cfg(all(desktop, debug_assertions))]
const DEV_ASSET_SCHEME: &str = "endprotocol";

/// 构造自定义协议 URL（`dev_asset_url` 的调用方 `app_webview_url` 仅桌面存在）。
#[cfg(all(desktop, debug_assertions))]
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

#[cfg(all(desktop, debug_assertions))]
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
