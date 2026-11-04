# 机密存储（Secure Storage）

> 应用配置中**可用的账户凭据**的存放方式、机密字段登记表、以及新增机密字段的流程。

## 1. 要解决的问题

应用配置（`app_config.json`）里混着两类东西：普通偏好设置与**可用的账户凭据**。
凭据一旦明文落盘，任何能读取用户目录的进程、备份软件、同步盘都能拿到。

需求是：**应用能随时访问机密数据，但别人不行（或者不能轻易访问）**。

这不是「把文件加密一下」能解决的 —— 加密文件的密钥只要也在磁盘上、或者用户能交互，
就等于没加密。真正的做法是**把数据放进操作系统用用户凭据保护的存储里**。

## 2. 架构

```
┌──────────────────────────────────────────────────────┐
│ app_config.json（明文，只剩 B/C 类配置）              │
│   card_settings.* / theme_* / dashboard_* / ...        │
│   account_token_xxx → { roles, user_info }（B 类）     │
│   schema_version: 2                                   │
└──────────────────────────────────────────────────────┘
                    ↕  ConfigService 对外 API 不变
┌──────────────────────────────────────────────────────┐
│ SecretStore                                           │
│   一个机密字段 = 一条凭据条目                          │
│   Windows: Credential Manager (CRED_TYPE_GENERIC)     │
│   macOS:   Keychain (generic password)                │
│   Linux:   Secret Service                             │
│   service = cn.msk-network.endprotocol                │
│   user    = {键}::{子字段}，如 account_token_1::cred │
└──────────────────────────────────────────────────────┘
```

### 各平台保护边界

| 平台 | 存储 | 保护边界 |
|---|---|---|
| Windows | Credential Manager | DPAPI 用户密钥：**同一用户凭据 + 同一台机器**才能解密 |
| macOS | Keychain | Keychain ACL，需用户授权 |
| Linux | Secret Service | D-Bus 会话密钥环 |

> Windows 侧依据：Microsoft Learn `CryptProtectData` 文档明确写着
> "Typically, only a user with the same logon credential as the user who encrypted the data
> can decrypt the data. In addition, the encryption and decryption usually must be done on
> the same computer."

### 降级链

| 优先级 | 后端 | 适用场景 |
|---|---|---|
| 1 | `credential-store` | Windows / macOS 必然可用；Linux 桌面环境可用 |
| 2 | `encrypted-file` | Linux 无 Secret Service daemon（AppImage 常见）：AES-256-GCM 加密到 `secrets.enc`，密钥在 `secrets.key`（权限 0600） |
| 3 | `plaintext` | 最后兜底，会记 warning 日志；机密字段**仍不进** `app_config.json` |

当前后端可通过命令 `get_secret_storage_status` 查询，前端封装 `getSecretStorageStatus()`。

> ⚠️ `encrypted-file` **弱于** OS 凭据库：文件与密钥同处一个用户目录，
> 能读取该目录的进程同样能解密。它只是 Linux 无凭据库时的退路。

## 3. 机密字段登记表

**这张表是唯一的机密判定来源。** 代码里不出现散落的 `if key == "account_token_..."` 判断。

判定实现在 `src-tauri/src/services/secret_registry.rs` 的 `SECRET_FIELDS` 常量。

### 3.1 A 类 · 机密（存 OS 凭据库，不落盘）

| 配置键 | 子字段 | 写入位置 | 为什么是机密 |
|---|---|---|---|
| `account_token_{userId}` | `cred` | `account_service.rs:2739`、`:2830` | 森空岛鉴权凭据，等价于密码 |
| `account_token_{userId}` | `token` | `account_service.rs:2740`、`:2831` | 森空岛访问令牌 |
| `account_token_{userId}` | `hytoken` | `account_service.rs:646`（`set_hytoken_for_user`） | 鹰角会话令牌，用于刷新 cred |
| `account_token_{userId}` | `u8token` | `account_service.rs:700`（`set_u8token_for_user`） | 抽卡 API 令牌（实测 584 字节），可直接读出游戏抽卡记录 |
| `account_token_{userId}` | `device_token` | `account_service.rs:804`（`set_device_token_for_user`） | 设备绑定令牌 |
| `account_token_{userId}` | `phone` | `account_service.rs:660`（`set_phone_for_user`） | 用户手机号，PII |
| `proxy_config` | `username` | `commands/config.rs` → `set_proxy_config` | 代理服务器账号 |
| `proxy_config` | `password` | 同上 | 代理服务器口令 |
| `proxy_config` | `host` | 同上 | 网络拓扑信息（弱机密） |
| `proxy_config` | `port` | 同上 | 网络拓扑信息（弱机密） |

