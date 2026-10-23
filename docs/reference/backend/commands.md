# Tauri 命令层（IPC 入口）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖范围：`src-tauri/src/commands/` 下 16 个文件，当前参考表收录 **113 个不同命令名**；源码含 116 处命令注解（其中有同名定义）。注册入口见 `src-tauri/src/lib.rs` 的 `generate_handler!`。

## 命令速查表

| 命令名 | 定义位置 | 参数 | 返回 | 内部调用 |
| --- | --- | --- | --- | --- |
| `get_accounts` | commands/account.rs:16 | `state: State<Arc<Mutex<AccountService>>>` | `Result<Vec<AccountInfo>, String>` | `ConfigService::get_all`、`AccountService::get_cached_accounts` / `AccountService::get_accounts` |
| `get_skland_accounts` | commands/account.rs:67 | `state: State<Arc<Mutex<AccountService>>>` | `Result<Vec<SklandAccountInfo>, String>` | `AccountService::get_skland_accounts` |
| `save_skland_account` | commands/account.rs:76 | `state`、`cred: String`、`token: String`、`user_id: String` | `Result<bool, String>` | `AccountService::save_skland_account` |
| `get_skland_account_roles` | commands/account.rs:91 | `state`、`user_id: String` | `Result<AccountLoginResult, String>` | `AccountService::get_skland_account_roles` |
| `get_skland_user_info` | commands/account.rs:104 | `state`、`user_id: String` | `Result<SklandUserInfo, String>` | `AccountService::get_skland_user_info` |
| `get_skland_games` | commands/account.rs:117 | `state`、`user_id: String`、`force: Option<bool>` | `Result<Vec<SklandGameInfo>, String>` | `AccountService::get_skland_games` |
| `add_account` | commands/account.rs:131 | `state`、`login_request: LoginRequest` | `Result<AccountLoginResult, String>` | `AccountService::add_account` |
| `logout_account` | commands/account.rs:144 | `state`、`account_id: String`、`keep_device_token: Option<bool>` | `Result<bool, String>` | `AccountService::logout_account` |
| `batch_logout` | commands/account.rs:157 | `state`、`account_ids: Vec<String>` | `Result<bool, String>` | `AccountService::batch_logout` |
| `refresh_accounts` | commands/account.rs:167 | `state` | `Result<AccountRefreshResult, String>` | `AccountService::refresh_accounts` |
| `send_verification_code` | commands/account.rs:176 | `state`、`request: SendCodeRequest` | `Result<bool, String>` | `AccountService::send_verification_code` |
| `add_account_by_code` | commands/account.rs:189 | `state`、`login_request: CodeLoginRequest` | `Result<AccountLoginResult, String>` | `AccountService::add_account_by_code` |
| `gen_scan_login` | commands/account.rs:202 | `state` | `Result<ScanLoginInfo, String>` | `AccountService::gen_scan_login` |
| `scan_status` | commands/account.rs:211 | `state`、`scan_id: String` | `Result<ScanStatus, String>` | `AccountService::scan_status` |
| `add_account_by_scan` | commands/account.rs:224 | `state`、`scan_code: String` | `Result<AccountLoginResult, String>` | `AccountService::add_account_by_scan` |
| `save_selected_roles` | commands/account.rs:237 | `state`、`cred`、`token`、`user_id`、`selected_roles: Vec<RoleDisplayInfo>` | `Result<Vec<AccountInfo>, String>` | `AccountService::save_selected_roles` |
| `get_selected_account` | commands/account.rs:253 | `state` | `Result<Option<String>, String>` | `AccountService::get_config_service` → `ConfigService::get("selected_account_id")` |
| `set_selected_account` | commands/account.rs:264 | `state`、`account_id: String` | `Result<bool, String>` | `ConfigService::set("selected_account_id", …)` |
| `check_and_refresh_cred` | commands/account.rs:282 | `state`、`user_id: String` | `Result<Option<(String, String)>, String>` | `AccountService::check_and_refresh_user_cred` |
| `set_lazy_load_enabled` | commands/account.rs:295 | `state`、`enabled: bool` | `Result<bool, String>` | `AccountService::set_lazy_load_enabled` |
| `is_lazy_load_enabled` | commands/account.rs:309 | `state` | `Result<bool, String>` | `AccountService::is_lazy_load_enabled` |
| `set_current_role_id` | commands/account.rs:318 | `state`、`role_id: Option<String>` | `Result<bool, String>` | `AccountService::set_current_role_id` |
| `query_role_data` | commands/account.rs:340 | `state`、`role_id`、`api_name`、`paths: Vec<String>` | `Result<serde_json::Value, String>` | `AccountService::query_role_data` |
| `get_attendance` | commands/attendance.rs:59 | `state: State<Arc<Mutex<AccountService>>>`、`role_id: String` | `Result<serde_json::Value, String>` | 本地 `lookup_cred_token`、`AccountService::check_and_refresh_user_cred`、`SklandService::call_skland_api`(GET)、`AvatarCacheService::get_or_download_image` |
| `do_attendance` | commands/attendance.rs:181 | `state`、`role_id: String` | `Result<serde_json::Value, String>` | 本地 `lookup_cred_token`、`AccountService::check_and_refresh_user_cred`、`SklandService::call_skland_api`(POST) |
| `capture_start` | commands/capture.rs:3 | 无 | `Result<CaptureStatus, String>` | `utils::capture::start` |
| `capture_stop` | commands/capture.rs:8 | 无 | `Result<CaptureStatus, String>` | `utils::capture::stop` |
| `capture_status` | commands/capture.rs:13 | 无 | `Result<CaptureStatus, String>` | `utils::capture::status` |
| `capture_list_sessions` | commands/capture.rs:18 | 无 | `Result<Vec<CaptureSessionMeta>, String>` | `utils::capture::list_sessions` |
| `capture_read_entries` | commands/capture.rs:23 | `id: String`、`offset: u64`、`limit: u64` | `Result<CapturePage, String>` | `utils::capture::read_entries` |
| `capture_delete_session` | commands/capture.rs:32 | `id: String` | `Result<(), String>` | `utils::capture::delete_session` |
| `capture_dir` | commands/capture.rs:37 | 无 | `Result<String, String>` | `utils::capture::capture_root` + `fs::create_dir_all` |
| `get_card_settings` | commands/card_config.rs:9 | `state`、`card_id: String` | `Result<Value, String>` | `ConfigService::get("card_settings.{card_id}")` |
| `save_card_settings` | commands/card_config.rs:26 | `state`、`card_id: String`、`settings: Value` | `Result<bool, String>` | `ConfigService::get` + 对象浅合并 + `ConfigService::set` |
| `remove_card_settings` | commands/card_config.rs:66 | `state`、`card_id: String` | `Result<bool, String>` | `ConfigService::remove("card_settings.{card_id}")` |
| `capture_screen` | commands/color_picker.rs:36 | `window: WebviewWindow` | `Result<ScreenCapture, String>` | Windows：`window` 控制 + GDI 截屏；非 Windows：返回仅支持 Windows 的错误 |
| `finish_screen_pick` | commands/color_picker.rs:56 | `window: WebviewWindow` | `()`（无返回） | Windows：退出全屏并聚焦；非 Windows：空实现 |
| `get_config` | commands/config.rs:9 | `state: State<Arc<Mutex<ConfigService>>>`、`key: String` | `Option<Value>` | `ConfigService::get` |
| `get_game_launch_command` | commands/startup.rs:185 | `config_service: State<Arc<Mutex<ConfigService>>>` | `Result<String, String>` | 校验/更新 `main_exe_path` 并返回含 `--silent --launch-game` 的带引号命令 |
| `set_config` | commands/config.rs:16 | `state`、`key: String`、`value: Value` | `Result<(), String>` | `ConfigService::set` |
| `remove_config` | commands/config.rs:27 | `state`、`key: String` | `bool` | `ConfigService::remove` |
| `get_all_configs` | commands/config.rs:34 | `state` | `HashMap<String, Value>` | `ConfigService::get_all` |
| `get_gacha_pool_meta` | commands/gacha.rs:84 | `account_state`、`gacha_state: State<Arc<GachaService>>`、`role_id: String` | `Result<serde_json::Value, String>` | 本地 `lookup_u8token`/`ensure_fresh_u8token`、`GachaService::get_pool_meta` |
| `sync_gacha_records` | commands/gacha.rs:116 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `ensure_fresh_u8token`、`GachaService::sync_records` |
| `get_saved_gacha_records` | commands/gacha.rs:148 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `GachaService::load_records_or_empty`（不联网） |
| `sync_weapon_gacha_records` | commands/gacha.rs:179 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `ensure_fresh_u8token`、`GachaService::sync_weapon_records` |
| `get_saved_weapon_gacha_records` | commands/gacha.rs:215 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `GachaService::load_weapon_records_or_empty`（不联网） |
| `resolve_gacha_avatar_map` | commands/gacha.rs:359 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `GachaService::{load_records_or_empty, load_weapon_records_or_empty, load_avatar_map, save_avatar_map, load_total_catalog, save_total_catalog, total_catalog_is_stale}`、`AccountService::{check_and_refresh_user_cred, query_role_data}`、本地 `resolve_missing_from_catalog` |
| `get_gacha_record_stats` | commands/gacha.rs:518 | `account_state`、`gacha_state`、`role_id: String` | `Result<serde_json::Value, String>` | `GachaService::{load_records_or_empty, group_records_by_pool, count_by_rarity, count_by_char}` |
| `read_image_file` | commands/image.rs:10 | `path: String` | `Result<Vec<u8>, String>` | `fs::read` |
| `get_image_cache_dir` | commands/image.rs:16 | 无 | `Result<String, String>` | `utils::paths::image_cache_dir` |
| `download_image` | commands/image.rs:29 | `url: String`、`cache_dir: String`、`sub_dir: String` | `Result<String, String>` | `resolve_url_subdir`/`all_sub_dir_names`、本地 `extract_filename_from_url`、`capture::send`（reqwest GET，带 Referer） |
| `get_backgrounds_dir` | commands/image.rs:141 | 无 | `Result<String, String>` | `utils::paths::backgrounds_dir` |
| `save_background_image` | commands/image.rs:152 | `data: String`（base64/dataURL） | `Result<String, String>` | `paths::backgrounds_dir`、清空目录、`base64` 解码、写 `bg.webp` |
| `delete_background_image` | commands/image.rs:190 | 无 | `Result<(), String>` | `paths::backgrounds_dir` + 删除目录下全部文件 |
| `launcher_get_process_read_bytes` | commands/launcher.rs:13 | 无 | `Result<u64, String>` | Win32 `GetProcessIoCounters`（非 Windows 返回 0） |
| `launcher_check_status` | commands/launcher.rs:31 | `service: State<Arc<Mutex<GameLauncherService>>>`、`channel: String`、`install_path: String` | `Result<GameStatus, String>` | 本地 `parse_channel`、`GameLauncherService::check_status` |
| `launcher_install_or_update` | commands/launcher.rs:59 | `app: AppHandle`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`（默认 8）、`resume: Option<bool>`（默认 true） | `Result<LauncherResult, String>` | `GameLauncherService::install_or_update`，按线程数并发下载、可断点续传，进度回调 emit `launcher-progress` |
| `launcher_verify_and_repair` | commands/launcher.rs:122 | `app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`、`quick: Option<bool>`、`resume: Option<bool>`（默认 true） | `Result<LauncherResult, String>` | `GameLauncherService::verify_and_repair`，emit `launcher-progress`；失败时额外发出 `error` 终态事件 |
| `launcher_get_remote_version` | commands/launcher.rs:179 | `service`、`channel` | `Result<RemotePackage, String>` | `GameLauncherService::get_latest_package` |
| `launcher_preload_download` | commands/launcher.rs:192 | `app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`（默认 8）、`resume: Option<bool>`（默认 true） | `Result<LauncherResult, String>` | `GameLauncherService::preload_download`（独立预下载传入 `None`，由服务获取包信息），emit `launcher-progress` |
| `launcher_install_preload` | commands/launcher.rs:236 | `app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`（默认 8）、`resume: Option<bool>`（默认 true） | `Result<LauncherResult, String>` | `GameLauncherService::install_preload`：校验并下载分卷、解密安装，emit `launcher-progress`；前端安装成功后另行触发快速校验 |
| `launcher_get_payload_state` | commands/launcher.rs:279 | `service`、`channel` | `Result<Option<PayloadState>, String>` | `GameLauncherService::get_payload_state` |
| `launcher_cancel_download` | commands/launcher.rs:290 | `install_path: Option<String>` | `Result<(), String>` | 带非空路径时先 `request_cancel_cleanup`（记录删除意图）再 `cancel_download`/`cleanup_staging_files`；不带路径仅置取消标志、保留缓存 |
| `launcher_has_download_cache` | commands/launcher.rs:309 | `install_path: String` | `Result<bool, String>` | `game_launcher_service::has_download_cache` |
| `launcher_reset_download_cancel` | commands/launcher.rs:317 | 无 | `Result<(), String>` | `game_launcher_service::reset_download_cancel` |
| `launcher_cancel_switch` | commands/launcher.rs:323 | 无 | `Result<(), String>` | `game_launcher_service::cancel_switch` |
| `launcher_cancel_all` | commands/launcher.rs:329 | 无 | `Result<(), String>` | `game_launcher_service::cancel_download` + `cancel_switch` |
| `launcher_decrypt_file` | commands/launcher.rs:336 | `file_path: String` | `Result<String, String>` | `utils::hg_crypto::decrypt_file_to_string` |
| `launcher_get_banners` | commands/launcher.rs:307 | `service`、`channel` | `Result<Vec<BannerItem>, String>` | `GameLauncherService::get_banners` |
| `launcher_get_announcements` | commands/launcher.rs:318 | `service`、`channel` | `Result<Vec<AnnouncementItem>, String>` | `GameLauncherService::get_announcements` |
| `launcher_get_notice_content` | commands/launcher.rs:329 | `service`、`channel` | `Result<LauncherNoticeContent, String>` | `GameLauncherService::get_notice_content`（Banner + 公告合并内容） |
| `launcher_get_background_image` | commands/launcher.rs:340 | `service`、`channel` | `Result<Option<BackgroundMedia>, String>` | `GameLauncherService::get_background_image` |
| `launcher_start_game` | commands/launcher.rs:443 | `config_service: State<Arc<StdMutex<ConfigService>>>`、`install_path: String`、`channel: String`、`dx11: Option<bool>`（省略时读配置 `launcher_dx11`，默认 false） | `Result<LauncherResult, String>` | `parse_channel`、`taskkill /F /IM`、`official_launcher::launch_via_official_parent`（已提权时本进程直接伪造官方父进程；否则提权 helper）/ 回退 `direct_launch` → `shell_execute_game`；DX11 开启时给游戏参数追加 `-force-d3d11`；Steam 启动且应用未提权时在 `warning` 返回 `overlay_unavailable` |
| `launcher_browse_folder` | commands/launcher.rs:523 | 无 | `Result<Option<String>, String>` | `rfd::FileDialog::pick_folder` |
| `launcher_get_disk_space` | commands/launcher.rs:540 | `path: String` | `Result<DiskSpace, String>` | 调用 `powershell Get-PSDrive` 子进程解析 used/free |
| `launcher_scan_install_dir` | commands/launcher.rs:599 | `service`、`channel`、`install_path` | `Result<FileScanResult, String>` | `GameLauncherService::scan_install_dir` |
| `launcher_detect_channel` | commands/launcher.rs:611 | `install_path: String` | `Result<Option<String>, String>` | 纯本地特征文件探测（hgsdk.dll / PCGameSDK.dll / gfsdk.dll 等） |
| `launcher_check_executable` | commands/launcher.rs:662 | `install_path: String`、`channel: String` | `Result<bool, String>` | `parse_channel` + `GameChannel::executable_name` + `Path::exists` |
| `launcher_check_game_running` | commands/launcher.rs:670 | `channel: String` | `Result<bool, String>` | `parse_channel` + `utils::process::is_process_running`（同名进程需有顶层窗口或在 90 秒启动宽限内，排除无窗口挂起残留）；游戏面板每 3 秒轮询 |
| `launcher_get_game_playtime` | commands/launcher.rs:677 | 无 | `GamePlaytime`（同步返回） | `utils::game_playtime::snapshot`（累计总时长 + 实时会话 + 运行态） |
| `launcher_kill_game` | commands/launcher.rs:682 | `channel: String` | `Result<bool, String>` | 隐藏控制台执行 `taskkill /T /F /IM`（两次）→ `wmic process … terminate` 兜底 |
| `launcher_switch_channel` | commands/launcher.rs:731 | `service`、`from_channel`、`to_channel`、`install_path`、`app: AppHandle` | `Result<String, String>` | `GameLauncherService::switch_channel` |
| `get_backend_logs` | commands/logs.rs:4 | 无 | `Vec<LogEntry>` | `utils::logger::get_logger().get_recent_logs()` |
| `get_log_dir` | commands/diagnostics.rs:7 | 无 | `Result<String, String>` | `utils::paths::log_dir()` |
| `export_diagnostics` | commands/diagnostics.rs:15 | `app: AppHandle`、`frontend_logs: Vec<FrontendLogEntry>`、`context: Option<String>` | `Result<String, String>` | `utils::diagnostics::export` |
| `get_pending_crash_reports` | commands/diagnostics.rs:25 | 无 | `Vec<CrashReportInfo>` | `utils::crash::pending_reports` |
| `ack_crash_reports` | commands/diagnostics.rs:31 | `paths: Vec<String>` | `Result<(), String>` | `utils::crash::acknowledge` |
| `get_api_health` | commands/diagnostics.rs:37 | 无 | `ApiHealthSnapshot` | `utils::api_health::snapshot` |
| `reset_api_health` | commands/diagnostics.rs:43 | 无 | `()` | `utils::api_health::reset` |
| `get_tray_user_info` | commands/tray.rs:8 | `config_service: State<Arc<Mutex<ConfigService>>>` | `Result<TrayUserInfo, String>` | `ConfigService::get::<TrayUserInfo>("tray_user_info")` |
| `steam_shortcut_defaults` | commands/startup.rs:194 | `config_service: State<Arc<Mutex<ConfigService>>>` | `Result<SteamShortcutDefaults, String>` | Steam 弹窗默认值：名字、从 `Endfield.exe` 提取的 `.ico`、DX11、上次勾选的两项 Overlay 选项、开始菜单 Steam 快捷方式数量、当前是否已提权 |
| `pick_steam_icon` | commands/startup.rs:243 | 无 | `Result<Option<String>, String>` | `rfd` 选择 `ico`/`png`/`exe`，取消返回 `None` |
| `pick_steam_icon_source` | commands/startup.rs:253 | 无 | `Result<Option<String>, String>` | `rfd` 选择用于提取图标的 exe，取消返回 `None` |
| `extract_steam_icon` | commands/startup.rs:265 | `exe_path: String` | `Result<String, String>` | `utils::game_icon::extract_icon` 重新组装 `RT_GROUP_ICON` 为 `.ico`，写出到应用数据目录并返回路径 |
| `create_game_shortcut` | commands/startup.rs:272 | `config_service: State<Arc<Mutex<ConfigService>>>`、`dx11: Option<bool>`（缺省读配置 `launcher_dx11`） | `Result<Option<String>, String>` | 用户通过 `rfd` 选择 `.lnk` 路径；PowerShell COM 创建快捷方式，启动参数按开关包含 `--dx11`，返回路径；取消选择返回 `None` |
| `add_steam_shortcut` | commands/startup.rs:345 | `config_service: State<Arc<Mutex<ConfigService>>>`、`options: SteamShortcutOptions`（`name`、`icon_path`、`dx11`、`create_admin_shortcut`、`elevate_start_menu`） | `Result<AddSteamShortcutResult, String>` | 允许 Steam 运行中写入：`utils::steam::add_shortcut` 按名字 upsert 当前账户 `userdata/<id>/config/shortcuts.vdf`；按勾选创建管理员 Steam 快捷方式（用户选路径）并提升开始菜单 Steam 快捷方式；返回 vdf 路径与新建/提升结果；非 Windows 返回 `Err` |
| `set_tray_user` | commands/tray.rs:17 | `app: AppHandle`、`config_service`、`role_id: String` | `Result<(), String>` | `ConfigService::set("tray_user_info", …)`、`tray::update_tray_menu` |
| `update_tray_user_data` | commands/tray.rs:38 | `app`、`config_service`、`user_info: TrayUserInfo` | `Result<(), String>` | `ConfigService::set("tray_user_info", …)`、`tray::update_tray_menu` |
| `show_tray_panel` | commands/tray.rs:56 | `app: AppHandle` | `Result<(), String>` | `tray::show_tray_panel` |
| `hide_tray_panel` | commands/tray.rs:62 | `app: AppHandle` | `Result<(), String>` | `tray::hide_tray_panel` |
| `show_main_window` | commands/tray.rs:68 | `app: AppHandle` | `Result<(), String>` | `tray::show_main_window_focus` + `tray::hide_tray_panel` |
| `app_quit` | commands/tray.rs:77 | `app: AppHandle` | `()`（无返回） | `app.exit(0)` |
| `write_file` | commands/updater.rs:105 | `path: String`、`data: Vec<u8>` | `Result<(), String>` | `fs::create_dir_all(parent)` + `fs::write` |
| `get_temp_dir` | commands/updater.rs:117 | 无 | `Result<String, String>` | `std::env::temp_dir` |
| `fetch_url` | commands/updater.rs:125 | `url: String` | `Result<String, String>` | `capture::send`（reqwest GET）→ `resp.text()` |
| `cancel_download` | commands/updater.rs:139 | 无 | `()`（无返回） | 模块级 `DOWNLOAD_CANCELLED` AtomicBool 置 true |
| `reset_download_cancel` | commands/updater.rs:145 | 无 | `()`（无返回） | `DOWNLOAD_CANCELLED` 置 false |
| `download_file` | commands/updater.rs:153 | `app: AppHandle`、`url: String`、`path: String` | `Result<u64, String>` | `capture::send_stream` 流式下载，每 256KB emit `download-progress` |
| `check_update_endpoint` | commands/updater.rs:58 | `app: AppHandle`、`endpoint: String` | `Result<Option<UpdateEndpointInfo>, String>` | 限定镜像/GitHub 清单，使用 updater 检查本机平台与版本 |
| `install_update_endpoint` | commands/updater.rs:73 | `app: AppHandle`、`endpoint: String` | `Result<(), String>` | 使用 updater 验签、下载并安装指定清单中的本机平台更新包；emit `download-progress` |
| `run_installer` | commands/updater.rs:217 | `app: AppHandle`、`path: String` | `Result<(), String>` | Windows：静默启动 NSIS 安装器并退出应用；非 Windows：返回不支持错误 |
| `minimize_window` | commands/window.rs:3 | `app: AppHandle<R>` | `()`（无返回） | `app.get_webview_window("main")` → `window.minimize()` |
| `toggle_maximize_window` | commands/window.rs:10 | `app: AppHandle<R>` | `()`（无返回） | `is_maximized` → `maximize()` / `unmaximize()` |
| `close_window` | commands/window.rs:21 | `app: AppHandle<R>` | `()`（无返回） | `window.close()` |
| `minimize_to_tray` | commands/window.rs:28 | `app: AppHandle<R>` | `Result<(), String>` | `window.hide()` |
| `get_system_snapshot` | commands/system_resource.rs:9 | `state: State<Arc<Mutex<SystemResourceService>>>` | `Result<SystemSnapshot, String>` | `SystemResourceService::snapshot`（`spawn_blocking`；sysinfo + nvidia-smi） |

---

## `src-tauri/src/commands/mod.rs`
**职责**：纯模块声明文件，导出 `account`、`attendance`、`capture`、`card_config`、`color_picker`、`config`、`gacha`、`image`、`launcher`、`logs`、`startup`、`system_resource`、`tray`、`updater`、`window` 共 15 个子模块。无命令定义，无逻辑。

## `src-tauri/src/commands/startup.rs`
**职责**：静默游戏启动命令的配置、命令行文本、Windows `.lnk` 快捷方式，以及 Steam 第三方游戏条目的参数弹窗支撑（默认值、图标提取、写入）。Steam 条目允许在 Steam 运行时写入（写完需重启 Steam 才可见）。
**导出**：`refresh_main_exe_path`（启动初始化辅助函数）、`SteamShortcutOptions`、`SteamShortcutDefaults`、`AddSteamShortcutResult`、Tauri 命令 `get_game_launch_command`、`steam_shortcut_defaults`、`pick_steam_icon`、`pick_steam_icon_source`、`extract_steam_icon`、`create_game_shortcut`、`add_steam_shortcut`。
**主要依赖**：`ConfigService`、`rfd::FileDialog`、Windows PowerShell `WScript.Shell` COM、`utils::steam`、`utils::game_icon`、`utils::official_launcher`（`process_is_elevated`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SteamShortcutOptions`（`Serialize`/`Deserialize`） | startup.rs:36 | 弹窗提交值：`name`、`icon_path: Option<String>`、`dx11: Option<bool>`、`create_admin_shortcut`、`elevate_start_menu`（后两项 `#[serde(default)]`） |
| `SteamShortcutDefaults`（`Serialize`） | startup.rs:53 | `steam_shortcut_defaults` 的返回：`name`、`icon_path`、`icon_extracted`、`game_exe_found`、`dx11`、`create_admin_shortcut`、`elevate_start_menu`、`start_menu_shortcut_count`、`is_elevated` |
| `AddSteamShortcutResult`（`Serialize`） | startup.rs:73 | `add_steam_shortcut` 的返回：`shortcuts_path`、`admin_shortcut: Option<String>`、`elevated_start_menu: Vec<String>` |
| `normalize_path` | startup.rs:82 | 剥除 `canonicalize()` 返回的 `\\?\` / `\\?\UNC\` 扩展长度前缀，避开 UNC 的还原为 `\\` |
| `ensure_main_exe_path` | startup.rs:94 | 规范化当前 exe 路径；当配置缺失、无效或已变化时更新 `main_exe_path` |
| `refresh_main_exe_path` | startup.rs:119 | 应用初始化时同步 exe 路径 |
| `launch_args`（`pub(crate)`） | startup.rs:26 | 组合 `--silent --launch-game`，按需追加 `--dx11`；不再支持 `--close-after-launch` |
| `resolve_install` | startup.rs:124 | 读取并校验 `launcher_install_path` / `launcher_channel`，返回游戏 `Endfield.exe` 路径 |
| `steam_icon_path` | startup.rs:158 | 图标缓存路径 `%LOCALAPPDATA%\\cn.msk-network.endprotocol\\steam\\endfield.ico` |
| `default_icon` | startup.rs:165 | 从游戏 exe 提取 `.ico`，返回 `(路径, 是否提取成功, 游戏是否存在)`；提取失败回退为 exe 自身路径 |
| `get_game_launch_command` | startup.rs:186 | 返回带引号的当前 exe 路径及 `--silent --launch-game` |
| `steam_shortcut_defaults` | startup.rs:195 | 弹窗默认值：名字缺省「明日方舟：终末地」、图标优先沿用上次保存的自定义图标否则重新提取、DX11 与应用设置同源、两项 Overlay 选项取上次保存值；附带开始菜单 Steam 快捷方式数量与当前进程是否已提权 |
| `pick_steam_icon` | startup.rs:244 | `rfd` 选择图标文件（`ico`/`png`/`exe`），取消返回 `None` |
| `pick_steam_icon_source` | startup.rs:254 | `rfd` 选择用于提取图标的 exe，取消返回 `None` |
| `extract_steam_icon` | startup.rs:266 | 对指定 exe 调用 `utils::game_icon::extract_icon`，返回生成的 `.ico` 路径 |
| `create_game_shortcut` | startup.rs:273 | 读取 `dx11`（缺省读 `launcher_dx11`），用户选择保存路径后创建 Windows `.lnk`；exe 缺失时不设置图标；取消返回 `None` |
| `add_steam_shortcut`（async） | startup.rs:346 | 校验名字非空 → `utils::steam::add_shortcut` 写 `shortcuts.vdf`（同名条目更新）→ 回写 `steam_shortcut_name` / `steam_shortcut_icon` / 两个 Overlay 选项 → 按勾选创建管理员 Steam 快捷方式（`rfd` 选保存路径，取消即报错）与提升开始菜单 Steam 快捷方式 |
| `powershell_literal`（私有，仅 Windows） | startup.rs:469 | 单引号转义（`'` → `''`），用于嵌入脚本路径串 |
| `run_powershell`（私有，仅 Windows） | startup.rs:474 | `-EncodedCommand` 执行脚本并收集 stderr/stdout 作为错误详情 |

