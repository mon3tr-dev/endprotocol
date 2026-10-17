# AccountService（账户与状态中枢）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。

**文件职责**：`src-tauri/src/services/account_service.rs`（3096 行 / 131402 字节）是账户与状态中枢，集中管理「Hypergryph 登录（密码/验证码/扫码）→ 森空岛 cred/token → 角色列表与角色详情」的完整链路，并承担凭据持久化、双版本账户缓存（完整版/精简版）、懒加载开关、自动签到定时任务与前端事件通知。

**状态注册方式**：`lib.rs:199` 调用 `AccountService::new(config_service, skland_service, avatar_cache_service, network_service, app.handle().clone())`；`lib.rs:206` 包装为 `Arc::new(Mutex::new(account_service))`（其中 `Mutex` 为 `tokio::sync::Mutex`，见 `lib.rs:3`），`lib.rs:207` 执行 `app.manage(managed_service)`。因此所有 command 以 `State<'_, Arc<Mutex<AccountService>>>` 注入并在 `.lock().await` 后调用；`lib.rs:215` 另把克隆传给 `AccountService::start_auto_refresh` 启动后台定时器。注意：服务内部持有的 `config_service` 是 `std::sync::Mutex<ConfigService>`（`lib.rs:151`），与外层 tokio Mutex 不同。

**主要依赖**：
- services：`ConfigService`（配置读写，`account_token_*` 等键）、`SklandService`（`check_cred` / `refresh_cred_by_hytoken` / `get_u8_token_by_hytoken` / `get_role_detail` / `get_player_binding` / `extract_endfield_roles` / `get_user_info` / `get_game_list` / `call_skland_api`）、`AvatarCacheService`（`get_or_download_avatar` 下载头像转 base64）、`NetworkService`（`char_detail_service().get_with_cache`、`set_current_role_id`、`retain_only_char_detail`、`preload_all_char_details`、`query_role_data`、`get_current_role_id`）。
- models：`account::{AccountInfo, AccountLoginResult, AccountRefreshResult, AccountSummary, SklandAccountInfo, SklandGameInfo, SklandUserInfo}`、`login::{CodeLoginRequest, LoginRequest, ScanLoginInfo, ScanStatus, SendCodeRequest}`、`role::RoleDisplayInfo`。
- utils：`http_client::create_client`、`capture::send`（HTTP 请求 + 抓包日志）、`AppError`；日志宏 `log_debug! / log_info! / log_warn! / log_error!` 与 `tracing`。
- 外部 crate：`serde_json`、`chrono`（刷新时间戳）、`tauri::{AppHandle, Emitter, async_runtime}`、`tokio`。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-21 行 | `use` 导入（models / services / utils / 日志宏 / tauri） |
| 24-26 行 | 常量 `SKLAND_GAMES_CACHE_KEY = "skland_games_cache"`、`SKLAND_GAMES_CACHE_TTL_SECS = 12*60*60` |
| 28-34 行 | 自由函数 `now_unix_secs()`（当前 Unix 秒） |
| 36-41 行 | `struct AsyncAccountService`：供 async spawn 使用的精简克隆（仅 2 个服务引用） |
| 43-284 行 | `AsyncAccountService::check_and_refresh_user_cred`：cred 校验、过期刷新、u8token 回填 |
| 286-293 行 | `enum MissingDeviceTokenPolicy`：新设备缺 device token 的两种处理策略 |
| 295-309 行 | `pub struct AccountService` 结构体与 8 个字段 |
| 311-336 行 | `new` 构造函数（读取 `lazy_load_enabled`，默认 true） |
| 338-351 行 | 3 个服务访问器：`get_config_service` / `skland_service` / `avatar_cache_service` |
| 353-481 行 | `set_lazy_load_enabled`：懒加载开关切换 + 双缓存互转 + 角色详情预载/裁剪 |
| 483-494 行 | `is_lazy_load_enabled`、`set_current_role_id` |
| 496-557 行 | 账户缓存读写：`cache_account_list` / `cache_account_summary` / `get_cached_accounts` / `clear_account_cache` |
| 559-600 行 | `gather_preload_role_infos`：遍历 `account_token_*` 收集预加载所需角色+凭据 |
| 602-617 行 | `clone_for_async` 与对外的 `check_and_refresh_user_cred`（转发） |
| 619-685 行 | `set_hytoken_for_user`、`set_u8token_for_user`（凭据字段写入） |
| 686-746 行 | `refresh_u8token_for_user`：同步前主动刷新 u8token |
| 747-781 行 | `get_local_device_token`（私有）、`set_device_token_for_user` |
| 783-817 行 | `notify_cache_refreshed`（emit `accounts-refreshed`）、`cache_accounts_by_user` |
| 819-973 行 | 自动签到三件套：`get_auto_sign_roles` / `check_attendance_today` / `do_attendance_for_role` |
| 975-1016 行 | `start_auto_refresh`：300 秒定时器（刷新账户 + 自动签到） |
| 1018-1399 行 | `get_accounts`：全量同步（约 380 行，含 cred 刷新、失败状态、自动刷新重试） |
| 1401-1455 行 | `add_account`：密码登录入口 |
| 1457-1538 行 | `logout_account`（按 roleId 解绑角色）、`batch_logout` |
| 1540-1840 行 | `refresh_accounts`：手动/定时刷新（走 `get_role_detail`，完成后 emit） |
| 1842-1890 行 | `send_verification_code`：发送短信验证码 |
| 1892-1994 行 | `get_hypergryph_token_by_code`（私有）、`add_account_by_code`：验证码登录 |
| 1996-2118 行 | `gen_scan_login`、`scan_status`：扫码二维码生成与轮询 |
| 2120-2247 行 | `token_by_scan_code`（私有）、`add_account_by_scan`：扫码登录 |
| 2249-2390 行 | `complete_login_from_token`：三种登录方式的公共后续流程 |
| 2392-2477 行 | `fetch_endfield_roles`、`read_skland_credentials`、`cache_skland_user_info` |
| 2479-2573 行 | `get_skland_user_info`、`get_skland_games`（+ 缓存读写）、`get_skland_account_roles` |
| 2575-2652 行 | `get_skland_accounts`、`save_skland_account` |
| 2654-2810 行 | `save_selected_roles`：保存勾选角色、迁移/保留凭据、构建双缓存 |
| 2812-2847 行 | `migrate_roles_app_field`：为旧 roles 补 `app: "endfield"` |
| 2849-2920 行 | `get_hypergryph_token`（密码换取 hytoken）、`is_new_device_verification_error` |
| 2922-3062 行 | `get_skland_code`（OAuth grant）、`get_skland_cred`（code 换 cred/token/userId） |
| 3064-3096 行 | `query_role_data`（统一数据查询入口） |

