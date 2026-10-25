# 后端启动、窗口与全局配置 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖：应用入口链（main → lib::run）、托盘、构建脚本、Cargo 依赖、Tauri 配置、ACL capability，以及签名测试示例。

## `src-tauri/src/main.rs`
**职责**：二进制入口（6 行）。仅设置 Windows 子系统属性后委托给库 crate 的 `run()`，不含任何业务逻辑。
**导出**：无（binary crate）。
**主要依赖**：`endprotocol_lib`（即 `src-tauri/src/lib.rs`，lib 名为 `endprotocol_lib`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `windows_subsystem` 属性 | main.rs:5 | **无条件** `#![windows_subsystem = "windows"]`（注释标注 DO NOT REMOVE）：release 与 debug 都不再创建控制台，被 Steam / 快捷方式等无控制台父进程拉起时不会闪现黑窗口；debug 下 `run()` 开头用 `AttachConsole(ATTACH_PARENT_PROCESS)` 附接父终端，`cargo run` 的控制台日志仍可输出 |
| `main` | main.rs:4 | 调用 `endprotocol_lib::run()`（main.rs:5） |

**备注**：`cargo run`/`pnpm tauri dev` 的实际逻辑全部在 lib.rs。

---

## `src-tauri/src/lib.rs`
**职责**：应用核心装配点。入口首先截获已有提权 helper，安装全局 panic hook，再由单实例插件处理后续启动请求。`--silent` 分支不创建 WebView、不注册完整应用插件和业务服务，只初始化配置、单实例和图标托盘；普通分支才初始化完整服务并动态创建主窗口/托盘面板。游戏启动继续复用 `launcher_start_game`。两种模式都在 setup 中保存 `AppHandle` 供崩溃广播，并调用 `utils::game_playtime::init()` 启动游戏在线时长统计，在 `RunEvent::Exit` 时 `utils::game_playtime::finalize()` 落盘。
**导出**：`pub fn run()`（唯一公开项）；其余为私有模块声明。
**主要依赖**：`commands`、`models`、`services`、`tray`、`utils` 模块；`services::{account_service, avatar_cache_service, config_service, gacha_service, game_launcher_service, network_service, skland_service}`；`tauri`、`tokio::sync::Mutex`、`std::sync::Arc`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `mod commands/models/services/tray/utils` | lib.rs:7-11 | 后端模块声明（全部私有） |
| `use services::*` | lib.rs:14-21 | 导入 8 个服务类型（Account/AvatarCache/Config/Gacha/GameLauncher/Network/Skland/SystemResource） |
| `run` | lib.rs:28 | 解析 `--silent` / `--launch-game` / `--dx11`：仅 `--silent` → 直接返回（不做任何事）；`--silent --launch-game` → 不可见驻守实例（无托盘/无窗口/不计时/不注册单实例插件）；仅 `--launch-game` 或普通启动 → 完整模式（单实例）并在需要时启动游戏。完整模式在 `RunEvent::Exit` 调用 `utils::game_playtime::finalize()` |
| `utils::crash::install_panic_hook()` | lib.rs:54 | 在 helper 截获与 `--silent` 空操作检查之后、业务初始化之前安装 panic hook；崩溃写入 `logs/crashes/crash-*.log` 并广播 `app:crash` |
| `create_config_service` | lib.rs:335 | 初始化现有 `ConfigService`，并校验/更新配置键 `main_exe_path` |
| `crash::set_app_handle` / `api_health::init` | lib.rs:65 / 246 | 驻守/完整模式设置崩溃广播 handle；完整模式额外初始化 API 熔断器，二者均在 `.setup()` 最前调用 |
| `attach_parent_console`（私有，仅 Windows debug） | lib.rs:327 | `main.rs` 已无条件使用 GUI 子系统，进程本身不再创建控制台（根除黑窗口闪现：控制台在进程创建期生成，进程内 `ShowWindow(SW_HIDE)` 只能事后隐藏、仍会闪一瞬间）。此函数在 `run()` 最开头（logger / Tauri 初始化之前）尝试 `AttachConsole(ATTACH_PARENT_PROCESS)`：手动 `cargo run` 时附接父终端使日志可见，被 Steam / 快捷方式拉起时附接失败即静默无窗口。附接必须发生在首次 stdio 写入前（`eprintln!` 在 GUI 进程无控制台时会 panic，所有 stderr 写入均需经 `logger::safe_eprintln!`） |
| `app_ready_for_full_instance` / `dispatch_pending_requests` | lib.rs:343 / 352 | 完整模式 setup 完成后标记就绪，并处理插件在 setup 完成前排队的第二实例请求 |
| `dispatch_instance_request` | lib.rs:371 | 主实例收到第二实例转交的参数：含 `--launch-game` 时以 `--dx11` 转发启动游戏（`exit_when_game_ends=false`），随后显示主窗口 |
| `wait_for_game_session`（async） | lib.rs:384 | 驻守实例的驻留等待：每 2 秒通过 `utils::process::is_process_running`（窗口/90 秒启动宽限判定，排除无窗口挂起残留）探测 `Endfield.exe`；检测到运行后等待其退出；若 120 秒内未出现（启动失败/被取消）也结束等待，供 Steam 判定「游戏中」并记录时长 |
| `start_game_from_config` | lib.rs:404 | 读取 `launcher_install_path` / `launcher_channel` / `launcher_dx11` 并调用 `commands::launcher::launch_game`；`dx11: Option<bool>` 优先取命令行 `--dx11`，`None` 时回退配置 `launcher_dx11`（默认 false）；`exit_when_game_ends=true`（仅驻守实例）时启动成功后调用 `wait_for_game_session`，游戏退出后才退出本进程；启动失败时同样退出 |
| `create_full_windows` / `create_main_window` / `app_webview_url` / `dev_asset_url` | lib.rs:492 / 516 / 560 / 608 | 完整模式按需创建窗口；debug 优先连 Vite，开发服务器不可用时改由自定义协议 `endprotocol` 提供 `frontendDist` 资源 |
| `register_dev_asset_protocol` / `dev_asset_error_response` | lib.rs:620 / 649 | debug 专用：注册 `endprotocol` URI scheme，经 `asset_resolver()` 提供构建产物（含 `.html`、目录 `index.html` 与入口 `index.html` 回退） |

