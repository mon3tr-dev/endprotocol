use std::sync::Arc;
use tauri::Manager;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 提权启动 helper 模式（见 utils/official_launcher.rs）：
    // 必须在 logger / tracing / Tauri 初始化之前截获 —— 这个进程是被 launcher_start_game
    // 以 runas 拉起来的第二个实例，只负责「伪造官方父进程 + 启动游戏 + 转发退出码」，
    // 全程不创建任何窗口；退出码即游戏退出码。
    if let Some(code) = utils::official_launcher::try_run_helper() {
        // try_run_helper 内部已完成收尾（挂起的官方启动器已被终止并等待结束）。
        std::process::exit(code);
    }

    // 初始化日志系统
    if let Err(e) = utils::logger::init_logger() {
        eprintln!("Failed to initialize logger: {}", e);
    }

    // 初始化 tracing subscriber，将 tracing 事件桥接到自定义 Logger
    utils::logger::init_tracing_subscriber();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
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
            commands::launcher::launcher_detect_channel,
            commands::launcher::launcher_scan_install_dir,
            commands::launcher::launcher_get_disk_space,
            commands::launcher::launcher_switch_channel,
            commands::launcher::launcher_cancel_switch,
            commands::launcher::launcher_cancel_all,
        ])
        .setup(|app| {
            // 初始化配置服务（使用 std::sync::Mutex，因为它是同步的）
            let config_service = Arc::new(std::sync::Mutex::new(
                ConfigService::new().map_err(|e| e.to_string())?,
            ));
            app.manage(config_service.clone());

            // 启动时自动录制：必须在任何 API 请求发出之前开始
            let auto_capture = config_service
                .lock()
                .map(|config| config.get::<bool>("capture_autostart"))
                .unwrap_or(None)
                .unwrap_or(false);
            if auto_capture {
                match utils::capture::start() {
                    Ok(status) => {
                        log_info!(
                            "[capture] auto-started on launch: {:?}",
                            status.session_id
                        );
                    }
                    Err(e) => {
                        log_warn!("[capture] auto-start on launch failed: {}", e);
                    }
                }
            }

            // 初始化系统托盘
            if let Err(e) = tray::setup_tray(app.handle(), config_service.clone()) {
                eprintln!("Failed to setup tray: {}", e);
            }

            // 初始化 Skland 服务
            let skland_service = Arc::new(SklandService::new(config_service.clone()));

            // 初始化头像缓存服务
            let avatar_cache_service =
                Arc::new(AvatarCacheService::new().map_err(|e| e.to_string())?);

            // 初始化抽卡记录服务
            let gacha_service = Arc::new(GachaService::new(app.handle().clone()));
            app.manage(gacha_service);

            // 初始化网络数据服务
            let network_service = Arc::new(NetworkService::new(
                skland_service.clone(),
                avatar_cache_service.clone(),
            ));

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

            // 处理窗口关闭事件：根据配置决定是关闭还是最小化到托盘
            let config_for_close = config_service.clone();
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let action = config_for_close
                            .lock()
                            .ok()
                            .and_then(|c| c.get::<String>("close_action"))
                            .unwrap_or_else(|| "ask".to_string());

                        match action.as_str() {
                            "minimize_to_tray" | "ask" => {
                                // For "ask" from OS close button, hide to tray as default
                                api.prevent_close();
                                let _ = window_clone.hide();
                            }
                            "close" => {
                                // Allow default close behavior
                            }
                            _ => {
                                // Default: hide to tray
                                api.prevent_close();
                                let _ = window_clone.hide();
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