**备注**：配置文件仍为 `%LOCALAPPDATA%\\cn.msk-network.endprotocol\\app_config.json`；键为 `main_exe_path`、`launcher_install_path`、`launcher_channel`、`launcher_dx11`，以及 Steam 弹窗记忆键 `steam_shortcut_name`、`steam_shortcut_icon`、`steam_create_admin_shortcut`、`steam_elevate_start_menu`。`main_exe_path` 不含 `\\?\` 前缀。`.lnk` 快捷方式目标为主程序 exe，工作目录为 exe 所在目录；`Endfield.exe` 存在时其内嵌图标直接通过 `$shortcut.IconLocation = '<Endfield.exe>,0'` 引用；exe 缺失则不设置图标。Steam 条目的 `Exe` 为主程序 exe、`LaunchOptions` 为静默启动参数，`icon` 为提取出的 `.ico`。**不再检查 `steam.exe` 是否正在运行**——改为成功提示里告知用户需重启 Steam。

---

## `src-tauri/src/commands/account.rs`
**职责**：账号体系的 IPC 门面（376 行 / 23 个命令）。绝大多数是 `AccountService`（`State<Arc<tokio::sync::Mutex<AccountService>>>`）的薄包装；只有 `get_accounts`、`get_selected_account`、`set_selected_account` 在命令层直接读写配置。

### `get_accounts`
- 位置：account.rs:16，`#[tauri::command]`（async）
- 参数：`state: State<'_, Arc<Mutex<AccountService>>>`
- 返回：`Result<Vec<AccountInfo>, String>`
- 逻辑：先取 `AccountService::get_config_service()` 锁配置，遍历所有 `account_token_*` 键提取 user_id，逐个调用 `AccountService::get_cached_accounts(user_id)` 尝试命中内存缓存；若**全部**用户缓存命中且非空则直接返回（`log_debug!` 记录 cache hit）。任一用户未命中则释放锁，改调 `AccountService::get_accounts().await` 走 API 拉全量并回填缓存。
- 配置键：`account_token_*`