### 内部结构

| 行号区间 | 内容 |
| --- | --- |
| lib.rs:27 | `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 属性 |
| lib.rs:35-42 | **提权启动 helper 截获**：`utils::official_launcher::try_run_helper()` 命中 `--endfield-launch-helper` 时以游戏退出码退出，不做 Tauri 初始化 |
| lib.rs:44-57 | 解析 `--silent` / `--launch-game`；仅 `--silent` 直接返回（不做任何事）；随后安装 panic hook 并解析 `--dx11`（`Option<bool>`，仅与 `--launch-game` 组合生效） |
| lib.rs:59-75 | **驻守实例**（`--silent --launch-game`）：不注册单实例插件、不创建窗口/托盘、不初始化 `game_playtime`；初始化 config 后启动游戏，由 `wait_for_game_session` 驻留到游戏退出，再随进程结束退出 |
| lib.rs:77-241 | 完整模式：初始化日志、创建单实例插件、注册 updater/process/opener/fs 插件与完整命令集 |
| lib.rs:243-317 | 完整模式 setup：动态窗口、全量服务、原托盘面板和账户刷新；`--launch-game` 时启动游戏 |
| lib.rs:325-491 | 配置初始化、第二实例请求转发（仅主实例）、按需启动游戏与驻留等待（`wait_for_game_session`） |
| lib.rs:492-607 | 完整模式窗口动态创建与关闭行为 |
| lib.rs:608-655 | debug 专用：`endprotocol` 自定义协议，经 `asset_resolver()` 提供 `frontendDist` 构建产物 |

**插件注册**：
| 插件 | 行 | 对应 capability |
| --- | --- | --- |
| `tauri_plugin_single_instance` | lib.rs:89（注册 lib.rs:100） | **仅完整模式启用**；保证同时只有一个主实例；驻守实例（`--silent --launch-game`）不注册插件，可同时存在任意多个；Windows 命名互斥体默认按当前 Windows 会话隔离 |
| `tauri_plugin_updater` | lib.rs:101 | 仅完整模式，`updater:default`（desktop.json） |
| `tauri_plugin_process` | lib.rs:102 | 仅完整模式，`process:allow-restart`（desktop.json） |
| `tauri_plugin_opener` | lib.rs:103 | 仅完整模式，`opener:default` / `opener:allow-open-url`（default.json）、`opener:allow-open-path`（desktop.json） |
| `tauri_plugin_fs` | lib.rs:104 | 仅完整模式；**未授予任何 `fs:*` 权限**（见文末异常） |

**稳定命令行参数**：`--silent` 单独出现时不启动应用、不创建窗口/托盘/驻守进程，直接退出；`--silent --launch-game` 启动一个**不可见驻守实例**（无窗口、无托盘、不计时、不注册单实例插件）并启动 config 中配置的游戏，每 2 秒探测 `Endfield.exe`，游戏退出（或 120 秒内未检测到游戏进程）后退出；仅 `--launch-game` 时以正常完整模式启动应用并一并启动游戏；`--dx11` 仅与 `--launch-game` 组合生效——存在时给游戏进程追加 `-force-d3d11`，不存在时使用应用内设置 `launcher_dx11`（默认 false）。完整模式注册单实例插件，因此同时只允许一个主实例；驻守实例彼此独立，且不受主实例或其它驻守实例启停影响。第二实例按普通启动方式转发给主实例并显示主窗口（`--dx11` 随请求转发）。debug 模式优先使用配置的 Vite `devUrl`；若开发服务器未运行，则在同一进程内注册自定义协议 `endprotocol`（Windows 为 `http://endprotocol.localhost`，其余平台为 `endprotocol://localhost`），由 `asset_resolver()` 回退读取 `frontendDist` 中构建好的文件（注册于 `register_dev_asset_protocol`），二者均不可用时返回明确错误。注意不能用 `tauri://localhost` / `http://tauri.localhost`：dev 构建不含内嵌资源，Tauri 协议处理器会直接报 `asset not found`。

