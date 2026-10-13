# 后端工具层 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖：`src-tauri/src/utils/` 下全部 9 个文件（mod / error / encrypt / hg_crypto / http_client / logger / official_launcher / paths / capture）。

## `src-tauri/src/utils/mod.rs`
**职责**：工具层模块清单（10 行）。声明 8 个子模块并统一再导出统一错误类型。
**导出**：`pub mod capture`、`pub mod encrypt`、`pub mod error`、`pub mod hg_crypto`、`pub mod http_client`、`pub mod logger`、`pub mod official_launcher`、`pub mod paths`；`pub use error::AppError`（mod.rs:10）。
**主要依赖**：`crate::utils::error`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `pub mod capture/encrypt/error/hg_crypto/http_client/logger/official_launcher/paths` | mod.rs:1-8 | 8 个子模块声明，全部 `pub` |
| `pub use error::AppError` | mod.rs:10 | 别名导出，使调用方写作 `crate::utils::AppError` |

**备注**：全 crate 通过 `crate::utils::{capture, paths, http_client, AppError}` 这类分组导入使用（如 services/account_service.rs:20、services/avatar_cache_service.rs:6、services/config_service.rs:8）。

---

## `src-tauri/src/utils/error.rs`
**职责**：定义全后端统一错误枚举 `AppError`（23 行），用 `thiserror` 派生 `Display` 与三个自动 `From` 转换，供 service/command 层的 `Result<T, AppError>` 使用。
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
| `AppError::ApiError { code: i32, message: String }` | error.rs:21-22 | Display：`API error (code={code}): {message}`；无 `From`，用于远端业务错误码 |

**备注**：
- 三个 `#[from]` 是 `thiserror` 生成的 `From` 实现的全部来源；其余三个变体只能显式构造。
- 调用面覆盖 account / avatar_cache / char_detail / char_wiki_detail / config / attendance 等 service 与 command；`AppError` 不实现 `serde::Serialize`，因此 `#[tauri::command]` 层通常把它转成 `String` 再返回。
- 存在对 `AppError` 的模式匹配工具函数，如 `account_service::is_new_device_verification_error(&AppError)`（services/account_service.rs:2929）。

---

## `src-tauri/src/utils/encrypt.rs`
**职责**：对齐 Python 参考实现的三种对称/非对称加密原语（87 行），用于森空岛/数美（Shumei）设备指纹 `dId` 获取流程的字段混淆与载荷加密。
**导出**：`des_encrypt_3des_ecb`、`aes_encrypt_cbc`、`rsa_pkcs1v15_encrypt`。
**主要依赖**：`aes`、`des`、`rsa`、`base64`（STANDARD 引擎）、`hex`、`rand`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `des_encrypt_3des_ecb(key: &str, data: &str) -> String` | encrypt.rs:12 | 算法：名义 3DES-ECB，实际 `Des::new_from_slice(key.as_bytes())` **单 DES**（encrypt.rs:22，注释说明 Python 传 8 字节 key 时 TripleDES 退化为单 DES）；Zero Padding 补到 8 字节倍数（encrypt.rs:16-19，`pad_len<8` 才补，长度已对齐时不追加）；逐 8 字节块 `encrypt_block_b2b`；输出 **BASE64（STANDARD）** 字符串。输入 `data` 为 UTF-8 明文。对应 Python `_DES_encrypt`（encrypt.rs:10）。用途：数美指纹 JSON 各字段（`ua`/`smid`/`svm`/`trees` 等按 `des_rules` 表）逐字段加密后改名为 `xx`/`pj`/`qr` 等混淆键。**调用方：无**（见备注） |
| `aes_encrypt_cbc(data: &[u8], key: &[u8]) -> String` | encrypt.rs:35 | 算法：AES-128-CBC，**IV 硬编码** `b"0102030405060708"`（encrypt.rs:49）；填充为特殊逻辑——先无条件 `push(0x00)`（encrypt.rs:43，复刻 Python 多加的一个 `\x00`），再补 0 到 16 字节倍数（encrypt.rs:44-47，已对齐时不补）；手写 CBC（逐块 XOR 前一密文块 + `encrypt_block`）；输出 **hex** 小写字符串（encrypt.rs:72）。key 为 16 字节（数美流程中取 `pri_id` 的 ASCII 字节）。对应 Python `_AES_encrypt`。用途：对「gzip 压缩后 base64 的指纹 JSON」做最终加密，密文以 `hex` 放入数美 `data` 字段。**调用方：无** |
| `rsa_pkcs1v15_encrypt(public_key_der: &[u8], data: &[u8]) -> Result<Vec<u8>, String>` | encrypt.rs:77 | 算法：RSA PKCS#1 v1.5（`Pkcs1v15Encrypt`），公钥以 **DER SubjectPublicKeyInfo** 解析（`RsaPublicKey::from_public_key_der`，encrypt.rs:78），随机源 `rand::thread_rng()`；返回原始密文字节（调用方自行 base64）。错误以 `String` 返回（`Failed to parse RSA public key: ...` / `RSA encryption failed: ...`）。对应 Python `PK.encrypt(uid, padding.PKCS1v15())`（encrypt.rs:76）。用途：数美接口的 `ep` 字段——用数美平台公钥加密随机 `uid`。**调用方：无** |

