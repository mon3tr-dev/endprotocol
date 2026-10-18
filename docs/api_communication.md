# API 通信与数据流规范

> 定位具体命令/实现请直接查：[ipc_index.md](reference/ipc_index.md)（106 个命令 ↔ 定义位置 ↔ 前端调用方）、
> [commands.md](reference/backend/commands.md)（每个命令的参数、返回值、内部调用链）。

## 1. 通信机制

前端与后端通过 Tauri 的 IPC (Inter-Process Communication) 进行通信。

- **前端调用**：`import { invoke } from '@tauri-apps/api/core';`
- **前端封装层**：页面/组件不直接散落 `invoke`，而是调用 `src/utils/*Service.ts` 中的封装函数（见 [utils_services_a.md](reference/frontend/utils_services_a.md)、[utils_services_b.md](reference/frontend/utils_services_b.md)）
- **后端响应**：所有 Command 必须返回 `Result<T, AppError>`（`AppError` 见 `src-tauri/src/utils/error.rs`，详见 [utils.md](reference/backend/utils.md)），确保错误能被前端正确捕获
- **状态事件**：后端向前端推送用 `app_handle.emit(...)`，前端用 `listen(...)`；卡片之间用 `window.dispatchEvent(new CustomEvent("cardAction", ...))`（见 [cards_core.md](reference/frontend/cards_core.md)）

## 2. 命名规范

- **Command 命名**：采用 `snake_case`，并以动词开头（如 `get_accounts`、`add_account`、`sync_gacha_records`）。
- **注册位置**：所有命令必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册（当前 99 个，完整清单见 [bootstrap.md](reference/backend/bootstrap.md)）。

### 2.1 模块划分（`src-tauri/src/commands/`）

| 文件 | 职责 | 详情 |
| --- | --- | --- |
| `account.rs` | 账户登录（密码/验证码/扫码）、登出、刷新、选中账户、角色数据查询 | [commands.md](reference/backend/commands.md) |
| `attendance.rs` | 查询/执行每日签到 | 同上 |
| `card_config.rs` | 卡片配置读写（`card_settings.{cardId}`） | 同上、[card_configuration.md](card_configuration.md) |
| `config.rs` | 通用键值配置 `get/set/remove/get_all` | 同上 |
| `gacha.rs` | 抽卡记录同步、统计、头像映射 | 同上 |
| `launcher.rs` | 启动器：安装/校验/下载/切服/进程管理 | 同上 |
| `updater.rs` | 应用自更新（下载、写文件、执行安装器） | 同上 |
| `image.rs` | 图片读取、缓存目录、下载、背景图管理 | 同上 |
| `tray.rs` | 托盘用户数据与托盘面板显隐 | 同上 |
| `window.rs` | 窗口最小化、最大化、关闭、托盘化 | 同上 |
| `capture.rs` / `color_picker.rs` | 网络抓包会话、屏幕取色 | 同上 |
| `logs.rs` | 读取后端日志（开发者页） | 同上 |

## 3. 数据流说明

### 3.1 账户登录流程

命令：`add_account`（手机号+密码）、`add_account_by_code`（验证码）、`add_account_by_scan`（扫码）；验证码下发用 `send_verification_code`，扫码轮询用 `gen_scan_login` + `scan_status`。

1. **前端**：`src/pages/account.tsx` 收集手机号/密码 → 调用 `src/utils/accountService.ts` 的 `addAccount` / `addAccountByCode` / `addAccountByScan`。
2. **后端**：`commands/account.rs` 转发到 `AccountService`（`services/account_service.rs`）：
   - 生成设备标识（`dId`，逻辑在 `services/skland_service.rs` 的 `fetch_new_did`，见 [services_skland.md](reference/backend/services_skland.md)）
   - 发送验证码 → 提交登录请求 → 获取 `token` 与 `cred`
   - 写入内存状态（`AccountService`）并按 `account_token_{user_id}` 持久化到配置
3. **持久化**：登录成功后由配置服务 `ConfigService` 写入本地 `app_config.json`；选中账户存在键 `selected_account_id`。

