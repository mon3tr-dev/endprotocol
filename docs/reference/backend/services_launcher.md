# GameLauncherService（启动器/下载/进程管理）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖文件：`src-tauri/src/services/game_launcher_service.rs`（共 2960 行，其中非空 2623 行）。
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
| 113-117 | `struct GameLauncherService` 字段定义 |
| 119-150 | `impl` 开头：`new`、`has_active_operation`/`set_active_operation`/`get_active_operation` |
| 152-347 | 版本检查：`get_latest_package`(159-277)、`check_status`(279-347) |
| 349-483 | 安装扫描与本地版本解析：`scan_install_dir`(349-443)、`read_local_version`(447-466)、`versions_equal`(469-483) |
| 485-608 | 清单下载与解析：`fetch_manifest`(488-521)、`parse_manifest`(525-574)、`validate_path`(578-608) |
| 610-647 | 计划生成：`plan_updates`(613-647) |
| 649-808 | 单文件下载：`download_file_with_resume`(652-783)、`download_and_verify`(785-808) |
| 810-1220 | 完整安装/更新：`install_or_update`(814-1197)、`apply_staged_files`(1200-1220) |
| 1222-1680 | 完整性校验与修复：`verify_and_repair`(1225-1680) |
| 1682-1973 | 预下载：`preload_download`(1685-1921)、`preload_part_file_name`(1923-1935)、`create_preload_staging`(1937-1945)、`preload_staging_version`(1947-1952)、`preload_staging_dir`(1954-1966)、`cleanup_preload_staging`(1968-1973) |
| 1975-2068 | 状态持久化：`save_payload_state`(1975-2013)、`load_payload_state`(2015-2021)、`get_payload_state`(2023-2025)、`save_preload_state`(2028-2068) |
| 2070-2145 | Web 批量代理：`batch_proxy_web`(2070-2145，含原始响应调试日志) |
| 2147-2227 | `get_banners`(2147-2176)、`get_announcements`(2178-2227) |
| 2229-2257 | `batch_proxy_web_raw`(2229-2257，返回原始 `serde_json::Value`) |
| 2259-2495 | `get_notice_content`(2259-2418)、`get_background_image`(2420-2480)、`classify_media_type`(2482-2495) |
| 2497-2825 | 渠道切换 `switch_channel`(2497-2825，5 阶段 + 事件 emit + 取消回滚) |
| 2827-3024 | 模块级 `async fn download_single_file`(2827-3024，实际批量下载的主力实现) |
| — | 文件内**不**包含进程启动/检测/杀死、磁盘空间、渠道 DLL 识别（见 `commands/launcher.rs`，见「关键流程」末两节） |

## 结构体与字段

### `GameLauncherService`（本文件 L113-117）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `http_client` | `reqwest::Client` | 通用 API 客户端，超时 30s，UA `EndProtocol/0.1.0`（L121-125） |
| `download_client` | `reqwest::Client` | 下载客户端，超时 1800s（30 分钟），UA 同上（L127-131） |
| `active_operation` | `Arc<Mutex<Option<ActiveOperation>>>` | 当前活跃操作快照；仅 `switch_channel` 会写入/清空（见备注·异常 4） |

### 模块级静态

| 符号 | 类型 | 含义 |
| --- | --- | --- |
| `DOWNLOAD_CANCELLED` (L18) | `AtomicBool` | 全局下载/校验取消标志，被下载流、校验任务与 `verify_md5_with_cancel` 读取 |
| `SWITCH_CANCELLED` (L19) | `AtomicBool` | 切服取消标志，仅 `switch_channel` 各阶段检查 |

### 关键 payload 结构（定义均在 `models/game.rs`，本文件只使用）

