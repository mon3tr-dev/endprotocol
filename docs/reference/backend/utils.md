# 后端工具层 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖：`src-tauri/src/utils/` 下全部 15 个文件（mod / api_health / error / crash / diagnostics / game_icon / game_playtime / hg_crypto / http_client / logger / official_launcher / paths / proxy / capture / process / steam）。

## `src-tauri/src/utils/mod.rs`
**职责**：工具层模块清单。声明 14 个子模块并统一再导出统一错误类型。
**导出**：`pub mod api_health`、`pub mod capture`、`pub mod crash`、`pub mod diagnostics`、`pub mod error`、`pub mod game_icon`、`pub mod game_playtime`、`pub mod hg_crypto`、`pub mod http_client`、`pub mod logger`、`pub mod official_launcher`、`pub mod paths`、`pub mod process`、`pub mod proxy`、`pub mod steam`；`pub use error::AppError`。
**主要依赖**：`crate::utils::error`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `pub mod api_health/capture/crash/diagnostics/error/game_icon/game_playtime/hg_crypto/http_client/logger/official_launcher/paths/process/proxy/steam` | mod.rs:1-14 | 14 个子模块声明，全部 `pub` |
| `pub use error::AppError` | mod.rs:16 | 别名导出，使调用方写作 `crate::utils::AppError` |

**备注**：全 crate 通过 `crate::utils::{capture, paths, http_client, AppError}` 这类分组导入使用（如 services/account_service.rs:20、services/avatar_cache_service.rs:6、services/config_service.rs:8）。

---

## `src-tauri/src/utils/error.rs`
**职责**：定义全后端统一错误枚举 `AppError`（27 行），用 `thiserror` 派生 `Display` 与三个自动 `From` 转换，供 service/command 层的 `Result<T, AppError>` 使用。
**导出**：`pub enum AppError`（error.rs:5）。
**主要依赖**：`thiserror`、`reqwest`、`serde_json`、`std::io`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AppError`（enum，`#[derive(Debug, Error)]`） | error.rs:4-5 | 应用错误根类型；字段式变体用具名字段 `{ message }` / `{ code, message }` |
| `AppError::HttpError(reqwest::Error)` | error.rs:6-7 | Display：`HTTP request failed: {0}`；`#[from] reqwest::Error` ⇒ `From<reqwest::Error>` 自动实现，`?` 可直接转换（常用于 `capture::send` 返回的 `reqwest::Error`，见 services/skland_service.rs:569） |
| `AppError::JsonError(serde_json::Error)` | error.rs:9-10 | Display：`JSON serialization failed: {0}`；`#[from] serde_json::Error` ⇒ `From<serde_json::Error>` |
| `AppError::IoError(std::io::Error)` | error.rs:12-13 | Display：`IO error: {0}`；`#[from] std::io::Error` ⇒ `From<std::io::Error>` |
| `AppError::AuthError { message: String }` | error.rs:15-16 | Display：`Authentication failed: {message}`；无 `From`，手动构造，是登录/签名校验/数美接口失败的主力变体（services/account_service.rs:167、233、1893；services/skland_service.rs:109、393） |
| `AppError::ConfigError { message: String }` | error.rs:18-19 | Display：`Configuration error: {message}`；无 `From`，多用于 Mutex 中毒、路径获取失败包装（services/config_service.rs:19、57、86；services/avatar_cache_service.rs:87） |
| `AppError::NetworkError { message: String }` | error.rs:21-22 | Display：`Network error: {message}`；无 `From`，用于代理连通性测试等网络类失败（`utils/proxy.rs`） |
| `AppError::ValidationError { message: String }` | error.rs:24-25 | Display：`Invalid input: {message}`；无 `From`，入参校验失败（如代理未启用/主机为空） |
| `AppError::ApiError { code: i32, message: String }` | error.rs:27-28 | Display：`API error (code={code}): {message}`；无 `From`，用于远端业务错误码 |

**备注**：
- 三个 `#[from]` 是 `thiserror` 生成的 `From` 实现的全部来源；其余变体只能显式构造。
- 调用面覆盖 account / avatar_cache / char_detail / char_wiki_detail / config / attendance / proxy 等 service 与 command；`AppError` 不实现 `serde::Serialize`，因此 `#[tauri::command]` 层通常把它转成 `String` 再返回。
- 存在对 `AppError` 的模式匹配工具函数，如 `account_service::is_new_device_verification_error(&AppError)`（services/account_service.rs:2929）。

---

