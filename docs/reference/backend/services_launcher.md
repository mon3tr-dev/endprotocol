# GameLauncherService（启动器/下载/进程管理）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖文件：`src-tauri/src/services/game_launcher_service.rs`（共 3272 行）。
> 「进程启动/检测/杀死」「磁盘空间」「渠道特征识别」**不在本文件**，位于 `src-tauri/src/commands/launcher.rs`，下文关键流程中单独标注其行号。

**文件职责**：游戏启动器后端核心服务，负责远程版本检查、文件清单下载解密、安装/更新（并发下载 + 断点续传 + MD5 校验 + 暂存原子应用）、完整性校验与修复、预下载（preload）、渠道切换（5 阶段带回滚）、Banner/公告/背景媒体获取，并维护全局下载/切换取消标志与「活跃操作」状态。

**状态注册方式**：`lib.rs:211-212` 创建 `Arc<tokio::sync::Mutex<GameLauncherService>>` 并 `app.manage(...)` 注入 Tauri State；所有 command（`commands/launcher.rs`）以 `tauri::State<'_, Arc<Mutex<GameLauncherService>>>` 取用，并在整段操作期间持有锁（因此 command 层天然串行）。取消类接口（`cancel_download` 等）是模块级自由函数，command 直接调用，不取锁。

**主要依赖**：`reqwest::Client`（超时 30s，UA `EndProtocol/0.1.0`）；`futures_util::StreamExt`（字节流）；`tokio::sync::{Mutex, Semaphore}` + `tokio::task::JoinSet`（并发下载/校验）；`walkdir::WalkDir`（目录遍历）；`tauri::Emitter`（事件 emit）；`crate::models::game::*`（全部数据结构，定义在 `models/game.rs`）；`crate::utils::capture`（`send`/`send_stream`，网络录制包装，见 `utils/capture.rs:422/483`）；`crate::utils::hg_crypto`（AES-CBC 解密、MD5/SHA-256，见 `utils/hg_crypto.rs`）；`crate::utils::paths::app_data_dir()`（`utils/paths.rs:7`）；`uuid::Uuid`、`chrono`、`serde_json`、`tracing`。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-17 | `use` 导入（std/fs/io/path/atomic、futures_util、reqwest、tauri、tokio、walkdir、models、utils） |
| 19-36 | 模块级静态取消标志 `DOWNLOAD_CANCELLED`(L19)、`SWITCH_CANCELLED`(L20) 与 4 个自由函数 `cancel_download`/`reset_download_cancel`/`cancel_switch`/`reset_switch_cancel` |
| 39-81 | `cleanup_staging_files`：清理暂存目录与 `.download` 缓存 |
| 83-120 | `has_download_cache`：探测是否存在下载缓存 |
| 122-202 | `MultipartZipReader`：将多个 ZIP 分卷作为可随机访问的 ZIP 读取器 |
| 204-454 | `GameLauncherService` 初始化、API 版本检查与游戏状态检查 |
| 456-811 | 安装扫描、本地版本解析、清单下载/校验与更新计划（小文件按 MD5、大文件按大小） |
| 1000-1450 | 常规安装/更新、稳定暂存复用、暂存文件应用 |
| 1443-1902 | 完整性校验与修复：`verify_and_repair` |
| 1907-2158 | 预下载：`preload_download` |
| 2162-2341 | 预下载安装：`install_preload`、加密 ZIP 分卷解压、暂存文件应用 |
| 2176-2320 | 分卷/暂存辅助函数与 payload 状态持久化 |
| 2322-2505 | Web 批量代理、Banner/公告获取 |
| 2507-2743 | 公告内容与背景媒体获取 |
| 2745-3073 | 渠道切换 `switch_channel`（5 阶段 + 回滚） |
| 3351-3630 | 模块级 `async fn download_single_file`（批量下载的主力实现） |
| — | 文件内**不**包含进程启动/检测/杀死、磁盘空间、渠道 DLL 识别（见 `commands/launcher.rs`，见「关键流程」末两节） |

## 结构体与字段

### `GameLauncherService`（本文件 L204-208）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `http_client` | `reqwest::Client` | 通用 API 客户端，超时 30s，UA `EndProtocol/0.1.0` |
| `active_operation` | `Arc<Mutex<Option<ActiveOperation>>>` | 当前活跃操作快照；仅 `switch_channel` 会写入/清空（见备注·异常 4） |

### 模块级静态