**备注**：
- **当前代码库中这三个 pub 函数没有任何调用方**（全仓 grep `des_encrypt|aes_encrypt|rsa_pkcs1v15` 仅命中本文件定义与 skland_service 中同名但独立的私有实现）。等价逻辑被内联在 `services/skland_service.rs::fetch_new_did`（数美设备指纹流程）中：
  - RSA：skland_service.rs:107-124（先 base64 解码常量 `PUB_KEY_DER`，加密 `uid` 后 base64 得 `ep`）；
  - AES-128-CBC：skland_service.rs:286-322（key=`pri_id.as_bytes()`、IV 同为 `0102030405060708`、同样先 `\x00` 再补零、结果 `hex::encode`）；
  - 单 DES：私有函数 `des_encrypt_3des`（skland_service.rs:1191-1215），算法与本文件 `des_encrypt_3des_ecb` 完全一致（Zero Padding + 单 DES + base64），仅把 `expect` 换成 `AppError::AuthError`。
- 加密产物最终 POST 到数美接口 `https://fp-it.portal101.cn/deviceprofile/v4`（skland_service.rs:341-347），换取 `deviceId`，再加前缀 `B` 作为森空岛请求头 `dId`（skland_service.rs:418）；森空岛业务请求本身使用 HMAC-SHA256+MD5 签名（skland_service.rs:422-449），不走本文件。
- 结论：encrypt.rs 是「参考实现/预留工具层」，与 skland_service 内联实现构成重复代码（异常项）。

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
**职责**：创建统一配置的 `reqwest::Client`（10 行），全局 30 秒超时。
**导出**：`pub fn create_client`。
**主要依赖**：`reqwest`、`std::time::Duration`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `create_client() -> Client` | http_client.rs:5 | `Client::builder().timeout(Duration::from_secs(30)).build()`；构建失败直接 `expect("Failed to create HTTP client")` panic（http_client.rs:9）。返回值为按值 `Client`（reqwest 内部引用计数，调用方自行 clone） |

**备注**：调用方共 15 处——services/skland_service.rs:515、772、857、941、1047、1109；services/account_service.rs:1851、1905、2005、2072、2132、2861、2940、2997；services/gacha_service.rs:778。**未覆盖**的请求方使用裸 `reqwest::Client::new()`（commands/image.rs:104、commands/updater.rs:34/69、services/avatar_cache_service.rs:169、services/char_detail_service.rs:630、services/skland_service.rs:104）或自建带自定义配置的 client（services/game_launcher_service.rs:121、127、2793），即超时策略并未全站统一（异常项）。

---

## `src-tauri/src/utils/logger.rs`
**职责**：自研日志系统（377 行）：控制台彩色输出 + 按日期文件落盘 + 内存环形缓冲（供前端读取），并提供 `tracing` 桥接层与 8 个导出宏。
**导出**：`LogLevel`、`LogEntry`、`LoggerConfig`、`Logger`、`init_logger`、`get_logger`、`init_tracing_subscriber`、宏 `log_debug!` / `log_info!` / `log_warn!` / `log_error!` / `log_debug_module!` / `log_info_module!` / `log_warn_module!` / `log_error_module!`。私有项：`TracingBridgeLayer`、`TracingVisitor`、`GLOBAL_LOGGER`。
**主要依赖**：`chrono`（Local 时间）、`serde::Serialize`、`tracing` / `tracing-subscriber`、`super::paths`、`std::sync::Mutex`。

