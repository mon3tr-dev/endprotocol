# 后端启动、窗口与全局配置 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖：应用入口链（main → lib::run）、托盘、构建脚本、Cargo 依赖、Tauri 配置、ACL capability，以及签名测试示例。

## `src-tauri/src/main.rs`
**职责**：二进制入口（6 行）。仅设置 Windows 子系统属性后委托给库 crate 的 `run()`，不含任何业务逻辑。
**导出**：无（binary crate）。
**主要依赖**：`endprotocol_lib`（即 `src-tauri/src/lib.rs`，lib 名为 `endprotocol_lib`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `windows_subsystem` 属性 | main.rs:2 | `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`，release 构建隐藏控制台窗口（注释标注 DO NOT REMOVE） |
| `main` | main.rs:4 | 调用 `endprotocol_lib::run()`（main.rs:5） |

**备注**：`cargo run`/`pnpm tauri dev` 的实际逻辑全部在 lib.rs。

---

## `src-tauri/src/lib.rs`
**职责**：应用核心装配点。声明后端模块树、初始化日志、构建 `tauri::Builder`（注册 4 个插件 + 100 个命令），并在 `.setup()` 中按依赖顺序创建并 `.manage()` 全部服务、启动自动刷新定时器、挂载托盘与窗口关闭行为。
**导出**：`pub fn run()`（唯一公开项）；其余为私有模块声明。
**主要依赖**：`commands`、`models`、`services`、`tray`、`utils` 模块；`services::{account_service, avatar_cache_service, config_service, gacha_service, game_launcher_service, network_service, skland_service}`；`tauri`、`tokio::sync::Mutex`、`std::sync::Arc`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `mod commands/models/services/tray/utils` | lib.rs:5-9 | 后端模块声明（全部私有） |
| `use services::*` | lib.rs:11-18 | 导入 8 个服务类型（Account/AvatarCache/Config/Gacha/GameLauncher/Network/Skland/SystemResource） |
| `run` | lib.rs:20 | 应用入口：见下方「内部结构」 |

### 内部结构