## `src-tauri/src/utils/hg_crypto.rs`
**职责**：鹰角（Hypergryph）游戏侧加解密与校验工具（131 行）：解密 CDN/本地加密资源（`game_files` 清单、`config.ini`），以及 MD5/SHA-256 哈希与可取消的分块 MD5 校验，供启动器/下载安装链路使用。
**导出**：`decrypt_bytes_to_string`、`decrypt_bytes`、`decrypt_file_to_string`、`sha256_hex`、`verify_md5`、`verify_md5_with_cancel`、`md5_hex`；私有常量 `AES_KEY`、`AES_IV`（均为 `const`，非 pub）。
**主要依赖**：`aes`（Aes256）、`cbc`（Decryptor + Pkcs7）、`sha2`（Sha256）、`md-5`（crate 名 `md5`）、`digest`、`hex`、`std::fs`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AES_KEY: [u8; 32]` | hg_crypto.rs:9-12 | AES-256 密钥常量，注释标注「from reverse engineering Hypergryph launcher」（逆向鹰角启动器所得），非 pub |
| `AES_IV: [u8; 16]` | hg_crypto.rs:15-17 | AES-256-CBC 固定 IV 常量，同样来自逆向，非 pub |
| `decrypt_bytes_to_string(encrypted_bytes: &[u8]) -> Result<String, String>` | hg_crypto.rs:21 | 空输入直接返回 `Ok("")`；否则调用 `decrypt_bytes` 后 `String::from_utf8`，失败报 `UTF-8 decode failed: ...`。调用方：game_launcher_service.rs:481（解密清单字节） |
| `decrypt_bytes(encrypted_bytes: &[u8]) -> Result<Vec<u8>, String>` | hg_crypto.rs:32 | **AES-256-CBC + PKCS7** 解密，key/IV 取文件内常量（hg_crypto.rs:37-38），`decrypt_padded_mut::<Pkcs7>` 原地解密后拷贝返回；空输入返回空 Vec。调用方：`decrypt_bytes_to_string`（hg_crypto.rs:26） |
| `decrypt_file_to_string(file_path: &str) -> Result<String, String>` | hg_crypto.rs:50 | `std::fs::read` 整文件读入（失败报 `Failed to read file '<path>': ...`）再交给 `decrypt_bytes_to_string`。调用方：commands/launcher.rs:242（读加密 `config.ini`）、game_launcher_service.rs:417 |
| `sha256_hex(data: &[u8]) -> String` | hg_crypto.rs:57 | SHA-256 → hex 小写。调用方：game_launcher_service.rs:477（对加密清单原文求哈希） |
| `verify_md5(file_path: &str, expected_md5: &str) -> Result<bool, String>` | hg_crypto.rs:65 | 薄封装，等价 `verify_md5_with_cancel(path, expected, None)`（hg_crypto.rs:66）。调用方：game_launcher_service.rs:379、591、724、763、903、1087、1856、2582（下载/校验/备份比对） |
| `verify_md5_with_cancel(file_path, expected_md5, cancelled: Option<&AtomicBool>) -> Result<bool, String>` | hg_crypto.rs:70 | 分块读取（`HASH_BUFFER_SIZE = 4 MiB`，hg_crypto.rs:79），**每轮循环前/开始/结束三处**检查 `cancelled` 标志，命中即返回 `Err("Hash verification cancelled")`（hg_crypto.rs:80、93、104）；Windows 下用 `OpenOptionsExt::custom_flags(0x08000000)`（`FILE_FLAG_NO_BUFFERING`，hg_crypto.rs:85-86）；比较用 `eq_ignore_ascii_case` 忽略大小写（hg_crypto.rs:110）。调用方：game_launcher_service.rs:1352（可取消的安装校验） |
| `md5_hex(data: &[u8]) -> String` | hg_crypto.rs:114 | 内存字节 MD5 → hex。调用方：game_launcher_service.rs:726（下载文件哈希）、2913 |
| `mod tests` | hg_crypto.rs:122-131 | 仅一个测试 `test_decrypt_roundtrip_key_iv`，只断言 key=32/IV=16 长度，**不做真实解密回环** |

**备注**：解密目标为 CDN 上的加密资源（`game_files` 清单）与本地加密 `config.ini`；哈希校验贯穿下载、落盘、备份全流程。密钥/IV 硬编码在源码中，属逆向常量。

---

## `src-tauri/src/utils/http_client.rs`
**职责**：创建统一配置的 `reqwest::Client`（全局 30 秒超时），并维护一个全局代理配置缓存，使设置页保存的 `proxy_config` 对所有 HTTP 请求即时生效。
**导出**：`pub fn create_client`、`pub fn create_proxied_client`、`pub fn set_global_proxy_config`、`pub fn global_proxy_config`。
**主要依赖**：`reqwest`、`serde_json::Value`、`std::sync::RwLock`、`std::time::Duration`、`crate::utils::proxy`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `static PROXY_CONFIG: RwLock<Option<Value>>` | http_client.rs:9 | 全局代理配置缓存（进程级）；`None` 表示直连 |
| `set_global_proxy_config(config)` | http_client.rs:12 | 写入缓存；由 `set_config("proxy_config")`、`set_proxy_config`、`remove_proxy_config`、`save_proxy_settings`、`clear_proxy_settings` 以及启动时的 `create_config_service()` 调用 |
| `global_proxy_config()` | http_client.rs:19 | 读取缓存快照（`None` 表示未启用代理） |
| `create_client() -> Client` | http_client.rs:24 | 等价于 `create_proxied_client(global_proxy_config().as_ref())`，即**默认跟随全局代理设置**，30 秒超时 |
| `create_proxied_client(proxy_config) -> Client` | http_client.rs:29 | 按传入代理配置构建 client（`proxy::from_config` 生成 `reqwest::Proxy`）；**未启用时显式调用 `ClientBuilder::no_proxy()`**，禁止 reqwest 回退到读取 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 等环境变量（否则后台运行的 v2ray 等第三方代理仍会被使用，即使 EndProtocol 内部代理开关已关闭）；构建失败时 `log_warn!` 并回退 `Client::new()`，不再 panic |

**备注**：调用方约 15 处（services/skland_service.rs、services/account_service.rs、services/gacha_service.rs），自本版本起自动继承全局代理；`commands/image.rs` 与 `services/avatar_cache_service.rs` 的图片下载也已从裸 `reqwest::Client::new()` 改为 `create_client()`，因此同样走代理。**仍未走代理**的请求方：`commands/updater.rs`（自建 client）、`services/char_detail_service.rs`、`services/skland_service.rs` 的数美指纹请求、`services/game_launcher_service.rs`（自建带自定义配置的 client）——如需覆盖，改为 `http_client::create_client()` 即可。

---

## `src-tauri/src/utils/proxy.rs`
**职责**：代理配置的解析与生效层：把 `proxy_config` JSON 收敛为 `reqwest::Proxy`、创建带代理的 client、解析系统代理（Windows 注册表 / 环境变量）、通过代理做连通性探测、自动嗅探本地常用代理端口。
**导出**：`from_config`、`test_connection`、`read_system_proxy`、`auto_detect_proxy`、`struct TestConnectionResult`、`struct SystemProxyInfo`、`struct ProxyConfigValue`。
**主要依赖**：`reqwest`（需启用 `socks` feature）、`serde`/`serde_json`、`windows-sys`（仅 Windows，注册表 API）、`crate::utils::AppError`、`log_debug!` / `log_warn!`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `is_enabled(config)`（私有） | proxy.rs:13-25 | 宽松判定：`enabled == true` 且 `host` 非空 |
| `exclude_list(config)`（私有） | proxy.rs:27-35 | 解析 `exclude` 逗号分隔的主机名列表，返回小写字符串向量 |
| `proxy_server(config)`（私有） | proxy.rs:43-71 | 规范成 `scheme://host:port`：scheme 由 `scheme_for` 决定，端口非法时回退 `8080`，`host` 中的 `scheme://` 前缀与尾部 `/` 会被剥掉 |
| `scheme_for(config)`（私有） | proxy.rs:77-95 | 非 SOCKS5 一律 `http`；SOCKS5 且 `remoteDns=true` → `socks5h`（域名交由代理解析），否则 `socks5` |
| `credentials(config)`（私有） | proxy.rs:98-115 | 用户名非空才返回认证对（密码缺省补空串），否则 `(None, None)` |
| `from_config(config) -> Option<Proxy>` | proxy.rs:122-154 | `Proxy::all(server)`；有用户名时 `basic_auth`。记录排除列表（`no_proxy` 由 `http_client::set_global_proxy_config` 写入环境变量）。URL 非法时 `log_warn!` 并返回 `None`（请求降级为直连而不是报错） |
| `test_connection(config, url, timeout_secs)` | proxy.rs:155-182 | 异步探测：用代理建 client → GET `url` → 返回 `TestConnectionResult`；未启用/主机为空 → `AppError::ValidationError`，请求失败 → `AppError::NetworkError`；超时夹取 1-60 秒 |
| `auto_detect_proxy()` | proxy.rs:189-274 | 异步嗅探：按顺序探测本地常用代理端口（HTTP 8080/7890/1080，SOCKS5 1080/1081），每个端口用 3 秒超时发起连通性测试，首个成功的即返回 `ProxyConfigValue`；全部失败则返回错误 |
| `struct ProxyConfigValue` | proxy.rs:270-282 | `enabled`/`proxy_type`/`host`/`port`/`username`/`password`/`remote_dns`/`exclude`；`Serialize` 供前端 |
| `struct TestConnectionResult` | proxy.rs:283-289 | `status: u16`、`duration_ms: u64`；`Serialize` 供前端 |
| `struct SystemProxyInfo` | proxy.rs:292-305 | `enabled`/`proxy_type`/`host`/`port`/`username`/`password`/`pac_url`/`from_env`；`Serialize + Deserialize` |
| `read_system_proxy()` | proxy.rs:323-333 | Windows 先读注册表，取不到再读环境变量，最后返回全空的 `none()` |
| `env_proxy()`（私有） | proxy.rs:336-354 | 依次尝试 `HTTPS_PROXY`/`https_proxy`/`HTTP_PROXY`/`http_proxy`/`ALL_PROXY`/`all_proxy`，命中后 `from_env=true` |
| `parse_proxy_url(raw)`（私有） | proxy.rs:357-400 | 解析 `scheme://[user:pass@]host[:port]`；`socks*` scheme → `proxy_type="socks5"`；缺省端口 http 8080 / socks5 1080 |
| `split_host_port(authority)`（私有） | proxy.rs:403-426 | 拆分 host 与可选端口，支持 IPv6 字面量 `[::1]:1080`；非数字后缀整体视作 host |
| `windows_registry_proxy()`（私有，`cfg(windows)`） | proxy.rs:431-467 | 读 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`：`ProxyEnable`(DWORD)、`ProxyServer`、`AutoConfigURL`、`ProxyOverride`；未启用或无 `ProxyServer` 时返回 `enabled:false` 并带上 `pac_url` |
| `pick_proxy_entry(server)`（私有，`cfg(windows)`） | proxy.rs:470-494 | 处理 `http=host:port;https=host:port` 与单一 `host:port` 两种写法，优先 `https` 条目 |
| `wide` / `read_raw_value` / `read_dword` / `read_string`（私有，`cfg(windows)`） | proxy.rs:497-575 | 注册表读取工具（UTF-16 路径、64KB 上限、`REG_SZ`/`REG_EXPAND_SZ`/`REG_DWORD`） |
| `mod tests` | proxy.rs:577-633 | 4 个单测：HTTP 配置、SOCKS5+认证、禁用/空主机、系统代理 URL 解析 |

**备注**：
- **reqwest 需要 `socks` feature 才能构造 `socks5://` / `socks5h://` 代理**——`Cargo.toml` 中的 `reqwest` 依赖已加上 `"socks"`。
- 代理 URI 一律经 `Proxy::all`（HTTP 与 HTTPS 流量都走代理）；SOCKS5 默认本地解析 DNS，打开 `remoteDns` 后改用 `socks5h://` 由代理解析域名（可绕过本地 DNS 污染）。
- 排除列表（`exclude` 字段）：前端以逗号分隔的主机名填写，保存后写入 `no_proxy` 环境变量，reqwest 对这些主机直连不走代理。
- `AppError` 新增两个变体以承载这里的错误：`NetworkError { message }`、`ValidationError { message }`（见 `utils/error.rs`）。
- 注册表 `ProxyOverride`（“不使用代理”列表）当前读出来但未参与解析——reqwest 不支持 per-host bypass 列表；PAC 脚本同理，只回传 `pac_url` 供 UI 提示。

---

## `src-tauri/src/utils/logger.rs`
**职责**：自研日志系统（387 行）：控制台彩色输出 + 按日期文件落盘 + 内存环形缓冲（供前端读取），并提供 `tracing` 桥接层与 9 个导出宏。
**导出**：`LogLevel`、`LogEntry`、`LoggerConfig`、`Logger`、`console_available`、`eprint_console`、`init_logger`、`get_logger`、`try_get_logger`、`init_tracing_subscriber`、宏 `log_debug!` / `log_info!` / `log_warn!` / `log_error!` / `log_debug_module!` / `log_info_module!` / `log_warn_module!` / `log_error_module!` / `safe_eprintln!`。私有项：`TracingBridgeLayer`、`TracingVisitor`、`GLOBAL_LOGGER`。
**主要依赖**：`chrono`（Local 时间）、`serde::Serialize`、`tracing` / `tracing-subscriber`、`super::paths`、`std::sync::Mutex`。

### 日志级别与条目

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `enum LogLevel { Debug, Info, Warn, Error }` | logger.rs:40 | 派生 `Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize`；派生序使 `level >= config.log_level` 可直接比较（logger.rs:169） |
| `LogLevel::as_str` | logger.rs:48 | → `"DEBUG"`/`"INFO"`/`"WARN"`/`"ERROR"`（私有） |
| `LogLevel::color_code` | logger.rs:57 | ANSI 颜色：Debug `\x1b[36m` 青、Info `\x1b[32m` 绿、Warn `\x1b[33m` 黄、Error `\x1b[31m` 红（私有） |
| `struct LogEntry` | logger.rs:69 | 字段 `timestamp`(String) / `level`(LogLevel) / `module`(String) / `message`(String) / `source`(String，后端固定写 `"backend"`，logger.rs:148)；`Serialize` 供前端 |
| `struct LoggerConfig` | logger.rs:78 | `log_to_console` / `log_to_file` / `log_level` / `log_dir: PathBuf` / `max_memory_entries`（私有字段外均为 pub） |
| `impl Default for LoggerConfig` | logger.rs:86-97 | 默认：控制台开、文件开、级别 Debug、`log_dir = paths::log_dir()`（失败回退 `current_dir()/logs` 且 `current_dir().unwrap()`，logger.rs:92-93）、内存上限 5000 条 |

### 控制台可用性（GUI 子系统保护）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `console_available() -> bool` | logger.rs:13、20 | Windows 实现 `GetConsoleWindow() != null`；非 Windows 恒真。`main.rs` 无条件使用 GUI 子系统后，进程可能根本没有控制台，此时 std 的 stderr 句柄不可用，直接 `eprintln!` 会 panic |
| `eprint_console(fmt: Arguments)` | logger.rs:25 | `console_available()` 为真才 `eprintln!`；`safe_eprintln!` 宏的落点 |
| `safe_eprintln!` 宏（`#[macro_export]`） | logger.rs:31 | 展开为 `$crate::utils::logger::eprint_console(format_args!(...))`；全 crate 的裸 `eprintln!` 均应替换为它（lib.rs、models/char_detail.rs、services/game_launcher_service.rs 已替换） |