### 日志级别与条目

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `enum LogLevel { Debug, Info, Warn, Error }` | logger.rs:13 | 派生 `Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize`；派生序使 `level >= config.log_level` 可直接比较（logger.rs:142） |
| `LogLevel::as_str` | logger.rs:21 | → `"DEBUG"`/`"INFO"`/`"WARN"`/`"ERROR"`（私有） |
| `LogLevel::color_code` | logger.rs:30 | ANSI 颜色：Debug `\x1b[36m` 青、Info `\x1b[32m` 绿、Warn `\x1b[33m` 黄、Error `\x1b[31m` 红（私有） |
| `struct LogEntry` | logger.rs:42 | 字段 `timestamp`(String) / `level`(LogLevel) / `module`(String) / `message`(String) / `source`(String，后端固定写 `"backend"`，logger.rs:121)；`Serialize` 供前端 |
| `struct LoggerConfig` | logger.rs:51 | `log_to_console` / `log_to_file` / `log_level` / `log_dir: PathBuf` / `max_memory_entries`（私有字段外均为 pub） |
| `impl Default for LoggerConfig` | logger.rs:59-70 | 默认：控制台开、文件开、级别 Debug、`log_dir = paths::log_dir()`（失败回退 `current_dir()/logs` 且 `current_dir().unwrap()`，logger.rs:65-66）、内存上限 5000 条 |

### Logger 实例

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `struct Logger` | logger.rs:73 | 持有 `config`、`log_file: Mutex<Option<File>>`、`memory_buffer: Mutex<VecDeque<LogEntry>>` |
| `Logger::new(config) -> Result<Self, Box<dyn Error>>` | logger.rs:80 | `log_to_file` 为真时调用 `init_log_file`（logger.rs:87-89） |
| `init_log_file` | logger.rs:94 | `create_dir_all(log_dir)` → 文件名 `app-%Y-%m-%d.log`（logger.rs:96-97）→ `create(true).append(true)` 打开并存入 Mutex |
| `format_timestamp` | logger.rs:106 | `%Y-%m-%d %H:%M:%S%.3f`（本地时间，毫秒精度） |
| `format_message` | logger.rs:110 | 私有，格式 `[ts] [LEVEL] [module] msg`；**全文件无调用（死代码）**，实际格式化在 `write_log` 内联（logger.rs:133-139） |
| `write_log(level, module, message)` | logger.rs:115 | 核心写入：①构造 `LogEntry` 入内存 `VecDeque`，超 `max_memory_entries` 则 `pop_front` 淘汰（logger.rs:124-131）；②控制台：仅当 `log_to_console && level >= config.log_level`，`eprintln!` 带颜色 + `\x1b[0m` 复位（logger.rs:142-146）；③文件：`writeln!` 后立即 `flush()`，**无颜色**（logger.rs:149-156） |
| `get_recent_logs() -> Vec<LogEntry>` | logger.rs:160 | 克隆整个内存缓冲；调用方 commands/logs.rs:6（`get_backend_logs` 命令） |
| `debug/info/warn/error(&self, message: &str)` | logger.rs:165、169、173、177 | module 固定 `"backend"` |
| `debug_fmt/info_fmt/warn_fmt/error_fmt(fmt: Arguments)` | logger.rs:181、185、189、193 | 接收 `format_args!`，供同名宏使用 |
| `debug_with_module/info_with_module/warn_with_module/error_with_module(module, message)` | logger.rs:198、202、206、210 | 指定 module（tracing 桥接与带模块宏使用） |