## 结构体与字段

`AccountService`（295-309 行）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `config_service` | `Arc<Mutex<ConfigService>>`（std Mutex） | 全局配置服务，承载 `account_token_*`、`account_list` 等所有持久化键 |
| `skland_service` | `Arc<SklandService>` | 森空岛 API 封装（cred 校验/刷新、角色详情、用户资料、游戏列表、attendance 等） |
| `avatar_cache_service` | `Arc<AvatarCacheService>` | 头像下载与本地缓存，返回 base64 |
| `network_service` | `Arc<NetworkService>` | 角色详情缓存与统一数据查询（`char_detail_service` 等） |
| `account_list_cache` | `Arc<Mutex<HashMap<String, Vec<AccountInfo>>>>` | 完整版账户缓存，key 为 user_id；仅非懒加载时写入/读取 |
| `account_summary_cache` | `Arc<Mutex<HashMap<String, Vec<AccountSummary>>>>` | 精简版账户缓存（无 cred/token），仅懒加载时使用 |
| `lazy_load_enabled` | `Arc<Mutex<bool>>` | 懒加载开关（内存态，初始值来自配置 `lazy_load_enabled`） |
| `app_handle` | `Option<AppHandle>` | Tauri AppHandle，用于 `emit("accounts-refreshed", …)` |

`AsyncAccountService`（37-41 行，私有）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `config_service` | `Arc<Mutex<ConfigService>>` | 与主服务共享的配置服务 |
| `skland_service` | `Arc<SklandService>` | cred 校验/刷新所需 |