| 行号区间 | 内容 |
| --- | --- |
| lib.rs:19 | `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 属性 |
| lib.rs:21-27 | 日志初始化：`utils::logger::init_logger()`（失败仅 `eprintln`，不中断）→ `utils::logger::init_tracing_subscriber()`（tracing 桥接到自定义 Logger；实现见 utils/logger.rs:218 与 :311） |
| lib.rs:29-33 | `tauri::Builder::default()` + 4 个插件：`tauri_plugin_updater`、`tauri_plugin_process`、`tauri_plugin_opener`、`tauri_plugin_fs` |
| lib.rs:34-150 | `.invoke_handler(tauri::generate_handler![...])` — 100 个命令（完整清单见下） |
| lib.rs:149-249 | `.setup(|app| {...})` — 服务初始化与窗口事件（步骤见下） |
| lib.rs:250-251 | `.run(tauri::generate_context!())` + `.expect(...)` |

**插件注册**（lib.rs:30-33）：
| 插件 | 行 | 对应 capability |
| --- | --- | --- |
| `tauri_plugin_updater` | lib.rs:30 | `updater:default`（desktop.json） |
| `tauri_plugin_process` | lib.rs:31 | `process:allow-restart`（desktop.json） |
| `tauri_plugin_opener` | lib.rs:32 | `opener:default` / `opener:allow-open-url`（default.json）、`opener:allow-open-path`（desktop.json） |
| `tauri_plugin_fs` | lib.rs:33 | **未授予任何 `fs:*` 权限**（见文末异常） |

### `.setup()` 初始化步骤顺序
| 步骤 | 行号 | 内容 |
| --- | --- | --- |
| 1 | lib.rs:151-154 | `ConfigService::new()` 包进 `Arc<std::sync::Mutex<>>`（同步锁），`.manage()` 注册；失败则 setup 返回 Err 终止启动 |
| 2 | lib.rs:157-174 | 读配置键 `capture_autostart`（默认 false），为 true 时**在任何 API 请求发出之前**调用 `utils::capture::start()`（utils/capture.rs:142）自动录制；成功/失败只记日志 |
| 3 | lib.rs:177-179 | `tray::setup_tray(app.handle(), config_service)`；失败仅 `eprintln`，不中断 |
| 4 | lib.rs:182 | `SklandService::new(config_service)` — **不** manage，作为依赖注入下游 |
| 5 | lib.rs:185-186 | `AvatarCacheService::new()` — 不 manage |
| 6 | lib.rs:189-190 | `GachaService::new(app.handle())` → `.manage()` |
| 7 | lib.rs:193-196 | `NetworkService::new(skland, avatar_cache)` — 不 manage |
| 8 | lib.rs:199-208 | `AccountService::new(config, skland, avatar_cache, network, app_handle)` 包进 `Arc<tokio::sync::Mutex<>>`（含异步方法故用 tokio 锁）→ `.manage()`；同时 clone 出 `timer_service`（lib.rs:207） |
| 9 | lib.rs:211-212 | `Arc::new(Mutex::new(GameLauncherService::new()))` → `.manage()`（tokio Mutex） |
| 10 | lib.rs:214-217 | `Arc::new(std::sync::Mutex::new(SystemResourceService::new()))` → `.manage()`（同步锁；`new()` 只初始化 CPU 列表/内存/磁盘/网卡，不枚举进程） |
| 11 | lib.rs:219 | `AccountService::start_auto_refresh(timer_service)` 启动账户自动刷新定时器（此时 tokio runtime 已就绪） |
| 12 | lib.rs:222-250 | 对 `main` 窗口挂 `on_window_event`：`CloseRequested` 时读配置键 `close_action`（默认 `"ask"`）——`"minimize_to_tray"`/`"ask"` → `api.prevent_close()` + `window.hide()`；`"close"` → 放行默认关闭；其它值 → 隐藏到托盘 |
| 12 | lib.rs:250 | `run(tauri::generate_context!())` |

### `.manage()` 的全部状态（4 个）
| State 类型 | 注册处 | 说明 |
| --- | --- | --- |
| `Arc<std::sync::Mutex<ConfigService>>` | lib.rs:154 | 全局配置（JSON 文件 + 内存缓存），所有同步配置命令与 tray 共用 |
| `Arc<GachaService>` | lib.rs:190 | 抽卡记录服务（持有 AppHandle） |
| `Arc<tokio::sync::Mutex<AccountService>>` | lib.rs:208 | 账户服务（异步方法，tokio 锁） |
| `Arc<tokio::sync::Mutex<GameLauncherService>>` | lib.rs:212 | 游戏启动器服务 |

> 未 manage 的服务：`SklandService`、`AvatarCacheService`、`NetworkService`、`GameLauncherService` 之外的依赖链，仅在 setup 内部传递。

**备注**：`lib.rs` 本身**没有任何 `emit`/`listen`**，也**没有 `.menu()`（无应用菜单）**；托盘只建图标不建右键菜单。

### 命令总表（`.invoke_handler` 完整清单，共 100 个，与 `#[tauri::command]` 定义数 100 一致，无遗漏/无多余）