### `get_skland_accounts`
- 位置：account.rs:67（async）
- 参数：`state`
- 返回：`Result<Vec<SklandAccountInfo>, String>`
- 逻辑：直连 `AccountService::get_skland_accounts()`，同步返回已绑定的森空岛账号列表，不联网。

### `save_skland_account`
- 位置：account.rs:76（async）
- 参数：`state`、`cred: String`、`token: String`、`user_id: String`
- 返回：`Result<bool, String>`（成功恒为 `true`）
- 逻辑：用户确认绑定后调用 `AccountService::save_skland_account(cred, token, user_id)` 落盘，错误统一 `map_err(|e| e.to_string())`。

### `get_skland_account_roles`
- 位置：account.rs:91（async）
- 参数：`state`、`user_id: String`
- 返回：`Result<AccountLoginResult, String>`
- 逻辑：调用 `AccountService::get_skland_account_roles(user_id)`，拉取该森空岛账号下的游戏角色列表。

### `get_skland_user_info`
- 位置：account.rs:104（async）
- 参数：`state`、`user_id: String`
- 返回：`Result<SklandUserInfo, String>`
- 逻辑：调用 `AccountService::get_skland_user_info(user_id)`，返回昵称、头像、游戏等级/积分等资料。

### `get_skland_games`
- 位置：account.rs:117（async）
- 参数：`state`、`user_id: String`、`force: Option<bool>`
- 返回：`Result<Vec<SklandGameInfo>, String>`
- 逻辑：以 `force.unwrap_or(false)` 调用 `AccountService::get_skland_games(user_id, force)`；默认读缓存的游戏列表（图标等），`force=true` 才重新请求。