### 3.2 B 类 · 隐私（保持明文，用户已确认）

| 配置键 | 子字段 | 说明 |
|---|---|---|
| `account_token_{userId}` | `user_info` | 森空岛用户资料（2048 字节 JSON），含 hg_id、IP 属地、生日、性别 |
| `account_token_{userId}` | `roles` | 角色绑定关系（userId / serverId / roleId） |
| `did_cache` | 整值 | 数美设备指纹 |
| `account_list` | 整值 | 账户 ID 列表 |

### 3.3 C 类 · 非机密（保持明文）

`card_settings.*`、`dashboard_tabs`、`dashboard_active_tab`、`theme_mode`、`theme_color`、
`theme_custom_colors`、`bg_image_path`、`bg_image_opacity`、`bg_blur`、`bg_opacity`、
`close_action`、`refresh_on_account_switch`、`wiki_detail_preload`、`developer_mode`、
`app.language`、`last_route`、`sidebar_collapsed`、`sidebar_rail_collapsed`、
`sidebar_nav_order`、`lazy_load_enabled`、`main_exe_path`、`launcher_install_path`、
`launcher_channel`、`launcher_dx11`、`steam_shortcut_name`、`steam_shortcut_icon`、
`steam_create_admin_shortcut`、`steam_elevate_start_menu`、`card_auto_sign_users`、
`card_user_mapping`、`todo_lists`、`system_resource_defaults`、
`system_resource_defaults_version`、`card_startup_tasks`、`tray_user_info`、
`tray_user_role_id`、`skland_games_cache`、`update_channel`、`update_source`、
`cache_mode`、`cache_max_entries`、`cache_max_size_mb`、`capture_autostart`、
`game_playtime_total_seconds`、`log_level`

## 4. 新增机密字段的流程

**白名单策略**：未登记的字段一律视为非机密，保持明文。这是为了避免误伤
（误伤会让卡片配置变成不可读的密文，反而制造排查困难）。代价是**必须主动登记**。

1. 在 `src-tauri/src/services/secret_registry.rs` 的 `SECRET_FIELDS` 中登记该字段
   （键名 + 子字段名；键名支持 `*` 结尾的前缀通配）；
2. 在本文档 §3.1 的表格里补一行（写清写入位置与判定理由）；
3. 在 `secret_registry.rs` 的 `mod tests` 里补一条单元测试；
4. 若该字段有子字段混合（同一键下既有 A 类又有 B 类），确认
   `strip_secret_fields` 的按字段剥离行为符合预期。

## 5. 实现要点

### 5.1 一个字段一条凭据（不能整对象塞一条）

Windows 凭据 blob 上限是 **2560 字节**（`CRED_MAX_CREDENTIAL_BLOB_SIZE`），
而 `u8token` 单字段就有 584 字节、`user_info` 有 2048 字节。
所以必须按字段拆分，让单个字段损坏不影响其它字段。

写入用 `set_secret`（原始字节）而非 `set_password`（会编码成 UTF-16，字节 ×2）——
后者会白白吃掉一半容量上限。

### 5.2 内存保留明文，磁盘不落盘

`ConfigService` 的内存缓存保留完整明文视图，业务代码（`account_service.rs` 有 43 处引用
`account_token_*`）**一行都不用改**。只有落盘时按字段剥离。

| 接口 | 返回内容 | 用途 |
|---|---|---|
| `get(key)` / `set(key, value)` | 含机密字段明文 | 后端内部 |
| `get_all()` | 含机密字段明文 | 后端内部 |
| `get_all_public()` | **剔除**机密字段 | 暴露给前端（`get_all_configs` 命令用它） |