`MissingDeviceTokenPolicy`（286-293 行，私有枚举）：`RequireUserVerification`（密码登录专用：不发验证码，仅返回 `NEW_DEVICE_VERIFICATION_REQUIRED` 由前端引导换验证码/扫码）、`ContinueWithoutDeviceToken`（验证码/扫码专用：继续登录但不记录 u8token）。

## 方法清单（必须完整）

共 57 个函数：37 个 `pub`、20 个私有（含 1 个自由函数、1 个静态关联函数、1 个 `AsyncAccountService` 方法）。私有项以「（私有）」标注。

| 方法 | 位置 | 说明（输入 → 做什么 → 输出；调用的外部 API/命令） |
| --- | --- | --- |
| `now_unix_secs()`（私有自由函数） | 29 | 无输入 → 取当前 Unix 秒（失败返回 0）→ `i64` |
| `AsyncAccountService::check_and_refresh_user_cred`（私有） | 44 | `user_id` → 读 `account_token_{user_id}` 取 cred/token/hytoken/u8token/device_token；`SklandService::check_cred` 有效则（u8token 缺失时）调 `get_u8_token_by_hytoken` 回填并返回 `Ok(None)`；失效或 `check_cred` 调用失败则调 `refresh_cred_by_hytoken` 换新 cred/token/u8token 写回配置 → `Ok(Some((cred, token)))`；缺 hytoken → `AppError::AuthError` |
| `new` | 312 | 4 个服务 + `AppHandle` → 读 `lazy_load_enabled`（默认 true）、初始化空缓存与开关 → `AccountService` |
| `get_config_service` | 338 | 无 → 返回 `&Arc<Mutex<ConfigService>>`（供 command 直接读写配置，如 `selected_account_id`） |
| `skland_service` | 343 | 无 → 返回 `&Arc<SklandService>`（commands/attendance.rs 借此调 `call_skland_api`） |
| `avatar_cache_service` | 348 | 无 → 返回 `&Arc<AvatarCacheService>`（commands/attendance.rs 用） |
| `set_lazy_load_enabled` | 353 | `enabled: bool` → 写配置 `lazy_load_enabled`；开启：完整缓存转精简后清空、`network_service.retain_only_char_detail(当前角色)`；关闭：用 `account_token_*` 的 cred/token 把精简合成完整、清空精简缓存、`gather_preload_role_infos()` + `network_service.preload_all_char_details()` 预载全部角色详情 → `Ok(())` |
| `is_lazy_load_enabled` | 483 | 无 → 读内存开关 → `bool` |
| `set_current_role_id` | 488 | `role_id: Option<String>` → 取当前懒加载状态并转发 `network_service.set_current_role_id(role_id, lazy)` → （async，无返回值） |
| `cache_account_list` | 496 | `user_id, Vec<AccountInfo>` → 写入完整版缓存 → 无 |
| `cache_account_summary` | 503 | `user_id, Vec<AccountSummary>` → 写入精简版缓存 → 无 |
| `get_cached_accounts` | 510 | `user_id` → 懒加载时读精简缓存并转成 `cred/token = None` 的完整结构；否则读完整缓存 → `Option<Vec<AccountInfo>>`（commands/account.rs:40 命中则免 API） |
| `clear_account_cache` | 551 | `user_id` → 同时移除完整版与精简版缓存 → 无 |
| `gather_preload_role_infos`（私有） | 560 | 无 → 遍历所有 `account_token_*` 的 `roles[]`，配对 cred/token → `Vec<PreloadRoleInfo>`（network_service 用） |
| `clone_for_async`（私有） | 602 | 无 → 构造 `AsyncAccountService`（克隆 2 个 Arc）→ 供 spawn 使用 |
| `check_and_refresh_user_cred` | 610 | `user_id` → `clone_for_async()` 后转发同名私有方法 → `Result<Option<(String, String)>, AppError>`；被 command `check_and_refresh_cred`、attendance/gacha command 调用 |
| `set_hytoken_for_user` | 619 | `user_id, hytoken` → 在 `account_token_{user_id}` 对象写入 `hytoken` 字段（非对象则 `ConfigError`）→ `Ok(())` |
| `set_u8token_for_user` | 652 | `user_id, u8token` → 写入 `u8token` 字段 → `Ok(())` |
| `refresh_u8token_for_user` | 686 | `user_id` → 读 hytoken+device_token（缺失跳过）→ `SklandService::get_u8_token_by_hytoken` → 成功则 `set_u8token_for_user` 并 `Ok(Some(u8))`；失败/缺字段 → `Ok(None)`（非致命，保留旧值）；被 commands/gacha.rs:70 在同步抽卡前调用 |
| `get_local_device_token`（私有） | 747 | `user_id` → 读 `account_token_{user_id}.device_token`（空串视为无）→ `Option<String>` |
| `set_device_token_for_user` | 759 | `user_id, device_token` → 写入 `device_token` 字段 → `Ok(())` |
| `notify_cache_refreshed`（私有） | 789 | `&AccountRefreshResult` → 有 `app_handle` 时 `emit("accounts-refreshed", result)` → 无 |
| `cache_accounts_by_user`（私有） | 796 | `&[AccountInfo]` → 按 `user_id` 分组，按懒加载状态分别写精简/完整缓存 → 无 |
| `get_auto_sign_roles` | 819 | 无 → 读配置 `card_auto_sign_users` → `Vec<String>`（role_id 列表） |
| `check_attendance_today` | 827 | `role_id` → 遍历 `account_token_*` 找该角色的 serverId/cred/token → `SklandService::call_skland_api("GET", "/web/v1/game/endfield/attendance")`（头 `sk-game-role: 3_{role}_{server}`、`token`）→ 解析 `data.hasToday` → `bool` |
| `do_attendance_for_role` | 896 | `role_id` → 同上定位凭据（额外取 user_id）→ `check_and_refresh_user_cred` 刷新 → `call_skland_api("POST", "/web/v1/game/endfield/attendance")` → `Ok(())` |
| `start_auto_refresh`（静态） | 975 | `Arc<tokio::sync::Mutex<AccountService>>` → `async_runtime::spawn` 每 300 秒：`refresh_accounts()` → 对 `card_auto_sign_users` 中未签到角色执行 `do_attendance_for_role` → 无；由 `lib.rs:215` 启动 |
| `get_accounts` | 1018 | 无 → 遍历 `account_token_*` 收集 roles → 逐角色 `check_and_refresh_user_cred` → `network_service.char_detail_service().get_with_cache(...)` → 成功取昵称/等级并 `avatar_cache_service.get_or_download_avatar` → 失败按错误串判定 `HYTOKEN_EXPIRED`/`FAILED`，并可用 hytoken `refresh_cred_by_hytoken` 后重试一次 → 按懒加载写缓存 → `Vec<AccountInfo>` |
| `add_account` | 1401 | `LoginRequest` → `get_hypergryph_token`(密码) →（新设备错误经 `is_new_device_verification_error` 判定）返回 `error_message = "NEW_DEVICE_VERIFICATION_REQUIRED"` → 否则 `complete_login_from_token(RequireUserVerification)` → `AccountLoginResult`；command `add_account` |
| `logout_account` | 1457 | `account_id`（实为 roleId）+ `keep_device_token` → 从各 `account_token_*` 的 `roles[]` 移除该角色；roles 清空且 `keep_device_token=false` 时删除 `device_token`；清对应用户缓存；从 `account_list` 移除 → 恒 `true`；command `logout_account` |
| `batch_logout` | 1523 | `account_ids` → 从 `account_list` 移除，并 `config.remove("account_token_{id}")` → 恒 `true`；command `batch_logout` |
| `refresh_accounts` | 1540 | 无 → 同 `get_accounts` 的收集/刷新逻辑，但角色详情走 `skland_service.get_role_detail`（绕过 char_detail 缓存），含 hytoken 自动刷新重试；完成后 `cache_accounts_by_user` + `notify_cache_refreshed`（emit）→ `AccountRefreshResult`；command `refresh_accounts` 与定时器 |
| `send_verification_code` | 1842 | `SendCodeRequest` → `POST https://as.hypergryph.com/general/v1/send_phone_code`（body: phone/type）→ `status==0` → `Ok(true)`；command `send_verification_code` |
| `get_hypergryph_token_by_code`（私有） | 1892 | `phone, code` → `POST https://as.hypergryph.com/user/auth/v2/token_by_phone_code` → `(token, deviceToken)` |
| `add_account_by_code` | 1961 | `CodeLoginRequest` → 上一步换 hytoken（deviceToken 空则置 None）→ `complete_login_from_token(ContinueWithoutDeviceToken)` → `AccountLoginResult`；command `add_account_by_code` |
| `gen_scan_login` | 1996 | 无 → `POST https://as.hypergryph.com/general/v1/gen_scan/login`（appCode `dd7b852d5f1dd9da`）→ `ScanLoginInfo { scan_id, scan_url }`；command `gen_scan_login` |
| `scan_status` | 2063 | `scan_id` → `GET https://as.hypergryph.com/general/v1/scan_status?scanId=...` → `ScanStatus { status, scan_code, msg }`；command `scan_status` |
| `token_by_scan_code`（私有） | 2120 | `scan_code` → `POST https://as.hypergryph.com/user/auth/v1/token_by_scan_code`（带 `X-AppCode/X-DeviceId/X-DeviceId2/X-DeviceModel/X-DeviceType/X-OSVer` 头）→ `(token, deviceToken, Option<hgld>)` |
| `add_account_by_scan` | 2205 | `scan_code` → 上一步换 hytoken（deviceToken 空转 None）→ `complete_login_from_token(ContinueWithoutDeviceToken)` → `AccountLoginResult`；command `add_account_by_scan` |
| `complete_login_from_token`（私有） | 2249 | `hy_token, device_token, missing_policy` → Step2 `get_skland_code`、Step3 `get_skland_cred` → 无 deviceToken 时用 userId 走 `get_local_device_token` 本地匹配 → 仍无则按策略返回 `NEW_DEVICE_VERIFICATION_REQUIRED` 或继续 → `set_hytoken_for_user` / `set_device_token_for_user` / `get_u8_token_by_hytoken`+`set_u8token_for_user` → `AccountLoginResult { success: true, cred, token, user_id }`（不返回角色，等用户确认绑定） |
| `fetch_endfield_roles`（私有） | 2392 | `cred, token, user_id` → `get_player_binding` + `SklandService::extract_endfield_roles` → 逐角色 `get_role_detail` + 头像缓存 → `Vec<RoleDisplayInfo>`（单角色失败仅记日志跳过） |
| `read_skland_credentials`（私有） | 2434 | `user_id` → 读 `account_token_{user_id}` 的 cred/token → `(String, String)`；缺失抛 `AuthError`（"Skland account/cred/token was not found"） |
| `cache_skland_user_info`（私有） | 2459 | `user_id, &SklandUserInfo` → 序列化写入 `account_token_{user_id}.user_info` → `Ok(())` |
| `get_skland_user_info` | 2479 | `user_id` → `check_and_refresh_user_cred` → `read_skland_credentials` → `SklandService::get_user_info` → 缓存 `user_info`（失败仅告警）→ `SklandUserInfo`；command `get_skland_user_info` |
| `get_skland_games` | 2508 | `user_id, force` → 先读 `skland_games_cache`（12 小时 TTL，非 force 且未过期直接返回）→ 否则刷新 cred + `SklandService::get_game_list` 写缓存；失败回退旧缓存 → `Vec<SklandGameInfo>`；command `get_skland_games` |
| `read_skland_games_cache`（私有） | 2550 | 无 → 读 `skland_games_cache` 的 `fetched_at`/`games` → `Option<(i64, Vec<SklandGameInfo>)>`（空列表视为无缓存） |
| `cache_skland_games`（私有） | 2563 | `&[SklandGameInfo]` → 写 `skland_games_cache = { fetched_at, games }` → `Ok(())` |
| `get_skland_account_roles` | 2575 | `user_id` → 刷新 cred → `read_skland_credentials` → `fetch_endfield_roles` → `AccountLoginResult { available_roles: Some(..) }`；command `get_skland_account_roles` |
| `get_skland_accounts` | 2595 | 无 → 扫描 `account_token_*`，`skland_account_bound`（缺省时以 roles 非空判定）为真才收录，附带 `user_info` 的昵称/头像 → `Vec<SklandAccountInfo>`；command `get_skland_accounts` |
| `save_skland_account` | 2628 | `cred, token, user_id` → 写 `cred`/`token`/`skland_account_bound=true`，并保证 `roles` 存在（默认 `[]`）→ `Ok(())`；command `save_skland_account` |
| `save_selected_roles` | 2654 | `cred, token, user_id, selected_roles` → 先 `migrate_roles_app_field`；读旧数据保留 `hytoken/u8token/device_token`；写入 `roles[{userId,serverId,roleId,app:"endfield"}]`、`skland_account_bound=true`；更新 `account_list`（移除旧 roleId、追加新 roleId）；锁释放后逐角色下载头像 → 写完整+精简双缓存 → `Vec<AccountInfo>`；command `save_selected_roles` |
| `migrate_roles_app_field`（私有静态） | 2812 | `&mut ConfigService` → 遍历 `account_token_*`，为缺少 `app` 的 role 补 `"endfield"` 并写回 → `Ok(())` |
| `get_hypergryph_token`（私有） | 2849 | `phone, password` → `POST https://as.hypergryph.com/user/auth/v1/token_by_phone_password` → `(token, Option<deviceToken>, Option<hgld>)` |
| `is_new_device_verification_error`（私有静态） | 2922 | `&AppError` → 关键词匹配（"新设备"/"需要验证"/"设备验证"/"verify"/"verification"）→ `bool` |
| `get_skland_code`（私有） | 2932 | `hy_token` → `POST https://as.hypergryph.com/user/oauth2/v2/grant`（appCode `4ca99fa6b56cc2ba`, type 0）→ `data.code` → `String` |
| `get_skland_cred`（私有） | 2989 | `sk_code` → `POST https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code`（kind 1）→ `(cred, token, user_id)` |
| `query_role_data` | 3064 | `role_id, api_name, paths` → `get_accounts()` 找到该角色（需 cred/token/user_id/server_id 齐全）→ `network_service.query_role_data(...)` → `HashMap<String, Value>`（key 为请求路径）；command `query_role_data`，另被 commands/gacha.rs:479 以 `"wiki_catalog"` 调用 |