**config（lib.rs:36-39）**：`get_config`、`set_config`、`remove_config`、`get_all_configs`
**attendance（lib.rs:41-42）**：`get_attendance`、`do_attendance`
**gacha 角色池（lib.rs:44-48）**：`get_gacha_pool_meta`、`sync_gacha_records`、`get_saved_gacha_records`、`get_gacha_record_stats`、`resolve_gacha_avatar_map`
**gacha 武器池（lib.rs:50-51）**：`sync_weapon_gacha_records`、`get_saved_weapon_gacha_records`
**account 主体（lib.rs:53-71）**：`get_accounts`、`get_skland_accounts`、`save_skland_account`、`get_skland_account_roles`、`get_skland_user_info`、`get_skland_games`、`add_account`、`logout_account`、`batch_logout`、`refresh_accounts`、`send_verification_code`、`add_account_by_code`、`gen_scan_login`、`scan_status`、`add_account_by_scan`、`save_selected_roles`、`get_selected_account`、`set_selected_account`、`check_and_refresh_cred`
**card_config（lib.rs:73-75）**：`get_card_settings`、`save_card_settings`、`remove_card_settings`
**system_resource（lib.rs:77）**：`get_system_snapshot`
**account 追加（lib.rs:76-79）**：`query_role_data`、`set_lazy_load_enabled`、`is_lazy_load_enabled`、`set_current_role_id`
**image（lib.rs:81-86）**：`read_image_file`、`get_image_cache_dir`、`download_image`、`get_backgrounds_dir`、`save_background_image`、`delete_background_image`
**window（lib.rs:88-91）**：`minimize_window`、`toggle_maximize_window`、`close_window`、`minimize_to_tray`
**color_picker（lib.rs:93-94）**：`capture_screen`、`finish_screen_pick`
**logs（lib.rs:96）**：`get_backend_logs`
**capture（lib.rs:98-104）**：`capture_start`、`capture_stop`、`capture_status`、`capture_list_sessions`、`capture_read_entries`、`capture_delete_session`、`capture_dir`
**updater（lib.rs:106-112）**：`write_file`、`get_temp_dir`、`fetch_url`、`download_file`、`run_installer`、`cancel_download`、`reset_download_cancel`
**tray（lib.rs:114-120）**：`get_tray_user_info`、`set_tray_user`、`update_tray_user_data`、`show_tray_panel`、`hide_tray_panel`、`show_main_window`、`app_quit`
**launcher（lib.rs:122-147，26 个）**：`launcher_check_status`、`launcher_get_process_read_bytes`、`launcher_install_or_update`、`launcher_verify_and_repair`、`launcher_preload_download`、`launcher_get_remote_version`、`launcher_get_payload_state`、`launcher_cancel_download`、`launcher_has_download_cache`、`launcher_reset_download_cancel`、`launcher_decrypt_file`、`launcher_get_banners`、`launcher_get_announcements`、`launcher_get_notice_content`、`launcher_get_background_image`、`launcher_start_game`、`launcher_browse_folder`、`launcher_check_executable`、`launcher_check_game_running`、`launcher_kill_game`、`launcher_detect_channel`、`launcher_scan_install_dir`、`launcher_get_disk_space`、`launcher_switch_channel`、`launcher_cancel_switch`、`launcher_cancel_all`

### 后端 emit 事件（全局，非 lib.rs 内发起）
| 事件名 | 发出位置 | 载荷 |
| --- | --- | --- |
| `tray-user-info-updated` | tray.rs:146（仅发给 tray-panel 窗口） | `TrayUserInfo` |
| `launcher-progress` | commands/launcher.rs:74/117/168 | 启动器下载/校验进度 |
| `accounts-refreshed` | services/account_service.rs:799 | 账户刷新结果 |
| `download-progress` | commands/updater.rs:106 | 更新包下载进度 |
| `gacha-sync-progress` | services/gacha_service.rs:746（常量 `GACHA_SYNC_PROGRESS_EVENT`，定义于 gacha_service.rs:22） | 抽卡同步进度 |
| `launcher://switch-progress` | services/game_launcher_service.rs:2471 | 换渠道进度 |
| `launcher://progress` | services/game_launcher_service.rs:2472 | `ActiveOperation::Switching(progress)` |

> 后端 Rust 侧没有任何 `listen(...)`；其余监听均在前端（如 `custom-titlebar.tsx` 监听 `tauri://resize`、`tauri://move`）。

---

## `src-tauri/src/tray.rs`
**职责**：系统托盘图标与托盘悬浮面板（tray-panel 窗口）的创建、定位、显隐与 tooltip 更新（171 行）。
**导出**：`TrayUserInfo`、`show_main_window_focus`、`setup_tray`、`update_tray_menu`、`show_tray_panel`、`hide_tray_panel`；私有 `show_panel_at_position`。
**主要依赖**：`tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton}`、`tauri::{Emitter, Manager, Runtime}`、`windows-sys`（仅 Windows 分支）、`crate::services::config_service::ConfigService`。