> 前端调用方、返回值与失败兜底策略见 [utils_services_a.md](reference/frontend/utils_services_a.md#srcutilsaccountservicets)。

### 3.2 角色数据懒加载流程

统一命令：**`query_role_data`**（参数 `role_id` / `api_name` / `paths`，由 `AccountService::query_role_data` 落到 `CharDetailService` 等服务）。

1. **前端**：`src/utils/roleDataService.ts`（带模块级 Promise 缓存）与 `src/utils/roleDetailService.ts`（无缓存，直接 IPC）调用 `invoke('query_role_data', ...)`。
2. **懒加载开关**：`set_lazy_load_enabled` / `is_lazy_load_enabled` / `set_current_role_id` 控制是否只拉取当前角色。
3. **后端**：`AccountService` 检查内存缓存 → 未命中则经 `SklandService::call_skland_api` 请求森空岛 → 解析为 `models/char_detail.rs` 中的结构体 → 写入内存并同步本地缓存。
4. **数据返回**：返回 `serde_json::Value`，前端更新 UI 并缓存。

> 详见 [utils_services_a.md](reference/frontend/utils_services_a.md)、[services_account.md](reference/backend/services_account.md)。

### 3.3 仪表板配置同步（多标签页）

当前实现**没有独立的 `save_dashboard_config` 命令**，仪表板数据走通用配置键：

1. **前端**：拖拽/增删卡片后调用 `src/utils/dashboardConfig.ts` 的 `addCard` / `removeCard` / `moveCard` / `updateCardLayout`。
2. **落盘**：`src/utils/tabService.ts` 的 `saveTabs` → `set_config`（配置键 `dashboard_tabs`、`dashboard_active_tab`）→ 后端 `ConfigService` 写 `app_config.json`。
3. **卡片内部设置**：单独走 `save_card_settings`（键 `card_settings.{cardId}`），见 [card_configuration.md](card_configuration.md)。

> 页面入口 `src/pages/dashboard.tsx:422` 通过 `CardContainer` 渲染，详见 [pages_core.md](reference/frontend/pages_core.md)、[cards_core.md](reference/frontend/cards_core.md)。

### 3.4 森空岛账户资料获取

账号管理页展示森空岛账户昵称、头像与游戏等级，数据来自用户资料接口。

- **接口**：`GET https://zonai.skland.com/web/v1/user`
- **查询参数 / 请求体**：无
- **请求头**：`cred`、`timestamp`、`sign`、`vName`、`dId`、`platform` 等由 `SklandService::call_skland_api`（`services/skland_service.rs:505`）统一注入
  （签名算法见 `calculate_sign`（同文件 `:422`）：`HMAC-SHA256(token, path + body + timestamp + header_json)` 后取 MD5）
- **返回体**：`data.user` 为资料主体（昵称、头像、`scoreInfoList` 游戏等级/积分），
  `data.userRts` 为社区互动数据，`data.pendant` / `data.background` 为挂件与主页背景
- **游戏图标**：`GET https://zonai.skland.com/web/v1/game` 的 `data.list[].game`
  （`gameId` / `name` / `iconUrl`）与 `scoreInfoList` 按 `gameId` 关联；
  该接口与账户无关，结果缓存在配置项 `skland_games_cache`（12 小时有效期，刷新失败时退回旧缓存）

流程：

1. **前端**：账户列表加载后，对缺少昵称/头像缓存的账户补齐资料；打开资料 Modal 时按需拉取资料与游戏列表；点击「刷新数据」时强制刷新两者。
2. **后端**：`AccountService::get_skland_user_info` 先检查并按需刷新 `cred`（`check_and_refresh_user_cred`），再通过 `SklandService::get_user_info`（`:630`）请求接口并解析为 `SklandUserInfo`；游戏列表由 `SklandService::get_game_list`（`:687`）解析为 `Vec<SklandGameInfo>`。
3. **缓存**：用户资料写入配置项 `account_token_{user_id}.user_info`，`get_skland_accounts` 会带出其中的昵称与头像，避免每次进入页面都重新请求。
4. **展示**：前端将昵称/头像渲染在森空岛账户行；资料 Modal 中头像外叠加挂件（头像框），游戏等级卡片使用游戏图标，`level` 为 0 的游戏不展示。

> 结构体定义见 [models.md](reference/backend/models.md)；相关命令 `get_skland_user_info` / `get_skland_games` 见 [ipc_index.md](reference/ipc_index.md)。

## 4. 错误处理规范

- **统一错误类型**：后端使用 `src-tauri/src/utils/error.rs` 的 `AppError`（变体清单见 [utils.md](reference/backend/utils.md)）；部分老命令仍返回 `Result<T, String>`。
- **前端反馈**：捕获错误后，通过 UI 组件（如 Toast 或 Modal）向用户展示友好的错误提示；多数 `src/utils/*Service.ts` 封装会吞掉异常并返回空值/`false`（各自的兜底策略见对应 reference 文档）。
- **日志追踪**：后端用 `tracing`/`log_*` 宏（`src-tauri/src/utils/logger.rs`），前端用 `src/utils/logger.ts`（禁止裸 `console.log`）。

## 5. 安全性要求

- **敏感数据**：严禁在日志中打印明文密码或完整的 Token。
- **输入校验**：后端必须对所有传入参数进行合法性校验。
- **权限控制**：涉及系统级操作（如文件读写）需在 `tauri.conf.json` 和 `capabilities/` 中严格限制（现状见 [bootstrap.md](reference/backend/bootstrap.md)）。

## 6. 相关 reference 文档

| 想查 | 打开 |
| --- | --- |
| 命令在哪定义、前端谁调用 | [reference/ipc_index.md](reference/ipc_index.md) |
| 命令参数/返回值/调用链 | [reference/backend/commands.md](reference/backend/commands.md) |
| 登录与角色数据的后端实现 | [reference/backend/services_account.md](reference/backend/services_account.md) |
| 森空岛 HTTP 端点与签名 | [reference/backend/services_skland.md](reference/backend/services_skland.md) |
| 前端服务封装层 | [reference/frontend/utils_services_a.md](reference/frontend/utils_services_a.md) |