### Logger 实例

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `struct Logger` | logger.rs:100 | 持有 `config`、`log_file: Mutex<Option<File>>`、`memory_buffer: Mutex<VecDeque<LogEntry>>` |
| `Logger::new(config) -> Result<Self, Box<dyn Error>>` | logger.rs:107 | `log_to_file` 为真时调用 `init_log_file`（logger.rs:114-116） |
| `init_log_file` | logger.rs:121 | `create_dir_all(log_dir)` → 文件名 `app-%Y-%m-%d.log`（logger.rs:123-124）→ `create(true).append(true)` 打开并存入 Mutex |
| `format_timestamp` | logger.rs:133 | `%Y-%m-%d %H:%M:%S%.3f`（本地时间，毫秒精度） |
| `write_log(level, module, message)` | logger.rs:137 | 核心写入：①构造 `LogEntry` 入内存 `VecDeque`，超 `max_memory_entries` 则 `pop_front` 淘汰（logger.rs:146-153）；②控制台：仅当 `log_to_console && level >= config.log_level` **且 `console_available()` 为真**，`eprintln!` 带颜色 + `\x1b[0m` 复位（logger.rs:163-171，GUI 无控制台时静默跳过而不是 panic）；③文件：`writeln!` 后立即 `flush()`，**无颜色**（logger.rs:174-181） |
| `get_recent_logs() -> Vec<LogEntry>` | logger.rs:185 | 克隆整个内存缓冲；调用方 commands/logs.rs:6（`get_backend_logs` 命令） |
| `info(&self, message: &str)` | logger.rs:190 | module 固定 `"backend"`（同名便捷方法 `debug`/`warn`/`error` 为死代码，已删除） |
| `debug_fmt/info_fmt/warn_fmt/error_fmt(fmt: Arguments)` | logger.rs:194、198、202、206 | 接收 `format_args!`，供同名宏使用 |
| `debug_with_module/info_with_module/warn_with_module/error_with_module(module, message)` | logger.rs:211、215、219、223 | 指定 module（tracing 桥接与带模块宏使用） |

### 全局实例与初始化

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `static GLOBAL_LOGGER: OnceLock<Logger>` | logger.rs:229 | 全局单例，`std::sync::OnceLock`（线程安全，无 `unsafe`） |
| `init_logger() -> Result<(), Box<dyn Error>>` | logger.rs:231 | 用 `LoggerConfig::default()` 建实例并 `GLOBAL_LOGGER.set(logger)`（重复初始化返回 `Err("Logger already initialized")`），随后 `info("Logger initialized successfully")`；调用方 lib.rs:99、utils/official_launcher.rs:1081（提权 helper 进程，失败不中断启动，仅 `eprintln`） |
| `get_logger() -> &'static Logger` | logger.rs:241 | `GLOBAL_LOGGER.get().expect("Logger not initialized. Call init_logger() first.")`；未初始化即调用会 panic |
| `try_get_logger() -> Option<&'static Logger>` | logger.rs:248 | 未初始化时返回 `None`；供 panic hook 与诊断导出等「日志可能尚未就绪」的路径安全使用 |
| `struct TracingBridgeLayer` + `impl Layer<S>` | logger.rs:247-279 | `on_event`：取 `metadata.level()/module_path()/target()`，用 `TracingVisitor` 收集字段，拼成 `[{target}] {fields}` 后按 ERROR/WARN/INFO/DEBUG\|TRACE 映射到 `*_with_module`（logger.rs:270-277） |
| `struct TracingVisitor(String)` + `impl field::Visit` | logger.rs:281-318 | 实现 `record_debug/record_str/record_i64/record_u64/record_bool`，字段以 `name=value` 空格连接（未实现 record_f64 等） |
| `init_tracing_subscriber()` | logger.rs:322 | `registry().with(TracingBridgeLayer).try_init().ok()`，已初始化则忽略；调用方 lib.rs:104。之后所有 `tracing::info!/debug!`（如 game_launcher_service 的 `tracing::info!`）都汇入本 Logger |

### 导出宏（均 `#[macro_export]`，路径 `$crate::utils::logger::get_logger()`）

| 宏 | 位置 | 展开到 |
| --- | --- | --- |
| `log_debug!` / `log_info!` / `log_warn!` / `log_error!` | logger.rs:334、341、348、355 | `get_logger().*_fmt(format_args!(...))`，module=`backend` |
| `log_debug_module!` / `log_info_module!` / `log_warn_module!` / `log_error_module!` | logger.rs:363、370、377、384 | `get_logger().*_with_module($module, &format_args!(...).to_string())` |
| `safe_eprintln!` | logger.rs:31 | `console_available()` 为真才写 stderr（见上表）；供非 logger 系统的裸 `eprintln!` 使用 |

**备注（格式 / 目标 / 轮转）**：
- **单行格式**：`[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [module] message`（logger.rs:133-139）。
- **输出目标**：stderr（控制台，带 ANSI 色）与日志文件（无色）；内存缓冲同时保留 5000 条供前端 `get_backend_logs` 拉取。
- **轮转/清理**：仅有「按启动日期命名 `app-YYYY-MM-DD.log`」这一按日分文件的**命名**策略——文件句柄在 `init_logger` 时打开一次，**跨天不会切换文件，也没有任何旧日志删除/轮转逻辑**，历史日志会无限累积（异常项）。
- 控制台按 `log_level` 过滤，但**文件与内存缓冲不过滤**，Debug 也会落盘。

---