| 符号 | 类型 | 含义 |
| --- | --- | --- |
| `DOWNLOAD_CANCELLED` (L19) | `AtomicBool` | 全局下载/校验取消标志，被下载流、校验任务与 `verify_md5_with_cancel` 读取 |
| `SWITCH_CANCELLED` (L20) | `AtomicBool` | 切服取消标志，仅 `switch_channel` 各阶段检查 |
| `CANCEL_CLEANUP_REQUESTED` (L22) | `AtomicBool` | 带路径取消时置位，服务在操作结束时据此删除续传暂存；安装/预下载开始时复位 |
| `INSTALL_STAGING_SUFFIX` (L25) | `&str` | 安装暂存目录固定后缀 `.staging.resume`，保证跨次续传 |
| `INSTALL_STAGING_VERSION_SUFFIX` (L27) | `&str` | 暂存版本标记后缀 `.staging.resume.version`，版本变化时丢弃旧暂存 |

### 关键 payload 结构（定义均在 `models/game.rs`，本文件只使用）

| 结构 | 关键字段 | 说明 |
| --- | --- | --- |
| `RemotePackage` (game.rs:274) | `version: String`、`resource_base_url: String`、`has_preload: bool`、`preload_version: Option<String>`、`preload_parts: Vec<PatchPart>`、`preload_total_bytes: u64`、`preload_expanded_bytes: u64` | 远程版本、资源基址及预下载分卷信息；不含解压密钥 |
| `PrePatch` / `PatchPart` (game.rs:218 / 245) | `PrePatch`：`version`、`client_version`、`package_size`、`total_size`、`patches: Vec<PatchPart>`；`PatchPart`：`url`、`md5`、`package_size`（后两者为字符串数字） | 预下载补丁包元数据（`pre_patch`）与其分卷 |
| `ManifestFile` (game.rs:266) | `path: String`、`md5: String`(32 hex)、`size: i64` | 解密后 NDJSON 清单单条 |
| `FilePlan` (game.rs:356) | `manifest: ManifestFile`、`source_path: Option<String>` | 本地已匹配则给源路径（可跳过下载） |
| `DownloadProgress` (game.rs:289) | `downloaded: u64`、`total: u64`、`stage: String`、`current_file: Option<String>`、`file_index: usize`、`file_count: usize`、`verified_bytes: u64` | 安装/校验/预下载进度 payload（`launcher-progress` 事件体） |
| `InstallStage` (game.rs:316) | `checking/comparing/downloading/verifying/repairing/applying/completed/error` | `DownloadProgress.stage` 取值 |
| `SwitchProgress` (game.rs:138) | `phase: String`、`downloaded/total: u64`、`current_file: Option<String>`、`file_index/file_count: usize`、`from_channel/to_channel: String` | 切服进度 payload；阶段包括 `checking`、`downloading`、`backing_up`、`moving`、`completed` |
| `ActiveOperation` (game.rs:112) | serde 标签 `type`：`installing`/`verifying`/`repairing` → `OperationProgress`；`switching` → `SwitchProgress` | 统一活跃操作枚举（`launcher://progress` 事件体） |
| `GameStatus` (game.rs:151) | `is_installed`、`has_update`、`local_version`、`remote_version`、`has_preload`、`preload_installable`、`preload_version`、`preload_total_bytes`、`preload_completed`、`active_operation` | `check_status` 输出；预下载可安装时将其视为更新 |
| `FileScanResult` (game.rs:478) | `channel_detected`、`detected_channel`、`total_files`、`valid_files`、`corrupted_files`、`missing_files`、`existing_bytes`、`download_bytes`、`corrupted_file_list`(≤20)、`missing_file_list`(≤20) | `scan_install_dir` 输出 |
| `PayloadState` (game.rs:363) | `channel`、`version`、`manifest_sha256`、`file_count`、`total_bytes`、`updated_at`(RFC3339)、`preload_version?`、`preload_completed` | 落盘的安装状态 JSON 内容 |
| `BannerItem` / `AnnouncementItem` / `LauncherNoticeContent` / `BackgroundMedia` (game.rs:392/399/408/469) | banner：`image_url`+`jump_url`；公告：`category`+`title`+`date`+`jump_url`；notice：`banners`+`announcements`；背景：`image_url?`+`video_url?` | 公告/背景接口输出 |

## 方法清单（必须完整）