### 全局实例与初始化

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `static mut GLOBAL_LOGGER: Option<Logger>` | logger.rs:216 | 全局单例，`unsafe` 静态可变量 |
| `init_logger() -> Result<(), Box<dyn Error>>` | logger.rs:218 | 用 `LoggerConfig::default()` 建实例并写入 `GLOBAL_LOGGER`（`unsafe` 块，logger.rs:221-223），随后 `info("Logger initialized successfully")`；调用方 lib.rs:32、utils/official_launcher.rs:1068（提权 helper 进程，失败不中断启动，仅 `eprintln`） |
| `get_logger() -> &'static Logger` | logger.rs:228 | `GLOBAL_LOGGER.as_ref().expect("Logger not initialized. Call init_logger() first.")`；未初始化即调用会 panic |
| `struct TracingBridgeLayer` + `impl Layer<S>` | logger.rs:237-269 | `on_event`：取 `metadata.level()/module_path()/target()`，用 `TracingVisitor` 收集字段，拼成 `[{target}] {fields}` 后按 ERROR/WARN/INFO/DEBUG\|TRACE 映射到 `*_with_module`（logger.rs:260-267） |
| `struct TracingVisitor(String)` + `impl field::Visit` | logger.rs:271-308 | 实现 `record_debug/record_str/record_i64/record_u64/record_bool`，字段以 `name=value` 空格连接（未实现 record_f64 等） |
| `init_tracing_subscriber()` | logger.rs:311 | `registry().with(TracingBridgeLayer).try_init().ok()`，已初始化则忽略；调用方 lib.rs:37。之后所有 `tracing::info!/debug!`（如 game_launcher_service 的 `tracing::info!`）都汇入本 Logger |

### 导出宏（均 `#[macro_export]`，路径 `$crate::utils::logger::get_logger()`）

| 宏 | 位置 | 展开到 |
| --- | --- | --- |
| `log_debug!` / `log_info!` / `log_warn!` / `log_error!` | logger.rs:323、330、337、344 | `get_logger().*_fmt(format_args!(...))`，module=`backend` |
| `log_debug_module!` / `log_info_module!` / `log_warn_module!` / `log_error_module!` | logger.rs:352、359、366、373 | `get_logger().*_with_module($module, &format_args!(...).to_string())` |

**备注（格式 / 目标 / 轮转）**：
- **单行格式**：`[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [module] message`（logger.rs:133-139）。
- **输出目标**：stderr（控制台，带 ANSI 色）与日志文件（无色）；内存缓冲同时保留 5000 条供前端 `get_backend_logs` 拉取。
- **轮转/清理**：仅有「按启动日期命名 `app-YYYY-MM-DD.log`」这一按日分文件的**命名**策略——文件句柄在 `init_logger` 时打开一次，**跨天不会切换文件，也没有任何旧日志删除/轮转逻辑**，历史日志会无限累积（异常项）。
- 控制台按 `log_level` 过滤，但**文件与内存缓冲不过滤**，Debug 也会落盘。

---