| 结构 | 关键字段 | 说明 |
| --- | --- | --- |
| `RemotePackage` (game.rs:270) | `version: String`、`resource_base_url: String`、`has_preload: bool`、`preload_version: Option<String>`、`preload_parts: Vec<PatchPart>`、`preload_total_bytes: u64` | 远程版本与资源基址（`get_latest_package` 输出） |
| `PrePatch` / `PatchPart` (game.rs:214 / 241) | `PrePatch`：`version`、`client_version`、`package_size`、`total_size`、`patches: Vec<PatchPart>`；`PatchPart`：`url`、`md5`、`package_size`（后两者为字符串数字） | 预下载补丁包元数据（`pre_patch`）与其分卷 |
| `ManifestFile` (game.rs:262) | `path: String`、`md5: String`(32 hex)、`size: i64` | 解密后 NDJSON 清单单条 |
| `FilePlan` (game.rs:346) | `manifest: ManifestFile`、`source_path: Option<String>` | 本地已匹配则给源路径（可跳过下载） |
| `DownloadProgress` (game.rs:283) | `downloaded: u64`、`total: u64`、`stage: String`、`current_file: Option<String>`、`file_index: usize`、`file_count: usize`、`verified_bytes: u64` | 安装/校验/预下载进度 payload（`launcher-progress` 事件体） |
| `InstallStage` (game.rs:310) | `checking/comparing/downloading/verifying/repairing/applying/completed/error` | `DownloadProgress.stage` 取值 |
| `SwitchProgress` (game.rs:147) | `phase: String`、`downloaded/total: u64`、`current_file: Option<String>`、`file_index/file_count: usize`、`from_channel/to_channel: String` | 切服进度 payload；`phase` 实际取值 `checking`(L2541)、`downloading`(L2655/2670)、`backing_up`(L2741)、`moving`(L2790)、`completed`(L2810) |
| `ActiveOperation` (game.rs:121) | serde 标签 `type`：`installing`/`verifying`/`repairing` → `OperationProgress`；`switching` → `SwitchProgress` | 统一活跃操作枚举（`launcher://progress` 事件体） |
| `GameStatus` (game.rs:160) | `is_installed`、`has_update`、`local_version`、`remote_version`、`has_preload`、`preload_version`、`preload_total_bytes`、`preload_completed`、`active_operation` | `check_status` 输出 |
| `FileScanResult` (game.rs:470) | `channel_detected`、`detected_channel`、`total_files`、`valid_files`、`corrupted_files`、`missing_files`、`existing_bytes`、`download_bytes`、`corrupted_file_list`(≤20)、`missing_file_list`(≤20) | `scan_install_dir` 输出 |
| `PayloadState` (game.rs:353) | `channel`、`version`、`manifest_sha256`、`file_count`、`total_bytes`、`updated_at`(RFC3339)、`preload_version?`、`preload_completed` | 落盘的安装状态 JSON 内容 |
| `BannerItem` / `AnnouncementItem` / `LauncherNoticeContent` / `BackgroundMedia` (game.rs:378/385/394/461) | banner：`image_url`+`jump_url`；公告：`category`+`title`+`date`+`jump_url`；notice：`banners`+`announcements`；背景：`image_url?`+`video_url?` | 公告/背景接口输出 |

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
| `async fn download_single_file`（私有） | L2827-3024 | 输入 `url`、`dest_path`、`expected_md5`、共享 `dl_bytes: Arc<AtomicU64>`、`file_size` → 新建 600s 超时 client，`.download` 断点续传（Range），最多 3 次重试（退避 `attempt*2` 秒，重试从 0 开始），逐块写盘并累加计数器，全量读取算 MD5 比对，失败删临时文件 → `Ok(())`/`Err(String)` |

### `impl GameLauncherService` 方法

