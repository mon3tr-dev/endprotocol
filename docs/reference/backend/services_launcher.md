# GameLauncherService（启动器/下载/进程管理）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖文件：`src-tauri/src/services/game_launcher_service.rs`（共 4328 行）。
> 「进程启动/检测/杀死」「磁盘空间」「渠道特征识别」**不在本文件**，位于 `src-tauri/src/commands/launcher.rs`，下文关键流程中单独标注其行号。

**文件职责**：游戏启动器后端核心服务，负责远程版本检查、文件清单下载解密、安装/更新（补丁包优先 + 并发下载 + 断点续传 + MD5 校验 + 暂存原子应用）、完整性校验与修复、预下载（preload）与补丁包应用、渠道切换（5 阶段带回滚）、Banner/公告/背景媒体获取，并维护全局下载/切换取消标志与「活跃操作」状态。

**状态注册方式**：`lib.rs:379` 创建 `Arc<GameLauncherService>` 并 `app.manage(...)` 注入 Tauri State；command（`commands/launcher.rs`）以 `tauri::State<'_, Arc<GameLauncherService>>` 直接取用。服务**不再被一把外层锁包住**：内部可变状态只有 `active_operation: Arc<Mutex<Option<ActiveOperation>>>`，全部方法都只需 `&self`，所以读写命令可以并发。历史上这里用 `Arc<tokio::sync::Mutex<GameLauncherService>>` 并把锁握满整段操作，于是一次几十分钟的下载会把公告、背景图、状态查询全部堵在锁上——前端刷新后启动流程的任务里正好有公告和背景图，于是卡死在「正在加载初始数据…」。需要互斥的只剩「会写安装目录」的长任务：`launcher_install_or_update` / `launcher_verify_and_repair` / `launcher_preload_download` / `launcher_install_preload` / `launcher_switch_channel` 先经 `commands/launcher.rs` 的 `acquire_write_gate(svc)` 取得 `write_gate`（容量 1 的 `Semaphore`）permit，permit 随函数结束自动释放；取消类接口（`cancel_download` 等）是模块级自由函数，command 直接调用，不取锁。

**主要依赖**：`reqwest::Client`（API 超时 30s、下载客户端连接 30s/读 120s，UA `EndProtocol/0.1.0`）；`futures_util::StreamExt`（字节流）；`tokio::sync::{Mutex, Semaphore}` + `tokio::task::JoinSet`（并发下载/校验）；`walkdir::WalkDir`（目录遍历）；`zip::ZipArchive` + 自定义 `MultipartZipReader`（多分卷 ZIP 解密解压）；`tauri::Emitter`（事件 emit）；`crate::models::game::*`（全部数据结构，定义在 `models/game.rs`）；`crate::utils::capture`（`send`/`send_stream`，网络录制包装）；`crate::utils::hg_crypto`（AES-256-CBC 解密、MD5/SHA-256）；`crate::utils::paths::app_data_dir()`；`uuid::Uuid`、`chrono`、`serde_json`、`tracing`。

## 逆向对齐说明（与官方 Hypergryph Launcher 一致的实现依据）

以下结论来自对官方 `Games.exe` / `hgdownloadsdk.dll` / `Patch.exe` 的静态逆向与本机实测，代码按此实现：