### 内部结构

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TRAY_ID` | tray.rs:9 | `"main-tray"`，托盘图标唯一 ID（`app.tray_by_id` 用） |
| `TRAY_PANEL_LABEL` | tray.rs:10 | `"tray-panel"`，与 tauri.conf.json 中第二窗口 label 对应 |
| `PANEL_WIDTH` / `PANEL_HEIGHT` | tray.rs:12-13 | 260.0 × 340.0，与 tauri.conf.json tray-panel 窗口尺寸一致（硬编码重复，改配置需同步改这里） |
| `struct TrayUserInfo` | tray.rs:18（derive :16-17） | 托盘展示的角色数据，serde `camelCase`，12 个 `Option` 字段：`role_id`、`nickname`、`avatar`、`cur_stamina`、`max_stamina`、`max_ts`、`daily_activation`、`max_daily_activation`、`weekly_score`、`weekly_total`、`bp_cur_level`、`bp_max_level`；配置键 `tray_user_info` |
| `show_main_window_focus` | tray.rs:34 | 取 `main` 窗口 → `unminimize()` + `show()`；Windows 分支额外 `ShowWindow(SW_SHOW)` + `SetForegroundWindow`（tray.rs:39-51），非 Windows 用 `set_focus()`（tray.rs:53-56） |
| `show_panel_at_position`（私有） | tray.rs:61 | 面板**可见则隐藏（toggle）**（tray.rs:66-69）；否则定位在托盘图标正上方：`x = tray_pos.x - 260/2`、`y = tray_pos.y - 340 - 8`（tray.rs:72-73），然后 `show()` + `set_focus()` |
| `setup_tray` | tray.rs:85 | 读配置 `tray_user_info` → tooltip 取 `nickname`（缺省 `"EndProtocol"`）；`TrayIconBuilder::with_id(TRAY_ID)`，图标用 `app.default_window_icon()`，`show_menu_on_left_click(false)`；事件：**左键双击** → `show_main_window_focus` + 关面板（tray.rs:106-114）；**右键抬起** → `show_panel_at_position` 按图标位置弹面板（tray.rs:115-123） |
| `update_tray_menu` | tray.rs:133 | 按 `TrayUserInfo.nickname` 更新 tooltip（tray.rs:137-143），并向 tray-panel 窗口 `emit("tray-user-info-updated", user_info)`（tray.rs:146） |
| `show_tray_panel` | tray.rs:153 | 命令入口的 toggle 显隐（可见→hide，否则 show+focus） |
| `hide_tray_panel` | tray.rs:166 | 强制隐藏面板（无错误时返回 Ok） |

**备注**：`setup_tray` 由 lib.rs:177 调用；`update_tray_menu`、`show_tray_panel`、`hide_tray_panel` 被 `commands/tray.rs` 调用。托盘**没有菜单项**，只有图标事件。

---

## `src-tauri/build.rs`
**职责**：构建脚本（3 行），仅调用 `tauri_build::build()` 生成 Tauri 的代码生成产物（IPC 模式、ACL schema 到 `gen/schemas/`、上下文等）。
**导出**：无（build script）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `main` | build.rs:1 | 调用 `tauri_build::build()`（build.rs:2） |

**备注**：`gen/schemas/`（`acl-manifests.json`、`capabilities.json`、`desktop-schema.json`、`windows-schema.json`）由它在编译期生成。

---

## `src-tauri/Cargo.toml`
**职责**：Rust 包清单（65 行）：定义 lib/bin 双 target、构建依赖、全部运行时依赖、（无效的）链接参数与 dev profile。
**导出**：crate `endprotocol_lib`（`staticlib` + `cdylib` + `rlib`）与 bin `endprotocol`。

### 逐 key 说明
| Key | 行号 | 用途 |
| --- | --- | --- |
| `package.name` | Cargo.toml:2 | `endprotocol`（bin 名） |
| `package.version` | :3 | `0.1.0`，与 tauri.conf.json `version` 一致 |
| `package.description` / `authors` / `edition` | :4-6 | `"A Tauri App"` / `["you"]` / `2021` |
| `lib.name` | :14 | `endprotocol_lib` — `_lib` 后缀避免与 bin 同名冲突（Windows 特有问题，见 :11-13 注释引用 rust-lang/cargo#8519） |
| `lib.crate-type` | :15 | `["staticlib", "cdylib", "rlib"]`（支持移动端静态链接 + 常规 Rust 引用） |
| `build-dependencies.tauri-build` | :17-18 | `2`，features 空 |
| `dependencies.tauri` | :21 | `2` + feature `tray-icon`（托盘必需） |
| `dependencies.tauri-plugin-opener` / `-fs` | :22-23 | 打开 URL/路径、文件系统插件 |
| `dependencies.serde` / `serde_json` | :24-25 | 序列化（serde 带 `derive`） |
| `dependencies.reqwest` | :26 | `0.12` + `json`、`stream`（流式下载） |
| `dependencies.futures-util` / `urlencoding` | :27-28 | 异步流工具、URL 编码 |
| `dependencies.tokio` | :29 | `1` + `full`（异步运行时） |
| `dependencies.thiserror` | :30 | 错误类型派生 |
| `dependencies.dirs` / `chrono` | :31-32 | 系统目录、时间（chrono 带 `serde`） |
| `dependencies.tracing` / `tracing-subscriber` | :33-34 | 日志（subscriber 带 `fmt`） |
| `dependencies.aes/cbc/ecb/des` | :35-37,:42 | 对称加密（游戏资源解密） |
| `dependencies.hmac/sha2/md-5/digest` | :38-41 | 森空岛签名（HMAC-SHA256 + MD5）与通用摘要 |
| `dependencies.rsa` | :43 | RSA 加密（登录/凭证） |
| `dependencies.flate2` | :44 | `zlib` 后端的 gzip 压缩/解压 |
| `dependencies.base64` / `bytes` / `http` | :45-47 | 编码与 HTTP 基础类型 |
| `dependencies.windows-sys` | Cargo.toml | `0.61`，features：`Win32_Foundation`、`Win32_Graphics_Gdi`、`Win32_UI_WindowsAndMessaging`、`Win32_System_Com`、`Win32_UI_Shell`、`Win32_System_Threading`（托盘取前台窗口、取色、进程检测）、`Win32_System_Power` / `Win32_System_Performance`（system_resource_service 采集实测 CPU 频率） |
| `dependencies.sysinfo` | Cargo.toml | 系统资源采集（CPU/内存/磁盘/网络/温度传感器），见 `services/system_resource_service.rs` |
| `dependencies.uuid` / `hex` / `rand` | :49-51 | UUID v4、十六进制、随机数 |
| `dependencies.indexmap` | :52 | 有序 map（带 `serde`） |
| `dependencies.tauri-plugin-process` | :53 | `2.3.1`，应用重启 |
| `dependencies.walkdir` / `rfd` | :54-55 | 目录遍历（校验/扫描）、原生文件对话框（`launcher_browse_folder`） |
| `target.x86_64-pc-windows-msvc.rustflags` | :57-58 | 意图是 `-fuse-ld=lld`（lld 链接器）——**该 key 在 Cargo.toml 中无效**，见文末异常 |
| `target.'cfg(not(android,ios))'.dependencies` | :60-61 | `tauri-plugin-updater = "2"`，仅桌面平台启用（与 lib.rs:30 的插件注册配套） |
| `profile.dev.debug` | :64 | `"line-tables-only"` — **在 workspace 中被忽略**（见异常） |
| `profile.dev.incremental` | :65 | `true` — 同上 |

### 依赖分组速查
| 用途 | crate |
| --- | --- |
| 框架/IPC | `tauri`、`tauri-plugin-{opener,fs,process,updater}`、`tauri-build` |
| 网络 | `reqwest`、`futures-util`、`http`、`urlencoding` |
| 数据 | `serde`、`serde_json`、`chrono`、`indexmap`、`bytes`、`uuid`、`hex`、`rand` |
| 加密/签名 | `aes`、`cbc`、`ecb`、`des`、`rsa`、`hmac`、`sha2`、`md-5`、`digest`、`base64`、`flate2` |
| 系统/IO | `dirs`、`walkdir`、`rfd`、`windows-sys` |
| 日志/错误 | `tracing`、`tracing-subscriber`、`thiserror` |

---

## `src-tauri/tauri.conf.json`
**职责**：Tauri v2 应用配置（85 行）：应用标识、构建命令、两个窗口（主窗口 + tray-panel）、安全策略、NSIS 打包与更新端点。
**导出**：无（JSON 配置）。

### 逐 key 说明
| Key | 行号 | 用途 |
| --- | --- | --- |
| `$schema` | :2 | `https://schema.tauri.app/config/2`（Tauri 2 schema） |
| `productName` | :3 | `endprotocol` — 产品名（安装包名） |
| `version` | :4 | `0.1.0`，与 Cargo.toml 同步 |
| `identifier` | :5 | `cn.msk-network.endprotocol` — 应用唯一标识（决定配置/数据目录） |
| `build.beforeDevCommand` | :7 | `pnpm dev`（启动 Vite） |
| `build.devUrl` | :8 | `http://localhost:1420` |
| `build.beforeBuildCommand` | :9 | `pnpm build` |
| `build.frontendDist` | :10 | `../dist` |
| `app.windows[0]`（主窗口） | :14-26 | **无 `label` 字段 → 默认 label 为 `main`**（代码里 `get_webview_window("main")` 依赖此默认值）；`title: "endprotocol"`、`1200×700`、`resizable: true`、`center: true`、`decorations: false`（无边框，配合自绘标题栏）、`transparent: true`、`windowEffects.acrylic` 毛玻璃 `color: [18,18,20,30]`；无 `url` → 默认加载 `/`（index.html） |
| `app.windows[1]`（tray-panel） | :27-43 | `label: "tray-panel"`（= tray.rs:10 常量）、`url: "/tray-panel.html"`、`260×340`、`resizable: false`、`decorations: false`、`transparent: true`、`visible: false`（初始隐藏）、`skipTaskbar: true`、`alwaysOnTop: true`、同款 acrylic `[18,18,20,30]` |
| `app.security.csp` | :46 | `null` — 关闭 CSP（未设置内容安全策略） |
| `bundle.active` | :50 | `true` — 启用打包 |
| `bundle.createUpdaterArtifacts` | :51 | `true` — 生成 updater 用的签名产物 |
| `bundle.targets` | :52 | `["nsis"]` — 仅 Windows NSIS 安装器 |
| `bundle.icon` | :54-60 | 32/128/256 png、`icon.icns`（macOS 预留）、`icon.ico`（Windows） |
| `bundle.windows.nsis.installerIcon` / `uninstallerIcon` | :64-65 | 均为 `icons/icon.ico` |
| `bundle.windows.nsis.installMode` | :67 | `currentUser` — 无需管理员权限的按用户安装 |
| `bundle.windows.nsis.startMenuFolder` | :69 | `ENDPROTOCOL` |
| `bundle.windows.nsis.languages` | :71 | `["SimpChinese", "English"]` |
| `plugins.updater.pubkey` | :77 | minisign 公钥（`dW50cnVzdGVkIGNvbW1lbnQ6...` base64） |
| `plugins.updater.endpoints` | :78-82 | 三个更新源，按序回退：`https://updates.msk-network.cn/stable/latest.json` → `https://updates.msk-network.cn/preview/latest.json` → `https://github.com/soldiereleven/endprotocol/releases/latest/download/latest.json` |