## `src-tauri/src/utils/official_launcher.rs`
**职责**：官方启动器父进程伪造 —— 在不打开鹰角启动器界面、不注入代码、不修改任何游戏文件的前提下启动《明日方舟：终末地》（1530 行，其中非 Windows 部分为返回错误的桩）。游戏会校验自己的**直接父进程**必须是签名有效的官方 `Games.exe`，本模块以 `CREATE_SUSPENDED` 创建官方启动器并永不恢复它（只有映像与签名存在），再用 `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` 把它指定为游戏进程的父进程，等待游戏退出后终止该挂起父进程并转发退出码。逻辑逐函数移植自 EndfieldNoLauncher 的 `src/launch.cpp`（AGPL-3.0，上游为 Better Endfield Next 的 `native/loaders/shared/official_launcher.cpp`，commit `514f6d6`），函数名与结构一一对应。
**导出**：跨平台 —— `HELPER_FLAG`、`exit_code` 模块、`LaunchToken`、`LaunchError`、`ElevatedLaunch`、`HelperOptions`、`quote_argument`、`quote_command_line`、`is_official_publisher`、`version_key`、`parse_helper_options`、`usage`；Windows 专属 —— `launch_via_official_parent`、`shell_execute_game`、`try_run_helper`（其余全部私有）。
**主要依赖**：`windows-sys`（`Win32_Security*` / `Win32_System_Threading` / `Win32_System_Registry` / `Win32_System_Environment` / `Win32_System_Console` / `Win32_System_Diagnostics_Debug` / `Win32_UI_Shell` / `Win32_UI_WindowsAndMessaging`）、`tracing`、`crate::utils::logger`（helper 写同一份日志文件）、`crate::utils::paths`（调用方算状态文件路径）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `HELPER_FLAG` | :50 | `"--endfield-launch-helper"`，提权 helper 的私有首参数 |
| `PUBLISHER`（私有） | :53 | `"Shanghai Hypergryph Network Technology Co., Ltd."`，签名者证书 `O` 字段期望值（对应 C++ `kPublisher`） |
| `pub mod exit_code` | :56-66 | `INVALID_ARGUMENTS=2` / `CREATE_FAILED=4` / `NO_VALID_LAUNCHER=7` / `WAIT_FAILED=8` |
| `LaunchToken` | :69-100 | 失败/提示的机器可读标记（`not_found`/`no_launcher`/`cancelled`/`create`/`wait_failed`/`fallback`/`unknown`），前端据此选 i18n 文案 |
| `LaunchError` | :102-139 | `{ token, detail }`；`message()` 产出 `"<token>: <detail>"` 契约串；私有 `exit_code()` 把 token 映射回退出码 |
| `ElevatedLaunch` | :142-146 | `{ helper_pid }`，提权 helper 已建立 |
| `wide` / `quote_argument` / `quote_command_line` | :151-192 | UTF-16 编码与 `CreateProcessW` 引号转义（对应 `QuoteArgument`：反斜杠仅在引号前与结尾翻倍） |
| `is_official_publisher` | :194 | `eq_ignore_ascii_case` 版 `_wcsicmp`（对应 `IsOfficialPublisher`） |
| `version_key` | :201 | 解析 `…\1.6.0\Games.exe` 的父目录名 → `Vec<u64>`；非法名返回空（排序最低，对应 `Version`） |
| `HelperOptions` / `usage` / `parse_helper_options` | :223-295 | helper 命令行（`--game`/`--parent`/`--status`/`--`，取值选项只允许一次、未知选项报错、只做纯字符串校验以便单测），对应 `Options`/`Usage`/`ParseOptions` |
| `RegistryKey` / `read_registry` / `subkeys` / `add_root` / `installed_roots` | :448-685 | 发现安装位置（对应 `RegistryKey`/`ReadRegistry`/`Subkeys`/`AddRoot`/`InstalledRoots`） |
| `OwnedHandle` | :366-394 | RAII 内核句柄（`CloseHandle`），null 与 `INVALID_HANDLE_VALUE` 视为无句柄；`take()` 用于移交所有权 |
| `windows_error` | :396 | `<操作> (Win32 <码>)` + `FormatMessageW` 本地化文本，740 额外附提权提示（对应 `WindowsError`） |
| `ensure_console_hidden` | :436 | 仅 `GetConsoleWindow`+`ShowWindow(SW_HIDE)`，**不调用 `FreeConsole`**（原因见备注） |
| `TrustState` / `verify_official_launcher` / `signer_organization` | :601-814 | 签名校验：独占只读句柄（`FILE_SHARE_READ`）+ `WINTRUST_FILE_INFO.hFile` + `WTD_UI_NONE`/`WTD_CHOICE_FILE`/`WTD_CACHE_ONLY_URL_RETRIEVAL\|WTD_REVOCATION_CHECK_NONE`，再取第 0 个签名者证书链 `pasCertChain[0].pCert` 的 `O` 字段比对（对应 `TrustState`/`VerifyOfficialLauncher`） |
| `find_official_launcher` | :816-856 | 给定 `--parent` 时只校验它，否则枚举候选并按版本降序取第一个通过者（对应 `FindOfficialLauncher`） |
| `OfficialParent` + `start` / `create_game` / `Drop` | :858-1025 | 挂起父进程（`CREATE_SUSPENDED\|CREATE_NO_WINDOW` + `SW_HIDE`，关线程句柄但永不 `ResumeThread`）与游戏创建（两段式属性列表 + `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` + `EXTENDED_STARTUPINFO_PRESENT`，`StartupInfo.cb = size_of::<STARTUPINFOEXW>()`）；`Drop` 只终止自己创建的进程并等 5s（对应 `OfficialParent`） |
| `wait_for_game` / `write_status_file` | :1027-1052 | 等待游戏退出并读退出码（对应 `WaitForGame`）；创建成功后写 `pid=<n>` 状态文件 |
| `try_run_helper` / `run_helper` / `launch` | :1054-1146 | helper 入口与完整流程；`launch()` 是唯一持有 RAII 的作用域，析构（终止挂起父进程）完成后调用方才 `process::exit` |
| `HelperProcess` | :1148-1212 | `ShellExecuteExW` 返回的 helper 进程句柄；`wait_early_exit(2.5s)` 宽限期探测 + `watch_to_completion()` 分离线程收尾 |
| `shell_execute_elevated` / `helper_parameters` | :1214-1289 | `ShellExecuteExW("runas", 自身 exe, ...)`，`SW_HIDE` + `SEE_MASK_NOCLOSEPROCESS\|NOASYNC\|FLAG_NO_UI\|NO_CONSOLE` |
| `launch_via_official_parent` | :1291-1340 | 未提权一侧入口：先验签（失败即 `no_launcher`，调用方回退直接启动）→ 提权重启自身 → 宽限期判定 |
| `shell_execute_game` | :1342-1366 | 回退路径：`ShellExecuteW(SW_SHOWNORMAL)` 直接启动游戏（旧实现的行为） |
| `mod tests` | :1399-1530 | 12 个单测：引号转义（结尾反斜杠 / 内嵌引号）、组织名比对、版本解析与数值比较、helper 参数解析 |