| 官方行为 | 逆向坐标 / 证据 | 本服务的对应实现 |
| --- | --- | --- |
| `cd_key` 属于 **`patch`** 对象（不在 `pkg` 里） | `Games.exe!CLibNetworkUtils::ParseLatestGameJson` @ `0x002f1e80`；线上 `get_latest_game` 响应实测 | `PatchInfo::cd_key`（`pkg.cd_key` 仅作兜底） |
| 补丁分卷是 **WinZip AES（AE-2/AES-256）加密 ZIP**，密码 = `cd_key` | 本机 `7zg.exe` + `cd_key` 解出包内全部文件且 MD5 与清单一致；错误密码失败；zip crate 复核一致 | `zip::ZipArchive::by_index_decrypt(..., cd_key.as_bytes())` |
| 官方用 `7zg.exe x -y -o"…" "<分卷>" [-p"<cd_key>"] -qtw<w> -qtfw<w>` 解压 | `Games.exe!CDecompressAssist::Start` @ `0x002b47e0`（`-p"%1"` @ `0x002b4a2f`、模板 @ `0x002b4af0`）；日志 `qep StartProcess … 7zg.exe` + `LogUnzipFinishEvent type:update_unzip` | `extract_encrypted_archive`（等价解密解压） |
| 包内 `package_files` / `delete_files.txt` / `patch.json` 是控制文件，**不落盘**；`game_files` 是正式文件 | `Games.exe!CCopyGameFile` 跳过名单 @ `0x00278dc0`、`delete_files.txt` 路径构造 @ `0x00277c50`；实测官方安装目录只有 `game_files` | `ARCHIVE_CONTROL_FILES` + `apply_extracted_files` 过滤；`game_files` 照常应用 |
| 官方按 `delete_files.txt` 删除旧文件 | 同上（拼出 `<目录>\delete_files.txt`） | `remove_deleted_files` + `parse_delete_list` |
| `package_files` 是**本包文件清单**（与 `game_files` 同格式） | 实测阿米娅安装目录那份 510,176 B / 3115 条，固定 AES 解密后为 `{"path","md5","size"}` NDJSON | `verify_archive_package_files`（只校验解压目录里存在的条目，坏包不铺） |
| 预下载产物在正式更新时被直接消费（`bUsePreDownloadZip`） | 日志 `cga QueryAllBrokenState … bUsePreDownloadZip:{}` / `ClearDownloadFilesIfNeed … bUsePreDownloadPath:{}` | `download_parts_to_staging` 按「同名 + MD5」从 `.staging.preload.*` 复用 |
| 常规更新走补丁包（下载分卷 → 解压 → 覆盖）；官方历史日志里解压事件**全部**是 `update_unzip` | 日志 `LogUnzipFinishEvent … vecFiles=[j9HZmer9RNws8Oly_1_6_4_1_6_3.zip.001]`（= `patch.patches[0]`）；`type:` 取值统计 4/4 为 `update_unzip` | `install_or_update` 优先 `install_from_archive_parts` |
| 差量包（含 hpatch `_patch` 条目）必须由 Patch.exe 结合本地 base 打补丁 | `Patch.exe!CPatchCotroller::DoPatch` @ `0x000729f0`；`patch.json` 的 `patch[]` 数组语义 | 检测到差量条目即返回 `ERR_DELTA_ARCHIVE`，回退清单逐文件下载 |
| `total_size` 是"预留空间估计"，不是解压后大小 | 实测倍率 1.66×~2.5×（补丁/整包各自不同） | 进度分母用实际解压条目之和，`total_size` 仅兜底 |

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-17 | `use` 导入（std/fs/io/path/atomic、futures_util、reqwest、tauri、tokio、walkdir、zip、models、utils） |
| 19-46 | 模块级静态取消标志 `DOWNLOAD_CANCELLED`(L19)、`SWITCH_CANCELLED`(L20)、`CANCEL_CLEANUP_REQUESTED`(L22) 与暂存/归档常量（L25/27/29/31/42/44/46） |
| 49-101 | 归档辅助：`is_archive_control_file`(L49)、`parse_delete_list`(L63) |
| 103-122 | 5 个取消标志自由函数 |
| 125-210 | `cleanup_staging_files`(L125)、`dir_has_files`(L173)、`has_download_cache`(L181) |
| 213-306 | `MultipartZipReader`：把多个 ZIP 分卷当作一个可随机访问的归档读取器 |
| 309-528 | `GameLauncherService` 初始化、版本检查（`get_latest_package` / `_with_cd_key`） |
| 530-740 | `check_status`、`scan_install_dir`、本地版本解析、版本比较 |
| 741-870 | 清单下载/解密/解析、路径安全校验 |
| 872-956 | `plan_updates`（更新计划：小文件按 MD5、大文件按大小） |
| 958-1120 | 下载原语：`download_file_with_resume`、`download_and_verify`（保留但无调用方） |
| 1122-1582 | `install_or_update`（补丁包优先 → 回退清单逐文件）与 `apply_staged_files` |
| 1584-2046 | 完整性校验与修复：`verify_and_repair` |
| 2048-2304 | 预下载：`preload_download`（只下载分卷，不解压） |
| 2306-2404 | `install_preload`（取密钥后进入归档应用） |
| 2406-2560 | `install_from_archive_parts`：分卷 → 解密解压 → 自检 → 应用 → 落状态 |
| 2562-2714 | `download_parts_to_staging`：分卷并发下载与跨暂存复用 |
| 2716-2842 | `extract_encrypted_archive`：WinZip AES 分卷解密解压 + 差量形态检测 |
| 2844-2947 | `apply_extracted_files`：控制文件过滤、原子替换 |
| 2949-2993 | `remove_deleted_files`：按 `delete_files.txt` 删除旧文件 |
| 2995-3014 | `read_archive_manifest`：优先使用包内 `game_files` |
| 3016-3066 | `verify_archive_package_files`：包内清单自检 |
| 3068-3138 | 分卷命名、预下载暂存目录的创建/定位/清理 |
| 3140-3233 | payload 状态与预下载状态的读写（`game_state/{channel}.json`） |
| 3235-3732 | Web 批量代理、Banner/公告/侧边栏/背景媒体 |
| 3734-4061 | 渠道切换 `switch_channel`（5 阶段 + 回滚） |
| 4063-4328 | 模块级 `subtract_download_progress`(L4063) 与 `download_single_file`(L4073) |
| — | 文件内**不**包含进程启动/检测/杀死、磁盘空间、渠道 DLL 识别（见 `commands/launcher.rs`） |