---

## `src-tauri/capabilities/default.json`
**职责**：主窗口与托盘面板共用的基础 ACL 权限（23 行）。
**导出**：无。

### 逐 key 说明
| Key | 行号 | 用途 |
| --- | --- | --- |
| `$schema` | :2 | `../gen/schemas/desktop-schema.json`（由 build.rs 生成） |
| `identifier` | :3 | `default` |
| `description` | :4 | "Capability for the main window and tray panel" |
| `windows` | :5 | `["main", "tray-panel"]` — 对两个窗口同时生效 |
| `permissions` | :6-22 | 见下表 |

| 权限 | 行 | 用途 |
| --- | --- | --- |
| `core:default` | :7 | Tauri core 默认集（事件、资源等基础能力） |
| `core:window:allow-minimize` | :8 | 最小化 |
| `core:window:allow-maximize` / `allow-unmaximize` | :9-10 | 最大化/还原（配合 `toggle_maximize_window` 之外的前端 API） |
| `core:window:allow-close` | :11 | 关闭窗口 |
| `core:window:allow-show` / `allow-hide` | :12-13 | 显示/隐藏（托盘隐藏主窗、面板显隐） |
| `core:window:allow-is-visible` | :14 | 查询可见性 |
| `core:window:allow-set-focus` | :15 | 聚焦 |
| `core:window:allow-set-position` | :16 | 设定位置 |
| `core:window:allow-primary-monitor` | :17 | 查询主显示器 |
| `core:window:allow-outer-position` / `allow-outer-size` | :18-19 | 查询窗口外框位置/尺寸（最大化状态判断等） |
| `opener:default` | :20 | opener 插件默认集（含 `reveal_item_in_dir`、mailto/tel/http(s) URL） |
| `opener:allow-open-url` | :21 | 无 scope 限制地打开任意 URL |