### 模块级自由函数

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `pub fn cancel_download` | L31-33 | 无输入 → 将 `DOWNLOAD_CANCELLED` 置 true → 无返回 |
| `pub fn request_cancel_cleanup` | L35-38 | 无输入 → 置 `CANCEL_CLEANUP_REQUESTED`，表示本次取消要删除续传缓存（须在 `cancel_download` 前调用） → 无返回 |
| `pub fn reset_download_cancel` | L40-42 | 无输入 → 复位下载取消标志 → 无返回 |
| `pub fn cancel_switch` | L44-46 | 无输入 → 将 `SWITCH_CANCELLED` 置 true → 无返回 |
| `pub fn reset_switch_cancel` | L48-50 | 无输入 → 复位切服取消标志 → 无返回 |
| `pub fn cleanup_staging_files` | L39-81 | 输入 `install_path` → 删除 `{install_path}.switch.download`、父目录下 `{stem}.staging.*`/`{stem}.switch.*`/`{stem}.backup.*` 目录、安装目录内所有 `.download` 文件 → 无返回（失败忽略） |
| `pub fn has_download_cache` | L83-111 | 输入 `install_path` → 扫父目录 `{stem}.staging.*` 与安装目录内 `.download` 文件 → `bool` |
| `async fn download_single_file`（私有） | L3351-3630 | 输入共享 `Client`、`url`、`dest_path`、`expected_md5`、共享 `dl_bytes: Arc<AtomicU64>`、`file_size`、`resume` → 流式写盘 + 流式 MD5 校验；`resume` 为真时保留 `.download` 分片并按 Range 续传（含完整未重命名的补全），否则取消/失败时删除分片 |