## 结构体与字段

### `GameLauncherService`（L309-313）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `http_client` | `reqwest::Client` | 通用 API 客户端，超时 30s，UA `EndProtocol/0.1.0` |
| `download_client` | `reqwest::Client` | 下载客户端：连接超时 30s、读超时 120s、不设总超时（支持大文件） |
| `active_operation` | `Arc<Mutex<Option<ActiveOperation>>>` | 当前活跃操作快照；仅 `switch_channel` 会写入/清空 |
| `write_gate` | `Arc<Semaphore>`（容量 1） | 只串行化「会写安装目录」的长任务：command 层 `acquire_write_gate` 取 permit 后再调用 `install_or_update` / `verify_and_repair` / `preload_download` / `install_preload` / `switch_channel`。**不再**用外层 `Mutex<GameLauncherService>` 把整个服务锁住——那会让下载堵死公告/背景图/状态查询 |

### 模块级静态与常量

| 符号 | 位置 | 含义 |
| --- | --- | --- |
| `DOWNLOAD_CANCELLED` | L19 | 全局下载/校验/归档应用取消标志 |
| `SWITCH_CANCELLED` | L20 | 切服取消标志，仅 `switch_channel` 各阶段检查 |
| `CANCEL_CLEANUP_REQUESTED` | L22 | 带路径取消时置位，服务在操作结束时据此删除续传暂存 |
| `INSTALL_STAGING_SUFFIX` | L25 | 清单安装暂存目录后缀 `.staging.resume` |
| `INSTALL_STAGING_VERSION_SUFFIX` | L27 | 暂存版本标记后缀 `.staging.resume.version` |
| `STAGED_REUSE_HASH_LIMIT` | L29 | 暂存小文件复用前重新校验 MD5 的尺寸上限（16 MB） |
| `PRELOAD_VERSION_MARKER` | L31 | 预下载暂存目录内的目标版本标记文件名 `.preload_version` |
| `ARCHIVE_CONTROL_FILES` | L42 | 包内控制文件名单：`package_files` / `delete_files.txt` / `patch.json`（不落盘） |
| `ARCHIVE_DELETE_LIST` | L44 | 包内删除清单文件名 `delete_files.txt` |
| `ERR_DELTA_ARCHIVE` | L46 | 差量包错误前缀 `DELTA_ARCHIVE:`，调用方据此回退清单路径 |

