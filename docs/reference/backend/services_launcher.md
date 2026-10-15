# GameLauncherService（启动器/下载/进程管理）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖文件：`src-tauri/src/services/game_launcher_service.rs`（共 3533 行）。
> 「进程启动/检测/杀死」「磁盘空间」「渠道特征识别」**不在本文件**，位于 `src-tauri/src/commands/launcher.rs`，下文关键流程中单独标注其行号。

**文件职责**：游戏启动器后端核心服务，负责远程版本检查、文件清单下载解密、安装/更新（并发下载 + 断点续传 + MD5 校验 + 暂存原子应用）、完整性校验与修复、预下载（preload）、渠道切换（5 阶段带回滚）、Banner/公告/背景媒体获取，并维护全局下载/切换取消标志与「活跃操作」状态。

**状态注册方式**：`lib.rs:211-212` 创建 `Arc<tokio::sync::Mutex<GameLauncherService>>` 并 `app.manage(...)` 注入 Tauri State；所有 command（`commands/launcher.rs`）以 `tauri::State<'_, Arc<Mutex<GameLauncherService>>>` 取用，并在整段操作期间持有锁（因此 command 层天然串行）。取消类接口（`cancel_download` 等）是模块级自由函数，command 直接调用，不取锁。

**主要依赖**：`reqwest::Client`（双实例：30s 通用 / 1800s 下载，UA `EndProtocol/0.1.0`）；`futures_util::StreamExt`（字节流）；`tokio::sync::{Mutex, Semaphore}` + `tokio::task::JoinSet`（并发下载/校验）；`walkdir::WalkDir`（目录遍历）；`tauri::Emitter`（事件 emit）；`crate::models::game::*`（全部数据结构，定义在 `models/game.rs`）；`crate::utils::capture`（`send`/`send_stream`，网络录制包装，见 `utils/capture.rs:422/483`）；`crate::utils::hg_crypto`（AES-CBC 解密、MD5/SHA-256，见 `utils/hg_crypto.rs`）；`crate::utils::paths::app_data_dir()`（`utils/paths.rs:7`）；`uuid::Uuid`、`chrono`、`serde_json`、`tracing`。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-15 | `use` 导入（std/fs/io/path/atomic、futures_util、reqwest、tauri、tokio、walkdir、models、utils） |
| 17-35 | 模块级静态取消标志 `DOWNLOAD_CANCELLED`(L18)、`SWITCH_CANCELLED`(L19) 与 4 个自由函数 `cancel_download`/`reset_download_cancel`/`cancel_switch`/`reset_switch_cancel` |
| 37-79 | `cleanup_staging_files`：清理暂存目录与 `.download` 缓存 |
| 81-111 | `has_download_cache`：探测是否存在下载缓存 |
| 112-209 | `MultipartZipReader`：将多个 ZIP 分卷作为可随机访问的 ZIP 读取器 |
| 211-465 | `GameLauncherService` 初始化、API 版本检查与游戏状态检查 |
| 466-768 | 安装扫描、本地版本解析、清单下载/校验与更新计划 |
| 769-1341 | 单文件断点下载、常规安装/更新及暂存文件应用 |
| 1342-1800 | 完整性校验与修复：`verify_and_repair` |
| 1802-2036 | 预下载：`preload_download` 与分卷暂存管理 |
| 2038-2430 | 预下载安装：`install_preload`、加密 ZIP 分卷解压、暂存文件应用与结果校验 |
| 2432-2577 | 分卷/暂存辅助函数与 payload 状态持久化 |
| 2579-3005 | Web 批量代理、Banner/公告/背景媒体获取 |
| 3006-3335 | 渠道切换 `switch_channel`（5 阶段 + 回滚） |
| 3336-3533 | 模块级 `async fn download_single_file`（批量下载的主力实现） |
| — | 文件内**不**包含进程启动/检测/杀死、磁盘空间、渠道 DLL 识别（见 `commands/launcher.rs`，见「关键流程」末两节） |

## 结构体与字段

### `GameLauncherService`（本文件 L211-214）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `http_client` | `reqwest::Client` | 通用 API 客户端，超时 30s，UA `EndProtocol/0.1.0` |
| `download_client` | `reqwest::Client` | 下载客户端，超时 1800s（30 分钟） |
| `active_operation` | `Arc<Mutex<Option<ActiveOperation>>>` | 当前活跃操作快照；仅 `switch_channel` 会写入/清空（见备注·异常 4） |