## 关键业务流程

### 登录：密码（1401-1455、2849-2920 行）
`add_account(LoginRequest)` → `get_hypergryph_token`（`POST /user/auth/v1/token_by_phone_password`）得 `(hytoken, deviceToken?, hgld?)`；若 API 报错且 `is_new_device_verification_error` 命中，直接返回 `NEW_DEVICE_VERIFICATION_REQUIRED`。随后进入 `complete_login_from_token(RequireUserVerification)`。注意：`hgld` 目前仅在日志中使用，本地 device token 匹配实际以 Step 3 返回的 `user_id` 为键。

### 登录：验证码（1842-1994 行）
`send_verification_code`（`POST /general/v1/send_phone_code`）→ `add_account_by_code(CodeLoginRequest)` → `get_hypergryph_token_by_code`（`POST /user/auth/v2/token_by_phone_code`）→ `complete_login_from_token(ContinueWithoutDeviceToken)`。

### 登录：扫码（1996-2247 行）
`gen_scan_login`（`POST /general/v1/gen_scan/login`）产出二维码 `scanUrl` → 前端轮询 `scan_status`（`GET /general/v1/scan_status`）取 `scanCode` → `add_account_by_scan(scan_code)` → `token_by_scan_code`（`POST /user/auth/v1/token_by_scan_code`，附固定 X-Device* 头）→ `complete_login_from_token(ContinueWithoutDeviceToken)`。