**备注**：**未授予** `core:window:allow-start-dragging`；前端自绘标题栏改用 CSS `WebkitAppRegion: "drag"`（custom-titlebar.tsx:170/208）实现拖动，未调用 `startDragging()`。

---

## `src-tauri/capabilities/desktop.json`
**职责**：桌面平台专属的补充权限（17 行）：更新器、打开路径、重启。
**导出**：无。

### 逐 key 说明
| Key | 行号 | 用途 |
| --- | --- | --- |
| `$schema` | — | **缺失**（default.json 有，此文件没有；不影响生成） |
| `identifier` | :2 | `desktop-capability` |
| `platforms` | :3-7 | `["macOS", "windows", "linux"]` — 仅桌面端生效（移动端不加载） |
| `windows` | :8-11 | `["main", "tray-panel"]` |
| `permissions` | :12-16 | `updater:default`（检查/下载/安装更新全流程，配合 updateService.ts:1 `check`）、`opener:allow-open-path`（无 scope 打开路径）、`process:allow-restart`（配合 updateService.ts:837 `relaunch()`） |

**备注**：**未授予** `process:allow-exit`；`fs` 插件已注册但两个 capability 文件均无任何 `fs:*` 权限。

---

## `src-tauri/examples/sign_test.rs`
**职责**：独立可运行示例（58 行，`cargo run --example sign_test`），用固定测试向量验证森空岛请求签名算法（HMAC-SHA256 → hex → MD5），并与 Python 实现的 header 顺序/紧凑格式对齐；用于调试对照，**不参与应用编译产物**。
**导出**：无（example binary）。
**主要依赖**：`hmac`、`sha2`、`md-5`（以 `md5` 名义）、`hex`、`serde_json`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `type HmacSha256` | sign_test.rs:8 | `Hmac<Sha256>` 别名 |
| `calculate_sign` | sign_test.rs:10 | 拼 `h_ca` header JSON（键序固定 `platform/timestamp/dId/vName`，`vName: "1.45.1"`、`platform: "1"`，sign_test.rs:12-15）→ raw = `path + body + ts + h_ca_str`（:18）→ HMAC-SHA256(token) 取 hex（:19-21）→ MD5(hex) 输出小写 hex（:24-25） |
| `main` | sign_test.rs:28 | 固定向量：token `9f192562b31b3d6222a22591fda002e8`、path `/api/v1/game/attendance`、body `{"uid":45235032,"gameId":"1"}`、ts `1683100800`、did `Bexampledid==`（:30-34）；重算一遍 raw/hex 并打印调试信息（:38-57） |