### `.setup()` 初始化步骤顺序（完整模式）
| 步骤 | 行号 | 内容 |
| --- | --- | --- |
| 1 | lib.rs:247-250 | 初始化 `ConfigService`，校验并更新 `main_exe_path`，`.manage()` 注册；随后 `utils::game_playtime::init(config_service.clone())` 启动时长统计；再动态创建完整 WebView 窗口 |
| 2 | lib.rs:252-267 | 读配置键 `capture_autostart`（默认 false），为 true 时调用 `utils::capture::start()` 自动录制；成功/失败只记日志 |
| 3 | lib.rs:269-270 | `tray::setup_tray(app.handle(), config_service)`，沿用完整模式的右键托盘面板 |
| 4 | lib.rs:273 | `SklandService::new(config_service)` — **不** manage，作为依赖注入下游 |
| 5 | lib.rs:276-277 | `AvatarCacheService::new()` — 不 manage |
| 6 | lib.rs:280-281 | `GachaService::new(app.handle())` → `.manage()` |
| 7 | lib.rs:284 | `NetworkService::new(skland, avatar_cache)` — 不 manage |
| 8 | lib.rs:287-296 | `AccountService::new(config, skland, avatar_cache, network, app_handle)` 包进 `Arc<tokio::sync::Mutex<>>` → `.manage()` |
| 9 | lib.rs:299-300 | `Arc::new(Mutex::new(GameLauncherService::new()))` → `.manage()`（tokio Mutex） |
| 10 | lib.rs:302-305 | `Arc::new(std::sync::Mutex::new(SystemResourceService::new()))` → `.manage()` |
| 11 | lib.rs:308 | `AccountService::start_auto_refresh(timer_service)` 启动账户自动刷新定时器 |
| 12 | lib.rs:543 | 创建 `main` 窗口时挂 `CloseRequested`：按 `close_action` 配置决定退出或最小化托盘 |

**静默/驻守模式初始化**（lib.rs:59-75）：仅 `--silent` 在进入 Tauri 之前直接返回（lib.rs:48-51），不做任何事；`--silent --launch-game` 创建不可见驻守实例：只初始化配置服务、记录/更新 `main_exe_path` 并启动游戏，不注册 IPC 命令与单实例插件，不创建窗口/托盘，不启动 logger、`game_playtime`、账户自动刷新、缓存、抽卡/系统资源服务；启动成功后由 `wait_for_game_session` 驻留等待游戏退出，再结束进程。

### `.manage()` 的完整模式状态（5 个；驻守模式仅注册 config）
| State 类型 | 注册处 | 说明 |
| --- | --- | --- |
| `Arc<std::sync::Mutex<ConfigService>>` | lib.rs:248 | 全局配置（JSON 文件 + 内存缓存），完整/驻守模式共用 |
| `Arc<GachaService>` | lib.rs:266 | 抽卡记录服务（持有 AppHandle） |
| `Arc<tokio::sync::Mutex<AccountService>>` | lib.rs:284 | 账户服务（异步方法，tokio 锁） |
| `Arc<tokio::sync::Mutex<GameLauncherService>>` | lib.rs:288 | 游戏启动器服务（仅完整模式） |
| `Arc<std::sync::Mutex<SystemResourceService>>` | lib.rs:293 | 系统资源采集服务（仅完整模式） |