**备注（提权模型 / 契约 / 限制）**：
- **两阶段提权（恰好一次 UAC）**：游戏与官方启动器 manifest 都要求管理员，未提权进程创建它们会得到 Win32 740。因此未提权一侧只做「查找 + 验签」，失败时不弹 UAC 就能给出结论；成功则 `runas` 重启自身，提权后的同一 exe 由 `lib.rs:26` 的 `try_run_helper()` 在 logger/Tauri 初始化**之前**截获。
- **`process::exit` 不跑析构**：helper 的完整流程必须先在一个函数内返回（RAII 析构 → 终止挂起的 `Games.exe`），再由 `lib.rs` 退出进程；若在持有父进程句柄时直接退出，那个 `Games.exe` 会永久残留。
- **不许 `FreeConsole`**：`utils::logger` 每条日志都 `eprintln!`，std 在写标准流失败时会 panic，所以只隐藏控制台窗口（release 构建本就是 windows 子系统、无控制台）。
- **签名句柄不跨提权边界**：helper 会重新验签并自己保持 `FILE_SHARE_READ` 句柄直到进程创建完成；未提权一侧的校验只是「不想让用户白弹一次 UAC」的 UX 过滤，**不要**因为「重复」而删掉 helper 里的那次。
- **有意与上游一致的两处取舍**：`WTD_REVOCATION_CHECK_NONE`（不联网、不查吊销，离线可用）与只比对组织名不比指纹。
- **状态文件**：`%LOCALAPPDATA%\cn.msk-network.endprotocol\launcher_helper_status`（路径由调用方传入），用于区分「helper 启动阶段失败」与「游戏创建成功但很快退出」——helper 退出码与游戏退出码共用同一段数值区间。
- 非 Windows 平台：`launch_via_official_parent` 返回 `unknown` 错误、`try_run_helper` 返回 `None`，模块仍可编译（CI 会构建 macOS/Linux）。

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

## 本文件发现的异常

1. **encrypt.rs 三个 pub 函数全部无调用方（死代码）**：等价实现被内联复制到 `services/skland_service.rs`（RSA skland_service.rs:107-124、AES skland_service.rs:286-322、DES 私有 `des_encrypt_3des` skland_service.rs:1191-1215），构成双份维护风险。
2. **logger.rs 无日志轮转/清理**：仅按启动日期命名 `app-YYYY-MM-DD.log`，文件句柄常驻不跨天切换，旧日志永不删除；同时文件与内存缓冲不做级别过滤（Debug 全量落盘）。
3. **logger.rs 使用 `static mut GLOBAL_LOGGER` + `unsafe` 读写**（logger.rs:216、221-232），非线程安全的现代写法（应为 `OnceLock`/`LazyLock`）；`LoggerConfig::default()` 中 `current_dir().unwrap()`（logger.rs:66）在 cwd 不可用时会 panic；私有 `format_message`（logger.rs:110）为死代码。
4. **HTTP 客户端超时策略不统一**：`http_client::create_client`（30s）仅被 3 个 service 使用，多处仍直接 `reqwest::Client::new()`（无显式超时），game_launcher_service 另建自定义 client。
5. **hg_crypto 的测试 `test_decrypt_roundtrip_key_iv` 只断言常量长度**（hg_crypto.rs:126-130），并未真正验证解密逻辑；AES key/IV 为明文硬编码（逆向常量）。
6. **`read_entries` 为全文件顺序扫描**（capture.rs:256-267），大会话下分页读取开销 O(文件行数)；单行 JSON 解析失败会被静默丢弃，可能导致 `total` 与前端可见条目不一致。