## `src-tauri/src/utils/official_launcher.rs`
**职责**：官方启动器父进程伪造 —— 在不打开鹰角启动器界面、不注入代码、不修改任何游戏文件的前提下启动《明日方舟：终末地》（约 1700 行，其中非 Windows 部分为返回错误的桩）。游戏会校验自己的**直接父进程**必须是签名有效的官方 `Games.exe`，本模块以 `CREATE_SUSPENDED` 创建官方启动器并永不恢复它（只有映像与签名存在），再用 `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` 把它指定为游戏进程的父进程，等待游戏退出后终止该挂起父进程并转发退出码。**已提权时由当前进程直接创建**（保留 Steam overlay 的 `CreateProcess` 注入链），未提权时才以 runas helper 完成创建。逻辑逐函数移植自 EndfieldNoLauncher 的 `src/launch.cpp`（AGPL-3.0，上游为 Better Endfield Next 的 `native/loaders/shared/official_launcher.cpp`，commit `514f6d6`），函数名与结构一一对应。
**导出**：跨平台 —— `HELPER_FLAG`、`KILL_HELPER_FLAG`、`exit_code` 模块、`kill_exit_code` 模块、`LaunchToken`、`LaunchError`、`ElevatedLaunch`、`HelperOptions`、`KillOptions`、`quote_argument`、`quote_command_line`、`is_official_publisher`、`version_key`、`parse_helper_options`、`parse_kill_options`、`usage`；Windows 专属 —— `launch_via_official_parent`、`kill_game_process`、`process_is_elevated`、`shell_execute_game`、`try_run_helper`、`try_run_kill_helper`（其余全部私有）。
**主要依赖**：`windows-sys`（`Win32_Security*` / `Win32_System_Threading` / `Win32_System_JobObjects` / `Win32_System_Registry` / `Win32_System_Environment` / `Win32_System_Console` / `Win32_System_Diagnostics_Debug` / `Win32_UI_Shell` / `Win32_UI_WindowsAndMessaging`）、`tracing`、`crate::utils::logger`（helper 写同一份日志文件）、`crate::utils::paths`（调用方算状态文件路径）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `HELPER_FLAG` | :53 | `"--endfield-launch-helper"`，提权 helper 的私有首参数 |
| `KILL_HELPER_FLAG` | :56 | `"--endfield-kill-helper"`，提权结束游戏 helper 的私有首参数（与启动 helper 共用同一个 exe） |
| `PUBLISHER`（私有） | :59 | `"Shanghai Hypergryph Network Technology Co., Ltd."`，签名者证书 `O` 字段期望值（对应 C++ `kPublisher`） |
| `pub mod exit_code` | :62-71 | `INVALID_ARGUMENTS=2` / `CREATE_FAILED=4` / `NO_VALID_LAUNCHER=7` / `WAIT_FAILED=8` |
| `pub mod kill_exit_code` | :74-79 | `INVALID_ARGUMENTS=2` / `STILL_RUNNING=3`（提权 `taskkill` 之后同名进程仍存活） |
| `LaunchToken` | :83-102 | 失败/提示的机器可读标记（`not_found`/`no_launcher`/`cancelled`/`create`/`wait_failed`/`kill_failed`/`fallback`/`overlay_unavailable`/`unknown`），前端据此选 i18n 文案 |
| `LaunchError` | :122-153 | `{ token, detail }`；`message()` 产出 `"<token>: <detail>"` 契约串；私有 `exit_code()` 把 token 映射回退出码（`kill_failed` 归入 `CREATE_FAILED`，仅用于 helper 内部错误路径） |
| `ElevatedLaunch` | :166-168 | `{ helper_pid: Option<u32> }`；`Some` = 提权 helper 已建立，`None` = 当前进程已提权并直接创建了游戏 |
| `wide` / `quote_argument` / `quote_command_line` | :175-220 | UTF-16 编码与 `CreateProcessW` 引号转义（对应 `QuoteArgument`：反斜杠仅在引号前与结尾翻倍） |
| `is_official_publisher` | :222 | `eq_ignore_ascii_case` 版 `_wcsicmp`（对应 `IsOfficialPublisher`） |
| `version_key` | :229 | 解析 `…\1.6.0\Games.exe` 的父目录名 → `Vec<u64>`；非法名返回空（排序最低，对应 `Version`） |
| `HelperOptions` / `usage` / `parse_helper_options` | :251-368 | helper 命令行（`--game`/`--parent`/`--status`/`--`，取值选项只允许一次、未知选项报错、只做纯字符串校验以便单测），对应 `Options`/`Usage`/`ParseOptions` |
| `KillOptions` / `parse_kill_options` | :275-310 | kill helper 命令行（`--name <x.exe>`，`--help`）；只接受 `<name>.exe` 且拒绝路径/引号，避免提权入口被当作通用进程终止器 |
| `RegistryKey` / `read_registry` / `subkeys` / `add_root` / `installed_roots` | :552-763 | 发现安装位置（对应 `RegistryKey`/`ReadRegistry`/`Subkeys`/`AddRoot`/`InstalledRoots`） |
| `OwnedHandle` | :443-471 | RAII 内核句柄（`CloseHandle`），null 与 `INVALID_HANDLE_VALUE` 视为无句柄；`take()` 用于移交所有权；`unsafe impl Send`（内核句柄是进程级对象，可跨线程等待/终止/关闭） |
| `process_is_elevated` | :479-498 | 读当前进程令牌的 `TokenElevation`；用于决定游戏由当前进程直接创建还是交给 runas helper |
| `windows_error` | :500-529 | `<操作> (Win32 <码>)` + `FormatMessageW` 本地化文本，740 额外附提权提示（对应 `WindowsError`） |
| `ensure_console_hidden` | :540-549 | 仅 `GetConsoleWindow`+`ShowWindow(SW_HIDE)`，**不调用 `FreeConsole`**（原因见备注）；`main.rs` 全构建改用 GUI 子系统后，正常路径下本函数已是 no-op（无控制台可隐藏），纯防御性保留 |
| `TrustState` / `verify_official_launcher` / `signer_organization` | :770-924 | 签名校验：独占只读句柄（`FILE_SHARE_READ`）+ `WINTRUST_FILE_INFO.hFile` + `WTD_UI_NONE`/`WTD_CHOICE_FILE`/`WTD_CACHE_ONLY_URL_RETRIEVAL\|WTD_REVOCATION_CHECK_NONE`，再取第 0 个签名者证书链 `pasCertChain[0].pCert` 的 `O` 字段比对（对应 `TrustState`/`VerifyOfficialLauncher`） |
| `find_official_launcher` | :925-964 | 给定 `--parent` 时只校验它，否则枚举候选并按版本降序取第一个通过者（对应 `FindOfficialLauncher`） |
| `OfficialParent` + `start` / `create_game` / `Drop` | :967-1134 | 挂起父进程（`CREATE_SUSPENDED\|CREATE_NO_WINDOW` + `SW_HIDE`，关线程句柄但永不 `ResumeThread`）与游戏创建（两段式属性列表 + `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` + `EXTENDED_STARTUPINFO_PRESENT`，`StartupInfo.cb = size_of::<STARTUPINFOEXW>()`）；`Drop` 只终止自己创建的进程并等 5s（对应 `OfficialParent`） |
| `wait_for_game` / `write_status_file` | :1136-1162 | 等待游戏退出并读退出码（对应 `WaitForGame`）；创建成功后写 `pid=<n>` 状态文件 |
| `LauncherJob` / `launch_in_process` | :1163-1264 | 直接启动路径：`CreateJobObjectW` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 兜底终止挂起父进程；本进程创建「挂起官方父进程 + 游戏」，后台线程等待游戏退出并清理，返回 `ElevatedLaunch { helper_pid: None }` |
| `try_run_kill_helper` / `run_kill_helper` | :1268-1300 | 提权结束游戏 helper 入口：在 logger/Tauri 初始化前由 `lib.rs` 截获，`ensure_console_hidden` + `parse_kill_options` → `process::terminate_processes` + `has_processes`，退出码 `0` / `STILL_RUNNING` |
| `try_run_helper` / `run_helper` / `launch` | :1304-1410 | helper 入口与完整流程；`launch()` 是唯一持有 RAII 的作用域，析构（终止挂起父进程）完成后调用方才 `process::exit` |
| `kill_existing_game`（私有，helper） | :1364 | `launch()` 开头以管理员权限执行 `taskkill /F /T /IM <game>`，清理上一局残留（含应用未提权时无法结束的提权游戏进程） |
| `HelperProcess` | :1418-1482 | `ShellExecuteExW` 返回的 helper 进程句柄；`wait_early_exit(2.5s)` 宽限期探测、`wait_to_exit(timeout)` 阻塞取退出码、`watch_to_completion()` 分离线程收尾 |
| `shell_execute_elevated` / `helper_parameters` | :1491-1571 | `ShellExecuteExW("runas", 自身 exe, ...)`，`SW_HIDE` + `SEE_MASK_NOCLOSEPROCESS\|NOASYNC\|FLAG_NO_UI\|NO_CONSOLE` |
| `launch_via_official_parent` | :1576-1670 | 入口：先验签（失败即 `no_launcher`，调用方回退直接启动）→ **已提权时 `launch_in_process`**，否则 runas 重启自身 → 宽限期判定 |
| `kill_game_process` / `kill_helper_parameters` | :1640-1686 | 结束游戏入口：先就地 `process::terminate_processes` + `has_processes`（已提权时到此为止，不弹 UAC）；仍有残留则 runas 重启自身跑 `--endfield-kill-helper`，阻塞等待退出码（`KILL_HELPER_TIMEOUT = 20s`），失败映射为 `kill_failed`（helper 退出码非 0 / 超时） |
| `shell_execute_game` | :1688-1730 | 回退路径：`ShellExecuteW(SW_SHOWNORMAL)` 直接启动游戏（旧实现的行为）；`arguments: &[String]` 逐个经 `quote_argument` 拼接后作为 `lpParameters` 传入，用于转发 `-force-d3d11` |
| `mod tests` | :1771-1921 | 16 个单测：引号转义（结尾反斜杠 / 内嵌引号）、组织名比对、版本解析与数值比较、helper 参数解析、kill 参数解析与 `<name>.exe` 限制 |

**备注（提权模型 / 契约 / 限制）**：
- **两种启动路径**：当前进程**已提权**时由 `launch_in_process` 直接创建挂起父进程与游戏 —— 这是 Steam overlay 能进入游戏的前提：`gameoverlayrenderer64.dll` 注入的是 Steam 拉起的本进程，只有保持同一条 `CreateProcess` 链，overlay 才能继续注入；**未提权**时才走 `runas` helper（游戏与官方启动器 manifest 都要求管理员，未提权进程直接创建会得到 Win32 740）。helper 路径会引入提权边界，Steam（非管理员）的 overlay 无法跨边界注入到管理员游戏，因此命令层会在 `warning` 中返回 `overlay_unavailable`。
- **`runas` 两阶段（恰好一次 UAC）**：未提权一侧只做「查找 + 验签」，失败时不弹 UAC 就能给出结论；成功则 `runas` 重启自身，提权后的同一 exe 由 `lib.rs:39` 的 `try_run_helper()` 在 logger/Tauri 初始化**之前**截获（结束游戏的 `try_run_kill_helper()` 紧随其后，`lib.rs:47`）。
- **`process::exit` 不跑析构**：helper 的完整流程必须先在一个函数内返回（RAII 析构 → 终止挂起的 `Games.exe`），再由 `lib.rs` 退出进程；若在持有父进程句柄时直接退出，那个 `Games.exe` 会永久残留。
- **直接启动的清理**：`LauncherJob` 用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 绑定挂起的 `Games.exe`，应用先退出（含崩溃）时由内核兜底终止；游戏正常退出时后台线程先 `Drop` 挂起父进程再关闭 Job。Job 在游戏创建之后才创建/赋值，因此不会把游戏本身纳入 Job。
- **启动前清理旧游戏进程**：helper 在 `launch()` 开头执行 `taskkill /F /T /IM <game>`。应用未提权时 `launch_game` 里的同名 `taskkill` 会因 `Access is denied` 失败，残留的提权游戏进程只能由提权 helper 清理。若残留进程被游戏反作弊驱动保护（管理员也无法终止），则只能重启系统；`is_process_running` 会通过窗口/启动宽限判定把这类无窗口残留排除在「游戏中」之外。
- **不许 `FreeConsole`**：万一进程真的附有控制台（非正常路径），`FreeConsole` 会让之后所有 stderr 写入直接失败、且 logger 里的 `console_available()` 检查也无济于事（句柄已失效）；因此只隐藏窗口、不卸载控制台（`main.rs` 全构建 GUI 子系统后，正常路径本就无控制台，裸 `eprintln!` 也已统一走 `safe_eprintln!`）。
- **签名句柄不跨提权边界**：helper 会重新验签并自己保持 `FILE_SHARE_READ` 句柄直到进程创建完成；未提权一侧的校验只是「不想让用户白弹一次 UAC」的 UX 过滤，**不要**因为「重复」而删掉 helper 里的那次。
- **有意与上游一致的两处取舍**：`WTD_REVOCATION_CHECK_NONE`（不联网、不查吊销，离线可用）与只比对组织名不比指纹。
- **状态文件**：`%LOCALAPPDATA%\cn.msk-network.endprotocol\launcher_helper_status`（路径由调用方传入），用于区分「helper 启动阶段失败」与「游戏创建成功但很快退出」——helper 退出码与游戏退出码共用同一段数值区间。
- **结束游戏同样要提权**：游戏进程由提权 helper 创建，未提权的 EndProtocol 执行 `taskkill` / `TerminateProcess` 只会得到 `Access is denied`。`kill_game_process` 因此先就地试一次（本进程已提权时足以成功，不弹 UAC），还有残留才 `runas` 重启自身跑 `KILL_HELPER_FLAG`（`--endfield-kill-helper --name <Endfield.exe>`），由 `lib.rs` 在 logger/Tauri 初始化前截获；helper 只做 `process::terminate_processes` + `has_processes`，退出码 `0` = 已结束、`STILL_RUNNING` = 仍存活。用户取消 UAC 会由 `shell_execute_elevated` 映射为 `cancelled`，命令层把它作为 `Err("<token>: <detail>")` 交给前端展示。
- **kill helper 的命令行只接受 `<name>.exe`**：这个提权入口若允许任意参数，就等于给应用开了一个「以管理员权限终止任意进程」的后门；`parse_kill_options` 因此拒绝路径、引号与非 `.exe` 目标。
- **旧实现的 `wmic` 兜底已移除**：`wmic` 在新版 Windows 已弃用，且同样跨不过完整性级别边界，留着只会掩盖真正的原因（权限不足）。
- 非 Windows 平台：`launch_via_official_parent` 返回 `unknown` 错误、`try_run_helper` / `try_run_kill_helper` 返回 `None`、`kill_game_process` 返回 `Ok(false)`、`process_is_elevated` 恒为 `false`，模块仍可编译（CI 会构建 macOS/Linux）。

