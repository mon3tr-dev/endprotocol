# 后端开发规范与拓展指南

> 定位现有实现请查 [README.md](README.md) 快速定位表，或 [reference/backend/](reference/backend/)（9 篇逐文件参考，含行号）。

## 1. 目录结构与文件定位

| 目录/文件 | 内容 | 对应 reference 文档 |
| --- | --- | --- |
| `src-tauri/src/commands/` | 13 个文件、**106 处 `#[tauri::command]` 注解**，处理前端 Invoke 请求 | [commands.md](reference/backend/commands.md) |
| `src-tauri/src/services/` | 11 个服务：`account_service`（状态中枢）、`skland_service`（API 客户端）、`game_launcher_service`、`gacha_service`、`char_detail_service`、`char_wiki_detail_service`、`config_service`、`avatar_cache_service`、`data_query`、`network_service` | [services_account.md](reference/backend/services_account.md)、[services_skland.md](reference/backend/services_skland.md)、[services_launcher.md](reference/backend/services_launcher.md)、[services_others.md](reference/backend/services_others.md) |
| `src-tauri/src/models/` | 7 个文件、79 个结构体/枚举（序列化与状态存储） | [models.md](reference/backend/models.md) |
| `src-tauri/src/utils/` | `error`、`encrypt`、`hg_crypto`、`http_client`、`logger`、`official_launcher`（免启动器启动/提权 helper）、`paths`、`capture` | [utils.md](reference/backend/utils.md) |
| `src-tauri/src/{main,lib,tray}.rs` | 进程入口、插件/状态/命令注册、托盘 | [bootstrap.md](reference/backend/bootstrap.md) |
| `src-tauri/{Cargo.toml,tauri.conf.json,capabilities/}` | 依赖、窗口与打包配置、权限 | [bootstrap.md](reference/backend/bootstrap.md) |

## 2. 开发规范

- **错误处理**: 统一使用 `src-tauri/src/utils/error.rs` 的 `AppError`，Command 返回 `Result<T, AppError>`（部分历史命令仍返回 `Result<T, String>`，新增时用 `AppError`）。变体与 `From` 转换见 [utils.md](reference/backend/utils.md)。
- **异步编程**: 涉及 I/O 或网络请求的函数必须 `async`，运行在 tokio（Tauri 默认运行时）。
- **状态管理**:
  - 全局状态通过 Tauri `State` 注册（`lib.rs` 的 `.manage(...)`）：`Arc<Mutex<AccountService>>`、`Arc<Mutex<ConfigService>>`、`Arc<GachaService>` 等。
  - **注意**：`NetworkService`、`AvatarCacheService`、`CharWikiDetailService` 未单独 `manage`，需通过 `AccountService` 持有字段访问（详见 [services_others.md](reference/backend/services_others.md)）。
  - 敏感信息（Token/Cred）严禁硬编码，必须通过 `ConfigService` 或 `AccountService` 内存态存取。
- **日志记录**: 使用 `tracing` 宏（`info!`/`error!`/`debug!`）或 `utils/logger.rs` 封装的 `log_*` 宏；禁止 `eprintln!` 调试残留。
- **配置读写**: 一律走 `ConfigService`（`src-tauri/src/services/config_service.rs`），键名用点号路径（如 `card_settings.{cardId}`、`account_token_{userId}.user_info`）。

## 3. 拓展位置与方法

### 3.1 新增 Tauri Command

1. 在 `src-tauri/src/commands/` 对应模块新建或扩展文件（无对应模块时新建 `my_feature.rs` 并在 `commands/mod.rs` 声明）
2. 编写 `#[tauri::command]` 标注的异步函数，参数用 `State<'_, ...>` + 显式业务参数（camelCase 自动映射）
3. 在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册（清单见 [bootstrap.md](reference/backend/bootstrap.md)）
4. 涉及敏感操作时在 `src-tauri/capabilities/default.json` / `desktop.json` 声明权限
5. 前端在 `src/utils/` 封装调用，并更新 [ipc_index.md](reference/ipc_index.md)

### 3.2 新增业务服务

1. 在 `src-tauri/src/services/` 新建 `my_service.rs`，并在 `services/mod.rs` 声明
2. 定义结构体与方法；需要跨命令共享时在 `lib.rs` 加 `.manage(...)`
3. Command 内通过 `State<'_, Arc<...>>` 取用；若服务需访问账户凭证，可挂在 `AccountService` 上
4. 记录该服务的 HTTP 端点、配置键、emit 事件到对应 reference 文档

### 3.3 新增数据模型

1. 在 `src-tauri/src/models/` 新建/扩展文件，`#[derive(Serialize, Deserialize, Clone, Debug)]`
2. 字段名需与森空岛 API 的 JSON 键一致，否则用 `#[serde(rename = "...")]` / `alias`
3. 注意各文件约定不一致（`game.rs` 多为 snake_case，其余多为 camelCase），以实际响应为准（见 [models.md](reference/backend/models.md)）

### 3.4 新增前端可读的本地数据/文件

- 路径统一用 `src-tauri/src/utils/paths.rs`（含平台差异），不要散拼路径
- 图片缓存命名需与 `commands/image.rs` 的 `extract_filename_from_url` 规则一致，避免缓存 miss

## 4. 拓展流程示例：添加一个新的 API 查询功能

1. **分析 API**: 确定森空岛 URL、方法、签名与参数（现有端点总表见 [services_skland.md](reference/backend/services_skland.md)）
2. **更新模型**: 在 `models/` 定义返回结构体
3. **实现服务**: 在 `services/skland_service.rs` 新增方法，复用 `call_skland_api`（自动注入 `cred`/`sign`/`timestamp` 等请求头）；自定义请求用 `utils/http_client.rs`
4. **暴露命令**: 在 `commands/` 创建 Command，调用服务层并返回 `Result<T, AppError>`
5. **前端联调**: 在 `src/utils/` 对应服务封装调用，更新 [ipc_index.md](reference/ipc_index.md)

## 5. 核心加密与签名说明

| 用途 | 位置 | 说明 |
| --- | --- | --- |
| 森空岛 API 签名 | `services/skland_service.rs:422` `calculate_sign` | `HMAC-SHA256(token, path + body + timestamp + header_json)` 后取 MD5；由 `call_skland_api`（`:505`）统一注入请求头 |
| 设备标识 `dId` | `services/skland_service.rs:98` `fetch_new_did` | 向数美接口获取设备指纹（`:76` 的 `fetch_new_did_with_retry` 目前无调用方） |
| AES/RSA/DES 等 | `utils/hg_crypto.rs`、`utils/encrypt.rs`、`services/skland_service.rs` 内联 | **注意**：`utils/encrypt.rs` 的三个 pub 函数当前无调用方，实际逻辑被内联到 `skland_service.rs`（详见 [utils.md](reference/backend/utils.md)、[services_skland.md](reference/backend/services_skland.md)） |
| 自更新签名校验 | minisign（见 README「更新系统」） | 前端 `src/utils/updateService.ts` |

## 6. 改代码后的文档同步

新增/重命名命令、服务、模型，或改动行号较多时，同步更新对应 `reference/backend/*.md` 与 [ipc_index.md](reference/ipc_index.md)（格式见 [README.md](README.md#5-文档维护约定)）。