### 模块级静态

| 符号 | 类型 | 含义 |
| --- | --- | --- |
| `DOWNLOAD_CANCELLED` (L18) | `AtomicBool` | 全局下载/校验取消标志，被下载流、校验任务与 `verify_md5_with_cancel` 读取 |
| `SWITCH_CANCELLED` (L19) | `AtomicBool` | 切服取消标志，仅 `switch_channel` 各阶段检查 |

### 关键 payload 结构（定义均在 `models/game.rs`，本文件只使用）

| 结构 | 关键字段 | 说明 |
| --- | --- | --- |
| `RemotePackage` (game.rs:274) | `version: String`、`resource_base_url: String`、`has_preload: bool`、`preload_version: Option<String>`、`preload_parts: Vec<PatchPart>`、`preload_total_bytes: u64`、`preload_expanded_bytes: u64` | 远程版本、资源基址及预下载分卷信息；不含解压密钥 |
| `PrePatch` / `PatchPart` (game.rs:218 / 245) | `PrePatch`：`version`、`client_version`、`package_size`、`total_size`、`patches: Vec<PatchPart>`；`PatchPart`：`url`、`md5`、`package_size`（后两者为字符串数字） | 预下载补丁包元数据（`pre_patch`）与其分卷 |
| `ManifestFile` (game.rs:266) | `path: String`、`md5: String`(32 hex)、`size: i64` | 解密后 NDJSON 清单单条 |
| `FilePlan` (game.rs:356) | `manifest: ManifestFile`、`source_path: Option<String>` | 本地已匹配则给源路径（可跳过下载） |
| `DownloadProgress` (game.rs:289) | `downloaded: u64`、`total: u64`、`stage: String`、`current_file: Option<String>`、`file_index: usize`、`file_count: usize`、`verified_bytes: u64` | 安装/校验/预下载进度 payload（`launcher-progress` 事件体） |
| `InstallStage` (game.rs:316) | `checking/comparing/downloading/verifying/repairing/applying/completed/error` | `DownloadProgress.stage` 取值 |
| `SwitchProgress` (game.rs:147) | `phase: String`、`downloaded/total: u64`、`current_file: Option<String>`、`file_index/file_count: usize`、`from_channel/to_channel: String` | 切服进度 payload；阶段包括 `checking`、`downloading`、`backing_up`、`moving`、`completed` |
| `ActiveOperation` (game.rs:121) | serde 标签 `type`：`installing`/`verifying`/`repairing` → `OperationProgress`；`switching` → `SwitchProgress` | 统一活跃操作枚举（`launcher://progress` 事件体） |
| `GameStatus` (game.rs:160) | `is_installed`、`has_update`、`local_version`、`remote_version`、`has_preload`、`preload_installable`、`preload_version`、`preload_total_bytes`、`preload_completed`、`active_operation` | `check_status` 输出；预下载可安装时将其视为更新 |
| `FileScanResult` (game.rs:484) | `channel_detected`、`detected_channel`、`total_files`、`valid_files`、`corrupted_files`、`missing_files`、`existing_bytes`、`download_bytes`、`corrupted_file_list`(≤20)、`missing_file_list`(≤20) | `scan_install_dir` 输出 |
| `PayloadState` (game.rs:363) | `channel`、`version`、`manifest_sha256`、`file_count`、`total_bytes`、`updated_at`(RFC3339)、`preload_version?`、`preload_completed` | 落盘的安装状态 JSON 内容 |
| `BannerItem` / `AnnouncementItem` / `LauncherNoticeContent` / `BackgroundMedia` (game.rs:392/399/408/475) | banner：`image_url`+`jump_url`；公告：`category`+`title`+`date`+`jump_url`；notice：`banners`+`announcements`；背景：`image_url?`+`video_url?` | 公告/背景接口输出 |

## 方法清单（必须完整）