### `add_account`
- 位置：account.rs:131（async）
- 参数：`state`、`login_request: LoginRequest`
- 返回：`Result<AccountLoginResult, String>`
- 逻辑：调用 `AccountService::add_account(login_request)` 完成密码/令牌登录并写入账号配置。

### `logout_account`
- 位置：account.rs:144（async）
- 参数：`state`、`account_id: String`、`keep_device_token: Option<bool>`
- 返回：`Result<bool, String>`
- 逻辑：以 `keep_device_token.unwrap_or(true)` 调用 `AccountService::logout_account`（默认保留设备令牌），返回是否成功。

### `batch_logout`
- 位置：account.rs:157（async）
- 参数：`state`、`account_ids: Vec<String>`
- 返回：`Result<bool, String>`
- 逻辑：调用 `AccountService::batch_logout(account_ids)` 批量登出。

### `refresh_accounts`
- 位置：account.rs:167（async）
- 参数：`state`
- 返回：`Result<AccountRefreshResult, String>`
- 逻辑：调用 `AccountService::refresh_accounts()`，强制刷新全部账号数据，返回成功/失败统计。

### `send_verification_code`
- 位置：account.rs:176（async）
- 参数：`state`、`request: SendCodeRequest`
- 返回：`Result<bool, String>`
- 逻辑：调用 `AccountService::send_verification_code(request)` 发送登录验证码。

### `add_account_by_code`
- 位置：account.rs:189（async）
- 参数：`state`、`login_request: CodeLoginRequest`
- 返回：`Result<AccountLoginResult, String>`
- 逻辑：调用 `AccountService::add_account_by_code(login_request)`，用验证码登录并保存账号。

### `gen_scan_login`
- 位置：account.rs:202（async）
- 参数：`state`
- 返回：`Result<ScanLoginInfo, String>`
- 逻辑：调用 `AccountService::gen_scan_login()`，生成扫码登录二维码信息。

### `scan_status`
- 位置：account.rs:211（async）
- 参数：`state`、`scan_id: String`
- 返回：`Result<ScanStatus, String>`
- 逻辑：调用 `AccountService::scan_status(&scan_id)` 轮询扫码结果。

### `add_account_by_scan`
- 位置：account.rs:224（async）
- 参数：`state`、`scan_code: String`
- 返回：`Result<AccountLoginResult, String>`
- 逻辑：调用 `AccountService::add_account_by_scan(scan_code)`，扫码确认后落账号。

### `save_selected_roles`
- 位置：account.rs:237（async）
- 参数：`state`、`cred`、`token`、`user_id`（均 `String`）、`selected_roles: Vec<RoleDisplayInfo>`
- 返回：`Result<Vec<AccountInfo>, String>`
- 逻辑：调用 `AccountService::save_selected_roles(...)` 持久化用户勾选的角色，返回更新后的账号列表。

### `get_selected_account`
- 位置：account.rs:253（async）
- 参数：`state`
- 返回：`Result<Option<String>, String>`
- 逻辑：通过 `service.get_config_service()` 取 `ConfigService::get("selected_account_id")`，返回当前选中账号 ID（可能为 `None`）。
- 配置键：`selected_account_id`

### `set_selected_account`
- 位置：account.rs:264（async）
- 参数：`state`、`account_id: String`
- 返回：`Result<bool, String>`（成功恒 `true`）
- 逻辑：`ConfigService::set("selected_account_id", json!(account_id))` 直接写配置。
- 配置键：`selected_account_id`

### `check_and_refresh_cred`
- 位置：account.rs:282（async）
- 参数：`state`、`user_id: String`
- 返回：`Result<Option<(String, String)>, String>`（新 `(cred, token)`）
- 逻辑：调用 `AccountService::check_and_refresh_user_cred(&user_id)`，检查凭据有效性并在需要时刷新。

### `set_lazy_load_enabled`
- 位置：account.rs:295（async）
- 参数：`state`、`enabled: bool`
- 返回：`Result<bool, String>`（成功恒 `true`）
- 逻辑：调用 `AccountService::set_lazy_load_enabled(enabled).await` 切换账号懒加载开关。

### `is_lazy_load_enabled`
- 位置：account.rs:309（async）
- 参数：`state`
- 返回：`Result<bool, String>`
- 逻辑：调用 `AccountService::is_lazy_load_enabled()` 读取懒加载状态。

### `set_current_role_id`
- 位置：account.rs:318（async）
- 参数：`state`、`role_id: Option<String>`
- 返回：`Result<bool, String>`（成功恒 `true`）
- 逻辑：调用 `AccountService::set_current_role_id(role_id).await` 设置当前激活角色（可清空）。

### `query_role_data`
- 位置：account.rs:340（async）
- 参数：`state`、`role_id: String`、`api_name: String`、`paths: Vec<String>`
- 返回：`Result<serde_json::Value, String>`
- 逻辑：调用 `AccountService::query_role_data(&role_id, &api_name, &paths)` 取到 `HashMap<path, value>` 后用 `serde_json::to_value` 转成 JSON 对象（key 为请求路径，缺失路径为 null；空 `paths` 表示返回完整数据）。全过程写 `log_debug!/log_info!/log_error!`。

---

## `src-tauri/src/commands/attendance.rs`
**职责**：森空岛「签到」功能的 IPC 入口（254 行 / 2 个命令）。命令层自己完成「按 roleId 反查凭据 → 刷新 cred → 直接调用森空岛 HTTP API」的完整链路，而不经过独立的 attendance service。

### 共享辅助函数 `lookup_cred_token`（attendance.rs:12-55，非命令）
遍历全部 `account_token_*` 配置项，在 `roles[]` 中按 `roleId` 精确匹配，返回 `(user_id, server_id, cred, token)`；找不到则返回 `AppError::AuthError`。配置键：`account_token_*`。

### `get_attendance`
- 位置：attendance.rs:59，`#[tauri::command]`（async）
- 参数：`state: State<'_, Arc<Mutex<AccountService>>>`、`role_id: String`
- 返回：`Result<serde_json::Value, String>`
- 逻辑：① 本地 `lookup_cred_token` 找凭据；② `AccountService::check_and_refresh_user_cred(&user_id)` 尝试刷新（失败则回退旧凭据，不中断）；③ `AccountService::skland_service()` → `SklandService::call_skland_api("GET", "/web/v1/game/endfield/attendance", …)`，附带 `sk-game-role: 3_{role_id}_{server_id}` 与 `token` 头；④ 校验响应 `code==0` 否则返回 `Attendance API error: code=…`；⑤ 遍历 `data.resourceInfoMap`，用 `AvatarCacheService::get_or_download_image(url, ImageType::AttendanceIcon)` 把奖励图标下载到本地并把 `icon` 字段替换成 `local_path`。

### `do_attendance`
- 位置：attendance.rs:181（async）
- 参数：`state`、`role_id: String`
- 返回：`Result<serde_json::Value, String>`
- 逻辑：与 `get_attendance` 前三步相同，但以 `POST`（body `json!({})`）请求同一路径执行签到；同样校验 `code==0`。**不**下载奖励图标（与 `get_attendance` 不对称）。

---

## `src-tauri/src/commands/capture.rs`
**职责**：网络抓包会话的 IPC 门面（42 行 / 7 个命令），全部是对 `utils::capture` 模块函数的转发，无状态参数。