---

## `src-tauri/src/utils/paths.rs`
**职责**：集中定义应用数据目录与各业务文件/目录路径（80 行），统一基于 `dirs::data_local_dir()` + 应用目录名，返回 `Result<PathBuf, &'static str>`。
**导出**：常量 `APP_DIR`（`const`，非 pub）、13 个 `pub fn`。
**主要依赖**：`dirs`、`std::path::PathBuf`。

常量：`APP_DIR = "cn.msk-network.endprotocol"`（paths.rs:3），即 Bundle ID 风格目录名。

| 符号 | 位置 | 返回路径（相对数据根目录） |
| --- | --- | --- |
| `app_data_dir()` | paths.rs:7 | `<data_local_dir>/cn.msk-network.endprotocol`；失败返回 `"Failed to get local app data directory"`。**平台差异**：Windows = `%LOCALAPPDATA%\cn.msk-network.endprotocol`（doc 注释 paths.rs:6，刻意用 Local 不用 Roaming，避免同步）；macOS = `~/Library/Application Support/cn.msk-network.endprotocol`；Linux = `~/.local/share/cn.msk-network.endprotocol`（`dirs::data_local_dir()` 语义）。调用方：config_service.rs:19、game_launcher_service.rs:1918/1952/1970 |
| `image_cache_dir()` | paths.rs:14 | `<app_data_dir>/image_cache`。调用方：commands/image.rs:18、avatar_cache_service.rs:87 |
| `backgrounds_dir()` | paths.rs:19 | `<app_data_dir>/backgrounds`。调用方：commands/image.rs:143、154、192 |
| `wiki_detail_cache_dir()` | paths.rs:24 | `<app_data_dir>/wiki_detail_cache`。调用方：char_wiki_detail_service.rs:42 |
| `log_dir()` | paths.rs:29 | `<app_data_dir>/logs`。调用方：logger.rs:65（LoggerConfig 默认值） |
| `config_file_path()` | paths.rs:34 | `<app_data_dir>/app_config.json`。调用方：config_service.rs:25 |
| `capture_dir()` | paths.rs:39 | `<app_data_dir>/network_capture`。调用方：utils/capture.rs:101（`capture_root`） |
| `gacha_records_file_path(user_id, server_id)` | paths.rs:44 | `<app_data_dir>/gacha_records/gacha_records_{userId}_{serverId}.json`。调用方：gacha_service.rs:162 |
| `gacha_weapon_records_file_path(user_id, server_id)` | paths.rs:52 | `<app_data_dir>/gacha_records/gacha_weapon_records_{userId}_{serverId}.json`。调用方：gacha_service.rs:242 |
| `gacha_total_catalog_file_path()` | paths.rs:65 | `<app_data_dir>/gacha_records/total.json`（全量 Wiki 目录，全局共用）。调用方：gacha_service.rs:335 |
| `gacha_records_file_path_legacy(user_id, server_id)` | paths.rs:70 | `<app_data_dir>/gacha_records_{userId}_{serverId}.json`（**与 app_config.json 同级的旧版布局**，仅供存量数据兼容读取）。调用方：gacha_service.rs:177 |
| `gacha_avatar_map_file_path()` | paths.rs:78 | `<app_data_dir>/gacha_avatar_map.json`。调用方：gacha_service.rs:301 |

**备注**：全部函数只拼接路径、**不创建目录**（创建由调用方 `create_dir_all` 完成）；除 `app_data_dir` 的底层查询失败外无其他错误来源，故错误类型是 `&'static str`。平台差异只体现在 `data_local_dir()` 根目录，子目录结构跨平台一致。

---

## `src-tauri/src/utils/capture.rs`
**职责**：网络请求录制器（580 行）。以全局单例维护一个「活动会话」，把经 `send`/`send_stream` 发出的 HTTP 请求（含响应体）追加写入 JSONL；并提供会话的开始/停止/状态/列表/分页读取/删除等管理能力，供开发者抓包面板使用。
**导出**：`CaptureBody`、`CaptureEntry`、`CaptureSessionMeta`、`CaptureStatus`、`CapturePage`（数据结构）；`is_recording`、`capture_root`、`status`、`start`、`stop`、`list_sessions`、`read_entries`、`delete_session`、`send`、`send_stream`（函数）。私有：`ActiveSession`、`CaptureService`、`service()`、`active_lock()`、`valid_id`、`write_meta`、`status_of`、`headers_to_vec`、`encode_body`、`RequestMeta`、`Draft`、`write_entry`、`rebuild_response`、常量与 `RECORDING`。
**主要依赖**：`base64`、`bytes`、`chrono`、`reqwest`、`http`、`serde`、`uuid`、`super::paths`、`crate::{log_info, log_warn}`。

### 常量与全局状态

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `MAX_BODY_BYTES` | capture.rs:19 | `16 MiB`，单个 body 截断上限 |
| `MAX_PAGE_SIZE` | capture.rs:20 | `500`，`read_entries` 的 limit 上限 |
| `META_FILE` / `EVENTS_FILE` | capture.rs:21-22 | `"meta.json"` / `"events.jsonl"` |
| `static RECORDING: AtomicBool` | capture.rs:24 | 录制总开关，`Relaxed` 读写；`start` 置 true（capture.rs:179）、`stop` 置 false（capture.rs:185）、写文件失败也会置 false（capture.rs:410） |

### 数据结构（会话存储格式）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CaptureBody` | capture.rs:27 | `encoding: String`（`"utf8"` 或 `"base64"`）、`size: u64`（原始字节数）、`truncated: bool`、`data: String` |
| `CaptureEntry` | capture.rs:35 | 单条请求记录：`index`、`timestamp`、`method`、`url`、`request_headers: Vec<(String,String)>`、`request_body: Option<CaptureBody>`、`status: Option<u16>`、`response_headers`、`response_body`、`duration_ms`、`error`、`note`；每行一条 JSON 序列化后写入 `events.jsonl` |
| `CaptureSessionMeta` | capture.rs:51 | 会话元数据：`id`、`started_at`、`ended_at: Option`、`status`（`"recording"`/`"completed"`）、`count`、`size_bytes`、`path`（会话目录绝对路径）；以 pretty JSON 存 `meta.json`（capture.rs:114） |
| `CaptureStatus` | capture.rs:62 | `recording`、`session_id`、`started_at`、`count`、`size_bytes`（仅 Serialize） |
| `CapturePage` | capture.rs:71 | `total: u64`（全文件有效行数）+ `entries: Vec<CaptureEntry>`（当前窗口） |
| `struct ActiveSession` | capture.rs:76 | `meta` + `writer: BufWriter<File>`（`events.jsonl` 句柄） |
| `struct CaptureService` | capture.rs:81 | `active: Mutex<Option<ActiveSession>>`，`OnceLock` 单例（capture.rs:85-90），锁中毒用 `into_inner` 恢复（capture.rs:92-94） |

### 磁盘布局

```
<app_data>/network_capture/                    # paths::capture_dir()（capture.rs:101）
└── <YYYYMMDD-HHMMSS>-<uuid8>/                 # 会话 id，start() 生成（capture.rs:152-155）
    ├── meta.json                              # CaptureSessionMeta，pretty 格式
    └── events.jsonl                           # 每行一个 CaptureEntry（紧凑 JSON）
```

### 管理 API

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `is_recording() -> bool` | capture.rs:96 | 读 `RECORDING` |
| `capture_root() -> Result<PathBuf, String>` | capture.rs:100 | = `paths::capture_dir()`，错误转 `String` |
| `valid_id(id) -> bool`（私有） | capture.rs:104 | 非空、≤64 字节、仅 `[0-9A-Za-z_-]` —— **防路径穿越**（测试 capture.rs:555 校验 `../escape` 被拒） |
| `write_meta(meta)`（私有） | capture.rs:112 | `meta.path` + `meta.json`，`serde_json::to_string_pretty` 后 `fs::write` |
| `status_of(Option<&Meta>)`（私有） | capture.rs:118 | 由元数据组装 `CaptureStatus`，无会话时全零/false |
| `status() -> CaptureStatus` | capture.rs:137 | 读活动会话元数据 |
| `start() -> Result<CaptureStatus, String>` | capture.rs:142 | 已在录制则直接返回现状（capture.rs:144-147）；否则建根目录 → 生成 id `{%Y%m%d-%H%M%S}-{uuid4 前 8 位}`（capture.rs:152-154）→ 建会话目录 → 写初始 meta（status=`recording`）→ 以 `create+append` 打开 `events.jsonl` 并包 `BufWriter` → 置 `RECORDING=true` |
| `stop() -> Result<CaptureStatus, String>` | capture.rs:184 | 先清 `RECORDING` → 取出会话 → flush writer → meta 置 `completed`、写 `ended_at`、用 `fs::metadata` 回填真实 `size_bytes`（capture.rs:194-196）→ 重写 meta（失败仅 `log_warn`） |
| `list_sessions() -> Result<Vec<CaptureSessionMeta>, String>` | capture.rs:205 | 扫根目录子目录，读 `meta.json`（缺失/解析失败跳过）；活动会话用内存中的最新 meta 覆盖（capture.rs:226-232）；非活动但状态仍为 `recording` 的残留记录被**就地修复为 `completed` 并回写**（capture.rs:234-237）；按 id **倒序**（新会话在前，capture.rs:241） |
| `read_entries(id, offset, limit) -> Result<CapturePage, String>` | capture.rs:245 | 校验 id → 打开 `events.jsonl` → `limit.clamp(1, 500)` → `BufReader::lines()` 顺序扫描，跳过空行，累计 `total`，从 `offset` 起收集至多 `limit` 条（单行 JSON 解析失败则静默丢弃，capture.rs:262）；**O(total) 全文件扫描** |
| `delete_session(id) -> Result<(), String>` | capture.rs:272 | 校验 id → 若正录制的就是该会话则报 `Cannot delete the session being recorded`（capture.rs:280）→ 目录不存在视为成功 → `fs::remove_dir_all` |