### 关键 payload 结构（定义均在 `models/game.rs`，本文件只使用）

| 结构 | 关键字段 | 说明 |
| --- | --- | --- |
| `RemotePackage` (game.rs:358) | `version`、`resource_base_url`、`has_preload`、`preload_version`、`preload_parts`、`preload_total_bytes`、`preload_expanded_bytes`、`has_patch`、`patch_parts`、`patch_total_bytes`、`has_patch_whole` | 远程版本、资源基址、补丁分卷与预下载分卷；**不含解密密钥** |
| `PatchInfo` (game.rs:244) | `cd_key`、`url`、`patches`、`v2_*` | 版本补丁包；`cd_key` 是分卷 zip 密码（仅后端持有） |
| `PrePatch` / `PatchPart` (game.rs:302 / 329) | `PrePatch`：`version`、`client_version`、`package_size`、`total_size`、`patches`；`PatchPart`：`url`、`md5`、`package_size` | 预下载补丁包与分卷条目（`pre_patch` **无密钥**） |
| `ManifestFile` (game.rs:350) | `path`、`md5`(32 hex)、`size` | 解密后 NDJSON 清单单条 |
| `FilePlan` (game.rs:452) | `manifest`、`source_path` | 本地已匹配则给源路径（可跳过下载） |
| `DownloadProgress` (game.rs:385) | `downloaded`、`total`、`stage`、`current_file`、`file_index`、`file_count`、`verified_bytes` | 安装/校验/预下载进度 payload |
| `InstallStage` (game.rs:412) | `checking/comparing/downloading/verifying/repairing/applying/preloading/completed/error` | `DownloadProgress.stage` 取值 |
| `ActiveOperation` (game.rs:112) | `type`：`installing`/`verifying`/`repairing`/`switching` | 统一活跃操作枚举 |
| `GameStatus` (game.rs:151) | `is_installed`、`has_update`、`local_version`、`remote_version`、`has_preload`、`preload_installable`、`preload_version`、`preload_total_bytes`、`preload_completed`、`active_operation` | `check_status` 输出 |
| `FileScanResult` (game.rs:640) | `channel_detected`、`total_files`、`valid_files`、`corrupted_files`、`missing_files`、`existing_bytes`、`download_bytes`、`corrupted_file_list`(≤20)、`missing_file_list`(≤20) | `scan_install_dir` 输出 |
| `PayloadState` (game.rs:459) | `channel`、`version`、`manifest_sha256`、`file_count`、`total_bytes`、`updated_at`、`preload_version?`、`preload_completed` | 落盘的安装状态 JSON |

## 方法清单（必须完整）

### 模块级自由函数

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `is_archive_control_file`（私有） | L49-61 | 输入相对路径 → 判断是否包内控制文件（仅匹配包根下的 `package_files`/`delete_files.txt`/`patch.json`） → `bool` |
| `parse_delete_list`（私有） | L63-101 | 输入文本 → 按行解析相对路径，同时兼容 JSON 数组/对象形态 → `Vec<String>` |
| `pub fn cancel_download` | L103-105 | 无输入 → 置 `DOWNLOAD_CANCELLED` → 无返回 |
| `pub fn request_cancel_cleanup` | L108-110 | 无输入 → 置 `CANCEL_CLEANUP_REQUESTED`（须在 `cancel_download` 前调用） → 无返回 |
| `pub fn reset_download_cancel` | L112-114 | 无输入 → 复位下载取消标志 → 无返回 |
| `pub fn cancel_switch` | L116-118 | 无输入 → 置 `SWITCH_CANCELLED` → 无返回 |
| `pub fn reset_switch_cancel` | L120-122 | 无输入 → 复位切服取消标志 → 无返回 |
| `pub fn cleanup_staging_files` | L125-171 | 输入 `install_path` → 删除 `{path}.switch.download`、父目录下 `{stem}.staging.*`/`{stem}.switch.*`/`{stem}.backup.*` 目录、安装目录内所有 `.download` 文件 → 无返回（失败忽略） |
| `dir_has_files`（私有） | L173-179 | 输入目录 → 递归判断是否存在文件 → `bool` |
| `pub fn has_download_cache` | L181-210 | 输入 `install_path` → 扫父目录 `{stem}.staging.*` 与安装目录内 `.download` 文件 → `bool` |
| `subtract_download_progress`（私有） | L4063-4071 | 输入进度计数与字节数 → 饱和回退（重试/服务端忽略 Range 时修正计数） → 无返回 |
| `async fn download_single_file`（私有） | L4073-4328 | 输入共享 `Client`、`url`、`dest_path`、`expected_md5`、共享 `dl_bytes`、`file_size`、`resume` → 流式写盘 + 流式 MD5 校验；`resume` 为真时保留 `.download` 分片并按 Range 续传 → `Result<(),String>` |