### 模块级自由函数

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `pub fn cancel_download` | L21-23 | 无输入 → 将 `DOWNLOAD_CANCELLED` 置 true → 无返回 |
| `pub fn reset_download_cancel` | L25-27 | 无输入 → 复位下载取消标志 → 无返回 |
| `pub fn cancel_switch` | L29-31 | 无输入 → 将 `SWITCH_CANCELLED` 置 true → 无返回 |
| `pub fn reset_switch_cancel` | L33-35 | 无输入 → 复位切服取消标志 → 无返回 |
| `pub fn cleanup_staging_files` | L38-79 | 输入 `install_path` → 删除 `{install_path}.switch.download`、父目录下 `{stem}.staging.*`/`{stem}.switch.*`/`{stem}.backup.*` 目录、安装目录内所有 `.download` 文件 → 无返回（失败忽略） |
| `pub fn has_download_cache` | L82-111 | 输入 `install_path` → 扫父目录 `{stem}.staging.*` 与安装目录内 `.download` 文件 → `bool` |
| `async fn download_single_file`（私有） | L3336-3533 | 输入 `url`、`dest_path`、`expected_md5`、共享 `dl_bytes: Arc<AtomicU64>`、`file_size` → 断点续传、重试并校验 MD5 |

### `impl GameLauncherService` 方法

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `MultipartZipReader::new` / `Read::read` / `Seek::seek` | L122-209 | 将多个分卷文件作为一个可随机读取的 ZIP 输入流，无需拼接生成完整归档副本 |
| `pub fn new` | L211-229 | 无输入 → 构造 30s/1800s 两个 `Client` 与空 `active_operation` → `Self` |
| `pub async fn has_active_operation` | L231-233 | 无输入 → 读锁判断 `active_operation.is_some()` → `bool` |
| `pub async fn set_active_operation` | L235-237 | 输入 `Option<ActiveOperation>` → 覆盖写入 → 无返回 |
| `pub async fn get_active_operation` | L239-241 | 无输入 → 克隆当前活跃操作 → `Option<ActiveOperation>` |
| `pub async fn get_latest_package` | L250-258 | 输入 channel 与可选本地版本 → 请求 `get_latest_game` 并只返回公开 `RemotePackage`；解压密钥不暴露给前端 |
| `async fn get_latest_package_with_cd_key`（私有） | L260-392 | 解析远端包与可选 `pkg.cd_key`，校验资源及补丁 URL 为 HTTPS → `(RemotePackage, Option<String>)` |
| `pub async fn check_status` | L394-464 | 输入 channel + `install_path` → 获取补丁与密钥；补丁可用且密钥非空时设 `preload_installable` 并将 `has_update` 置为 true → `GameStatus` |
| `pub async fn scan_install_dir` | L466-562 | 输入 channel + `install_path` → 取远程清单并比对本地文件存在性/大小/MD5 → `FileScanResult` |
| `fn read_local_version`（私有） | L564-584 | 解密 `config.ini` 并解析版本行 → `Result<String,_>` |
| `fn versions_equal`（私有关联 fn） | L586-603 | 规范化两个版本串并按数字段比较 → `bool` |
| `pub async fn fetch_manifest` | L605-640 | GET `{resource_base_url}/game_files`，计算 SHA-256 并解密 NDJSON → `(Vec<ManifestFile>, manifest_sha256)` |
| `fn parse_manifest`（私有） | L642-693 | 解析并校验清单路径、MD5、size 与条目数 → `Vec<ManifestFile>` |
| `fn validate_path`（私有关联 fn） | L695-728 | 拒绝绝对路径、`.`/`..` 路径段及 Windows 保留名 → `Result<(),String>` |
| `pub fn plan_updates` | L730-768 | 比对清单与本地文件并生成更新计划 → `Vec<FilePlan>` |
| `pub async fn download_file_with_resume` | L769-901 | 输入 URL、目标路径与回调 → 断点续传、重试并在完成后改名 → `Result<(),String>` |
| `pub async fn download_and_verify` | L902-930 | 下载后校验 MD5，不符则删除并报错 → `Result<(),String>` |
| `pub async fn install_or_update` | L931-1316 | 常规安装/更新：复制现有文件到暂存、下载缺失文件、校验并应用，然后保存状态 |
| `fn apply_staged_files`（私有） | L1317-1341 | 将安装暂存内容逐文件复制到目标目录 |
| `pub async fn verify_and_repair` | L1342-1801 | 并发检查文件并重新下载损坏文件；返回校验结果 JSON |
| `pub async fn preload_download` | L1802-2036 | 下载 `pre_patch` 分卷到版本标记暂存目录；复用完整且 MD5 一致的分卷，否则断点续传并校验。供单独预下载和安装流程调用 |
| `pub async fn install_preload` | L2038-2233 | 获取 `pkg.cd_key`，复用或下载并复验全部分卷 MD5，解密 ZIP 并解压到暂存区，应用文件后执行完整性检测/修复；成功后保存 payload 状态并清理暂存 |
| `fn extract_preload_archive`（私有） | L2235-2335 | 使用 `MultipartZipReader` 按 API 顺序读取分卷 ZIP，以后端 `cd_key` 解密并安全解压到暂存目录 |
| `fn apply_preload_files`（私有） | L2337-2406 | 将解压暂存文件复制到游戏安装目录 |
| `fn ensure_verification_succeeded`（私有） | L2408-2430 | 校验完整性结果；存在未修复文件时返回错误 |
| `fn preload_part_file_name`（私有） | L2432-2444 | 根据分卷 URL 提取安全文件名，非法时回退到编号名 |
| `fn create_preload_staging`（私有关联 fn） | L2446-2454 | 创建版本标记的预下载暂存目录 |
| `fn preload_staging_version` / `preload_staging_dir` / `cleanup_preload_staging`（私有） | L2456-2482 | 读取版本标记、定位并清理预下载暂存目录 |
| `fn save_payload_state` / `load_payload_state` / `get_payload_state` / `save_preload_state` | L2484-2577 | 读写 `game_state/{channel}.json` 与预下载状态 |
| `async fn batch_proxy_web`（私有） | L2579-2654 | 批量代理请求并解析响应 |
| `pub async fn get_banners` / `get_announcements` | L2656-2736 | 获取 Banner 与公告 |
| `async fn batch_proxy_web_raw`（私有） | L2738-2766 | 批量代理并返回原始 `serde_json::Value` |
| `pub async fn get_notice_content` / `get_background_image` / `classify_media_type` | L2768-3004 | 获取公告内容与背景媒体 |
| `pub async fn switch_channel` | L3006-3335 | 输入 `from_channel`、`to_channel`、`install_path`、`app` → 计算清单差异、下载差异文件、备份并应用，支持取消回滚 → `Ok(to_remote.version)` / `Err` |