### 录制与请求发送

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `headers_to_vec(&HeaderMap)`（私有） | capture.rs:291 | 保留重复头（如多个 `set-cookie`）为 `Vec<(name, value)>`，value 用 `from_utf8_lossy` |
| `encode_body(&[u8]) -> CaptureBody`（私有） | capture.rs:303 | 超 16 MiB 截断并标 `truncated`（`size` 仍为原始长度）；切片是合法 UTF-8 → `utf8` 原文；否则若「完整 bytes 是 UTF-8、仅截断处切断」也用 lossy 还原为 `utf8`（capture.rs:313-317），否则 `base64` |
| `RequestMeta::from_request(&reqwest::Request)` | capture.rs:340 | 抓 method/url/headers/body（`body.as_bytes()`，仅当 body 为内存字节时可得） |
| `struct Draft` + `Draft::record(self)` | capture.rs:353、364 | 把「请求元数据 + 响应状态/头/体 + 耗时 + 错误」组装成 `CaptureEntry`（timestamp 精确到毫秒）后交给 `write_entry` |
| `write_entry(mut entry)`（私有） | capture.rs:383 | 未录制直接返回；活动会话 `count += 1` 并赋 `entry.index = count`（**index 从 1 开始**）→ `serde_json::to_string` 紧凑单行 → `writeln!` + 立即 `flush`；成功则 `size_bytes += 行长+1`，失败 `log_warn` 并把 `RECORDING` 置 false 停止录制（capture.rs:409-411） |
| `rebuild_response(status, headers, body) -> Response`（私有） | capture.rs:415 | 因为 `send` 需要读完 body 才能录制，故用 `http::Response::new(body)` 重组再 `.into()` 回 `reqwest::Response` |
| `send(client, builder) -> Result<Response, reqwest::Error>`（pub async） | capture.rs:422 | 未录制时零开销直通（`recording.then(...)` 不构造 meta，capture.rs:426-431）；录制时计时 → `execute` → 成功则读 `bytes()`：读到则录制（body 一并 encode）并返回**重建的 Response**（capture.rs:450）；读 body 失败则录制 `error`+`note="response body could not be read"` 并把原始 Err 传出（capture.rs:452-464）；请求失败也录制（无 status/body）后透传 Err |
| `send_stream(client, builder) -> Result<Response, reqwest::Error>`（pub async） | capture.rs:483 | 流式变体：不读 body，录制 `note="streaming response, body not recorded"`（capture.rs:507），原样返回 `Response`（供下载/更新等流式消费） |
| `mod tests` | capture.rs:528-579 | 三个测试：`encode_body` 文本/二进制/空、`valid_id` 路径穿越、`headers_to_vec` 重复头 |

### 与 `commands/capture.rs` 的对应关系

| Tauri 命令 | 位置 | 转发到 |
| --- | --- | --- |
| `capture_start` | commands/capture.rs:4-6 | `capture::start()` |
| `capture_stop` | commands/capture.rs:9-11 | `capture::stop()` |
| `capture_status` | commands/capture.rs:14-16 | `Ok(capture::status())` |
| `capture_list_sessions` | commands/capture.rs:19-21 | `capture::list_sessions()` |
| `capture_read_entries(id, offset, limit)` | commands/capture.rs:24-30 | `capture::read_entries(&id, offset, limit)` |
| `capture_delete_session(id)` | commands/capture.rs:33-35 | `capture::delete_session(&id)` |
| `capture_dir` | commands/capture.rs:38-42 | `capture::capture_root()` + 额外 `create_dir_all` 后返回路径字符串 |

**备注**：
- 启动自动录制：lib.rs:157-174 在 `.setup()` 中读配置键 `capture_autostart`（默认 false），在任何 API 请求发出之前调用 `utils::capture::start()`。
- `send`/`send_stream` 的调用方遍布全后端：commands/updater.rs:35/70、commands/image.rs:105、services/skland_service.rs:341/569/780/867/961/1060/1121、services/account_service.rs:1862/1916/2016/2079/2144/2872/2952/3008、services/gacha_service.rs:780、services/char_detail_service.rs:631、services/avatar_cache_service.rs:176、services/game_launcher_service.rs:180/462/665/2016/2175/2822。
- 会话 id 同时充当目录名，所有读写路径都先经 `valid_id` 白名单校验，杜绝 `../` 穿越。
- 数据结构（`CaptureEntry` 等）同时被 `commands/capture.rs` 直接导入并返回给前端。

---

## `src-tauri/src/utils/game_icon.rs`
**职责**：Windows 可执行文件图标提取（约 250 行）。Steam 库条目的 `icon` 字段只接受图片文件路径，因此把 `Endfield.exe` 内嵌的 `RT_GROUP_ICON` / `RT_ICON` 资源重新组装成标准 `.ico` 文件，供 `utils::steam` 的默认图标使用。
**导出**：`extract_icon`；私有：`load_icon_bytes`（Windows / 非 Windows 两份）、内部 `ResourceName`、`LoadedModule`（Drop 时 `FreeLibrary`）、`read_resource`、`collect_group_names`、`wide`、`read_group_icon`。
**主要依赖**：`std::fs`、`std::path`、`windows_sys::Win32::{Foundation, System::LibraryLoader, UI::WindowsAndMessaging}`（仅 Windows）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `extract_icon(exe_path, out_path)` | :13 | 校验源 exe 存在 → 提取字节 → 建父目录 → 写 `*.ico.tmp` 后 `rename` 覆盖，避免 Steam 读到半个文件；返回 `out_path` |
| `load_icon_bytes`（Windows） | :41 | `LoadLibraryExW(..., LOAD_LIBRARY_AS_DATAFILE)` 打开 exe（`LoadedModule` 负责 `FreeLibrary`）→ `EnumResourceNamesW(RT_GROUP_ICON)` 收集图标组名 → 取 ID 最小的组（字符串命名回退第一个）→ 按 `GRPICONDIR` 逐项读 `RT_ICON` → 组装 `ICONDIR + ICONDIRENTRY + 图像数据` |
| `load_icon_bytes`（非 Windows） | :244 | 恒返回错误（Windows 专用） |
| `mod tests` | :250 起 | 仅验证源文件不存在时返回 `Err` |

**备注**：资源名同时支持整型 ID（`IS_INTRESOURCE`，指针低位即 ID）与字符串形式；`LockResource` 数据在模块卸载前有效，因此先拷贝成 `Vec<u8>` 再释放。图标缓存路径由 `commands/startup.rs::steam_icon_path` 决定（`%LOCALAPPDATA%\cn.msk-network.endprotocol\steam\endfield.ico`）。

---