### `impl GameLauncherService` 方法

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `MultipartZipReader::new` / `Read::read` / `Seek::seek` | L213-306 | 将多个分卷文件作为一个可随机读取的 ZIP 输入流，无需拼接出完整归档副本 |
| `pub fn new` | L315-336 | 无输入 → 构造 API 客户端、下载客户端、空 `active_operation` 与容量 1 的 `write_gate` → `Self` |
| `pub fn write_gate` | L340-342 | 无输入 → 克隆 `Arc<Semaphore>`，供命令层串行化写安装目录的长任务 |
| `pub async fn has_active_operation` | L344-346 | 无输入 → 读锁判断 `active_operation.is_some()` → `bool` |
| `pub async fn set_active_operation` | L336-338 | 输入 `Option<ActiveOperation>` → 覆盖写入 → 无返回 |
| `pub async fn get_active_operation` | L340-342 | 无输入 → 克隆当前活跃操作 → `Option<ActiveOperation>` |
| `pub async fn get_latest_package` | L351-359 | 输入 channel 与可选本地版本 → 请求 `get_latest_game` 并只返回公开 `RemotePackage`（密钥不暴露给前端） |
| `async fn get_latest_package_with_cd_key`（私有） | L361-528 | 解析远端包、`patch`（分卷/整包/V2 字段）与 `pre_patch`，校验 URL 为 HTTPS → `(RemotePackage, Option<String>)`；**密钥取 `patch.cd_key`，`pkg.cd_key` 仅兜底** |
| `pub async fn check_status` | L530-600 | 输入 channel + `install_path` → 获取补丁与密钥；`preload_installable = has_preload && cd_key 非空`，可安装时把 `has_update` 置真 → `GameStatus` |
| `pub async fn scan_install_dir` | L602-698 | 输入 channel + `install_path` → 取远程清单并比对本地文件存在性/大小/MD5 → `FileScanResult` |
| `fn read_local_version`（私有） | L700-720 | 解密 `config.ini` 并解析版本行 → `Result<String,_>` |
| `fn versions_equal`（私有关联 fn） | L722-739 | 规范化两个版本串并按数字段比较 → `bool` |
| `pub async fn fetch_manifest` | L741-776 | GET `{resource_base_url}/game_files`，计算 SHA-256 并解密 NDJSON → `(Vec<ManifestFile>, manifest_sha256)` |
| `fn parse_manifest`（私有关联 fn） | L778-829 | 解析并校验清单路径、MD5、size 与条目数 → `Vec<ManifestFile>` |
| `fn validate_path`（私有关联 fn） | L831-870 | 拒绝绝对路径、`.`/`..` 路径段及 Windows 保留名 → `Result<(),String>` |
| `async fn plan_updates`（私有） | L872-956 | 比对清单与本地文件并生成更新计划：先按「存在 + 大小一致」筛选，再对其中 ≤16MB 的文件并发计算 MD5，大文件仅按大小判断 → `Vec<FilePlan>` |
| `pub async fn install_or_update` | L1122-1557 | 常规安装/更新：**先试补丁包**（差量包拒绝后回退），否则清单比对逐文件下载；输入 `max_concurrent`、`resume` |
| `fn apply_staged_files`（私有） | L1559-1582 | 将清单暂存内容逐文件复制到目标目录 |
| `pub async fn verify_and_repair` | L1584-2046 | 并发检查文件并重新下载损坏文件；`resume` 控制修复下载的分片保留；返回校验结果 JSON |
| `pub async fn preload_download` | L2048-2304 | 只下载 `pre_patch` 分卷到版本标记暂存目录并逐卷校验 MD5（**不解压、不应用**，与官方预下载阶段一致） |
| `pub async fn install_preload` | L2306-2404 | 取 `patch.cd_key` 后进入归档应用；`pre_patch` 缺失时退回 `patch` 分卷（正式发版后的兜底） |
| `async fn install_from_archive_parts`（私有） | L2406-2560 | **核心链路**：分卷下载（含预下载复用）→ 解密解压 → 包内清单自检 → 控制文件过滤/delete 清单/原子替换 → 落状态 → 清理暂存 |
| `async fn download_parts_to_staging`（私有） | L2562-2714 | 分卷并发下载；已存在且 MD5 一致跳过；可按「同名 + MD5」从 `.staging.preload.*` 直接搬用 |
| `fn extract_encrypted_archive`（私有关联 fn） | L2716-2842 | 用 `MultipartZipReader` + `cd_key` 解密解压分卷 ZIP；**发现 hpatch `_patch`/`vfs_files/vfs_patch` 条目即返回 `ERR_DELTA_ARCHIVE`** |
| `fn apply_extracted_files`（私有） | L2844-2947 | 应用解压产物：跳过控制文件、`<目标>.hgtmp` 原子替换、校验写入长度 |
| `fn remove_deleted_files`（私有） | L2949-2993 | 读取 `delete_files.txt`（先试固定 AES 解密、再按明文）→ 删除安装目录中的对应文件 |
| `fn read_archive_manifest`（私有关联 fn） | L2995-3014 | 读取包内 `game_files` 并解密解析为新版清单 → `Option<(Vec<ManifestFile>, String)>` |
| `fn verify_archive_package_files`（私有关联 fn） | L3016-3066 | 读取包内 `package_files`（加密 NDJSON）→ 对解压目录里存在的条目逐条校验 MD5，坏包返回 `Err` → `Result<usize,String>`（返回校验条目数） |
| `fn preload_part_file_name`（私有） | L3068-3079 | 根据分卷 URL 提取安全文件名，非法时回退到编号名 |
| `fn create_preload_staging`（私有关联 fn） | L3081-3089 | 创建版本标记的预下载暂存目录 |
| `fn preload_staging_version`（私有关联 fn） | L3091-3095 | 读取预下载暂存目录记录的目标版本 |
| `fn preload_staging_dir` / `preload_staging_dirs` / `cleanup_preload_staging`（私有） | L3097-3138 | 定位（单个/全部，按修改时间新到旧）与清理预下载暂存目录 |
| `fn save_payload_state` / `load_payload_state` / `get_payload_state` / `save_preload_state` | L3140-3233 | 读写 `game_state/{channel}.json` 与预下载状态 |
| `async fn batch_proxy_web`（私有） | L3235-3308 | 批量代理请求并解析响应（含公告结构调试输出） |
| `pub async fn get_banners` / `get_announcements` | L3310-3390 | 获取 Banner 与公告 |
| `async fn batch_proxy_web_raw`（私有） | L3392-3418 | 批量代理并返回原始 `serde_json::Value` |
| `pub async fn get_notice_content` / `get_background_image` / `classify_media_type` | L3420-3732 | 公告 + Banner + 侧边栏三合一请求、背景媒体与媒体类型判定 |
| `fn parse_sidebars`（私有关联 fn） | L3600-3655 | 把 `get_sidebar_rsp` 的分组结构合并成扁平 `Vec<SidebarItem>`；解析失败只记日志并返回空表 |
| `pub async fn switch_channel` | L3734-4061 | 输入 `from_channel`、`to_channel`、`install_path`、`app` → 计算清单差异、下载差异文件、备份并应用，支持取消回滚 → `Ok(to_remote.version)` / `Err` |