### 5.3 前端不能写机密字段

`set_config` 命令会**拒绝**写机密键 —— 前端是通用配置入口，机密数据必须经由
后端专用的账户流程写入凭据库。

代理配置有专用命令 `save_proxy_settings`，不受此限制。

### 5.4 迁移（v1 → v2）

启动时若检测到 `schema_version < 2`，执行迁移：

1. 备份 `app_config.json` → `app_config.json.bak`；
2. 把所有机密字段写入凭据库（**幂等**：同名条目覆盖写）；
3. 原子重建配置文件（写 `.tmp` 再 `rename`，只含非机密字段 + `schema_version`）；
4. **删除备份**（迁移成功后明文副本不再需要）。

任一步崩溃，下次启动会重跑迁移（凭据库写入幂等），不会丢数据。

## 6. 凭据库条目命名

```
service = cn.msk-network.endprotocol
user    = {配置键}::{子字段}
```

实例：`account_token_4718764::u8token`、`proxy_config::password`。

> Windows 上 TargetName 形如 `account_token_4718764::u8token.cn.msk-network.endprotocol`。
> 注意 service 名里的 `.` 会与 Windows 凭据库的默认分隔符冲突 —— 任何依赖
> service/user 解析的逻辑（如 `Entry::search`）都会把 service 切成 `endprotocol`。
> 读写与删除走完整 TargetName，不受影响。

## 7. 配套的泄漏面收敛

机密移入凭据库只解决「配置文件」这一处。以下泄漏面已一并处理：

| 位置 | 问题 | 处理 |
|---|---|---|
| `gacha_service.rs:773` | `log_debug!("gacha: GET {}", url)` 把 584 字节 u8token 写进日志文件 | URL 敏感 query 参数脱敏（`utils/redact.rs`） |
| `skland_service.rs:567` | 森空岛 API 请求 URL 含令牌 | 同上 |
| `avatar_cache_service.rs:174`、`commands/image.rs:103`、`char_detail_service.rs:455` | 下载 URL 可能带签名参数 | 同上 |
| `src/pages/account.tsx:2854` | 「凭证过期」弹窗把 `token` / `cred` 明文渲染进 DOM | 改为掩码（`utils/redact.ts` 的 `maskSecret`） |
| `commands/config.rs` `get_all_configs` | 把含凭据的整份配置返回前端 | 改用 `get_all_public()`，逐字段剔除 |
| `commands/config.rs` `set_config` | 任意键写入口，可覆盖凭据 | 拒绝写机密键 |

**未处理**（用户明确要求不改）：`network_capture/` 目录的网络抓包文件仍会落盘
请求头（含 `cred`）与响应体。该目录仅在开发者模式手动开启时写入。

## 8. 相关文件

| 文件 | 职责 |
|---|---|
| `src-tauri/src/services/secret_registry.rs` | 机密字段登记表（唯一判定来源）+ 单元测试 |
| `src-tauri/src/services/secret_store.rs` | 凭据库封装 + 降级链（加密文件后端） |
| `src-tauri/src/services/config_service.rs` | 配置读写，机密字段分流，v1→v2 迁移 |
| `src-tauri/src/commands/config.rs` | 配置命令；过滤对外视图、拒写机密键 |
| `src-tauri/src/utils/redact.rs` | 日志脱敏（URL query、key=value 片段） |
| `src/utils/redact.ts` | 前端遮罩（`maskSecret` / `redactText`） |
| `src-tauri/tests/secret_storage.rs` | 端到端集成测试（真实凭据库） |

## 9. 运维

### 查看当前后端

命令 `get_secret_storage_status` → `{ backend, degraded }`。

### 凭据库条目清理

Windows 上可用 `cargo run --example cred_cleanup`（仓库内 `src-tauri/examples/cred_cleanup.rs`），
它会枚举本应用的凭据条目并删除非真实账户的残留。

### 密钥丢失

OS 凭据库被清空（用户手动清理、换机器、重装系统）后，机密字段无法恢复。
此时应用表现为「账户需要重新登录」—— 这是预期行为，不是 bug。