> 方法总数 51：模块级 7、`MultipartZipReader` 3、`GameLauncherService` impl 内 41（其中公开方法 21）。上表列出服务 API 与预下载安装相关辅助方法。

## 关键流程

### 安装/更新检查（L250-603）
- `get_latest_package_with_cd_key` L260-392：POST `get_latest_game`（请求体 `seq` + `proxy_reqs[{kind, get_latest_game_req{appcode, launcher_appcode, channel, sub_channel, version:<本地版本或 "">}}]`）→ 解析 `pkg.file_path`、`pre_patch` 与可选 `pkg.cd_key`；资源和补丁 URL 强制 HTTPS。公开 `get_latest_package` 只返回 `RemotePackage`，密钥仅留在后端。
  - **`version` 必须填本地版本**：官方接口只在上报本地版本时才返回 `pre_patch`（带 `""` 时返回 `pre_patch: null`，并把 `pkg.packs` 填成完整安装包分卷列表）。
- `check_status` L394-464：`is_installed = 存在 {install}/Endfield.exe 且存在 {install}/config.ini`；`preload_installable = 有预下载补丁且 cd_key 非空`，此时 `has_update=true`；完成状态仍按 `game_state/{channel}.json` 中的预下载版本匹配。
- `scan_install_dir` L466-562：取远程清单并统计缺失、大小不符、MD5 不符与字节数。
- `versions_equal` L586-603：规范化版本串并按数字段比较。

### 清单下载与解析（L605-728）
- 获取 `{resource_base_url}/game_files` 后计算密文 SHA-256，再 AES-256-CBC 解密并解析 NDJSON。
- 校验路径安全、MD5、文件大小、重复路径与条目数上限。

### 下载与断点续传（L769-930、L3336-3533）
- `download_file_with_resume` 提供可回调的断点续传；批量下载使用 `download_single_file`，支持取消、重试和 MD5 校验。

### 完整安装/更新（L931-1341）
- 复制现有文件到暂存目录，下载缺失文件，校验后应用并保存安装状态；下载/校验进度通过 `launcher-progress` 发出。

### 校验与修复（L1342-1801）
- 扫描安装清单中的缺失、大小不符及 MD5 不符文件，并并发下载修复；`quick=false` 时执行完整 MD5 校验。