**备注**：与生产实现 `services/skland_service.rs::calculate_sign`（skland_service.rs:422，同为 HMAC-SHA256 + MD5，带 `log_debug!`）算法一致；改签名规则时两处需同步。`vName` 硬编码为 `1.45.1`。

---

## 附：本次核对发现的异常
1. **Cargo.toml:57-58 `rustflags` 是无效 key** — `cargo check` 实测报 `warning: F:\endprotocol\src-tauri\Cargo.toml: unused manifest key: target.x86_64-pc-windows-msvc.rustflags`。`rustflags` 属于 `.cargo/config.toml`（本仓库不存在 `.cargo/` 目录），因此 `-fuse-ld=lld` 实际**未生效**，链接仍用默认 MSVC link。
2. **Cargo.toml:63-65 `[profile.dev]` 被忽略** — 仓库根 `Cargo.toml` 是 virtual workspace（仅 `members = ["src-tauri"]`），`cargo` 警告 `profiles for the non root package will be ignored`，`debug = "line-tables-only"` / `incremental = true` 未应用。
3. **workspace 缺 `resolver = "2"`** — `cargo` 警告 virtual workspace 默认 resolver 1，与 edition 2021 成员不匹配。
4. **`tauri_plugin_fs` 已注册（lib.rs:33）但无 `fs:*` 权限** — default.json/desktop.json 均未授予任何 fs 权限，且前端未引用 `@tauri-apps/plugin-fs`，该插件目前对 webview 不可用（Rust 侧直接用 std::fs 不受影响）。
5. **`process:allow-exit` 未授予** — tray-panel.tsx:127 的回退分支 `getCurrentWindow().app.exit(0)` 本身也非合法 API（`Window` 类型无 `app` 属性，tsc 报 TS2339），运行时必然抛错，仅被 try/catch 吞掉。
6. **能力文件缺 schema** — `capabilities/desktop.json` 无 `$schema` 字段（`default.json` 有）。
7. **`cargo check` 通过但有 46 个 warning** — 大量未使用导入/死代码（如 `commands/tray.rs:2` 的 `Emitter`、`Manager`），另有 `error finalizing incremental compilation session directory ... (os error 5)` 的 target 目录权限问题（仅影响增量编译缓存，不阻断编译）。
8. **托盘面板尺寸/label 双重定义** — `tray.rs:10,12-13` 与 `tauri.conf.json:28,31-32` 各写一份，需人工保持一致。