### `capture_start`
- 位置：capture.rs:3（async）；参数：无；返回：`Result<CaptureStatus, String>`；逻辑：`capture::start()` 启动抓包。

### `capture_stop`
- 位置：capture.rs:8（async）；参数：无；返回：`Result<CaptureStatus, String>`；逻辑：`capture::stop()` 停止抓包。

### `capture_status`
- 位置：capture.rs:13（async）；参数：无；返回：`Result<CaptureStatus, String>`；逻辑：`Ok(capture::status())` 读取当前状态，永不失败。

### `capture_list_sessions`
- 位置：capture.rs:18（async）；参数：无；返回：`Result<Vec<CaptureSessionMeta>, String>`；逻辑：`capture::list_sessions()` 列出历史会话。

### `capture_read_entries`
- 位置：capture.rs:23（async）；参数：`id: String`、`offset: u64`、`limit: u64`；返回：`Result<CapturePage, String>`；逻辑：`capture::read_entries(&id, offset, limit)` 分页读取会话条目。

### `capture_delete_session`
- 位置：capture.rs:32（async）；参数：`id: String`；返回：`Result<(), String>`；逻辑：`capture::delete_session(&id)` 删除会话。

### `capture_dir`
- 位置：capture.rs:37（async）；参数：无；返回：`Result<String, String>`；逻辑：`capture::capture_root()` 取根目录并 `fs::create_dir_all` 确保存在，返回路径字符串。

---

## `src-tauri/src/commands/card_config.rs`
**职责**：桌面卡片个性化配置的增删改（79 行 / 3 个命令），全部经 `AccountService::get_config_service()` 访问配置，键名为 `card_settings.{card_id}`。

### `get_card_settings`
- 位置：card_config.rs:9（async）
- 参数：`state`、`card_id: String`
- 返回：`Result<Value, String>`（缺失时返回空对象 `{}`）
- 逻辑：读取 `card_settings.{card_id}`；不存在时返回 `Value::Object(Map::new())`。

### `save_card_settings`
- 位置：card_config.rs:26（async）
- 参数：`state`、`card_id: String`、`settings: Value`
- 返回：`Result<bool, String>`（成功恒 `true`）
- 逻辑：读取现有 `card_settings.{card_id}`，若双方都是 JSON 对象则做**浅合并**（新值覆盖同名键），否则整体替换；随后 `ConfigService::set` 写回。

### `remove_card_settings`
- 位置：card_config.rs:66（async）
- 参数：`state`、`card_id: String`
- 返回：`Result<bool, String>`
- 逻辑：`ConfigService::remove("card_settings.{card_id}")`，返回是否确实删除。

---

## `src-tauri/src/commands/color_picker.rs`
**职责**：Windows 屏幕取色（吸管）流程的窗口控制与 GDI 截屏；macOS/Linux 使用仅报不支持错误的命令桩，前端不展示屏幕吸管入口。Windows 流程为「最小化 → 截取鼠标所在屏幕 → 还原并全屏 → 前端在全屏覆盖层上取色」。

### 内部结构
- `ScreenCapture`：`width`/`height`/`data`，`data` 为 RGBA 的 base64，序列化为 camelCase。
- `capture_screen`：Windows 下最小化并等待 400ms，执行 `capture_screen_sync()` 后还原并全屏；非 Windows 返回明确错误。
- `finish_screen_pick`：Windows 下退出全屏并聚焦；非 Windows 空实现。
- Windows 专用 `capture_screen_sync()`：Win32 GDI 截屏：`GetCursorPos` → `MonitorFromPoint`/`GetMonitorInfoW` → `GetDC`/`CreateCompatibleDC`/`CreateCompatibleBitmap` → `BitBlt` → `GetDIBits` 取 32 位像素 → BGRA 转 RGBA → base64 编码；每步失败都返回具体错误字符串并释放 GDI 资源。

### `capture_screen`
- 位置：color_picker.rs:28，`#[tauri::command]`（async）
- 参数：`window: WebviewWindow`
- 返回：`Result<ScreenCapture, String>`
- 逻辑：先 `window.minimize()` 并 `sleep(400ms)`（避免截到自身窗口），用 `tauri::async_runtime::spawn_blocking` 在线程池执行 `capture_screen_sync`；**无论成败**随后 `unminimize()` + `set_fullscreen(true)` + `set_focus()` 进入全屏取色态，最后返回截屏结果。

### `finish_screen_pick`
- 位置：color_picker.rs:47，`#[tauri::command]`（同步）
- 参数：`window: WebviewWindow`
- 返回：`()`（无返回值）
- 逻辑：`set_fullscreen(false)` + `set_focus()`，取色完成或取消后退出全屏还原窗口。

---

## `src-tauri/src/commands/config.rs`
**职责**：通用配置 KV 的最薄封装（38 行 / 4 个命令），直接持有 `State<Arc<std::sync::Mutex<ConfigService>>>`（注意是**同步** Mutex，与 account 系列的 tokio Mutex 不同）。**任何**前端都可经 `set_config` 写入任意键，是配置的总入口。

### `get_config`
- 位置：config.rs:9（同步）；参数：`state: State<Arc<Mutex<ConfigService>>>`、`key: String`；返回：`Option<Value>`；逻辑：`ConfigService::get(&key)`，锁中毒用 `unwrap()`（会 panic）。

### `set_config`
- 位置：config.rs:16（同步）；参数：`state`、`key: String`、`value: Value`；返回：`Result<(), String>`；逻辑：锁失败与 `ConfigService::set` 错误均 `map_err(to_string)`，持久化到配置文件。

### `remove_config`
- 位置：config.rs:27（同步）；参数：`state`、`key: String`；返回：`bool`；逻辑：`ConfigService::remove(&key)`，返回是否删除。

### `get_all_configs`
- 位置：config.rs:34（同步）；参数：`state`；返回：`HashMap<String, Value>`；逻辑：`ConfigService::get_all()` 返回全量配置（含 `account_token_*` 等敏感项）。

---

## `src-tauri/src/commands/gacha.rs`
**职责**：抽卡（寻访）记录相关 IPC（521 行 / 7 个命令）。命令层承担「凭据反查 + token 刷新 + 组装 JSON」的编排，真正的请求与存储由 `GachaService`（`State<Arc<GachaService>>`）负责。

### 内部结构
- 1-15：导入 + `TOTAL_CATALOG_REFRESH_COOLDOWN` 常量（全量 Wiki 目录刷新冷却 6 小时）。
- 18-54：`lookup_u8token(config_service, role_id)` —— 遍历 `account_token_*`，按 `roles[].roleId` 匹配，返回 `(user_id, server_id, u8token)`，否则 `AppError::AuthError`。
- 56-81：`ensure_fresh_u8token(account_service, config_service, user_id, role_id)` —— 先非致命地 `check_and_refresh_user_cred`，再 `refresh_u8token_for_user` 主动换新 u8token（避免过期导致非 JSON 响应），失败回退 `lookup_u8token` 读缓存值。
- 84-113：`get_gacha_pool_meta`；116-145：`sync_gacha_records`；148-176：`get_saved_gacha_records`。
- 179-212：`sync_weapon_gacha_records`；215-249：`get_saved_weapon_gacha_records`。
- 251-350：`resolve_missing_from_catalog`（私有辅助：从 Wiki 目录按名称补齐头像，见下）。
- 359-515：`resolve_gacha_avatar_map`（本文件最长逻辑，见下）。
- 518-565：`get_gacha_record_stats`。

### `get_gacha_pool_meta`
- 位置：gacha.rs:84（async）
- 参数：`account_state: State<Arc<Mutex<AccountService>>>`、`gacha_state: State<Arc<GachaService>>`、`role_id: String`
- 返回：`Result<serde_json::Value, String>`
- 逻辑：`lookup_u8token` 定位账号 → `ensure_fresh_u8token` 拿新鲜 token → `GachaService::get_pool_meta(&u8token, &server_id)` 取卡池 meta → `serde_json::to_value` 返回。配置键：`account_token_*`。

### `sync_gacha_records`
- 位置：gacha.rs:116（async）
- 参数：同上（`account_state`、`gacha_state`、`role_id`）
- 返回：`Result<serde_json::Value, String>`
- 逻辑：刷新 u8token 后调 `GachaService::sync_records(&user_id, &server_id, &u8token)`，做**增量**同步（从最新读到上次保存的最后一条并合并），返回同步结果统计。

### `get_saved_gacha_records`
- 位置：gacha.rs:148（async）
- 参数：同上
- 返回：`Result<serde_json::Value, String>`
- 逻辑：仅 `lookup_u8token`（不刷新、不联网），调 `GachaService::load_records_or_empty(&user_id, &server_id)` 读本地记录，无记录返回空结构。

### `sync_weapon_gacha_records`
- 位置：gacha.rs:179（async）
- 参数：同上
- 返回：`Result<serde_json::Value, String>`
- 逻辑：与 `sync_gacha_records` 相同流程，改调 `GachaService::sync_weapon_records(...)`（武器寻访）。

### `get_saved_weapon_gacha_records`
- 位置：gacha.rs:215（async）
- 参数：同上
- 返回：`Result<serde_json::Value, String>`
- 逻辑：调 `GachaService::load_weapon_records_or_empty(&user_id, &server_id)` 读本地武器寻访记录。

### `resolve_missing_from_catalog`
- 位置：gacha.rs:251（私有函数）
- 参数：`catalog: &serde_json::Value`、`needed: &HashMap<String,String>`（id → 显示名）、`unresolved: &mut Vec<String>`、`map: &mut HashMap<String,String>`
- 返回：`usize`（本次新解析数量）
- 逻辑：遍历 `data.catalog[].typeSub[].items[]` 建「显示名 → 图标」表。条目类型优先取 `brief.associate.type`（`char`/`weapon`）；新干员/武器在目录中可能仍是**预览条目**（`brief.associate` 为 `null`，`brief.dotType == "label_type_preview"`），此时回退到所属 `typeSub.id`（`"1"` = 干员、`"2"` = 武器）归类，名称回退 `brief.name` → `item.name`，图标取 `brief.cover`。随后仅对 `unresolved` 中仍无映射的 id 按显示名补齐，命中者写入 `map` 并从 `unresolved` 移除。