> 未 manage 的依赖服务：`SklandService`、`AvatarCacheService`、`NetworkService`，仅在 setup 内部传递。

**备注**：`lib.rs` 本身**没有任何 `emit`/`listen`**，也**没有全局应用菜单**；完整模式右键托盘仍打开原有托盘面板。

### 命令总表（完整模式 `.invoke_handler` 注册 114 个命令；驻守模式不注册 IPC 命令）

完整命令清单与定义/调用关系见 [commands.md](commands.md) 和 [ipc_index.md](../ipc_index.md)；驻守分支为纯 `Builder::default().setup(...)`（lib.rs:59-75），不注册单实例插件，也无 `.invoke_handler`。

### 后端 emit 事件（全局，非 lib.rs 内发起）
| 事件名 | 发出位置 | 载荷 |
| --- | --- | --- |
| `tray-user-info-updated` | tray.rs:173（仅发给 tray-panel 窗口） | `TrayUserInfo` |
| `launcher-progress` | commands/launcher.rs:74/117/168 | 启动器下载/校验进度 |
| `accounts-refreshed` | services/account_service.rs:812 | 账户刷新结果 |
| `download-progress` | commands/updater.rs:106 | 更新包下载进度 |
| `gacha-sync-progress` | services/gacha_service.rs:746（常量 `GACHA_SYNC_PROGRESS_EVENT`，定义于 gacha_service.rs:22） | 抽卡同步进度 |
| `launcher://switch-progress` | services/game_launcher_service.rs:2471 | 换渠道进度 |
| `launcher://progress` | services/game_launcher_service.rs:2472 | `ActiveOperation::Switching(progress)` |

> 后端 Rust 侧没有任何 `listen(...)`；其余监听均在前端（如 `custom-titlebar.tsx` 监听 `tauri://resize`、`tauri://move`）。

---

## `src-tauri/src/tray.rs`
**职责**：系统托盘图标与托盘悬浮面板（tray-panel 窗口）的创建、定位、显隐与 tooltip 更新（198 行）。仅在完整模式创建；`--silent --launch-game` 驻守实例不显示托盘。
**导出**：`TrayUserInfo`、`show_main_window_focus`、`setup_tray`、`update_tray_menu`、`show_tray_panel`、`hide_tray_panel`；私有 `show_panel_at_position`、`build_tray`。
**主要依赖**：`tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton}`、`tauri::{Emitter, Manager, Runtime}`、`windows-sys`（仅 Windows 分支）、`crate::services::config_service::ConfigService`。