### 登录公共流程与新设备策略（286-293、2249-2390 行）
Step 2 `get_skland_code`（`POST /user/oauth2/v2/grant`）→ Step 3 `get_skland_cred`（`POST zonai.skland.com/.../generate_cred_by_code`）得 `(cred, token, user_id)` → Step 3.5 服务器未下发 deviceToken 时用 `get_local_device_token(user_id)` 本地匹配 → 仍缺失时按 `MissingDeviceTokenPolicy` 分流（密码登录：返回 `NEW_DEVICE_VERIFICATION_REQUIRED`；验证码/扫码：继续但不取 u8token）→ 依次落盘 `hytoken`、`device_token`、`u8token`（`get_u8_token_by_hytoken`，失败不阻断）→ 返回父级凭据，角色绑定推迟到 `save_selected_roles`。

### token 与 cred 刷新（43-284、610-781 行）
- 主入口 `check_and_refresh_user_cred`（610）转发到 `AsyncAccountService`（44）：`check_cred` 有效 → 顺带回填缺失的 u8token；失效或 `check_cred` 报错 → `refresh_cred_by_hytoken(hyt token, device_token)` 换新 cred/token/u8token 并写回 `account_token_{user_id}`；无 hytoken → `AuthError`（提示 re-login）。
- `get_accounts` / `refresh_accounts` 内部：每次取角色详情前刷新；错误串含 `hytoken/OAuth/grant failed` → 标记 `HYTOKEN_EXPIRED`；错误串含 `API error/Failed to parse JSON/HTTP request failed` → 视为同步失败，再用 hytoken 自动刷新并重试一次详情接口。
- `refresh_u8token_for_user`（686）供抽卡同步前主动续期 u8token；`set_hytoken_for_user` / `set_u8token_for_user` / `set_device_token_for_user`（619/652/759）为登录成功后的字段写入器。