### `impl GameLauncherService` 方法

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `MultipartZipReader::new` / `Read::read` / `Seek::seek` | L122-202 | 将多个分卷文件作为一个可随机读取的 ZIP 输入流，无需拼接生成完整归档副本 |
| `pub fn new` | L210-236 | 无输入 → 构造 30s `Client`、下载 `Client`（30s 连接超时 + 120s 读超时，不设总超时以支持大文件）与空 `active_operation` → `Self` |
| `pub async fn has_active_operation` | L223-225 | 无输入 → 读锁判断 `active_operation.is_some()` → `bool` |
| `pub async fn set_active_operation` | L227-229 | 输入 `Option<ActiveOperation>` → 覆盖写入 → 无返回 |
| `pub async fn get_active_operation` | L231-233 | 无输入 → 克隆当前活跃操作 → `Option<ActiveOperation>` |
| `pub async fn get_latest_package` | L242-250 | 输入 channel 与可选本地版本 → 请求 `get_latest_game` 并只返回公开 `RemotePackage`；解压密钥不暴露给前端 |
| `async fn get_latest_package_with_cd_key`（私有） | L252-382 | 解析远端包与可选 `pkg.cd_key`，校验资源及补丁 URL 为 HTTPS → `(RemotePackage, Option<String>)` |
| `pub async fn check_status` | L384-454 | 输入 channel + `install_path` → 获取补丁与密钥；补丁可用且密钥非空时设 `preload_installable` 并将 `has_update` 置为 true → `GameStatus` |
| `pub async fn scan_install_dir` | L456-552 | 输入 channel + `install_path` → 取远程清单并比对本地文件存在性/大小/MD5 → `FileScanResult` |
| `fn read_local_version`（私有） | L554-574 | 解密 `config.ini` 并解析版本行 → `Result<String,_>` |
| `fn versions_equal`（私有关联 fn） | L576-593 | 规范化两个版本串并按数字段比较 → `bool` |
| `pub async fn fetch_manifest` | L595-630 | GET `{resource_base_url}/game_files`，计算 SHA-256 并解密 NDJSON → `(Vec<ManifestFile>, manifest_sha256)` |
| `fn parse_manifest`（私有） | L632-683 | 解析并校验清单路径、MD5、size 与条目数 → `Vec<ManifestFile>` |
| `fn validate_path`（私有关联 fn） | L685-724 | 拒绝绝对路径、`.`/`..` 路径段及 Windows 保留名 → `Result<(),String>` |
| `async fn plan_updates`（私有） | L726-811 | 比对清单与本地文件并生成更新计划：先按「存在 + 大小一致」筛选，再对其中 ≤16MB 的文件并发计算 MD5 以识别“内容变化但大小不变”（如 `config.ini` 版本号），大文件仅按大小判断 → `Vec<FilePlan>` |
| `pub async fn install_or_update` | L1000-1421 | 常规安装/更新：输入 `max_concurrent`（下载文件并发数，1-32）与 `resume`（是否保留分片续传）；比对后只下载缺失/大小不符/小文件内容变化的文件到固定暂存区，复用上次已完成的暂存文件与未完成分片，下载即校验 MD5，直接应用变更文件并保存状态；失败/取消且开启续传时保留暂存 |
| `fn apply_staged_files`（私有） | L1429-1450 | 将安装暂存内容逐文件复制到目标目录 |
| `pub async fn verify_and_repair` | L1443-1902 | 并发检查文件并重新下载损坏文件；`resume` 控制修复下载的分片保留；返回校验结果 JSON |
| `pub async fn preload_download` | L1907-2158 | 下载 `pre_patch` 分卷到版本标记暂存目录；可复用安装流程已获取的远端包信息以避免重复请求；复用完整且 MD5 一致的分卷，否则断点续传并校验；`resume` 为真时取消后保留分卷 |
| `pub async fn install_preload` | L2162-2341 | 获取 `pkg.cd_key` 与补丁信息后立即进入分卷下载（复用同一份远端包信息，不再二次查询，透传 `resume`），随后直接解密 ZIP 并解压到暂存区，应用文件后保存 payload 状态并清理暂存；安装内不再重复校验分卷，全量校验由前端后续触发快速校验替代 |
| `fn extract_preload_archive`（私有） | L2002-2102 | 使用 `MultipartZipReader` 按 API 顺序读取分卷 ZIP，以后端 `cd_key` 解密并安全解压到暂存目录 |
| `fn apply_preload_files`（私有） | L2104-2174 | 将解压暂存文件复制到游戏安装目录 |
| `fn preload_part_file_name`（私有） | L2176-2185 | 根据分卷 URL 提取安全文件名，非法时回退到编号名 |
| `fn create_preload_staging`（私有关联 fn） | L2190-2198 | 创建版本标记的预下载暂存目录 |
| `fn preload_staging_version` / `preload_staging_dir` / `cleanup_preload_staging`（私有） | L2200-2225 | 读取版本标记、定位并清理预下载暂存目录 |
| `fn save_payload_state` / `load_payload_state` / `get_payload_state` / `save_preload_state` | L2227-2320 | 读写 `game_state/{channel}.json` 与预下载状态 |
| `async fn batch_proxy_web`（私有） | L2322-2395 | 批量代理请求并解析响应 |
| `pub async fn get_banners` / `get_announcements` | L2397-2477 | 获取 Banner 与公告 |
| `async fn batch_proxy_web_raw`（私有） | L2479-2505 | 批量代理并返回原始 `serde_json::Value` |
| `pub async fn get_notice_content` / `get_background_image` / `classify_media_type` | L2812-2970 / L3049-3108 / L3111-3123 | 公告 + Banner + 侧边栏三合一请求、背景媒体与媒体类型判定 |
| `fn parse_sidebars`（私有关联 fn） | L2992-3046 | 把 `get_sidebar_rsp` 的分组结构（`pic` + `sidebar_labels[]`）合并成扁平 `Vec<SidebarItem>`；解析失败只记日志并返回空表，不影响公告主流程 |
| `pub async fn switch_channel` | L2745-3073 | 输入 `from_channel`、`to_channel`、`install_path`、`app` → 计算清单差异、下载差异文件、备份并应用，支持取消回滚 → `Ok(to_remote.version)` / `Err` |

> 方法总数 48：模块级 7、`MultipartZipReader` 3、`GameLauncherService` impl 内 38（其中公开方法 19）。上表列出服务 API 与预下载安装相关辅助方法。`download_file_with_resume` / `download_and_verify` 仍保留在代码中，但没有任何调用方（死代码）。

## 关键流程

### 安装/更新检查（L242-630）
- `get_latest_package_with_cd_key` L252-382：POST `get_latest_game`（请求体 `seq` + `proxy_reqs[{kind, get_latest_game_req{appcode, launcher_appcode, channel, sub_channel, version:<本地版本或 "">}}]`）→ 解析 `pkg.file_path`、`pre_patch` 与可选 `pkg.cd_key`；资源和补丁 URL 强制 HTTPS。公开 `get_latest_package` 只返回 `RemotePackage`，密钥仅留在后端。
  - **`version` 必须填本地版本**：官方接口只在上报本地版本时才返回 `pre_patch`（带 `""` 时返回 `pre_patch: null`，并把 `pkg.packs` 填成完整安装包分卷列表）。