### 内部结构

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TRAY_ID` | tray.rs:9 | `"main-tray"`，托盘图标唯一 ID（`app.tray_by_id` 用） |
| `TRAY_PANEL_LABEL` | tray.rs:10 | `"tray-panel"`，与动态创建的托盘面板窗口 label 对应 |
| `PANEL_WIDTH` / `PANEL_HEIGHT` | tray.rs:14-15 | 288.0 × 376.0，**回退尺寸**：仅在 `outer_size()` 取不到真实窗口尺寸时用于定位；实际窗口尺寸由 `lib.rs::create_full_windows` 的 `inner_size(288.0, 376.0)` 决定，改一处需同步另一处 |
| `struct TrayUserInfo` | tray.rs:20（derive :16-19） | 托盘展示的角色数据，serde `camelCase`，13 个 `Option` 字段：`role_id`、`nickname`、`avatar`、`account_level`、`cur_stamina`、`max_stamina`、`max_ts`、`daily_activation`、`max_daily_activation`、`weekly_score`、`weekly_total`、`bp_cur_level`、`bp_max_level`；配置键 `tray_user_info`。`account_level`（:25）是**游戏账号等级**（`char_detail` 的 `base.level`），供面板右上角徽标显示；`bp_cur_level`/`bp_max_level` 是通行证等级，二者不可混用 |
| `show_main_window_focus` | tray.rs:38 | 取或动态创建 `main` 窗口 → `unminimize()` + `show()`；Windows 分支额外 `ShowWindow(SW_SHOW)` + `SetForegroundWindow` |
| `show_panel_at_position`（私有） | tray.rs:68 | 面板可见则隐藏；否则按**真实窗口物理尺寸**（`panel.outer_size()`）居中定位于托盘图标上方 8px，并用 `app.monitor_from_point` 取所在显示器工作区做 clamp，防止面板越出屏幕；随后 show + focus |
| `setup_tray` | tray.rs:111 | 完整模式读配置 `tray_user_info`，创建唯一托盘图标；**左键双击**显示主窗并关面板，**右键抬起**弹出原有面板 |
| `build_tray` | tray.rs:127 | 唯一图标构建逻辑；左键双击显示主窗并隐藏面板，右键抬起弹出面板 |
| `update_tray_menu` | tray.rs:163 | 按 `TrayUserInfo.nickname` 更新 tooltip，并向 tray-panel 窗口发送 `tray-user-info-updated` |
| `show_tray_panel` | tray.rs:180 | 命令入口的 toggle 显隐（可见→hide，否则 show+focus） |
| `hide_tray_panel` | tray.rs:193 | 强制隐藏面板（无错误时返回 Ok） |

**备注**：托盘只在完整模式创建；`--silent` 实例不显示托盘、不进入托盘交接流程。`update_tray_menu`、`show_tray_panel`、`hide_tray_panel` 被 `commands/tray.rs` 调用。`TrayUserInfo` 由前端 `src/utils/trayService.ts` 组装后写入，新增字段需同时改该服务与 `src/components/tray-panel.tsx` 复用的同名类型。

定位不再直接用 `PANEL_WIDTH`/`PANEL_HEIGHT` 与物理坐标相减：`inner_size` 是**逻辑**尺寸，在 125%/150% 缩放下按常量硬算会明显偏移，故改为读取窗口真实的物理 `outer_size()`。

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
| `dependencies.tauri-plugin-opener` / `-fs` | :22-23 | 打开 URL/路径、文件系统插件（完整模式注册） |
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
| `dependencies.windows-sys` | Cargo.toml | `0.61`，仅 `cfg(windows)` 目标依赖；features：`Win32_Foundation`、`Win32_Graphics_Gdi`、`Win32_UI_WindowsAndMessaging`、`Win32_System_Com`、`Win32_UI_Shell`、`Win32_System_Threading`（托盘取前台窗口、取色、进程检测）、`Win32_System_Power` / `Win32_System_Performance`（system_resource_service 采集实测 CPU 频率）；**免启动器启动**额外需要：`Win32_Security`（`CreateProcessW` 的 `SECURITY_ATTRIBUTES` 参数门控）、`Win32_Security_Cryptography` + `Win32_Security_Cryptography_Catalog` + `Win32_Security_Cryptography_Sip`（`WinVerifyTrust` 数据结构与两个 `WTHelper*` 函数）、`Win32_Security_WinTrust`、`Win32_System_Registry`（Reg* 与 `SHELLEXECUTEINFOW`）、`Win32_System_Environment`、`Win32_System_Console`、`Win32_System_Diagnostics_Debug`、`Win32_Storage_FileSystem`（见 utils/official_launcher.rs） |
| `dependencies.sysinfo` | Cargo.toml | 系统资源采集（CPU/内存/磁盘/网络/温度传感器），见 `services/system_resource_service.rs` |
| `dependencies.uuid` / `hex` / `rand` | :49-51 | UUID v4、十六进制、随机数 |
| `dependencies.indexmap` | :52 | 有序 map（带 `serde`） |
| `dependencies.tauri-plugin-process` | :52 | `2.3.1`，应用重启 |
| `dependencies.tauri-plugin-single-instance` | :53 | `2`，第二实例参数转发；Windows 命名互斥体按登录会话命名空间隔离 |
| `dependencies.walkdir` / `rfd` | :55-56 | 目录遍历（校验/扫描）、原生文件对话框（游戏目录与用户选定的快捷方式保存位置） |
| `target.x86_64-pc-windows-msvc.rustflags` | :57-58 | 意图是 `-fuse-ld=lld`（lld 链接器）——**该 key 在 Cargo.toml 中无效**，见文末异常 |
| `target.'cfg(not(android,ios))'.dependencies` | :61-62 | `tauri-plugin-updater = "2"`，仅桌面平台启用（完整模式注册） |
| `profile.dev.debug` | :64 | `"line-tables-only"` — **在 workspace 中被忽略**（见异常） |
| `profile.dev.incremental` | :65 | `true` — 同上 |

### 依赖分组速查
| 用途 | crate |
| --- | --- |
| 框架/IPC | `tauri`、`tauri-plugin-{opener,fs,process,updater}`、`tauri-build` |
| 网络 | `reqwest`、`futures-util`、`http`、`urlencoding` |
| 数据 | `serde`、`serde_json`、`chrono`、`indexmap`、`bytes`、`uuid`、`hex`、`rand` |
| 加密/签名 | `aes`、`cbc`、`ecb`、`des`、`rsa`、`hmac`、`sha2`、`md-5`、`digest`、`base64`、`flate2` |
| 系统/IO | `dirs`、`walkdir`、`rfd`；Windows 专用 `windows-sys` |
| 日志/错误 | `tracing`、`tracing-subscriber`、`thiserror` |

---

## `src-tauri/tauri.conf.json`
**职责**：Tauri v2 应用配置：应用标识、构建命令、安全策略、NSIS 打包与更新端点；`app.windows` 留空，由 Rust 入口按模式动态创建 WebView。
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
| `app.windows` | :13 | 空数组；主窗口与 tray-panel 仅在完整模式由 `lib.rs:create_full_windows` 创建，驻守模式不创建 WebView |
| `app.security.csp` | :15 | `null` — 关闭 CSP（未设置内容安全策略） |
| `bundle.active` | :19 | `true` — 启用打包 |
| `bundle.createUpdaterArtifacts` | :20 | `true` — 生成 updater 用的签名产物 |
| `bundle.targets` | 未配置 | 使用 Tauri 当前构建平台的默认打包目标；保留 `bundle.windows.nsis` 的 Windows 安装器配置 |
| `bundle.icon` | :21-27 | 32/128/256 png、`icon.icns`（macOS）、`icon.ico`（Windows） |
| `bundle.windows.nsis.installerIcon` / `uninstallerIcon` | :31-32 | 均为 `icons/icon.ico` |
| `bundle.windows.nsis.installMode` | :34 | `currentUser` — 无需管理员权限的按用户安装 |
| `bundle.windows.nsis.startMenuFolder` | :36 | `ENDPROTOCOL` |
| `bundle.windows.nsis.languages` | :38 | `["SimpChinese", "English"]` |
| `plugins.updater.pubkey` | :44 | minisign 公钥（`dW50cnVzdGVkIGNvbW1lbnQ6...` base64） |
| `plugins.updater.endpoints` | :45-49 | 三个更新源，按序回退：`https://updates.msk-network.cn/stable/latest.json` → `https://updates.msk-network.cn/preview/latest.json` → `https://github.com/soldiereleven/endprotocol/releases/latest/download/latest.json` |

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
5. ~~**`process:allow-exit` 未授予** — tray-panel.tsx 的回退分支 `getCurrentWindow().app.exit(0)` 非法~~ **已修复**：该回退分支已移除（`handleQuit` 失败只记日志），不再依赖不存在的 `Window.app` API。
6. **能力文件缺 schema** — `capabilities/desktop.json` 无 `$schema` 字段（`default.json` 有）。
7. **`cargo check` 通过但有 46 个 warning** — 大量未使用导入/死代码（如 `commands/tray.rs:2` 的 `Emitter`、`Manager`），另有 `error finalizing incremental compilation session directory ... (os error 5)` 的 target 目录权限问题（仅影响增量编译缓存，不阻断编译）。
8. **托盘面板尺寸双重定义（已收敛为回退值）** — 窗口尺寸唯一来源是 `lib.rs::create_full_windows` 的 `inner_size(288.0, 376.0)`；`tray.rs` 的 `PANEL_WIDTH`/`PANEL_HEIGHT` 只在 `outer_size()` 取不到真实尺寸时作为定位回退，不再是「必须与窗口尺寸逐值一致」的硬性重复。`tauri.conf.json` 的 `app.windows` 为空数组，面板窗口并不在那里定义（此前文档所述 `tauri.conf.json:28,31-32` 已过时）。
9. **托盘面板窗口不设 `shadow`** — 窗口是 `transparent(true)` + 系统 Acrylic，开启窗口阴影会在透明边缘补一块灰色底板，破坏「真透明」观感；立体层次改由前端 `.glass-native` 的圆角与色调层提供。