> 方法总数 56：模块级 12（含 2 个归档辅助）、`MultipartZipReader` 3、`GameLauncherService` impl 内 41（其中公开方法 19）。`download_file_with_resume` / `download_and_verify` 仍保留在代码中，但没有任何调用方（死代码）。

## 关键流程

### 版本检查与密钥来源（L351-528）
- `get_latest_package_with_cd_key` 请求体：`seq` + `proxy_reqs[{kind:"get_latest_game", get_latest_game_req{appcode, launcher_appcode, channel, sub_channel, version:<本地版本>}}]`。
- **必须上报本地版本**：不带版本时服务端返回 `patch: null`、`pre_patch: null`（全新安装只能走清单逐文件）；带版本时才可能给出补丁包与预下载包。
- 解析 `pkg.file_path`（资源根）、`patch`（分卷 + `cd_key` + V2 字段）、`pre_patch`（分卷，无密钥）；资源、补丁、预下载 URL 均强制 HTTPS。
- 密钥取值顺序：`patch.cd_key` → `pkg.cd_key`（历史兜底）；只留在后端，`RemotePackage` 不含密钥。

### 安装/更新（L1122-1557）
1. `checking` 阶段 → 读取本地版本 → 带版本请求远端包。
2. **补丁包优先**：`has_patch && patch_parts 非空 && cd_key 存在` → `install_from_archive_parts`。
   - 解压时检测到差量条目（`ERR_DELTA_ARCHIVE`）→ 记日志并回退清单路径；其它错误直接失败（暂存按 `resume` 保留）。
   - 没有密钥时只记警告并回退清单路径（不静默失败）。