| 方法 | 位置 | 说明（输入 → 做什么 → 输出） |
| --- | --- | --- |
| `pub fn new` | L120-138 | 无输入 → 构造 30s/1800s 两个 `Client` 与空 `active_operation` → `Self`（构造失败 `expect` panic） |
| `pub async fn has_active_operation` | L140-142 | 无输入 → 读锁判断 `active_operation.is_some()` → `bool` |
| `pub async fn set_active_operation` | L144-146 | 输入 `Option<ActiveOperation>` → 覆盖写入 → 无返回 |
| `pub async fn get_active_operation` | L148-150 | 无输入 → 克隆当前活跃操作 → `Option<ActiveOperation>` |
| `pub async fn get_latest_package` | L159-277 | 输入 `&GameChannel` + `local_version: Option<&str>` → 向 `channel.api_url()` POST `get_latest_game` 批量代理请求（`capture::send`，请求体 `version` 填本地版本，`None` 填 `""`），解析 `BatchProxyResponse`，校验 `file_path` 与各预下载分卷 URL 必须 `https://` 开头，提取 `pre_patch`（版本 + 分卷 + 字节数） → `RemotePackage` |
| `pub async fn check_status` | L279-347 | 输入 channel + `install_path` → 判 exe/`config.ini` 是否齐全得 `is_installed`，读本地版本、带上本地版本请求远程版本做 `versions_equal` 得 `has_update`，`has_preload = 已安装 && 远程有 pre_patch && 本地版本≠预下载目标版本`，结合持久化状态判定 `preload_completed`，附 `active_operation` → `GameStatus` |
| `pub async fn scan_install_dir` | L349-443 | 输入 channel + `install_path` → 取远程清单，逐条比对本地存在性/大小/MD5（错误路径各记 ≤20 条） → `FileScanResult`（`channel_detected` = exe+`Endfield_Data`+`config.ini` 三者齐全；`detected_channel` 恒回填传入渠道） |
| `fn read_local_version`（私有） | L447-466 | 输入 `install_path` → `hg_crypto::decrypt_file_to_string` 解密 `config.ini`，解析 `game_version`/`version` 行的 `=` 后值（去引号） → `Result<String,_>`，找不到报 `Version not found in config.ini` |
| `fn versions_equal`（私有关联 fn） | L469-483 | 输入两个版本串 → 去 `v/V` 前缀、截断 `-`/`+` 后缀、按 `.` 拆为 `u32` 数组比较 → `bool` |
| `pub async fn fetch_manifest` | L488-521 | 输入 `resource_base_url` → GET `{base}/game_files`，对密文算 SHA-256（作为 manifest 标识），AES 解密后按 NDJSON 解析 → `(Vec<ManifestFile>, manifest_sha256)` |
| `fn parse_manifest`（私有） | L525-574 | 输入解密文本 → 逐行 JSON 反序列化，执行路径安全校验、MD5 32 hex 校验、`size>=0` 校验、规范化路径查重、条目数 ≤100,000 → `Vec<ManifestFile>` |
| `fn validate_path`（私有关联 fn） | L578-608 | 输入清单路径（也用于校验预下载分卷文件名） → 拒绝空路径、绝对路径（`/`、`\`）、含 `:`、`.`/`..` 段、Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9） → `Result<(),String>` |
| `pub fn plan_updates` | L613-647 | 输入清单 + `install_path` → 对每条检查本地文件大小与 MD5，匹配则填 `source_path` → `Vec<FilePlan>` |
| `pub async fn download_file_with_resume` | L652-783 | 输入 `url`、`dest_path`、进度回调 → `.download` 断点续传（Range；服务端 200 则从头），最多 3 次重试（退避 `attempt` 秒），每 256KB 触发一次回调，完成后改名到 `dest_path` → `Result<(),String>`（取消时删临时文件并返回 `Download cancelled`） |
| `pub async fn download_and_verify` | L785-808 | 输入 `url`、`dest_path`、`expected_md5`、回调 → 调上面函数下载后校验 MD5，不符则删文件并报错 → `Result<(),String>`（**全仓无外部调用**，见备注·异常 1） |
| `pub async fn install_or_update` | L814-1197 | 输入 channel、`install_path`、`Arc<dyn Fn(DownloadProgress)>` → 依次：检查(`checking`)→拉远程包→拉清单→比对(`comparing`)→复制已有文件到 `{install_path}.staging.{uuid}`→复用 preload 暂存文件→信号量并发 8 下载(`downloading`，后台 500ms 发一次进度)→全量 MD5 校验(`verifying`)→覆盖应用到安装目录(`applying`)→保存状态→清理暂存→回 `completed`/`error` → `Ok(版本号)` / `Err(前 5 个失败文件摘要)`；已有操作进行中直接报错 |
| `fn apply_staged_files`（私有） | L1200-1220 | 输入 staging、target 目录 → WalkDir 逐文件 `fs::copy` 覆盖到目标 → `Result<(),String>` |
| `pub async fn verify_and_repair` | L1225-1680 | 输入 channel、`install_path`、回调、`max_concurrent`(截断到 1..32)、`quick` → Phase1 并发检查存在性/大小/MD5（`quick` 跳过 MD5；MD5 走 `spawn_blocking` + `verify_md5_with_cancel`）收集修复清单 → Phase2 并发重新下载损坏文件 → 返回 JSON 字符串 `{ok, failed, repaired, files[]}` → `Result<String,String>` |
| `pub async fn preload_download` | L1685-1921 | 输入 channel、`install_path`、回调、`max_concurrent` → 读本地版本（读不到按 `None`）→ 带本地版本请求 `get_latest_package` 取 `pre_patch`；本地版本已等于预下载目标版本则发 `completed` 后直接返回；否则准备暂存目录（同版本旧暂存复用续传，异版本删除后按 `create_preload_staging` 新建 `{install_path}.staging.preload.{uuid}`），按 `max_concurrent`（截断到 1..32）并发下载各分卷（已下完且 MD5 一致的分卷跳过，其余走 `download_single_file`：断点续传 + 单卷 MD5 校验，进度按字节汇总）→ 全部成功才 `save_preload_state(..., true)` 并发 `completed`；有失败或取消则 `save_preload_state(..., false)`（取消分支不写状态）、发 `error`、返回 `Err`（见异常 7）。**进度事件用独立阶段 `preloading`**（不写 `localActiveOp`，前端只把它画在预下载按钮上） |
| `fn preload_part_file_name`（私有） | L1923-1935 | 输入分卷 URL + 序号 → 取路径末段作本地文件名（`validate_path` 校验，非法则回退 `part_###.zip`） → `String` |
| `fn create_preload_staging`（私有关联 fn） | L1937-1945 | 输入 `install_path`、`version` → 建 `{install_path}.staging.preload.{uuid}` 并写入 `.preload_version` 标记 → `Result<PathBuf,String>`；同区间的常量 `PRELOAD_VERSION_MARKER`（L1934）为标记文件名 |
| `fn preload_staging_version`（私有关联 fn） | L1947-1952 | 输入目录 → 读 `.preload_version` → `Option<String>` |
| `fn preload_staging_dir`（私有） | L1954-1966 | 输入 `install_path` → 在父目录找 `{stem}.staging.preload.*` → `Option<String>` |
| `fn cleanup_preload_staging`（私有） | L1968-1973 | 输入 `install_path` → 删除找到的 preload 暂存目录 → 无返回 |
| `fn save_payload_state`（私有） | L1975-2013 | 输入 channel、`version`、`manifest_sha256`、`manifest` → 组装 `PayloadState`（保留既有 preload 字段）写 `game_state/{channel}.json.tmp` 再 rename（原子写） → `Result<(),String>` |
| `fn load_payload_state`（私有） | L2015-2021 | 输入 channel → 读并反序列化 `game_state/{channel}.json` → `Option<PayloadState>` |
| `pub async fn get_payload_state` | L2023-2025 | 输入 channel → 包装同步读取 → `Option<PayloadState>` |
| `fn save_preload_state`（私有） | L2028-2068 | 输入 channel、`preload_version`、`completed` → 读（或新建）状态后写回 preload 字段，临时文件 + rename → `Result<(),String>` |
| `async fn batch_proxy_web`（私有） | L2070-2145 | 输入 channel、`proxy_reqs` → 以 `{seq, proxy_reqs}` POST `channel.web_api_url()`，`eprintln!` 输出原始 `proxy_rsps` 调试信息（公告 tabs/banner 数量），再解析 → `BatchProxyResponse` |
| `pub async fn get_banners` | L2147-2176 | 输入 channel → 组 `get_banner` 请求（language `zh-cn`、platform `Windows`、source `launcher`） → `Vec<BannerItem>`（`url`→`image_url`、`jump_url`） |
| `pub async fn get_announcements` | L2178-2227 | 输入 channel → 组 `get_announcement` 请求，展平 tabs→announcements，`start_ts` 转 `%m/%d` → `Vec<AnnouncementItem>`（`category`=tab 名、`title`=content） |
| `async fn batch_proxy_web_raw`（私有） | L2229-2257 | 输入 channel、`proxy_reqs` → 同 POST web 批量代理但不解析结构 → 原始 `serde_json::Value`（其上的 doc 注释与实际功能错位，见异常 5） |
| `pub async fn get_notice_content` | L2259-2418 | 输入 channel → 一次发 `get_banner` + `get_announcement`（B 服强制改用官服参数），手工遍历原始 JSON，兼容 `tabName/tab_name`、`start_ts/startTs`（支持秒/毫秒时间戳）、`jump_url/jumpUrl` → `LauncherNoticeContent` |
| `pub async fn get_background_image` | L2420-2480 | 输入 channel → 组 `get_main_bg_image` 请求，取 `main_bg_image.url`/`video_url`，用扩展名判定图片/视频并互换字段 → `Option<BackgroundMedia>` |
| `fn classify_media_type`（私有） | L2482-2495 | 输入 URL → 判 `.mp4/.webm/.ogg` 或带 `?` 后缀 → `"video"` / `"image"` |
| `pub async fn switch_channel` | L2497-2825 | 输入 `from_channel`、`to_channel`、`install_path`、`app: AppHandle` → 5 阶段：①拉双方远程包与清单做 diff（L2539-2613）②下载差异文件到 `{install_dir}/.switch.download`（优先复用 `.switch/{to_channel}` 备份，L2615-2713）③把待删文件备份到 `.switch/{from_channel}` 并删除（L2714-2760）④把暂存文件复制进安装目录（L2761-2806）⑤清理暂存、emit `completed`、清 `active_operation`（L2807-2824）；每阶段检查 `SWITCH_CANCELLED` 并回滚（恢复备份/删暂存） → `Ok(to_remote.version)` / `Err` |