### 角色数据查询与缓存（496-600、1018-1399、1540-1840、3064-3096 行）
- `get_accounts`（1018）：走 `network_service.char_detail_service().get_with_cache`（带角色详情缓存），结果按 `user_id` 分组后按懒加载状态写入完整/精简缓存。
- `refresh_accounts`（1540）：走 `skland_service.get_role_detail`（实时接口，不经 char_detail 缓存），完成后 `cache_accounts_by_user` + emit。
- `query_role_data`（3064）：统一数据查询入口，依赖 `get_accounts()` 提供凭据，再委托 `NetworkService::query_role_data` 按 `paths` 取叶节点。
- 缓存四件套（496/503/510/551）+ `gather_preload_role_infos`（560）支撑懒加载与预载。

### 森空岛用户资料与游戏列表（2434-2573 行）
`get_skland_user_info` → 刷新 cred → `read_skland_credentials` → `SklandService::get_user_info` → 写 `account_token_{user_id}.user_info`（供 `get_skland_accounts` 列表展示昵称/头像）。`get_skland_games` → `skland_games_cache`（12 小时 TTL，`force` 可绕过；刷新失败回退旧缓存）。`get_skland_account_roles` → `fetch_endfield_roles`（binding → 逐角色 detail → 头像）。

### 账户持久化（1457-1538、2628-2810、2812-2847 行）
- 绑定：`save_skland_account` 写 `cred/token/skland_account_bound/roles`；`save_selected_roles` 写 `roles[]`（含 `app:"endfield"`）、保留 hytoken/u8token/device_token、同步 `account_list` 并写双缓存。
- 解绑：`logout_account` 按 roleId 从 `roles[]` 移除（可选删除 `device_token`）并清缓存；`batch_logout` 清 `account_list` 与 `account_token_{id}`。
- 迁移：`migrate_roles_app_field` 给旧角色补 `app` 字段（在 `save_selected_roles` 开头执行）。