3. **清单路径**：`fetch_manifest` → `plan_updates`（先大小、再对 ≤16MB 文件算 MD5）→ 下载到固定暂存 `{install_path}.staging.resume`（带 `.staging.resume.version` 标记）→ 全部成功后 `apply_staged_files` 应用 → 保存状态。
4. 预下载产物（加密分卷）**不**在清单路径里按 `manifest.path` 复用（官方产物也不是游戏文件）；它的复用发生在补丁包路径。
5. 失败/取消时：`resume` 为真且未要求清理 → 保留暂存与分片供下次续传。

### 补丁/预下载归档应用（L2406-3066）
- 暂存：`{install_path}.staging.patch`（分卷 + `.extracted`）。
- 分卷复用顺序：本暂存已完整 → `.staging.preload.*` 里同名且 MD5 一致（`rename`，跨卷失败则 `copy` + 复验）→ 重新下载。
- 解压：`MultipartZipReader` 顺序拼接分卷 → `ZipArchive::by_index_decrypt(cd_key)`；进度分母用实际条目解压总量；未加密条目会被自动按无密码读取（实测 `by_index_decrypt` 对明文条目忽略密码）。
- **自检**：用包内 `package_files` 核对解压产物 MD5（只校验存在的条目），失败即拒绝应用。
- 应用：跳过 `ARCHIVE_CONTROL_FILES`；每个文件先写 `<目标>.hgtmp`，长度校验通过后 `rename` 覆盖；最后按 `delete_files.txt` 删除旧文件。
- 落状态：优先用包内 `game_files`（解密 NDJSON）作为新版清单与 SHA-256，缺失时回退远端 `fetch_manifest`。
- 成功后清理补丁暂存与预下载暂存，并把预下载完成标记复位（`save_preload_state(channel, version, false)`）。

### 校验与修复（L1584-2046）
- 扫描安装清单中的缺失、大小不符及 MD5 不符文件，并并发下载修复；`quick=false` 时执行完整 MD5 校验。
- 修复下载同样使用 `download_single_file`，`resume` 决定取消后是否保留 `.download` 分片。