> 方法总数 43：模块级 7（其中 pub 6）+ impl 内 36（其中 pub 20）。上表全部列出；加粗的 20 个 `pub` impl 方法与 6 个 pub 自由函数即全部公开 API。

## 关键流程

### 安装/更新检查（L152-483）
- `get_latest_package` L159-277：POST `get_latest_game`（请求体 `seq` + `proxy_reqs[{kind, get_latest_game_req{appcode, launcher_appcode, channel, sub_channel, version:<本地版本或 "">}}]`）→ 取 `get_latest_game_rsp.pkg.file_path` 作 `resource_base_url`，**强制 https**；预下载信息取自 `get_latest_game_rsp.pre_patch`（`version` + `patches[]`，逐条强制 https），`has_preload = 分卷列表非空`。
  - **`version` 必须填本地版本**：官方接口只在上报本地版本时才返回 `pre_patch`（带 `""` 时返回 `pre_patch: null`，并把 `pkg.packs` 填成完整安装包分卷列表）。
- `check_status` L279-347：`is_installed = 存在 {install}/Endfield.exe 且存在 {install}/config.ini`；本地版本来自解密的 `config.ini`（L447-466）；`has_update = 本地≠远程`；`has_preload = 已安装 && 远程有 pre_patch && 本地版本≠预下载目标版本`；`preload_completed` 读 `game_state/{channel}.json` 并校验 preload 版本一致。
- `scan_install_dir` L349-443：核心文件检查 L356-360；逐清单条目统计 missing/大小不符/MD5 不符与字节数 L376-425。
- `versions_equal` L469-483：语义化分段比较，忽略 `v` 前缀与 `-`/`+` 后缀。