- `check_status` L384-454：`is_installed = 存在 {install}/Endfield.exe 且存在 {install}/config.ini`；`preload_installable = 有预下载补丁且 cd_key 非空`，此时 `has_update=true`；完成状态仍按 `game_state/{channel}.json` 中的预下载版本匹配。
- `scan_install_dir` L456-552：取远程清单并统计缺失、大小不符、MD5 不符与字节数。
- `versions_equal` L576-593：规范化版本串并按数字段比较。

### 清单下载与解析（L595-724）
- 获取 `{resource_base_url}/game_files` 后计算密文 SHA-256，再 AES-256-CBC 解密并解析 NDJSON。
- 校验路径安全、MD5、文件大小、重复路径与条目数上限。

### 下载（L3351-3630）
- 批量下载统一使用模块级 `download_single_file`，参数包含共享 `reqwest::Client`、并发数由调用方信号量控制、`resume` 控制分片保留；支持取消、重试、断点续传和 MD5 校验。
- 磁盘写入使用 1MB `BufWriter`，MD5 使用 `hg_crypto::verify_md5` 流式读取（4MB 缓冲），不再 `fs::read` 整个文件。
- 续传策略：存在 `{dest}.download` 时按文件长度发起 `Range`；服务端忽略 Range 则从头写；中断重试从磁盘实际长度继续；若分片已等于目标大小则校验后直接改名，避免重下。
- 取消/失败时 `resume = true` 保留分片，`resume = false` 删除分片。

### 完整安装/更新（L1000-1450）
- `plan_updates` 生成 `FilePlan`：先按「是否存在 + 大小是否一致」筛选，再对其中 ≤16MB 的文件并发计算 MD5 以识别「内容变化但大小不变」的文件（典型如 `config.ini` 的版本号——若不更新会永远提示可更新）；大文件仅按大小判断（游戏大资源多为内容寻址，内容变化会改变文件名或大小）。由此避免对数 10GB 本地文件做全量哈希。
- `install_or_update` 使用固定暂存目录 `{install_path}.staging.resume`，并写入 `{install_path}.staging.resume.version` 标记：仅当版本一致时复用，否则清理重建。
- 下载前先复用暂存区中已完成文件（小文件复验 MD5，大文件信任下载时的校验）和预下载文件，并把未完成 `.download` 分片长度计入初始进度；随后按 `max_concurrent` 并发下载剩余文件。
- 全部成功后才应用暂存文件；失败/取消且 `resume` 为真时保留暂存与分片，下次继续；成功或关闭续传时清空暂存与标记。若用户取消时选择了删除，`CANCEL_CLEANUP_REQUESTED` 保证最终清理。
- 安装阶段不做二次全量校验；完整性兜底由安装完成后前端触发的快速校验（仅查缺失/大小）负责。下载进度通过 `launcher-progress` 发出。

### 校验与修复（L1443-1902）
- 扫描安装清单中的缺失、大小不符及 MD5 不符文件，并并发下载修复；`quick=false` 时执行完整 MD5 校验。
- 修复下载同样使用 `download_single_file`，`resume` 决定取消后是否保留 `.download` 分片。

### 预下载与安装（L1907-2341）
`preload_download` L1907-2158：读取本地版本、获取或复用已获取的 `pre_patch` 分卷信息，立即发出下载进度并准备可复用的版本暂存目录，并发下载且逐卷校验 MD5；失败时保留可续传分卷，成功后标记预下载完成；取消时若 `resume` 为真则保留分卷暂存，若取消要求删除或关闭续传则清理。
阶段取值：进行中一律 `stage = "preloading"`（`InstallStage::Preloading`），终态为 `completed`（成功/已是最新）或 `error`（失败/取消）；前端按 `stage === "preloading"` 把进度画在预下载按钮上，收到其它 stage 即视为预下载结束。
下载内容为官方预发布补丁分卷（`.zip.001`…，WinZip AES 加密）。当 `pkg.cd_key` 可用时，`check_status` 将其标记为可安装更新；`install_preload` 会复用或下载分卷（下载/复用时已由 `download_single_file` 逐卷校验 MD5）、使用后端密钥解压并直接应用补丁，然后保存 payload 状态并清理暂存。安装流程不将 `cd_key` 返回前端；安装阶段不再重复校验分卷、也不做全量 MD5 扫描，安装完成后由前端执行快速校验（仅检查缺失/大小异常文件并按需修复）。
安装步骤：取最新包与解压密钥 → 确认预下载版本和分卷可用 → 将已取到的包信息传给 `preload_download`（不重复请求 API，透传 `max_concurrent` 与 `resume`；已有完整分卷会复用，否则立即下载）→ 直接解密解压到暂存目录 → 应用暂存文件 → 拉取安装后清单并保存 payload 状态 → 清理暂存目录 → 前端执行快速校验。安装失败时保留分卷暂存以便重试。
目录定位/清理见 L2200-2225；版本标记文件与建目录见 L2176-2198。