### 预下载（L2048-2304）
- `preload_download`：读取本地版本 → 取/复用 `pre_patch` 分卷信息 → 版本标记暂存目录 → 并发下载并逐卷 MD5 校验 → 写 `save_preload_state(completed=true)`；**不做解压**。
- 阶段取值：进行中 `stage = "preloading"`（`InstallStage::Preloading`），终态 `completed` / `error`；前端按 `stage === "preloading"` 把进度画在预下载按钮上。
- 可安装条件：`has_preload && cd_key 非空`（即正式发版、`patch` 下发后）；后端 `install_preload` 会再次校验密钥，缺失即拒绝。
- 预下载分卷是 WinZip AES 加密的官方补丁分卷（`.zip.001`…），与应用阶段消费的是同一批文件。

### 公告与侧边栏（L3235-3655）
- `get_notice_content` 一次 `batch_proxy_web_raw` 请求带上 `get_banner` / `get_announcement` / `get_sidebar`（B 服复用官服参数），分别解析为 `banners` / `announcements` / `sidebars`。
- `parse_sidebars` 抹平官方数据的两种形态（`pic.url` + `jump_url` 与 `sidebar_labels[0]`），规则是「条目自身优先、缺失回退第一条 label」。

### 渠道检测与切换
`switch_channel` 依次比较两渠道清单、下载差异文件、备份并移除旧渠道文件、应用新渠道文件、清理暂存；切换期间检查取消标志并尝试回滚。

### 游戏进程与磁盘辅助（位于 `commands/launcher.rs`）
启动/检测/终止游戏、检测渠道、检查可执行文件和查询磁盘空间由对应 launcher command 处理，不属于本服务。

### 远程接口
- `POST https://launcher.hypergryph.com/api/proxy/batch_proxy`（国际服 `launcher.gryphline.com`）：请求 `get_latest_game`，读取 `pkg.file_path`、`patch`、`pre_patch`。
- `POST .../api/proxy/web/batch_proxy`：Banner、公告、右侧栏（`get_sidebar`）与背景信息。
- `GET {resource_base_url}/game_files`：加密清单；`GET {resource_base_url}/{manifest.path}`：安装/修复文件（免签名直取）。
- `GET {patch.patches[].url}`：补丁/预下载分卷（WinZip AES，需要 `cd_key`）。
- 要取到 `patch` / `pre_patch`，`get_latest_game` 请求必须携带本地版本。

### 本地路径与持久化
- 清单安装暂存：`{install_path}.staging.resume` + 版本标记 `{install_path}.staging.resume.version`。
- 补丁归档暂存：`{install_path}.staging.patch`（含 `.extracted` 解压目录）。
- 预下载暂存：`{install_path}.staging.preload.{uuid}`，含 `.preload_version` 标记与分卷；正式更新时被补丁路径复用。
- Payload 状态：`%LOCALAPPDATA%\cn.msk-network.endprotocol\game_state\{channel}.json`。
- 普通下载临时文件为 `{dest}.download`；应用阶段临时文件为 `{dest}.hgtmp`。
- 本服务不读写 `app_config.json`；前端设置保存在 `launcher_install_path`、`launcher_channel`、`launcher_verify_threads`、`launcher_download_threads`（默认 8）、`launcher_download_resume`（默认 true）等 localStorage 键中。

### 进度事件
- 服务内渠道切换发出 `launcher://switch-progress`（`SwitchProgress`）和 `launcher://progress`（`ActiveOperation`）。
- 安装、校验、预下载通过回调由 command 发出 `launcher-progress`（`DownloadProgress`）；前端监听封装在 `src/utils/launcherService.ts`。

### 关联 launcher commands
- 调用本服务：`launcher_check_status`、`launcher_install_or_update`、`launcher_verify_and_repair`、`launcher_get_remote_version`、`launcher_preload_download`、`launcher_install_preload`、`launcher_get_payload_state`、`launcher_get_banners`、`launcher_get_announcements`、`launcher_get_notice_content`、`launcher_get_background_image`、`launcher_scan_install_dir`、`launcher_switch_channel`。
- 直接使用模块级下载/切换控制函数：`launcher_cancel_download`、`launcher_has_download_cache`、`launcher_reset_download_cancel`、`launcher_cancel_switch`、`launcher_cancel_all`。