### 清单下载与解析（L485-608）
- `GET {resource_base_url}/game_files`（L492）→ 密文 SHA-256（L510，作为 `PayloadState.manifest_sha256`）→ AES-256-CBC 解密（L514）→ NDJSON 逐行解析。
- 校验规则：路径安全（L539，防穿越/保留名）、MD5 32 hex（L542-548）、`size>=0`（L550-552）、重复路径（L554-562，`\` 归一 `/`）、上限 100,000 条（L567-572）。

### 下载与断点续传（L649-808、L2827-3024）
- 两条实现：`download_file_with_resume`（L652-783，带进度回调，256KB/次）与 `download_single_file`（L2827-3024，实际批量使用，共享 `AtomicU64` 计数，4MB/次日志）。
- 断点续传：读 `{dest}.download` 现有长度作为 `start_byte`（L669-680 / L2843-2855），带 `Range: bytes={n}-`（L695 / L2883）；若服务端回 200（忽略 Range）则从 0 重下（L710-712 / L2904-2910）；206 走追加模式，否则新建（L716-727 / L2922-2930）。
- 重试：3 次；`download_file_with_resume` 退避 `attempt` 秒（L685-691），`download_single_file` 退避 `attempt*2` 秒（L2866-2879），重试均从 0 开始。
- 取消：流式循环中每块检查 `DOWNLOAD_CANCELLED`，命中即删 `.download` 并返回（L735-739 / L2938-2943）。
- 校验：`download_single_file` 全量读文件算 MD5 比对（L2976-2992，不符删临时文件）；`download_file_with_resume` 内的 MD5 校验为恒真空操作（L757-763，见异常 2）。
- 完成后 `fs::rename(.download → dest)`（L766 / L2995）。

### 完整安装/更新（L810-1220）
阶段与进度（`InstallStage`）：`checking` L829-837 → 拉包 L839 / 拉清单 L848 → `comparing` L853-861（计划 L863-875，全新则直接保存状态返回 L877-882）→ 建 `{install_path}.staging.{uuid}` L885-891 → 复制已存在文件到暂存 L894-915 → preload 复用（校验大小+MD5 后复制，成功则从下载列表剔除并清理 preload 暂存）L923-969 → `downloading`（信号量并发 8，L979-980；后台任务每 500ms 发进度，L983-1006；任务逐个 spawn L1008-1050；汇总失败文件 L1052-1095）→ `verifying`（全清单 MD5，每 500 条回调，L1102-1139）→ `applying`（`apply_staged_files` 覆盖到安装目录，L1143-1154）→ 保存 `game_state/{channel}.json` L1156-1158 → 删除暂存 L1165-1167 → 发 `completed`/`error` L1169-1196。
磁盘代价：已存在文件会整份复制进暂存（峰值约需 2 倍占用），见 L894-915。

### 校验与修复（L1222-1680）
- Phase1 并发检查 L1285-1454：`max_concurrent` 限制 1..32（L1233）；`quick=true` 跳过 MD5（L1379-1380）；MD5 走 `spawn_blocking` + `hg_crypto::verify_md5_with_cancel(..., Some(&DOWNLOAD_CANCELLED))`（L1384-1390）；结果分类 `MISSING`/`SIZE_MISMATCH`/`MD5_MISMATCH` 并入 `repair_list`（L1413-1432）；后台 500ms 进度任务 L1308-1336。
- 取消检查点 L1459-1462、L1630-1633。
- Phase2 并发重下损坏文件 L1488-1628：`{resource_base_url}/{path}` 下载覆盖原路径（L1589-1604），后台 500ms 进度 L1532-1560。
- 输出 L1659-1679：JSON 字符串 `{"ok","failed","repaired","files":[...damaged paths]}`（由前端本地化）；无损坏时返回 `"All files verified OK"`（L1504）。

### 预下载（L1682-1973）
`preload_download` L1685-1921：读本地版本（`read_local_version`，读不到按 `None`）L1693 → 带本地版本请求 `get_latest_package` L1696-1698 → 取 `pre_patch` 的 `version`/分卷列表（缺则报 `No preload package available`）L1700-1708 → 本地版本已等于目标版本：发 `completed` 后返回 L1719-1721 → 准备暂存目录：同版本旧暂存复用（续传，L1737-1741），异版本删除后新建 `{install_path}.staging.preload.{uuid}`（L1743-1747） → 按 `max_concurrent.clamp(1,32)` 并发下载分卷 L1798-1844（分卷文件名取自 URL 末段；已完成且 MD5 一致的分卷跳过；其余走 `download_single_file`，内含断点续传 + 单卷 MD5 校验）→ 汇总失败 L1846-1856 → 取消：发 `error` + 删暂存 + 返回 L1858-1868 → 有失败：`save_preload_state(..., false)` + 发 `error` + 返回错误 L1870-1893 → 全部成功：`save_preload_state(..., true)` L1896 → 发 `completed` L1898-1909 → `Ok("Preload completed: <version> (N parts, B bytes)")`。
阶段取值：进行中一律 `stage = "preloading"`（`InstallStage::Preloading`），终态为 `completed`（成功/已是最新）或 `error`（失败/取消）；前端按 `stage === "preloading"` 把进度画在预下载按钮上，收到其它 stage 即视为预下载结束。
下载内容即官方预发布补丁分卷（`.zip.001`…，WinZip AES 加密，见备注·异常 14），**安装/更新流程目前无法消费**：`install_or_update` 的 preload 复用逻辑（L923-969）按“游戏相对路径 + 大小 + MD5”匹配，分卷文件名不会命中。
目录定位/清理见 L1954-1973；版本标记文件/建目录见 L1934-1952。

### 渠道检测与切换（服务内切换：L2496-2825）
- 取消与活跃操作：入口检查 L2504-2506；设 `active_operation = Switching(checking)` L2540-2550；各阶段取消检查点 L2552/2559/2565/2571/2624/2719/2765，取消时回滚并 `reset_switch_cancel()`。
- Phase1 差异计算 L2539-2613：以**清单对清单** diff（非本地磁盘实际状态），MD5 或 size 不同→下载，仅存在于旧清单→待删除；差异为空直接返回 L2610-2613。
- Phase2 下载 L2615-2713：暂存 `{install_dir}/.switch.download`（L2516）；优先复用备份 `.switch/{to_channel}/{path}`（大小+MD5 校验，L2643-2666）；失败清理暂存与已下载文件 L2698-2706。
- Phase3 备份+删除 L2714-2760：旧文件复制到 `.switch/{from_channel}/{path}` 再删除（L2734-2753）；取消时恢复已备份文件 L2719-2732。
- Phase4 应用 L2761-2806：暂存 → 安装目录逐文件 `fs::copy`；取消时删除已复制文件并从备份回滚 L2765-2781。
- Phase5 清理 L2807-2824：删 `.switch.download`、emit `completed`、sleep 1s、清 `active_operation`。
- **真正的渠道特征识别不在本文件**：`launcher_detect_channel` 在 `commands/launcher.rs:463-510`（按 `glextra.dll`+`play_pc_sdk.dll`+`manifest.xml`→google_play；`gfsdk.dll`+`glfoundation.dll`→global；`PCGameSDK.dll`→bilibili；`hgsdk.dll`→official）。

### 游戏进程启动/检测/杀死（不在本文件，位于 `commands/launcher.rs`）
- 启动：`launcher_start_game` `commands/launcher.rs:291-373` —— 先 `taskkill /F /IM Endfield.exe`（:308-310），sleep 500ms，再 `ShellExecuteW`（`SW_SHOWNORMAL`，工作目录 = 安装目录，:331-338）。
- 检测运行：`launcher_check_game_running` `commands/launcher.rs:522-531`（异步、隐藏控制台地运行 `tasklist /FI "IMAGENAME eq Endfield.exe"` 并检查输出；前端每 3 秒轮询）。
- 杀死：`launcher_kill_game` `commands/launcher.rs:534-570`（隐藏控制台运行 `taskkill /T /F /IM` → 失败再按 exe 名 → 再失败 `wmic process where name like '%Endfield%' call terminate`）。
- 可执行文件存在性：`launcher_check_executable` `commands/launcher.rs:514-519`；进程名/可执行名来自 `models/game.rs:99-106`（均为 `Endfield.exe`）。

### 磁盘空间（不在本文件，位于 `commands/launcher.rs`）
- `launcher_get_disk_space` `commands/launcher.rs:394-447`：取路径最近存在的祖先盘符 → Windows 下调 `powershell Get-PSDrive` 解析 `Used|Free` → `{total, free}`；非 Windows 返回 `u64::MAX`。

### 远程版本与 Banner/公告获取（L152-277、L2070-2495）
- 通用 web 批量代理：`{seq, proxy_reqs}` POST `channel.web_api_url()`（L2074-2086、L2234-2246）。
- Banner：`kind=get_banner`，参数 `appcode/language=zh-cn/channel/sub_channel/platform=Windows/source=launcher`（L2143-2153、L2270-2281）。
- 公告：`kind=get_announcement`（L2178-2188、L2282-2293），`get_notice_content` 内容解析兼容多种字段命名与秒/毫秒时间戳（L2329-2403）。
- 背景：`kind=get_main_bg_image`（L2419-2429），按扩展名区分图/视频（L2482-2495）。
- B 服公告改用官服参数（L2218-2222）。

### 进度事件 emit（本文件 L2519-2537；command 层 L74/117/168）
- 服务内 `switch_channel` 的 `emit` 闭包（L2519-2537）每次同时发两条：
  - `launcher://switch-progress` → `SwitchProgress`（字段见上表）
  - `launcher://progress` → `ActiveOperation::Switching(SwitchProgress)`（serde `type="switching"`）