### `resolve_gacha_avatar_map`
- 位置：gacha.rs:359（async）
- 参数：同上
- 返回：`Result<serde_json::Value, String>`（`{角色/武器 id: 图标 URL}` 映射）
- 逻辑：① 读本地角色+武器记录，筛出 `rarity == 6` 且 `is_draw()` 的条目，构建 `id → 显示名` 的 `needed` 表；② `GachaService::load_avatar_map()` 读已有映射（文件 `gacha_avatar_map.json`，与 `app_config.json` 同级），算出 `missing`；③ 有缺失时先非致命 `check_and_refresh_user_cred`，再用 `load_total_catalog()` 读本地 `total.json` 缓存并调 `resolve_missing_from_catalog` 解析；④ 若仍有未解析 id 且（缓存缺失或已过 `TOTAL_CATALOG_REFRESH_COOLDOWN` 冷却期），则 `AccountService::query_role_data(&role_id, "wiki_catalog", &[])` 重新拉取全量 Wiki 目录、`save_total_catalog` 写盘并再次解析（这样新干员/武器不会因缓存是历史快照而永久缺头像，同时避免无法匹配的名称导致每次打开页面都拉取目录）；⑤ 有新增则 `save_avatar_map` 回写文件，最后返回完整 map。

### `get_gacha_record_stats`
- 位置：gacha.rs:518（async）
- 参数：同上
- 返回：`Result<serde_json::Value, String>`
- 逻辑：`load_records_or_empty` 后在命令层组装统计 JSON：`user_id`、`server_id`、`last_sync_time`、`total_records`、`total_draws`、`total_gifts`、`by_pool`（`GachaService::group_records_by_pool` 取长度）、`by_rarity`（`count_by_rarity`）、`by_char`（`count_by_char`）。不发起网络请求。

---

## `src-tauri/src/commands/image.rs`
**职责**：图片与背景图的本地缓存/读写（217 行 / 6 个命令 + 1 个私有工具函数）。涉及目录：图片缓存目录（`paths::image_cache_dir`，按子目录分类）与背景目录（`paths::backgrounds_dir`，固定单文件 `bg.webp`）。

### `read_image_file`
- 位置：image.rs:10（同步）；参数：`path: String`；返回：`Result<Vec<u8>, String>`；逻辑：直接 `fs::read(&path)`，**不校验路径范围**（可读任意本地文件），错误信息含路径。

### `get_image_cache_dir`
- 位置：image.rs:16（同步）；参数：无；返回：`Result<String, String>`；逻辑：`paths::image_cache_dir()` 并 `log_info!` 记录结果。

### `download_image`
- 位置：image.rs:29（async）
- 参数：`url: String`、`cache_dir: String`、`sub_dir: String`
- 返回：`Result<String, String>`（本地文件路径）
- 逻辑：① 空 URL 报错；② `file://` / `http://asset.localhost` 开头视为已本地化直接返回；③ `extract_filename_from_url` 去查询串取最后一段路径作文件名；④ `sub_dir` 为空时先 `resolve_url_subdir(&url)`（URL 注册表）定子目录，未命中则遍历 `all_sub_dir_names()` 扫描已有缓存命中即返回，仍无则回退 `misc`；⑤ `fs::create_dir_all` 建目录，文件已存在直接返回；⑥ 用 `reqwest` + `capture::send` GET（带 `Referer: https://game.skland.com/`）下载、写盘、返回路径。

### `get_backgrounds_dir`
- 位置：image.rs:141（同步）；参数：无；返回：`Result<String, String>`；逻辑：`paths::backgrounds_dir()` + `log_info!`。

### `save_background_image`
- 位置：image.rs:152（同步）
- 参数：`data: String`（base64 或 `data:` URL）
- 返回：`Result<String, String>`（保存后路径）
- 逻辑：建背景目录 → **先删除目录内所有旧文件**（副作用：只保留一张背景）→ 剥掉 `data:…,` 前缀 → base64 解码 → 写入 `bg.webp` → 返回路径。

### `delete_background_image`
- 位置：image.rs:190（同步）；参数：无；返回：`Result<(), String>`；逻辑：遍历背景目录删除全部文件（任一删除失败即报错），`log_info!` 记录。

### 私有工具 `extract_filename_from_url`（image.rs:208-217）
去 `?` 查询串后取最后一个 `/` 之后的片段，空则 `None`。

---

## `src-tauri/src/commands/launcher.rs`
**职责**：游戏启动器（下载/校验/渠道切换/启动进程）的 IPC 层（759 行 / 27 个命令）。多数命令持有 `State<Arc<tokio::sync::Mutex<GameLauncherService>>>`；涉及渠道的先经 `parse_channel` 把字符串转成 `GameChannel` 枚举；耗时操作通过回调 emit `launcher-progress` 事件推送进度。

### 内部结构
- 1-9：导入（`models::game::*`、`GameLauncherService`、`Emitter`、`utils::official_launcher`）。
- 11-29：`launcher_get_process_read_bytes`（Win32 IO 计数器）。
- 31-50：`launcher_check_status`；52-102：`launcher_install_or_update`；104-159：`launcher_verify_and_repair`；161-170：`launcher_get_remote_version`；172-212：`launcher_preload_download`；214-248：`launcher_install_preload`；250-259：`launcher_get_payload_state`。
- 261-305：下载控制、切服取消与解密。
- 307-388：内容获取（banners / announcements / notice content / background media）。
- 389-522：`launcher_start_game`（taskkill + 提权 helper 伪造官方父进程 + 回退直启）。
- 540-597：`launcher_get_disk_space`；599-668：扫描安装目录与渠道探测。
- 670-733：游戏运行检测与进程终止；735 起：`launcher_switch_channel`。

### `launcher_get_process_read_bytes`
- 位置：launcher.rs:13（同步）；参数：无；返回：`Result<u64, String>`；逻辑：Windows 下 `GetCurrentProcess` + `GetProcessIoCounters` 取 `ReadTransferCount`（任务管理器磁盘速率用），非 Windows 返回 `Ok(0)`。

### `launcher_check_status`
- 位置：launcher.rs:31（async）；参数：`service`、`channel: String`、`install_path: String`；返回：`Result<GameStatus, String>`；逻辑：`parse_channel` → 加锁 → `GameLauncherService::check_status(&ch, &install_path).await`。