### 懒加载（353-494 行）
`set_lazy_load_enabled` 在两种模式间转换缓存：开启 → 精简缓存补全 + 清空完整缓存 + `retain_only_char_detail(当前角色)`；关闭 → 用 `account_token_*` 的 cred/token 合成完整缓存 + `preload_all_char_details` 预载全部角色。`set_current_role_id` 把激活角色同步给 NetworkService（影响详情缓存裁剪）。

### 事件 emit 与定时任务（789-817、975-1016、约 1836 行）
本文件唯一的 emit：`notify_cache_refreshed` 发送事件 **`accounts-refreshed`**，payload 为 `AccountRefreshResult { success, error_message, accounts, refresh_time }`，仅在 `refresh_accounts` 末尾触发（约 1836）。文件内无任何 `listen`。`start_auto_refresh` 以 300 秒周期执行刷新 + 自动签到。

## 备注

**配置键（本文件读写）**
- `account_token_{user_id}`：核心凭据对象，字段含 `cred`、`token`、`hytoken`、`u8token`、`device_token`、`roles[{userId,serverId,roleId,app}]`、`skland_account_bound`、`user_info`（SklandUserInfo 序列化）。
- `skland_games_cache`：森空岛游戏列表缓存（常量 `SKLAND_GAMES_CACHE_KEY`，TTL 12 小时，结构 `{fetched_at, games}`）。
- `lazy_load_enabled`：懒加载开关（bool，默认 true）。
- `card_auto_sign_users`：开启自动签到的 role_id 列表（只读）。
- `account_list`：角色 ID 列表（登出/绑定时增删）。
- `selected_account_id`：当前选中账户，由 `commands/account.rs:260/274` 通过 `get_config_service()` 读写，**本文件不涉及**（仓库中不存在 `selected_account` 键）。