- 安装/校验/预下载不直接 emit，而是把 `Arc<dyn Fn(DownloadProgress)>` 回调交给 command，由 command 发 `launcher-progress` → `DownloadProgress`（`commands/launcher.rs:74`、`:117`、`:168`）。
- 前端监听三处：`src/utils/launcherService.ts:295`（`launcher-progress`）、`:303`（`launcher://progress`）、`:311`（`launcher://switch-progress`）。

## 备注

**HTTP 端点**
- `POST https://launcher.hypergryph.com/api/proxy/batch_proxy`（official/bilibili，`models/game.rs:31-40`）/ `POST https://launcher.gryphline.com/api/proxy/batch_proxy`（global/google_play）—— 版本检查（本文件 L192）。
- `POST https://launcher.hypergryph.com/api/proxy/web/batch_proxy` / `https://launcher.gryphline.com/api/proxy/web/batch_proxy`（`models/game.rs:43-52`）—— 公告/Banner/背景（L2042、L2201）。
- `GET {resource_base_url}/game_files` —— 加密清单（L492）。
- `GET {resource_base_url}/{manifest.path}` —— 单文件下载（L992 安装、L1561 修复、L2627 切服）。
- `GET {patch.url}`（带 `auth_key` 查询串，`pre_patch.patches[]`）—— 预下载分卷下载（L1786 起由 `download_single_file` 发起）；`auth_key` 会过期，官方客户端每次下载前重新请求接口换新链接。
- 请求体外层统一 `{seq, proxy_reqs}`（L165-177、L2034-2037、L2193-2196）；`seq`：国服 `5`、国际服 `3`（`models/game.rs:91-96`）；`appcode`/`launcher_appcode`/`channel`/`sub_channel` 见 `models/game.rs:55-88`。