### `launcher_install_or_update`
- 位置：launcher.rs:59（async）
- 参数：`app: AppHandle`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`（缺省 8）、`resume: Option<bool>`（缺省 true）
- 返回：`Result<LauncherResult, String>`（业务失败也包成 `success:false` 的 `LauncherResult`，不返回 `Err`）
- 逻辑：构造 `progress_cb` 回调，每阶段 `app.emit("launcher-progress", &DownloadProgress)`；调 `GameLauncherService::install_or_update(&ch, &install_path, progress_cb, max_concurrent, resume)`，成功填 `version` 与 "Update to {v} completed"，失败填错误串。`resume` 决定取消/失败后是否保留分片与暂存。
- 事件：`launcher-progress`

### `launcher_verify_and_repair`
- 位置：launcher.rs:122（async）
- 参数：`app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`、`quick: Option<bool>`、`resume: Option<bool>`
- 返回：`Result<LauncherResult, String>`
- 逻辑：`GameLauncherService::verify_and_repair(..., max_concurrent.unwrap_or(12), quick.unwrap_or(false), resume.unwrap_or(true))`，进度同样 emit `launcher-progress`；结果包成 `LauncherResult`，发生错误时额外 emit `stage = "error"` 以结束前端进度状态。

### `launcher_get_remote_version`
- 位置：launcher.rs:179（async）；参数：`service`、`channel`；返回：`Result<RemotePackage, String>`；逻辑：`GameLauncherService::get_latest_package(&ch, None)` 取远程版本包（不带本地版本，因此不会返回 `pre_patch` 预下载信息）。

### `launcher_preload_download`
- 位置：launcher.rs:192（async）
- 参数：`app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`、`resume: Option<bool>`
- 返回：`Result<LauncherResult, String>`
- 逻辑：`GameLauncherService::preload_download(..., max_concurrent.unwrap_or(8), resume.unwrap_or(true), None)` 预下载官方预发布补丁分卷（服务内自行读本地版本以取 `pre_patch`），进度 emit `launcher-progress`。

### `launcher_install_preload`
- 位置：launcher.rs:236（async）
- 参数：`app`、`service`、`channel`、`install_path`、`max_concurrent: Option<usize>`、`resume: Option<bool>`
- 返回：`Result<LauncherResult, String>`
- 逻辑：调用 `GameLauncherService::install_preload`；复用已下载分卷或先下载并 MD5 校验，使用官方 `pkg.cd_key` 解压到暂存区并应用文件。命令完成后由前端再调用快速校验与修复；解压密码只保留在后端。
- 事件：`launcher-progress`

### `launcher_get_payload_state`
- 位置：launcher.rs:279（async）；参数：`service`、`channel`；返回：`Result<Option<PayloadState>, String>`；逻辑：`GameLauncherService::get_payload_state(&ch)`，返回上次安装/更新的 payload 状态。

### `launcher_cancel_download`
- 位置：launcher.rs:290（async）；参数：`install_path: Option<String>`；返回：`Result<(), String>`；逻辑：给了非空路径时先调 `game_launcher_service::request_cancel_cleanup()` 记录删除意图，再置取消标志并 `cleanup_staging_files(&path)`；不给路径时仅 `cancel_download()`，后台任务会保留分片与暂存以便续传。**不加 service 锁**。

### `launcher_has_download_cache`
- 位置：launcher.rs:309（async）；参数：`install_path: String`；返回：`Result<bool, String>`；逻辑：`game_launcher_service::has_download_cache(&path)` 判断是否有暂存目录或 `.download` 文件。

### `launcher_reset_download_cancel`
- 位置：launcher.rs:317（async）；参数：无；返回：`Result<(), String>`；逻辑：`game_launcher_service::reset_download_cancel()`。

### `launcher_cancel_switch`
- 位置：launcher.rs:288（async）；参数：无；返回：`Result<(), String>`；逻辑：`game_launcher_service::cancel_switch()` 取消渠道切换。

### `launcher_cancel_all`
- 位置：launcher.rs:294（async）；参数：无；返回：`Result<(), String>`；逻辑：依次 `cancel_download()` + `cancel_switch()`。

### `launcher_decrypt_file`
- 位置：launcher.rs:301（async）；参数：`file_path: String`；返回：`Result<String, String>`；逻辑：`utils::hg_crypto::decrypt_file_to_string(&file_path)` 解密游戏资源文件并返回文本。

### `launcher_get_banners`
- 位置：launcher.rs:307（async）；参数：`service`、`channel`；返回：`Result<Vec<BannerItem>, String>`；逻辑：`GameLauncherService::get_banners(&ch)`。

### `launcher_get_announcements`
- 位置：launcher.rs:318（async）；参数：`service`、`channel`；返回：`Result<Vec<AnnouncementItem>, String>`；逻辑：`GameLauncherService::get_announcements(&ch)`。

### `launcher_get_notice_content`
- 位置：launcher.rs:329（async）；参数：`service`、`channel`；返回：`Result<LauncherNoticeContent, String>`；逻辑：`GameLauncherService::get_notice_content(&ch)`（Banner + 公告合并内容）。

### `launcher_get_background_image`
- 位置：launcher.rs:340（async）；参数：`service`、`channel`；返回：`Result<Option<BackgroundMedia>, String>`；逻辑：`GameLauncherService::get_background_image(&ch)`。

### `launcher_start_game`
- 位置：launcher.rs:443（async）
- 参数：`config_service: State<Arc<StdMutex<ConfigService>>>`、`install_path: String`、`channel: String`、`dx11: Option<bool>`（为 `None` 时读取配置 `launcher_dx11`，缺省 false）
- 返回：`Result<LauncherResult, String>`
- 逻辑：用 `ch.executable_name()` 拼 exe 路径，不存在直接返回 `success:false`；启用 DX11 时构造游戏参数 `vec!["-force-d3d11"]`；先 `taskkill /F /IM <exe>` 杀残留进程并 `sleep(500ms)`；随后（Windows）在 `spawn_blocking` 中调用 `official_launcher::launch_via_official_parent` —— **游戏会校验自己的直接父进程必须是签名有效的官方 `Games.exe`**，该函数先查找 + 验签官方启动器（失败即 `no_launcher`），然后分两条路径：应用**已提权**时由当前进程直接创建「挂起且永不运行的官方启动器 + 以其为父进程的游戏进程」（保留 Steam overlay 的 `CreateProcess` 注入链）；**未提权**时用 `ShellExecuteExW("runas")` 以 `--endfield-launch-helper` 提权重启自身完成创建，命令侧用 2.5s 宽限期 + 状态文件判断 helper 是启动阶段失败还是游戏已创建。找不到签名有效的官方启动器时回退 `direct_launch`（`ShellExecuteW(SW_SHOWNORMAL)` + 游戏参数，即旧行为）并把原因放进 `LauncherResult.warning`。若当前进程由 Steam 拉起（`SteamClientLaunch` / `SteamAppId` / `SteamGameId` / `SteamOverlayGameId` 之一存在）且未提权，额外在 `warning` 返回 `overlay_unavailable`。非 Windows 走 `Command::spawn` 并传入 `game_arguments`。实际实现在 `launch_game`（launcher.rs:459），供静默启动直接调用。启动前先以应用权限执行 `taskkill /F /IM <exe>`；应用未提权时该命令无法结束上一局由提权进程创建的残留，提权 helper 在创建新游戏前会再执行 `taskkill /F /T /IM <exe>` 清理。
- 并发保护：`static LAUNCH_IN_FLIGHT`（launcher.rs:405）保证同一时刻只有一次启动，避免重复点击弹出两次 UAC / 留下两套挂起的父进程。

#### `launcher_start_game` 的 `message` / `warning` token 契约

`message`（失败时）与 `warning`（回退提示）都是 `"<token>: <detail>"` 形式：`token` 由前端映射到 i18n 文案（`src/utils/launcherService.ts` 的 `LAUNCH_TOKEN_KEYS`），`detail` 是后端给的技术细节（英文诊断、Win32 码）。

| token | 含义 | 触发点 |
| --- | --- | --- |
| `not_found` | 游戏可执行文件不存在 | 命令内 exe 存在性检查 |
| `no_launcher` | 未找到签名有效的官方启动器 | `official_launcher::find_official_launcher` |
| `cancelled` | 用户在 UAC 上点了「否」 | `ShellExecuteExW` → `ERROR_CANCELLED(1223)` |
| `create` | 创建启动器父进程 / 游戏进程失败 | helper 退出码 2 / 4 |
| `wait_failed` | 等待游戏退出失败 | helper 退出码 8 |
| `fallback` | 已回退到直接启动（`warning` 字段专用，不是失败） | `no_launcher` 回退成功后 |
| `overlay_unavailable` | Steam 未提权，Overlay 无法注入到管理员游戏（`warning` 字段专用，不是失败） | Steam 启动上下文 + 当前进程未提权 |
| `unknown` | 其它（含 helper 提前退出的未知码、启动中重复点击） | 兜底 |

### `launcher_browse_folder`
- 位置：launcher.rs:523（同步）；参数：无；返回：`Result<Option<String>, String>`；逻辑：`rfd::FileDialog::new().set_title("Select Game Directory").pick_folder()`，取消返回 `None`。

### `launcher_get_disk_space`
- 位置：launcher.rs:540（async）
- 参数：`path: String`
- 返回：`Result<DiskSpace, String>`（`{total, free}` 字节）
- 逻辑：沿 `ancestors()` 找第一个存在的根路径，Windows 下起 `powershell -NoProfile -Command "Get-PSDrive …"` 解析 `Used|Free` 并相加得 total；非 Windows 返回 `u64::MAX` 占位。

### `launcher_scan_install_dir`
- 位置：launcher.rs:599（async）；参数：`service`、`channel`、`install_path`；返回：`Result<FileScanResult, String>`；逻辑：`GameLauncherService::scan_install_dir(&ch, &install_path)` 扫描已有文件完整性。

### `launcher_detect_channel`
- 位置：launcher.rs:611（async）；参数：`install_path: String`；返回：`Result<Option<String>, String>`；逻辑：先校验 `Endfield.exe`+`Endfield_Data`+`config.ini` 齐全否则 `None`；再按特征 DLL 判定：`glextra.dll`+`play_pc_sdk.dll`+`manifest.xml` → `google_play`，`gfsdk.dll`+`glfoundation.dll` → `global`，`PCGameSDK.dll` → `bilibili`，`hgsdk.dll` → `official`，否则 `None`。纯本地，不联网。

### `launcher_check_executable`
- 位置：launcher.rs:662（同步）；参数：`install_path: String`、`channel: String`；返回：`Result<bool, String>`；逻辑：`parse_channel` → `Path::exists` 判断渠道对应 exe 是否存在。

### `launcher_check_game_running`
- 位置：launcher.rs:670（异步）；参数：`channel: String`；返回：`Result<bool, String>`；逻辑：`parse_channel` → `utils::process::is_process_running(ch.process_name())`（`tasklist` CSV 取得同名 PID，任一 PID 拥有顶层窗口或在 90 秒启动宽限内才视为运行中；无窗口的崩溃/挂起残留返回 false）。前端游戏面板每 3 秒调用，避免同步子进程阻塞 Tauri 主线程。

### `launcher_get_game_playtime`
- 位置：launcher.rs:677（同步）；参数：无；返回：`GamePlaytime`（`{ total_seconds, session_seconds, running }`）；逻辑：`utils::game_playtime::snapshot()`，返回累计总时长（不含当前会话）+ 当前会话时长 + 运行态。由后台探测任务 `utils::game_playtime` 维护，仅在 EndProtocol 运行期间统计。

### `launcher_kill_game`
- 位置：launcher.rs:682（async）
- 参数：`channel: String`
- 返回：`Result<bool, String>`（恒 `Ok(true)`）
- 逻辑：三级兜底杀进程：`taskkill /T /F /IM <process_name>` → 失败改用 `<exe_name>` → 仍失败用 `wmic process where name like '%Endfield%' call terminate`；**无论是否成功都返回 `true`**。

### `launcher_switch_channel`
- 位置：launcher.rs:731（async）
- 参数：`service`、`from_channel: String`、`to_channel: String`、`install_path: String`、`app: AppHandle`
- 返回：`Result<String, String>`（成功消息）
- 逻辑：两个 channel 都经 `parse_channel` 校验，然后 `GameLauncherService::switch_channel(&from, &to, &install_path, app).await`（service 内部可用 app emit 进度/事件）。

---

## `src-tauri/src/commands/diagnostics.rs`
**职责**：崩溃处理与诊断导出 IPC（48 行 / 6 个命令）。转发到 `utils::crash`、`utils::api_health`、`utils::diagnostics`。

### `get_log_dir`
- 位置：diagnostics.rs:7（同步）
- 参数：无
- 返回：`Result<String, String>`
- 逻辑：`utils::paths::log_dir()` 返回应用日志目录；前端配合 `revealItemInDir` 打开。

### `export_diagnostics`
- 位置：diagnostics.rs:15（同步）
- 参数：`app: AppHandle`、`frontend_logs: Vec<FrontendLogEntry>`、`context: Option<String>`（前端 `invoke` 传 `frontendLogs` / `context`）
- 返回：`Result<String, String>`（zip 文件绝对路径）
- 逻辑：`utils::diagnostics::export` 打包前端日志、后端内存日志、日志文件、崩溃报告与 manifest。

### `get_pending_crash_reports`
- 位置：diagnostics.rs:25（同步）
- 参数：无
- 返回：`Vec<CrashReportInfo>`
- 逻辑：`utils::crash::pending_reports`；启动时前端若拿到非空列表则弹出「上次运行异常退出」提示。

### `ack_crash_reports`
- 位置：diagnostics.rs:31（同步）
- 参数：`paths: Vec<String>`
- 返回：`Result<(), String>`
- 逻辑：`utils::crash::acknowledge` 在崩溃报告旁写 `.log.ack`，避免下次启动重复提示。

### `get_api_health`
- 位置：diagnostics.rs:37（同步）
- 参数：无
- 返回：`ApiHealthSnapshot`
- 逻辑：`utils::api_health::snapshot`；前端在启动阶段轮询作为事件漏收兜底。

### `reset_api_health`
- 位置：diagnostics.rs:43（同步）
- 参数：无
- 返回：`()`
- 逻辑：`utils::api_health::reset`；用户点击「已修复，重试」后解除熔断，随后前端重载页面。

---

## `src-tauri/src/commands/logs.rs`
**职责**：后端日志读取（7 行 / 1 个命令），全目录最小文件。

### `get_backend_logs`
- 位置：logs.rs:4，`#[tauri::command]`（**同步**）
- 参数：无
- 返回：`Vec<LogEntry>`
- 逻辑：`utils::logger::get_logger().get_recent_logs()` 返回当前会话的全部内存日志；注意返回类型不是 `Result`。