### 预下载与安装（L1802-2430）
`preload_download` L1802-2036：读取本地版本、获取 `pre_patch` 分卷，准备可复用的版本暂存目录，并发下载且逐卷校验 MD5；失败时保留可续传分卷，成功后标记预下载完成。
阶段取值：进行中一律 `stage = "preloading"`（`InstallStage::Preloading`），终态为 `completed`（成功/已是最新）或 `error`（失败/取消）；前端按 `stage === "preloading"` 把进度画在预下载按钮上，收到其它 stage 即视为预下载结束。
下载内容为官方预发布补丁分卷（`.zip.001`…，WinZip AES 加密）。当 `pkg.cd_key` 可用时，`check_status` 将其标记为可安装更新；`install_preload` 会复用或下载分卷、重新校验 MD5、使用后端密钥解压并应用补丁，最后执行完整性校验与修复。安装流程不将 `cd_key` 返回前端。
安装步骤：取最新包与解压密钥 → 确认预下载版本和分卷可用 → 调 `preload_download`（已有完整分卷会复用，否则下载）→ 在阻塞任务中复验分卷 MD5 并解密解压到暂存目录 → 应用暂存文件 → `verify_and_repair(..., quick=false)` 并确认无未修复文件 → 拉取安装后清单并保存 payload 状态 → 清理暂存目录。安装失败时保留分卷暂存以便重试。
目录定位/清理见 L2463-2482；版本标记文件与建目录见 L2432-2454。

### 渠道检测与切换
`switch_channel` 依次比较两渠道清单、下载差异文件、备份并移除旧渠道文件、应用新渠道文件、清理暂存；切换期间检查取消标志并尝试回滚。

### 游戏进程与磁盘辅助（位于 `commands/launcher.rs`）
启动/检测/终止游戏、检测渠道、检查可执行文件和查询磁盘空间由对应 launcher command 处理，不属于本服务。

### 远程接口
- `POST https://launcher.hypergryph.com/api/proxy/batch_proxy` / Gryphline 对应端点：请求 `get_latest_game`，读取 `pkg.file_path`、`pre_patch` 和可选 `pkg.cd_key`。
- `POST https://launcher.hypergryph.com/api/proxy/web/batch_proxy` / Gryphline 对应端点：获取 Banner、公告与背景信息。
- `GET {resource_base_url}/game_files`：获取加密清单；`GET {resource_base_url}/{manifest.path}`：下载安装/修复文件。
- `GET {patch.url}`：下载预下载补丁分卷。预下载包只有在 `pkg.cd_key` 非空时才可安装；密钥只在后端使用，不序列化给前端。
- 要取到 `pre_patch`，`get_latest_game` 请求必须携带本地版本；没有本地分卷时，安装流程会下载同一组 `pre_patch.patches[]`，之后仍按相同的分卷校验、解密、安装和完整性校验步骤处理。

### 本地路径与持久化
- 安装暂存：`{install_path}.staging.{uuid}`；预下载暂存：`{install_path}.staging.preload.{uuid}`，含 `.preload_version` 标记、补丁分卷和解压临时目录。
- Payload 状态：`%LOCALAPPDATA%\cn.msk-network.endprotocol\game_state\{channel}.json`，由 `save_payload_state` / `save_preload_state` 更新。
- 普通下载临时文件为 `{dest}.download`；取消与清理由 launcher command 和服务模块级清理函数处理。
- 本服务不读写 `app_config.json`；前端设置保存在 `launcher_install_path`、`launcher_channel`、`launcher_verify_threads` 等 localStorage 键中。

### 进度事件
- 服务内渠道切换发出 `launcher://switch-progress`（`SwitchProgress`）和 `launcher://progress`（`ActiveOperation`）。
- 安装、校验、预下载通过回调由 command 发出 `launcher-progress`（`DownloadProgress`）；前端监听封装在 `src/utils/launcherService.ts`。

### 关联 launcher commands
- 调用本服务：`launcher_check_status`、`launcher_install_or_update`、`launcher_verify_and_repair`、`launcher_get_remote_version`、`launcher_preload_download`、`launcher_install_preload`、`launcher_get_payload_state`、`launcher_get_banners`、`launcher_get_announcements`、`launcher_get_notice_content`、`launcher_get_background_image`、`launcher_scan_install_dir`、`launcher_switch_channel`。
- 直接使用模块级下载/切换控制函数：`launcher_cancel_download`、`launcher_has_download_cache`、`launcher_reset_download_cancel`、`launcher_cancel_switch`、`launcher_cancel_all`。