**本地路径与文件布局**
- 安装目录内容：`{install_path}/Endfield.exe`、`{install_path}/config.ini`（加密，需 `decrypt_file_to_string` 读）、`{install_path}/Endfield_Data/`（L296-297、L357-359、L448）。
- 安装暂存（兄弟目录）：`{install_path}.staging.{uuid}`（L885）。
- 预下载暂存（兄弟目录）：`{install_path}.staging.preload.{uuid}`（L1737-1749），存放 `pre_patch.patches[]` 的分卷文件（文件名取自 URL 末段，如 `xxx_1_6_3_1_5_3.zip.001`），目录内还有版本标记 `.preload_version`；定位靠前缀匹配（L1954-1966）；目标版本与标记不一致时先删旧暂存（L1743-1747），一致则复用续传。
- 切服暂存与备份（安装目录**内**）：`{install_path}/.switch.download`（L2516）、`{install_path}/.switch/{from_channel}/...`（备份，L2715）、`{install_path}/.switch/{to_channel}/...`（复用源，L2640）。
- 下载临时文件：`{dest}.download`（L658、L2834），随改名落定。
- 状态目录：`%LOCALAPPDATA%\cn.msk-network.endprotocol\game_state\{channel}.json`（临时写 `.json.tmp` 后 rename）（L2006-2009、L2016-2017、L2058-2065；根目录见 `utils/paths.rs:7`）。
- `cleanup_staging_files` 清理目标：`{install_path}.switch.download`（L41）、父目录 `{stem}.staging.*`/`{stem}.switch.*`/`{stem}.backup.*`（L47-64）、安装目录内 `*.download` 文件（L66-78）。

**emit 事件名与 payload**
- `launcher://switch-progress` → `SwitchProgress`（L2535）。
- `launcher://progress` → `ActiveOperation`（`type="switching"`）（L2536）。
- `launcher-progress` → `DownloadProgress`（由 `commands/launcher.rs:74/117/168` 发出，服务仅提供回调）。

**被哪些 command 调用**（`src-tauri/src/commands/launcher.rs`，均在 `lib.rs:122-147` 注册）
- 调 service 方法：`launcher_check_status`→`check_status`(:28)、`launcher_install_or_update`→`install_or_update`(:49)、`launcher_verify_and_repair`→`verify_and_repair`(:99，默认 `max_concurrent=12`、`quick=false`)、`launcher_get_remote_version`→`get_latest_package`(:145)、`launcher_preload_download`→`preload_download`(:156，默认并发 8)、`launcher_get_payload_state`→`get_payload_state`(:190)、`launcher_get_banners`(:247)、`launcher_get_announcements`(:258)、`launcher_get_notice_content`(:269)、`launcher_get_background_image`(:280)、`launcher_scan_install_dir`→`scan_install_dir`(:451)、`launcher_switch_channel`→`switch_channel`(:574)。
- 调模块级自由函数：`launcher_cancel_download`→`cancel_download`+`cleanup_staging_files`(:201)、`launcher_has_download_cache`→`has_download_cache`(:214)、`launcher_reset_download_cancel`(:222)、`launcher_cancel_switch`(:228)、`launcher_cancel_all`(:234)。
- 不经过本 service 的同名分区 command：`launcher_start_game`(:291)、`launcher_detect_channel`(:463)、`launcher_check_executable`(:514)、`launcher_check_game_running`(:522)、`launcher_kill_game`(:534)、`launcher_get_disk_space`(:394)、`launcher_browse_folder`(:377)、`launcher_decrypt_file`(:241)、`launcher_get_process_read_bytes`(:10)。