---

## `src-tauri/src/commands/tray.rs`
**职责**：托盘菜单/托盘面板的 IPC（80 行 / 7 个命令）。配置键固定为 `tray_user_info`（类型 `TrayUserInfo`），菜单刷新调用 `crate::tray` 模块的函数。

### `get_tray_user_info`
- 位置：tray.rs:8（同步）
- 参数：`config_service: State<'_, Arc<std::sync::Mutex<ConfigService>>>`
- 返回：`Result<TrayUserInfo, String>`
- 逻辑：`ConfigService::get::<TrayUserInfo>("tray_user_info")`，缺失时返回 `TrayUserInfo::default()`。

### `set_tray_user`
- 位置：tray.rs:17（同步）
- 参数：`app: AppHandle<R>`、`config_service`、`role_id: String`
- 返回：`Result<(), String>`
- 逻辑：读出已有 `tray_user_info`（或默认），只改 `role_id` 字段 → `ConfigService::set("tray_user_info", …)` 持久化 → `crate::tray::update_tray_menu(&app, &user_info)` 刷新托盘菜单。
- 配置键：`tray_user_info`

### `update_tray_user_data`
- 位置：tray.rs:38（同步）
- 参数：`app`、`config_service`、`user_info: TrayUserInfo`
- 返回：`Result<(), String>`
- 逻辑：前端拉到最新数据后整体覆盖写 `tray_user_info`，再 `update_tray_menu` 刷新菜单。

### `show_tray_panel`
- 位置：tray.rs:56（同步）；参数：`app: AppHandle<R>`；返回：`Result<(), String>`；逻辑：`crate::tray::show_tray_panel(&app)` 显示托盘浮层窗口。

### `hide_tray_panel`
- 位置：tray.rs:62（同步）；参数：`app`；返回：`Result<(), String>`；逻辑：`crate::tray::hide_tray_panel(&app)`。

### `show_main_window`
- 位置：tray.rs:68（同步）；参数：`app`；返回：`Result<(), String>`；逻辑：`crate::tray::show_main_window_focus(&app)` 显示并聚焦主窗口，随后 `hide_tray_panel(&app)` 收起浮层。

### `app_quit`
- 位置：tray.rs:77（同步）；参数：`app`；返回：`()`；逻辑：`app.exit(0)` 直接退出进程。

---

## `src-tauri/src/commands/updater.rs`
**职责**：应用自更新所需的通用原语（下载/写文件/装包，含 9 个命令）。Tauri updater 插件按本机平台检查、验签、安装；预览/频道切换使用受限的镜像/GitHub 清单端点。另含模块级静态 `DOWNLOAD_CANCELLED: AtomicBool` 作为下载取消开关。

### `write_file`
- 位置：updater.rs:105（同步）；参数：`path: String`、`data: Vec<u8>`；返回：`Result<(), String>`；逻辑：`fs::create_dir_all(parent)` 后 `fs::write`，**任意路径皆可写**。

### `get_temp_dir`
- 位置：updater.rs:117（同步）；参数：无；返回：`Result<String, String>`；逻辑：`std::env::temp_dir()` 字符串化。

### `fetch_url`
- 位置：updater.rs:125（async）；参数：`url: String`；返回：`Result<String, String>`；逻辑：`capture::send(&client, client.get(&url))` 后 `resp.text()`，**任意 URL 可 GET**。

### `cancel_download`
- 位置：updater.rs:139（同步）；参数：无；返回：`()`；逻辑：`DOWNLOAD_CANCELLED.store(true, SeqCst)`，`download_file` 循环下次检查时退出并删除半成品文件。

### `reset_download_cancel`
- 位置：updater.rs:145（同步）；参数：无；返回：`()`；逻辑：`DOWNLOAD_CANCELLED.store(false, SeqCst)`，新下载前调用。

### `download_file`
- 位置：updater.rs:153（async）
- 参数：`app: AppHandle`、`url: String`、`path: String`
- 返回：`Result<u64, String>`（写入的总字节数）
- 逻辑：开始时重置取消标志 → `capture::send_stream` 取流 → 建父目录与目标文件 → 逐 chunk 写盘，每累计 ≥256KB（或下完）`app.emit("download-progress", {downloaded, total})`；检测到取消标志则删除文件并返回 `Err("Download cancelled")`；结束 `flush` 并返回字节数。
- 事件：`download-progress`

### `check_update_endpoint`
- 位置：updater.rs:58（async）
- 参数：`app: AppHandle`、`endpoint: String`
- 返回：`Result<Option<UpdateEndpointInfo>, String>`
- 逻辑：仅允许稳定/预览镜像、GitHub latest 或指定版本 Release 清单；通过 updater builder 检查本机目标与更新版本。

### `install_update_endpoint`
- 位置：updater.rs:73（async）
- 参数：`app: AppHandle`、`endpoint: String`
- 返回：`Result<(), String>`
- 逻辑：重新检查清单中的本机更新，调用 updater 插件下载、验签并安装，并 emit `download-progress`。

### `run_installer`
- 位置：updater.rs:217（async）
- 参数：`app: AppHandle`、`path: String`
- 返回：`Result<(), String>`
- 逻辑：Windows 下以 `CREATE_NO_WINDOW` 标志静默启动安装器并传 `/S`（NSIS 静默参数），`sleep(2s)` 等安装器起来后 `app.exit(0)` 让出文件占用，由安装器替换并重启应用；非 Windows 返回明确的不支持错误。

---

## `src-tauri/src/commands/window.rs`
**职责**：主窗口基础控制（34 行 / 4 个命令），全部针对标签为 `"main"` 的 webview 窗口，均为同步命令。

### `minimize_window`
- 位置：window.rs:3（同步）；参数：`app: tauri::AppHandle<R>`；返回：`()`；逻辑：`app.get_webview_window("main")` → `window.minimize()`（忽略错误）。

### `toggle_maximize_window`
- 位置：window.rs:10（同步）；参数：`app`；返回：`()`；逻辑：`is_maximized()`（失败按 false）→ 已最大化则 `unmaximize()`，否则 `maximize()`。

### `close_window`
- 位置：window.rs:21（同步）；参数：`app`；返回：`()`；逻辑：`window.close()`，忽略错误。

### `minimize_to_tray`
- 位置：window.rs:28（同步）；参数：`app`；返回：`Result<(), String>`；逻辑：`window.hide()` 隐藏主窗口到托盘，错误转字符串。

---

## `src-tauri/src/commands/system_resource.rs`
**职责**：系统资源采集命令入口（1 个命令）。仅做状态取用与线程调度，实际采集逻辑在 `services/system_resource_service.rs`。

### `get_system_snapshot`
- 位置：system_resource.rs:9（异步）；参数：`state: State<Arc<Mutex<SystemResourceService>>>`；返回：`Result<SystemSnapshot, String>`。
- 逻辑：克隆 `Arc` → `tauri::async_runtime::spawn_blocking` 内加锁并调用 `SystemResourceService::snapshot()`，避免高频轮询阻塞异步运行时；锁/线程错误转 `String`。
- 采集内容：CPU（总体/单核使用率、**实测频率**（PDH `% Processor Performance` × 标称频率，可用 `frequency_is_actual` 判断）、温度）、内存/Swap、GPU（nvidia-smi，尽力而为）、磁盘列表（容量/读写速率）、网卡列表（上下行速率/累计），以及 host/os/uptime；部分失败以 `errors: Vec<String>`（如 `gpu_unavailable`、`no_disk`）返回。

---

## 汇总

- 命令总数：**102**（account 23、launcher 26、capture 7、gacha 7、tray 7、updater 9、image 6、config 4、window 4、card_config 3、attendance 2、color_picker 2、logs 1、system_resource 1；`mod.rs` 0）。
- 事件 emit：`launcher-progress`（launcher.rs）、`download-progress`（updater.rs）。
- 关键配置键：`account_token_*`（含 `cred`/`token`/`u8token`/`roles[]`）、`selected_account_id`、`card_settings.{card_id}`、`tray_user_info`，以及前端侧的 `system_resource_defaults` / `todo_lists` / `todo_defaults`（经 config 命令读写）；相关本地文件：`gacha_avatar_map.json`、`total.json`、`backgrounds/bg.webp`。
- 主要状态（managed state）：`Arc<std::sync::Mutex<ConfigService>>`（config/tray 直接用）、`Arc<tokio::sync::Mutex<AccountService>>`（account/attendance/card_config/gacha）、`Arc<GachaService>`、`Arc<Mutex<GameLauncherService>>`、`Arc<std::sync::Mutex<SystemResourceService>>`（见 `lib.rs` 的 `setup`）。