## `src-tauri/src/utils/game_playtime.rs`
**职责**：游戏运行时长统计（187 行）。作为进程级单例，只统计 EndProtocol 自身运行期间的游戏进程在线时长：后台每 5 秒探测一次 `Endfield.exe`，进程出现即开始一段会话、消失即把该段累加进总时长并落盘；应用启动时若游戏已在运行则从启动时刻算起，应用退出时若游戏仍在运行则计到退出时刻。
**导出**：`TOTAL_SECONDS_KEY`、`GamePlaytime`、`init`、`snapshot`、`finalize`；私有：常量 `POLL_SECONDS`/`FOLD_SECONDS`/`GAME_PROCESS_NAME`、`Inner`、`STATE`、`CONFIG`、`state`、`now_secs`、`poll_loop`、`update`、`persist`。
**主要依赖**：`serde::Serialize`、`std::sync::{Arc, Mutex, OnceLock}`、`std::time::{SystemTime, UNIX_EPOCH}`、`crate::services::config_service::ConfigService`、`crate::utils::process::is_process_running`、`tauri::async_runtime`、`tracing`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TOTAL_SECONDS_KEY` | :20 | `"game_playtime_total_seconds"`，累计总时长在 `app_config.json` 中的键（u64 秒） |
| `POLL_SECONDS` / `FOLD_SECONDS` | :22 / :25 | 进程探测间隔 5s；运行中每累积 60s 把已过去时长折入总数并落盘（崩溃安全） |
| `GAME_PROCESS_NAME` | :28 | `"Endfield.exe"`（各渠道一致） |
| `GamePlaytime`（struct，`Serialize`） | :31-39 | 前端快照：`total_seconds`（不含当前会话）、`session_seconds`（未运行为 0）、`running` |
| `struct Inner` | :41-47 | 内存态：`total_seconds`、`session_start`、`running`、`first_poll`、`app_start` |
| `static STATE / CONFIG` | :49-50 | `OnceLock<StdMutex<Inner>>` 与 `OnceLock<Arc<StdMutex<ConfigService>>>` 单例 |
| `state()` / `now_secs()` | :52 / :64 | 惰性初始化单例；当前 Unix 秒（失败为 0） |
| `init(config_service)` | :72 | 从 config 读回 `total_seconds`，记录 `app_start`，置首轮探测标记，`CONFIG.set` 后 `tauri::async_runtime::spawn(poll_loop)`。lib.rs 在静默/完整两种 setup 中均调用 |
| `poll_loop()`（私有 async） | :91 | 循环：`is_process_running("Endfield.exe")` → `update` → sleep 5s |
| `update(running)`（私有） | :99 | 会话开始（首次探测到运行从 `app_start` 算、否则从此刻算）；会话结束累加并落盘；运行中每满 60s 折叠落盘 |
| `snapshot() -> GamePlaytime` | :143 | 汇报当前总数 + 实时会话（命令 `launcher_get_game_playtime` 的返回） |
| `finalize()` | :162 | 应用退出（`RunEvent::Exit`）时若仍在运行则计到此刻并落盘；幂等 |
| `persist(inner)`（私有） | :174 | 把 `total_seconds` 写入 `ConfigService`（`app_config.json`） |

**备注**：
- 事件/命令关联：`launcher_get_game_playtime`（commands/launcher.rs）→ `snapshot`；lib.rs 的 `.setup()` 调用 `init`，`.run(|_, event| …)` 在 `RunEvent::Exit` 调用 `finalize`。
- 仅统计 EndProtocol 运行期间；游戏在软件未运行时的时间段不计入。运行中每 60s 折叠落盘，进程被强杀最多丢 60s。
- 存储位置：`%LOCALAPPDATA%\cn.msk-network.endprotocol\app_config.json` 的 `game_playtime_total_seconds`。
- **驻守实例**（`--silent --launch-game`，游戏退出后自行退出）不调用 `init`：避免与同时运行的完整版重复累计，也减少多实例并发写配置文件；该会话的应用内时长不计入，由 Steam 记录游戏时长。

---

## `src-tauri/src/utils/process.rs`
**职责**：进程探测与结束辅助（约 220 行）。供 `launcher_check_game_running` / `launcher_kill_game` 命令、驻守等待与游戏运行时长统计共用：「进程是否真的在运行」查询（排除崩溃/挂起后残留的无窗口进程）与「结束同名进程」的执行原语。
**导出**：`is_process_running`（async）、`list_process_ids`（sync）、`terminate_processes`（sync）、`has_processes`（sync）；私有：`STARTUP_GRACE_SECONDS`、`list_process_ids_async`、`parse_tasklist_pids`、`has_top_level_window`、`process_is_starting`。
**主要依赖**：`tokio::process::Command`、`std::process::Command`、`windows-sys`（`Win32_System_Threading`、`Win32_UI_WindowsAndMessaging`，仅 Windows）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `is_process_running(process_name) -> bool`（pub async） | :14 | Windows：`tasklist /FI "IMAGENAME eq <name>" /FO CSV /NH` 取得同名 PID；任一 PID 拥有顶层窗口，或进程创建时间在 `STARTUP_GRACE_SECONDS` 内，即视为运行中；无窗口的陈旧进程（如 Application Hang 后仍 `STILL_ACTIVE` 的残留）返回 false。命令失败记 debug 日志并返回 false；非 Windows 恒 false。调用方：commands/launcher.rs（`launcher_check_game_running`）、utils/game_playtime.rs（`poll_loop`）、lib.rs（`wait_for_game_session`） |
| `STARTUP_GRACE_SECONDS` | :35 | 90 秒；新进程尚未创建窗口时仍视为「正在启动」 |
| `list_process_ids_async`（私有 async） | :38 | 异步 `tasklist`，交给 `parse_tasklist_pids` 解析 |
| `parse_tasklist_pids`（私有） | :66 | 解析 `tasklist /FO CSV /NH` 输出：只保留镜像名忽略大小写完全匹配的行，取第 2 列 PID（两种查询共用同一段解析） |
| `list_process_ids`（pub sync） | :94 | 同步版本，供 `spawn_blocking` / helper 进程使用；**不做**窗口/启动宽限过滤（`taskkill` 要的是「还有哪些同名进程活着」，包括界面判定为未运行的残留）。非 Windows 返回空 |
| `terminate_processes`（pub sync） | :133 | 隐藏窗口 `taskkill /T /F /IM <name>`，随后对 `list_process_ids` 的每个 PID 再补一次 `taskkill /F /PID`；返回按名命令是否成功（通常 `Access is denied` 表示需要提权）。非 Windows 恒 `false` |
| `has_processes`（pub sync） | :164 | 轮询 `list_process_ids`，最多约 3 秒（6 次 × 500ms）等终止生效；仍有进程返回 `true` |
| `has_top_level_window`（私有） | :177 | `EnumWindows` + `GetWindowThreadProcessId` 判断 PID 是否拥有顶层窗口（跨完整性级别可见） |
| `process_is_starting`（私有） | :206 | `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetProcessTimes` 读取创建时间，与当前时间比较 |

**备注**：仅按镜像名判断会把杀不掉的无窗口挂起进程误报为「游戏中」；窗口/启动宽限判定修复了该误报。游戏正常运行时拥有主窗口，不受影响。`terminate_processes` / `has_processes` 被 `commands/launcher.rs`（`launcher_kill_game`）、`utils/official_launcher.rs`（`kill_game_process`、提权 kill helper 的 `run_kill_helper`）复用。

---

## `src-tauri/src/utils/steam.rs`
**职责**：Steam 第三方游戏（非 Steam 快捷方式）注入与 Overlay 权限辅助（Windows 专用，约 800 行，含二进制 VDF 单元测试）。直接读写当前账户的 `userdata/<accountId>/config/shortcuts.vdf`（二进制 VDF）：按显示名匹配已有条目，命中则更新、否则追加。显示名、图标与启动选项全部由调用方传入（见 `SteamShortcut`）。另外提供「以管理员身份运行」`.lnk` 的创建与改写，以及「开始」菜单 Steam 快捷方式的发现。
**导出**：`TYPE_OBJECT`、`SteamShortcut`、`add_shortcut`、`steam_root`、`create_elevated_shortcut`、`find_start_menu_steam_shortcuts`、`elevate_shortcuts`；私有：`VdfValue`、`ShortcutsFile`、`upsert_shortcut`、`field_string`、`set_string`、`set_i32`、`next_entry_index`、`steam_app_id`、`parse_shortcuts`、`encode_shortcuts`、`write_value`、`write_cstring`、`Parser`、`write_atomically`、`collect_steam_shortcuts`、`mark_shortcut_as_admin`、`run_powershell`、`powershell_literal`、`find_steam_root`、`read_registry_string`、`wide`、`find_shortcuts_file`、`modified_time`（注册表/路径/快捷方式相关均仅 Windows）。
**主要依赖**：`std::fs`、`std::path`、`std::time`、`base64`、`windows_sys::Win32::System::Registry`（仅 Windows）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TYPE_OBJECT` | :20 | `0x00`，VDF 对象类型字节；同时被 `utils::game_icon` 之外的外部测试使用 |
| `VdfValue` / `ShortcutsFile` | :31 / :42 | 解析后的 VDF 值与 `shortcuts.vdf` 根对象（根键、条目、尾部结束字节数） |
| `SteamShortcut` | :49 | 写入参数：`name`（显示名，同时用于去重）、`exe_path`、`launch_options`、`icon_path: Option<&Path>`（`None` 回退 exe 自身） |
| `add_shortcut(shortcut)` | :61 | 定位 Steam 根目录与 `shortcuts.vdf` → 读取（缺失视为空）→ 解析 → upsert → 原子写回；返回 `shortcuts.vdf` 路径；非 Windows 直接返回错误 |
| `steam_root()` | :95 | `find_steam_root` 的 `Result` 包装，供 `add_steam_shortcut` 定位 `steam.exe` |
| `upsert_shortcut` | :107 | 按 `AppName` 命中则更新 `Exe`/`StartDir`/`icon`/`LaunchOptions`/`appid`，否则以递增数字键追加完整字段（含空 `tags` 对象） |
| `steam_app_id` | :201 | `CRC32(Exe + AppName) \| 0x80000000`，与 Steam 为非 Steam 快捷方式生成 ID 的算法一致 |
| `parse_shortcuts` | :216 | 解析根对象 `shortcuts`；空文件返回空列表；保留文件尾部 0x08 结束字节数量；遇到未知类型/尾部非 0x08 数据即报错，避免写回损坏文件 |
| `encode_shortcuts` | :246 | 按二进制 VDF 规则重新编码根对象与全部条目 |
| `write_value` / `write_cstring` | :258 / :309 | 各 VDF 类型（object/string/int32/float/pointer/wstring/color/uint64）写出 |
| `Parser` | :314 (entries :358) | 严格二进制 VDF 解析器：`entries`（:366）循环读取键值直到 0x08，`wstring` 读取 UTF-16LE 字符串 |
| `write_atomically` | :410 | 先写 `shortcuts.vdf.tmp` 再 `rename` 覆盖原文件 |
| `create_elevated_shortcut` | :443 | 用 `WScript.Shell` 定位目标/参数/工作目录/备注/图标并保存 `.lnk`，再通过 `Shell.Application` 的 `Verbs()` 执行「以管理员身份运行」动词；返回 `.lnk` 路径 |
| `find_start_menu_steam_shortcuts` | :515 | 枚举用户级（`%APPDATA%`）与公共级（`%PROGRAMDATA%`）「开始」菜单，返回文件名为 `steam` 的 `.lnk`（不含 `steam://` 协议快捷方式，它无法承载 RunAsAdmin） |
| `elevate_shortcuts` | :586 | 逐个调用 `mark_shortcut_as_admin`；已提升的跳过，单个失败只记 warn 日志；返回本次实际修改的路径 |
| `mark_shortcut_as_admin` | :610 | 用 `Shell.Application` 查「以管理员身份运行」动词，存在则 `DoIt()` 并返回 `Ok(true)`；动词不存在视为已勾选（`Ok(false)`） |
| `run_powershell` | :628 | `-NoProfile -STA -NonInteractive -EncodedCommand` 执行脚本（隐藏窗口），失败时把 stderr/stdout 作为错误详情 |
| `find_steam_root` | :681 | 依次尝试注册表 `HKCU\Software\Valve\Steam\SteamPath`、`HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath`、`HKLM\SOFTWARE\Valve\Steam\InstallPath`，再回退 `%ProgramFiles(x86)%\Steam` / `%ProgramFiles%\Steam`；要求存在 `userdata` 目录 |
| `find_shortcuts_file` | :787 | 枚举 `userdata/<纯数字账户>/config`，取最近修改的 `shortcuts.vdf`；不存在时取最近修改的 `config` 目录并以其下路径作为新文件 |