**配置键 / 持久化**
- 本文件**不读写** `app_config.json`（未注入 `ConfigService`）；自身持久化只有 `game_state/{channel}.json`（字段见 `PayloadState`）。
- 相关键位在前端 localStorage：`launcher_install_path`、`launcher_channel`、`launcher_verify_threads`（默认 12）、`launcher_cancel_behavior`、`launcher_skip_stop_confirm`（`src/components/game-action-panel.tsx:47-50`、`game-launch-settings.tsx`）。

**备注 · 发现的异常/坏味道**
1. `download_and_verify`(L785) 与 `download_file_with_resume`(L652) 是 `pub` 但全仓无外部调用（`download_and_verify` 仅调用后者，后者也仅被它调用）；实际批量下载走 `download_single_file`(L2827) —— 疑似死公共 API。
2. `download_file_with_resume` 的“MD5 校验”(L757-763) 拿文件自身的 MD5 去和自己比，恒真且结果被忽略（注释已承认拿不到期望值）。
3. 取消清理路径不一致：`cleanup_staging_files` 删的是 `{install_path}.switch.download`（兄弟路径，L41），而 `switch_channel` 实建的是 `{install_dir}/.switch.download`（目录内，L2516）；且 L66-78 只删 `.download` 结尾的**文件**，因此该暂存**目录**不会被清理。
4. `active_operation` 仅由 `switch_channel` 写入/清空（L2540/L2553…L2812），`install_or_update`/`verify_and_repair`/`preload_download` 从不设置 → L820、L1234 的 `has_active_operation` 守卫对它们实际无效，真正的互斥来自 command 层对 `Arc<Mutex<...>>` 的整段 `lock()`；`ActiveOperation::Installing/Verifying/Repairing` 三个变体后端从未构造（仅序列化定义）。
5. doc 注释错位：L2228「获取启动器公告内容（Banner + 公告合并返回）」实际挂在 `batch_proxy_web_raw`(L2229) 上，`get_notice_content`(L2259) 无文档注释。
6. 事件命名两套规范：服务发 `launcher://switch-progress`/`launcher://progress`（带 `://`），command 发 `launcher-progress`（无），前端三处监听都必须兼容（`launcherService.ts:295/303/311`）。
7. `preload_download` 现在只在**全部分卷下载且单卷 MD5 校验通过**后写 `save_preload_state(..., true)`；有失败则写 `false` + 发 `error` + 返回错误（L1870-1893），已成功的分卷保留在暂存目录供续传（已下完的分卷靠 MD5 跳过、半截分卷靠 `{dest}.download` 续传）；用户取消时同样发一条终态 `error` 事件（L1858-1868）并删掉暂存目录，前端据此清空预下载按钮状态。
   - 仍存在的续传缺口：①重试仍用首次请求拿到的 `auth_key` 链接，若链接在下载途中过期就得重新点一次“预下载”（新请求会换新链接）；②「取消」走的是 `launcher_cancel_download` → `cleanup_staging_files`，它按 `{stem}.staging.*` 前缀删目录，会把预下载暂存一起删掉——因此续传只在“失败后重试”场景生效，取消后需从头下载。
8. `scan_install_dir` 的 `channel_detected` 只是「exe+Data+config 存在」（L357-360），`detected_channel` 恒回填调用方传入的渠道（L434），并不做渠道识别（真正识别在 `commands/launcher.rs:463`）。
9. `download_single_file` 为每个文件新建一个 `reqwest::Client`（L2857-2861），高并发时重复建连接池；类内已有可复用的 `download_client`。
10. 调试输出混用 `eprintln!`（L2099-2135、L2407、L2438-2477）与 `tracing`，不利于日志聚合。
11. `switch_channel` Phase2 建了 `dl_counter`(L2678) 传入下载函数却从未读取用于 emit，切服下载阶段只有逐文件开始/结束事件，无字节级实时进度。
12. 切服 diff 只比较两份清单（L2578-2602），不检查本地磁盘实际内容：本地已损坏但两版清单 MD5 相同的文件不会被重新下载。
13. `verify_and_repair` Phase2 中单文件修复失败仅记日志（L1610-1613），最终 JSON 的 `failed` 等于「发现的损坏数」而非「修复后仍损坏数」，`repaired` 才反映实际成功数（L1660-1678）。
14. 预下载包无法被本应用消费：`pre_patch.patches[]` 分卷解出来是一个 ZIP（条目按游戏内相对路径组织，如 `AntiCheatExpert/ACE-BASE.sys`），但每个条目都是 WinZip AES-256 加密（method 99 / extra `0x9901` AE-2 / strength 3）且官方请求带 `patch_encrypt: true`；没有解压口令就无法校验条目内容、也无法把它当作“提前下好的游戏文件”喂给 `install_or_update` 的 preload 复用逻辑（L923-969）。当前预下载的价值仅是提前把分卷取回本地并校验分卷本身（各分卷 md5 由接口提供）。