### 公告与侧边栏（L2812-3046）
- `get_notice_content` 一次 `batch_proxy_web_raw` 请求带上三项 `proxy_reqs`：`get_banner`、`get_announcement`、`get_sidebar`（B 服复用官服参数），分别解析为 `banners` / `announcements` / `sidebars`。
- `parse_sidebars` 负责抹平官方数据的两种形态：社媒条目把二维码放在 `pic.url`、地址放在 `jump_url`；`CS` 这类条目 `pic` 为 null，文案与地址只在 `sidebar_labels[0]`。合并规则是「条目自身优先、缺失回退第一条 label」，输出扁平 `SidebarItem`。`SklandTool`（`DisplayType_GRID`，6 条森空岛工具链接）原样透传，由前端决定不展示。

### 渠道检测与切换
`switch_channel` 依次比较两渠道清单、下载差异文件、备份并移除旧渠道文件、应用新渠道文件、清理暂存；切换期间检查取消标志并尝试回滚。

### 游戏进程与磁盘辅助（位于 `commands/launcher.rs`）
启动/检测/终止游戏、检测渠道、检查可执行文件和查询磁盘空间由对应 launcher command 处理，不属于本服务。

### 远程接口
- `POST https://launcher.hypergryph.com/api/proxy/batch_proxy` / Gryphline 对应端点：请求 `get_latest_game`，读取 `pkg.file_path`、`pre_patch` 和可选 `pkg.cd_key`。
- `POST https://launcher.hypergryph.com/api/proxy/web/batch_proxy` / Gryphline 对应端点：获取 Banner、公告、右侧栏（`get_sidebar`）与背景信息。
- `GET {resource_base_url}/game_files`：获取加密清单；`GET {resource_base_url}/{manifest.path}`：下载安装/修复文件。
- `GET {patch.url}`：下载预下载补丁分卷。预下载包只有在 `pkg.cd_key` 非空时才可安装；密钥只在后端使用，不序列化给前端。
- 要取到 `pre_patch`，`get_latest_game` 请求必须携带本地版本；没有本地分卷时，安装流程会下载同一组 `pre_patch.patches[]`，之后仍按相同的分卷校验、解密和安装步骤处理。

### 本地路径与持久化
- 安装暂存：`{install_path}.staging.resume`（固定目录，跨次续传），版本标记 `{install_path}.staging.resume.version`；预下载暂存：`{install_path}.staging.preload.{uuid}`，含 `.preload_version` 标记、补丁分卷和解压临时目录。
- Payload 状态：`%LOCALAPPDATA%\cn.msk-network.endprotocol\game_state\{channel}.json`，由 `save_payload_state` / `save_preload_state` 更新。
- 普通下载临时文件为 `{dest}.download`；取消与清理由 launcher command 和服务模块级清理函数处理。续传开启时取消会保留该文件，下次按 Range 继续。
- 本服务不读写 `app_config.json`；前端设置保存在 `launcher_install_path`、`launcher_channel`、`launcher_verify_threads`、`launcher_download_threads`（默认 8）、`launcher_download_resume`（默认 true）等 localStorage 键中。

### 进度事件
- 服务内渠道切换发出 `launcher://switch-progress`（`SwitchProgress`）和 `launcher://progress`（`ActiveOperation`）。
- 安装、校验、预下载通过回调由 command 发出 `launcher-progress`（`DownloadProgress`）；前端监听封装在 `src/utils/launcherService.ts`。

### 关联 launcher commands
- 调用本服务：`launcher_check_status`、`launcher_install_or_update`、`launcher_verify_and_repair`、`launcher_get_remote_version`、`launcher_preload_download`、`launcher_install_preload`、`launcher_get_payload_state`、`launcher_get_banners`、`launcher_get_announcements`、`launcher_get_notice_content`、`launcher_get_background_image`、`launcher_scan_install_dir`、`launcher_switch_channel`。
- 直接使用模块级下载/切换控制函数：`launcher_cancel_download`、`launcher_has_download_cache`、`launcher_reset_download_cancel`、`launcher_cancel_switch`、`launcher_cancel_all`。