**备注**：**允许 Steam 运行期间写入**（旧实现会拒绝）——Steam 退出时会用内存数据覆盖 `shortcuts.vdf`，因此命令层在成功提示中要求用户完全退出并重启 Steam；`appid` 以 i32 位模式写入。多账户时只写最近修改的账户目录。图标字段只接受文件路径，默认值由 `commands/startup.rs` 配合 `utils/game_icon` 生成 `.ico`。

---

## `src-tauri/src/utils/api_health.rs`
**职责**：API 连续失败熔断器（约 222 行）。记录森空岛接口连续失败次数、分类与服务器时间偏差；达到阈值后置位全局 `BLOCKED`，后续 `call_skland_api` 立即失败，避免前端无限等待，并通过 `app:api-health` 事件通知前端弹出提示。
**导出**：`ApiFailureKind`、`ApiHealthSnapshot`、`CLOCK_SKEW_THRESHOLD_SECONDS`、`init`、`ensure_available`、`record_success`、`record_failure`、`reset`、`snapshot`、`classify_error`。私有：`BLOCK_THRESHOLD`、`SIGNATURE_BLOCK_THRESHOLD`、`DEVICE_FINGERPRINT_BLOCK_THRESHOLD`、`APP_HANDLE`、`BLOCKED`、`STATE`、`state`。
**主要依赖**：`chrono`、`serde::Serialize`、`std::sync::{Mutex, OnceLock}`、`std::sync::atomic`、`tauri::{AppHandle, Emitter}`、`crate::utils::AppError`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `BLOCK_THRESHOLD` / `SIGNATURE_BLOCK_THRESHOLD` / `DEVICE_FINGERPRINT_BLOCK_THRESHOLD` | :10 / :12 / :15 | 普通错误连续 5 次、签名类 3 次、数美设备指纹 3 次触发熔断 |
| `CLOCK_SKEW_THRESHOLD_SECONDS` | :17 | 服务器时间与本地时间偏差 ≥180 秒即判定为时钟异常，单次失败也直接熔断 |
| `ApiFailureKind`（`Serialize`、`snake_case`） | :23-36 | `ClockSkew / Signature / Auth / Network / Server / Parse / DeviceFingerprint / Unknown`，作为事件与导出清单的枚举值；`DeviceFingerprint` 对应数美设备指纹接口失败（前端提示重启电脑并同步时区） |
| `ApiHealthSnapshot`（`Serialize`） | :38-46 | `blocked`、`consecutive_failures`、`kind`、`message`、`clock_skew_seconds`、`last_failure_at`；`Default` 为未熔断空状态 |
| `init(app)` | :66 | 保存 `AppHandle` 供事件广播；状态惰性初始化 |
| `ensure_available()` | :72 | 已熔断时返回 `AppError::AuthError`，消息包含失败次数与最后一次错误；`call_skland_api` 在每次请求前调用 |
| `record_success()` | :88 | 未熔断时把计数/分类/偏差清零（任一成功请求即解除连续失败累计） |
| `record_failure(kind, message, clock_skew_seconds)` | :97 | 累计失败；确认时钟偏差或达到阈值时置 `BLOCKED` 并 `emit("app:api-health", snapshot)`，否则只记 warn 日志 |
| `reset()` | :159 | 用户修复问题后清空熔断与计数（命令 `reset_api_health`） |
| `snapshot()` | :171 | 返回当前状态（命令 `get_api_health`、诊断 manifest） |
| `classify_error(code, message, clock_skew_seconds)` | :178 | 按服务器时间偏差、sign/timestamp/签名/过期、cred/token/401/403、5xx 等关键字分类；`数美`/`deviceprofile`/`device_id` 归类为 `DeviceFingerprint` |

**备注**：
- 由 `services/skland_service.rs` 的 `call_skland_api` 调用：请求前 `ensure_available`，成功置 `record_success`，HTTP/JSON/业务错误按类型 `record_failure`；并从响应头 `Date` 计算本地时钟偏差。
- 数美设备指纹（dId 获取）失败的计数在 `SklandService::fetch_new_did` 内部完成（`DeviceFingerprint`，阈值 3），`call_skland_api` 中 dId 失败不再重复计 `Network`。
- 事件名 `app:api-health`；payload 即 `ApiHealthSnapshot`。前端 `src/utils/crashReporting.ts` 监听后收起 Splash 并把账户标记为不可用（`src/utils/accountAvailability.ts`），弹窗为非致命，可关闭后继续使用应用。
- 静默模式不初始化该服务（不建立 WebView，也无业务请求）。

---

## `src-tauri/src/utils/crash.rs`
**职责**：崩溃捕获与崩溃报告管理（约 250 行）。安装全局 panic hook，把 panic 消息、线程、位置、回溯、应用版本与系统信息写入 `logs/crashes/crash-*.log`；运行中通过 `app:crash` 事件通知前端；启动时读取未确认报告供弹窗展示，并提供 `.ack` 标记。
**导出**：`CrashReportInfo`、`CrashEventPayload`、`set_app_handle`、`install_panic_hook`、`crash_dir`、`pending_reports`、`acknowledge`。私有：`APP_HANDLE`、`HOOK_INSTALLED`、`IN_HOOK`、`handle_panic`、`panic_message`、`write_report`、`ack_path`、`truncate_chars`。
**主要依赖**：`chrono`、`serde::Serialize`、`std::backtrace::Backtrace`、`std::panic`、`tauri::{AppHandle, Emitter}`、`super::paths`、`super::logger::try_get_logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CrashReportInfo`（`Serialize`） | :17-25 | `path`、`file_name`、`timestamp`、`message`、`content`（截断到 24000 字符）、`acknowledged` |
| `CrashEventPayload`（`Serialize`） | :27-35 | `message`、`location`、`thread`、`backtrace`、`report_path`、`timestamp`；`app:crash` 事件体 |
| `set_app_handle(app)` | :37 | 在 Tauri `setup` 中保存 `AppHandle`，供 hook 广播事件 |
| `install_panic_hook()` | :43 | 幂等替换全局 panic hook；`lib.rs` 在业务初始化前调用 |
| `handle_panic(info)`（私有） | :50 | `IN_HOOK` 防递归；捕获 payload/位置/线程/回溯；写报告、写后端日志、安全写 stderr；有 handle 时 `emit("app:crash")` |
| `crash_dir()` | :132 | `%LOCALAPPDATA%\cn.msk-network.endprotocol\logs\crashes` |
| `write_report(content)`（私有） | :138 | 文件名为 `crash-YYYYMMDD-HHMMSS-<pid>.log` |
| `pending_reports()` | :152 | 扫描 `crash-*.log`，跳过已有 `.log.ack` 的文件；按时间倒序取最近 5 条 |
| `acknowledge(paths)` | :211 | 仅接受崩溃目录内的 `.log`，写入 `crash-*.log.ack` 标记已读；防路径穿越 |
| `truncate_chars` / `ack_path`（私有） | :240 / :244 | 字符级截断；ack 文件路径 |

**备注**：崩溃目录与 `app-YYYY-MM-DD.log` 同属 `logs/`；`export_diagnostics` 会把所有 `crash-*.log` 一并打包。`write_report` 失败时仅通过 `safe_eprintln` 输出，不再递归触发 hook。

---

## `src-tauri/src/utils/diagnostics.rs`
**职责**：诊断日志导出（约 163 行）。把前端日志、后端内存日志、当日 `app-*.log` / `startup.log`、崩溃报告与系统/API 状态清单打包成 zip，写入 `logs/exports/`。
**导出**：`FrontendLogEntry`、`export`。私有：`DiagnosticsManifest`、`write_archive_contents`、`add_text`、`add_file`。
**主要依赖**：`chrono`、`serde`、`zip`（`ZipWriter` / `SimpleFileOptions` / `CompressionMethod`）、`super::{api_health, crash, logger, paths}`、`tauri::AppHandle`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `FrontendLogEntry`（`Deserialize`/`Serialize`） | :13-22 | 与 `src/utils/logger.ts` 的 `LogEntry` 对齐：`timestamp`、`level`（数字）、`message`、`module`、`source`、`data?` |
| `DiagnosticsManifest`（`Serialize`） | :24-32 | 应用名、版本（`app.package_info()`）、ISO 时间、OS/架构、调用方上下文、`ApiHealthSnapshot` |
| `export(app, frontend_logs, context)` | :34 | 创建 `endprotocol-diagnostics-YYYYMMDD-HHMMSS.zip`；失败时删除半成品并返回错误 |
| `write_archive_contents(...)`（私有） | :62 | 依次写入 `manifest.json`、`frontend-logs.json`、`backend-logs.txt`、`logs/app-*.log`、`logs/startup.log`、`crashes/crash-*.log` |
| `add_text` / `add_file`（私有） | :143 / :155 | 向 zip 写入字符串 / 文件字节（Deflated 压缩） |

**备注**：不打包 `app_config.json`、网络抓包或图片缓存，避免泄露凭证；由命令 `export_diagnostics`（`commands/diagnostics.rs:15`）调用，前端在崩溃弹窗、Splash 错误面板与开发者页「导出诊断日志」按钮中使用。

---

## 本文件发现的异常

1. **logger.rs 无日志轮转/清理**：仅按启动日期命名 `app-YYYY-MM-DD.log`，文件句柄常驻不跨天切换，旧日志永不删除；同时文件与内存缓冲不做级别过滤（Debug 全量落盘）。
2. **`LoggerConfig::default()` 中 `current_dir().unwrap()`**（logger.rs:66）在 cwd 不可用时会 panic。
3. **HTTP 客户端超时策略不统一**：`http_client::create_client`（30s）仅被 3 个 service 使用，多处仍直接 `reqwest::Client::new()`（无显式超时），game_launcher_service 另建自定义 client。
4. **hg_crypto 的测试 `test_decrypt_roundtrip_key_iv` 只断言常量长度**（hg_crypto.rs:126-130），并未真正验证解密逻辑；AES key/IV 为明文硬编码（逆向常量）。
5. **`read_entries` 为全文件顺序扫描**（capture.rs:256-267），大会话下分页读取开销 O(文件行数）；单行 JSON 解析失败会被静默丢弃，可能导致 `total` 与前端可见条目不一致。