**HTTP 端点（本文件直接请求，均经 `http_client::create_client` + `capture::send`）**
- `POST https://as.hypergryph.com/general/v1/send_phone_code`（1857）
- `POST https://as.hypergryph.com/user/auth/v2/token_by_phone_code`（1911）
- `POST https://as.hypergryph.com/general/v1/gen_scan/login`（2011）
- `GET  https://as.hypergryph.com/general/v1/scan_status`（2074）
- `POST https://as.hypergryph.com/user/auth/v1/token_by_scan_code`（2139）
- `POST https://as.hypergryph.com/user/auth/v1/token_by_phone_password`（2868）
- `POST https://as.hypergryph.com/user/oauth2/v2/grant`（2948）
- `POST https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code`（3004）
- 经 `SklandService::call_skland_api`：`GET`/`POST /web/v1/game/endfield/attendance`（约 879、约 950，基址 `https://zonai.skland.com`）。
- 其余森空岛读接口（user/game/binding/role detail/check_cred/refresh/u8token）全部委托 `SklandService`。

**emit / listen 事件**
- emit：`accounts-refreshed`（789，payload `AccountRefreshResult`）。
- listen：无。

**调用方（command / 内部）**
- `commands/account.rs`：`get_accounts`、`get_skland_accounts`、`save_skland_account`、`get_skland_account_roles`、`get_skland_user_info`、`get_skland_games`、`add_account`、`logout_account`、`batch_logout`、`refresh_accounts`、`send_verification_code`、`add_account_by_code`、`gen_scan_login`、`scan_status`、`add_account_by_scan`、`save_selected_roles`、`get_selected_account`/`set_selected_account`（仅经 `get_config_service`）、`check_and_refresh_cred`、`set_lazy_load_enabled`、`is_lazy_load_enabled`、`set_current_role_id`、`query_role_data`。
- `commands/attendance.rs`：`get_attendance`/`do_attendance` 使用 `get_config_service`、`check_and_refresh_user_cred`、`skland_service`、`avatar_cache_service`。
- `commands/gacha.rs`：`check_and_refresh_user_cred`、`refresh_u8token_for_user`、`query_role_data`（`wiki_catalog`）、`get_config_service`。
- `commands/card_config.rs`：仅 `get_config_service`。
- 内部定时器 `start_auto_refresh`：`refresh_accounts`、`get_auto_sign_roles`、`check_attendance_today`、`do_attendance_for_role`（这三者未暴露为 command）。

**发现的异常/注意点**
1. 任务提示中的 `selected_account` 在仓库中实际为 `selected_account_id`，且只出现在 `commands/account.rs`。
2. `batch_logout`（1523）把入参当作 user_id 拼 `account_token_{id}` 删除，而 `logout_account`（1457）把同名入参当作 roleId 处理，两者语义不一致，`batch_logout` 多半删不掉真实凭据键。
3. `set_lazy_load_enabled` 内两个分支的锁顺序相反（约 371-392 先完整后精简；约 414-423 先精简后完整），并发调用存在理论上的锁顺序风险。
4. `save_selected_roles` 中 `data.as_object_mut().expect("object checked above")`（约 2642）为可 panic 点；`get_accounts` 等处 `&role_id[..8.min(role_id.len())]` 按字节截断，非 ASCII roleId 会 panic。
5. `get_network_service`（原 3071）与访问器 `network_service`（原 355）为死代码，已删除；`AsyncAccountService` 的 `avatar_cache_service` 字段（原 78）亦未使用，已删除。
