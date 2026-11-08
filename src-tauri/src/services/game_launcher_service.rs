use std::fs;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::{collections::HashSet, fs::File, io};

use futures_util::StreamExt;
use reqwest::Client;
use tauri::Emitter;
use tokio::sync::{Mutex, Semaphore};
use walkdir::WalkDir;

use crate::models::game::*;
use crate::utils::{capture, hg_crypto};

/// 全局下载取消标志
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
static SWITCH_CANCELLED: AtomicBool = AtomicBool::new(false);
/// 本次取消是否同时删除下载缓存（由 launcher_cancel_download 带 install_path 时置位）
static CANCEL_CLEANUP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// 安装暂存目录后缀：固定名称，保证取消/失败后下次运行仍能续传
const INSTALL_STAGING_SUFFIX: &str = ".staging.resume";
/// 安装暂存目录对应的版本标记文件后缀（与暂存目录同级，避免被当作游戏文件应用）
const INSTALL_STAGING_VERSION_SUFFIX: &str = ".staging.resume.version";
/// 小文件复用前重新校验 MD5 的尺寸上限（大文件下载完成时已校验）
const STAGED_REUSE_HASH_LIMIT: u64 = 16 * 1024 * 1024;
/// 预下载分卷暂存目录的版本标记文件
const PRELOAD_VERSION_MARKER: &str = ".preload_version";

/// 补丁 / 预下载包内的**控制文件**：它们不是游戏文件，不能铺进安装目录。
///
/// 逆向依据（Games.exe）：
/// - `CCopyGameFile` 构造函数用 `package_files` / `delete_files.txt` / `patch.json` 三个名字
///   建立"跳过名单"（RVA `0x00278dc0`，紧邻 RVA `0x00277c50` 的 `delete_files.txt` 路径构造）；
/// - 本机官方安装目录 `E:\Endfield Game` 实测只有 `game_files`，没有 `package_files` /
///   `delete_files.txt` / `patch.json`。
///
/// `game_files` **不在**排除之列：它是游戏安装目录内的正式文件（官方实测保留）。
const ARCHIVE_CONTROL_FILES: [&str; 3] = ["package_files", "delete_files.txt", "patch.json"];
/// 包内"需要删除的旧文件"清单
const ARCHIVE_DELETE_LIST: &str = "delete_files.txt";
/// 差量补丁包（含 hpatch `_patch` 条目）的错误前缀：调用方据此回退到清单逐文件下载
const ERR_DELTA_ARCHIVE: &str = "DELTA_ARCHIVE:";

/// 判断解压产物中的相对路径是否为包内控制文件（只匹配包根下的那几个名字）
fn is_archive_control_file(relative: &Path) -> bool {
    if relative.components().count() != 1 {
        return false;
    }
    let Some(name) = relative.to_str() else {
        return false;
    };
    ARCHIVE_CONTROL_FILES
        .iter()
        .any(|control| name.eq_ignore_ascii_case(control))
}

/// 读取 `delete_files.txt` 内容：官方是"每行一个相对路径"的清单；
/// 这里同时兼容 JSON 数组（`["a","b"]` 或 `[{"path":"a"}]`），两种都归一化为相对路径列表。
fn parse_delete_list(content: &str) -> Vec<String> {
    let trimmed = content.trim_start();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let items = match value {
                serde_json::Value::Array(items) => items,
                other => vec![other],
            };
            let mut out = Vec::new();
            for item in items {
                match item {
                    serde_json::Value::String(path) => out.push(path),
                    serde_json::Value::Object(map) => {
                        for key in ["path", "file", "name"] {
                            if let Some(serde_json::Value::String(path)) = map.get(key) {
                                out.push(path.clone());
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            }
            if !out.is_empty() {
                return out
                    .into_iter()
                    .map(|path| path.trim().replace('\\', "/"))
                    .filter(|path| !path.is_empty())
                    .collect();
            }
        }
    }
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.replace('\\', "/"))
        .collect()
}

pub fn cancel_download() {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
}

/// 标记本次取消需要连带删除缓存文件（必须在 cancel_download 之前调用）
pub fn request_cancel_cleanup() {
    CANCEL_CLEANUP_REQUESTED.store(true, Ordering::SeqCst);
}

pub fn reset_download_cancel() {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
}

pub fn cancel_switch() {
    SWITCH_CANCELLED.store(true, Ordering::SeqCst);
}

pub fn reset_switch_cancel() {
    SWITCH_CANCELLED.store(false, Ordering::SeqCst);
}

/// 清理指定安装路径下的所有暂存目录和 .download 缓存文件
pub fn cleanup_staging_files(install_path: &str) {
    let install_dir = Path::new(install_path);
    // 删除切换暂存目录
    let switch_staging = format!("{}.switch.download", install_path);
    if Path::new(&switch_staging).exists() {
        tracing::info!("[cleanup] Removing switch staging: {}", switch_staging);
        let _ = fs::remove_dir_all(&switch_staging);
    }
    // 删除旧格式 staging 目录
    if let Some(parent) = install_dir.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if let Some(stem) = install_dir.file_name().and_then(|s| s.to_str()) {
                    if name_str.starts_with(&format!("{}.staging.", stem))
                        || name_str.starts_with(&format!("{}.switch.", stem))
                        || name_str.starts_with(&format!("{}.backup.", stem))
                    {
                        let path = entry.path();
                        tracing::info!("[cleanup] Removing old dir: {}", path.display());
                        if path.is_dir() {
                            let _ = fs::remove_dir_all(&path);
                        } else {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
    // 删除安装目录内的 .download 文件
    if install_dir.exists() {
        for entry in WalkDir::new(install_dir).into_iter().flatten() {
            if entry.file_type().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".download") {
                        let path = entry.path();
                        tracing::info!("[cleanup] Removing .download file: {}", path.display());
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }
}

/// 目录内是否存在任意文件（用于判断暂存区是否值得保留）
fn dir_has_files(dir: &Path) -> bool {
    WalkDir::new(dir)
        .into_iter()
        .flatten()
        .any(|entry| entry.file_type().is_file())
}

/// 检查指定安装路径下是否存在下载缓存（暂存目录或 .download 文件）
pub fn has_download_cache(install_path: &str) -> bool {
    let install_dir = Path::new(install_path);
    // 检查 *.staging.* 目录
    if let Some(parent) = install_dir.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if let Some(stem) = install_dir.file_name().and_then(|s| s.to_str()) {
                    if name_str.starts_with(&format!("{}.staging.", stem)) && entry.path().is_dir()
                    {
                        return true;
                    }
                }
            }
        }
    }
    // 检查安装目录内的 .download 文件
    if install_dir.exists() {
        for entry in WalkDir::new(install_dir).into_iter().flatten() {
            if entry.file_type().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".download") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

struct MultipartZipReader {
    files: Vec<File>,
    offsets: Vec<u64>,
    len: u64,
    position: u64,
}

impl MultipartZipReader {
    fn new(paths: &[PathBuf]) -> io::Result<Self> {
        let mut files = Vec::with_capacity(paths.len());
        let mut offsets = Vec::with_capacity(paths.len());
        let mut len = 0u64;

        for path in paths {
            offsets.push(len);
            let file = File::open(path)?;
            len = len
                .checked_add(file.metadata()?.len())
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Archive too large"))?;
            files.push(file);
        }

        if files.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "No archive parts",
            ));
        }

        Ok(Self {
            files,
            offsets,
            len,
            position: 0,
        })
    }
}

impl Read for MultipartZipReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let mut total_read = 0;
        while total_read < buffer.len() && self.position < self.len {
            let file_index = self
                .offsets
                .partition_point(|offset| *offset <= self.position)
                .saturating_sub(1);
            let part_end = self
                .offsets
                .get(file_index + 1)
                .copied()
                .unwrap_or(self.len);
            let part_remaining = (part_end - self.position) as usize;
            let read_len = (buffer.len() - total_read).min(part_remaining);

            self.files[file_index]
                .seek(SeekFrom::Start(self.position - self.offsets[file_index]))?;
            let read =
                self.files[file_index].read(&mut buffer[total_read..total_read + read_len])?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Unexpected end of archive part",
                ));
            }

            self.position += read as u64;
            total_read += read;
        }
        Ok(total_read)
    }
}

impl Seek for MultipartZipReader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let next = match position {
            SeekFrom::Start(position) => i128::from(position),
            SeekFrom::End(offset) => i128::from(self.len) + i128::from(offset),
            SeekFrom::Current(offset) => i128::from(self.position) + i128::from(offset),
        };
        if next < 0 || next > i128::from(u64::MAX) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid archive seek position",
            ));
        }
        self.position = next as u64;
        Ok(self.position)
    }
}

pub struct GameLauncherService {
    http_client: Client,
    download_client: Client,
    active_operation: Arc<Mutex<Option<ActiveOperation>>>,
    /// 只串行化「会写安装目录」的长任务（安装/更新、校验修复、预下载、切服）。
    /// 整个服务此前被 `Arc<Mutex<GameLauncherService>>` 包着，而安装一跑就是几十分钟，
    /// 期间公告、背景图、状态查询全部排队等锁——前端刷新后启动流程的任务里就有
    /// 公告和背景图，于是卡死在「正在加载初始数据…」。
    write_gate: Arc<Semaphore>,
}

impl GameLauncherService {
    pub fn new() -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("EndProtocol/0.1.0")
            .build()
            .expect("Failed to create HTTP client");

        let download_client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            // 单文件可能下载数十分钟，这里只限制读超时，避免大文件被总超时中断
            .read_timeout(Duration::from_secs(120))
            .user_agent("EndProtocol/0.1.0")
            .build()
            .expect("Failed to create download HTTP client");

        Self {
            http_client,
            download_client,
            active_operation: Arc::new(Mutex::new(None)),
            write_gate: Arc::new(Semaphore::new(1)),
        }
    }

    /// 取「会写安装目录」的长任务闸门（容量 1）。命令层先 acquire 到 permit 再执行，
    /// 保证安装/校验/预下载/切服彼此不并发，同时不再堵住只读命令。
    pub fn write_gate(&self) -> Arc<Semaphore> {
        self.write_gate.clone()
    }

    pub async fn has_active_operation(&self) -> bool {
        self.active_operation.lock().await.is_some()
    }

    pub async fn set_active_operation(&self, op: Option<ActiveOperation>) {
        *self.active_operation.lock().await = op;
    }

    pub async fn get_active_operation(&self) -> Option<ActiveOperation> {
        self.active_operation.lock().await.clone()
    }

    // ========== 版本检查 ==========

    /// 从 launcher API 获取最新版本和资源地址
    ///
    /// `local_version` 会作为 `version` 字段发给官方接口：
    /// - 官方客户端始终上报本地版本；只有在带上版本时接口才会返回 `pre_patch`（预下载补丁包）。
    /// - 全新安装（无本地版本）传 `None`，此时返回的 `pkg.packs` 为完整安装包分卷列表。
    pub async fn get_latest_package(
        &self,
        channel: &GameChannel,
        local_version: Option<&str>,
    ) -> Result<RemotePackage, String> {
        self.get_latest_package_with_cd_key(channel, local_version)
            .await
            .map(|(remote, _)| remote)
    }

    async fn get_latest_package_with_cd_key(
        &self,
        channel: &GameChannel,
        local_version: Option<&str>,
    ) -> Result<(RemotePackage, Option<String>), String> {
        tracing::info!(
            "[api] get_latest_package: channel={}, appcode={}, local_version={}",
            channel.as_str(),
            channel.app_code(),
            local_version.unwrap_or("")
        );
        let req_body = serde_json::json!({
            "seq": channel.seq(),
            "proxy_reqs": [{
                "kind": "get_latest_game",
                "get_latest_game_req": {
                    "appcode": channel.app_code(),
                    "launcher_appcode": channel.launcher_app_code(),
                    "channel": channel.channel(),
                    "sub_channel": channel.sub_channel(),
                    "version": local_version.unwrap_or("")
                }
            }]
        });

        tracing::debug!(
            "[api] Request body: {}",
            serde_json::to_string_pretty(&req_body).unwrap_or_default()
        );

        let resp = capture::send(
            &self.http_client,
            self.http_client.post(channel.api_url()).json(&req_body),
        )
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;
        tracing::debug!("[api] Response status={}, body_len={}", status, text.len());

        let body: BatchProxyResponse = serde_json::from_str(&text).map_err(|e| {
            format!(
                "Failed to parse API response: {} — body preview: {}",
                e,
                &text[..text.len().min(500)]
            )
        })?;

        let game_rsp = body
            .proxy_rsps
            .iter()
            .find(|r| r.kind == "get_latest_game")
            .and_then(|r| r.get_latest_game_rsp.as_ref())
            .ok_or_else(|| "No get_latest_game response found".to_string())?;

        let pkg = game_rsp
            .pkg
            .as_ref()
            .ok_or_else(|| "No package info in response".to_string())?;

        let resource_base_url = pkg.file_path.clone();
        tracing::info!(
            "[api] version={}, resource_url={}",
            game_rsp.version,
            resource_base_url
        );

        if !resource_base_url.starts_with("https://") {
            return Err(format!(
                "Resource URL must be HTTPS, got: {}",
                resource_base_url
            ));
        }

        // 预下载补丁包（pre_patch）：官方在正式发版前提供的分卷压缩包
        let (
            has_preload,
            preload_version,
            preload_parts,
            preload_total_bytes,
            preload_expanded_bytes,
        ) = match game_rsp.pre_patch.as_ref() {
            Some(pre) if !pre.patches.is_empty() => {
                for part in &pre.patches {
                    if !part.url.starts_with("https://") {
                        return Err(format!("Preload part URL must be HTTPS, got: {}", part.url));
                    }
                }
                tracing::info!(
                    "[api] pre_patch: version={}, parts={}, download_bytes={}, expanded_bytes={}",
                    pre.version,
                    pre.patches.len(),
                    pre.total_bytes(),
                    pre.total_size
                );
                (
                    true,
                    Some(pre.version.clone()),
                    pre.patches.clone(),
                    pre.total_bytes(),
                    pre.total_size.parse().unwrap_or(0),
                )
            }
            _ => (false, None, Vec::new(), 0, 0),
        };

        // 版本补丁包（patch）：官方常规更新的主通道。
        // patch.patches 是 WinZip AES-256 加密分卷，密码 = patch.cd_key；patch.url 是未加密整包。
        let patch_info = game_rsp.patch.as_ref();
        let patch_parts: Vec<PatchPart> = patch_info
            .map(|p| {
                p.patches
                    .iter()
                    .filter(|part| !part.url.is_empty())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if !patch_parts.is_empty() {
            for part in &patch_parts {
                if !part.url.starts_with("https://") {
                    return Err(format!("Patch part URL must be HTTPS, got: {}", part.url));
                }
            }
            tracing::info!(
                "[api] patch: parts={}, download_bytes={}, whole_url={}",
                patch_parts.len(),
                patch_info.map(|p| p.total_bytes()).unwrap_or(0),
                patch_info.map(|p| p.url.as_str()).unwrap_or("")
            );
        }

        // 解密密钥：官方真值在 patch.cd_key（`pkg` 里没有该键，见 Games.exe ParseLatestGameJson）。
        // 保留 pkg.cd_key 作为历史形态兜底。
        let cd_key = patch_info
            .and_then(|p| p.normalized_cd_key())
            .or_else(|| {
                pkg.cd_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|key| !key.is_empty())
                    .map(str::to_string)
            });

        Ok((
            RemotePackage {
                version: game_rsp.version.clone(),
                resource_base_url,
                has_preload,
                preload_version,
                preload_parts,
                preload_total_bytes,
                preload_expanded_bytes,
                has_patch: !patch_parts.is_empty(),
                patch_parts,
                patch_total_bytes: patch_info.map(|p| p.total_bytes()).unwrap_or(0),
                has_patch_whole: patch_info
                    .map(|p| !p.url.is_empty())
                    .unwrap_or(false),
            },
            cd_key,
        ))
    }

    /// 检查游戏安装状态
    pub async fn check_status(
        &self,
        channel: &GameChannel,
        install_path: &str,
    ) -> Result<GameStatus, String> {
        tracing::info!(
            "[check_status] channel={}, path={}",
            channel.as_str(),
            install_path
        );
        let path = Path::new(install_path);
        let exe_exists = path.join(channel.executable_name()).exists();
        let config_exists = path.join("config.ini").exists();
        let is_installed = exe_exists && config_exists;
        tracing::info!("[check_status] is_installed={}", is_installed);

        let mut local_version = None;
        if is_installed {
            local_version = self.read_local_version(install_path).ok();
        }

        tracing::info!("[check_status] fetching remote package...");
        // 带上本地版本：官方接口只在这种情况下返回 pre_patch（预下载补丁包）
        let (remote, preload_cd_key) = self
            .get_latest_package_with_cd_key(channel, local_version.as_deref())
            .await?;
        tracing::info!("[check_status] got remote: version={}", remote.version);
        let remote_version = Some(remote.version.clone());

        let has_update =
            if let (Some(ref local), Some(ref remote)) = (&local_version, &remote_version) {
                !Self::versions_equal(local, remote)
            } else {
                false
            };

        // 预下载可用条件：已安装 + 官方提供预下载补丁包 + 本地版本不是预下载目标版本
        let has_preload = is_installed
            && remote.has_preload
            && local_version.as_deref() != remote.preload_version.as_deref();
        let preload_installable = has_preload && preload_cd_key.is_some();

        // Check persisted preload state to see if preload was completed for this version
        let preload_completed = if has_preload {
            let persisted = self.load_payload_state(channel);
            if let Some(ref state) = persisted {
                state.preload_completed
                    && state.preload_version.as_deref() == remote.preload_version.as_deref()
            } else {
                false
            }
        } else {
            false
        };

        let active_operation = self.get_active_operation().await;

        Ok(GameStatus {
            is_installed,
            has_update: has_update || preload_installable,
            local_version,
            remote_version,
            has_preload,
            preload_version: remote.preload_version,
            preload_installable,
            preload_total_bytes: remote.preload_total_bytes,
            preload_completed,
            active_operation,
        })
    }

    /// 扫描安装目录，检查已有文件的完整性
    pub async fn scan_install_dir(
        &self,
        channel: &GameChannel,
        install_path: &str,
    ) -> Result<FileScanResult, String> {
        let path = Path::new(install_path);

        // 检查核心文件
        let has_exe = path.join(channel.executable_name()).exists();
        let has_data = path.join("Endfield_Data").is_dir();
        let has_config = path.join("config.ini").exists();
        let channel_detected = has_exe && has_data && has_config;

        // 获取远程清单
        let remote = self.get_latest_package(channel, None).await?;
        let (manifest, _) = self.fetch_manifest(&remote.resource_base_url).await?;

        let total_files = manifest.len();
        let install_dir = Path::new(install_path);
        let mut valid_files = 0usize;
        let mut corrupted_files = 0usize;
        let mut missing_files = 0usize;
        let mut existing_bytes: u64 = 0;
        let mut download_bytes: u64 = 0;
        let mut corrupted_file_list = Vec::new();
        let mut missing_file_list = Vec::new();

        for entry in &manifest {
            let local_path = install_dir.join(&entry.path);
            let entry_size = entry.size.max(0) as u64;

            if !local_path.exists() {
                missing_files += 1;
                download_bytes += entry_size;
                if missing_file_list.len() < 20 {
                    missing_file_list.push(entry.path.clone());
                }
                continue;
            }

            match fs::metadata(&local_path) {
                Ok(meta) => {
                    if meta.len() as i64 != entry.size {
                        // 大小不匹配
                        corrupted_files += 1;
                        download_bytes += entry_size;
                        if corrupted_file_list.len() < 20 {
                            corrupted_file_list.push(entry.path.clone());
                        }
                        continue;
                    }
                }
                Err(_) => {
                    corrupted_files += 1;
                    download_bytes += entry_size;
                    if corrupted_file_list.len() < 20 {
                        corrupted_file_list.push(entry.path.clone());
                    }
                    continue;
                }
            }

            // 大小匹配，检查 MD5
            match hg_crypto::verify_md5(local_path.to_str().unwrap_or(""), &entry.md5) {
                Ok(true) => {
                    valid_files += 1;
                    existing_bytes += entry_size;
                }
                _ => {
                    corrupted_files += 1;
                    download_bytes += entry_size;
                    if corrupted_file_list.len() < 20 {
                        corrupted_file_list.push(entry.path.clone());
                    }
                }
            }
        }

        tracing::info!(
            "[scan] channel_detected={}, total={}, valid={}, corrupted={}, missing={}, existing_bytes={}, download_bytes={}",
            channel_detected, total_files, valid_files, corrupted_files, missing_files, existing_bytes, download_bytes
        );

        Ok(FileScanResult {
            channel_detected,
            detected_channel: Some(channel.as_str().to_string()),
            total_files,
            valid_files,
            corrupted_files,
            missing_files,
            existing_bytes,
            download_bytes,
            corrupted_file_list,
            missing_file_list,
        })
    }

    /// 读取本地 config.ini 中的版本号
    fn read_local_version(&self, install_path: &str) -> Result<String, String> {
        let config_path = Path::new(install_path).join("config.ini");
        let content =
            hg_crypto::decrypt_file_to_string(config_path.to_str().ok_or("Invalid config path")?)?;

        // 解析版本号，格式类似 "game_version = x.y.z"
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("game_version") || line.starts_with("version") {
                if let Some(pos) = line.find('=') {
                    let value = line[pos + 1..].trim().trim_matches('"').trim_matches('\'');
                    if !value.is_empty() {
                        return Ok(value.to_string());
                    }
                }
            }
        }

        Err("Version not found in config.ini".to_string())
    }

    /// 比较版本号是否相等
    fn versions_equal(a: &str, b: &str) -> bool {
        let parse = |v: &str| -> Vec<u32> {
            let core = v.trim().trim_start_matches('v').trim_start_matches('V');
            let core = if let Some(pos) = core.find(|c: char| c == '-' || c == '+') {
                &core[..pos]
            } else {
                core
            };
            core.split('.').filter_map(|s| s.parse().ok()).collect()
        };

        let a_parts = parse(a);
        let b_parts = parse(b);
        a_parts == b_parts
    }

    // ========== 清单下载与解析 ==========

    /// 下载并解密游戏文件清单
    pub async fn fetch_manifest(
        &self,
        resource_base_url: &str,
    ) -> Result<(Vec<ManifestFile>, String), String> {
        let manifest_url = format!("{}/game_files", resource_base_url);
        tracing::info!("[manifest] Fetching from: {}", manifest_url);

        let resp = capture::send(&self.http_client, self.http_client.get(&manifest_url))
            .await
            .map_err(|e| format!("Failed to download manifest: {}", e))?;

        let status = resp.status();
        tracing::debug!("[manifest] HTTP status: {}", status);

        let encrypted = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read manifest bytes: {}", e))?;

        tracing::debug!("[manifest] Encrypted size: {} bytes", encrypted.len());

        // 计算加密字节的 SHA-256 用于状态跟踪
        let manifest_sha256 = hg_crypto::sha256_hex(&encrypted);
        tracing::debug!("[manifest] SHA-256: {}", manifest_sha256);

        // AES-256-CBC 解密
        let decrypted = hg_crypto::decrypt_bytes_to_string(&encrypted)?;
        tracing::debug!("[manifest] Decrypted size: {} bytes", decrypted.len());

        // 解析 NDJSON（每行一个 JSON 对象）
        let files = Self::parse_manifest(&decrypted)?;
        tracing::info!("[manifest] Parsed {} files", files.len());

        Ok((files, manifest_sha256))
    }

    /// 解析解密后的清单文本（NDJSON 格式）
    fn parse_manifest(content: &str) -> Result<Vec<ManifestFile>, String> {
        let mut files = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for (line_num, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let entry: ManifestFile = serde_json::from_str(line)
                .map_err(|e| format!("Line {}: JSON parse error: {}", line_num + 1, e))?;

            // 验证路径安全性
            Self::validate_path(&entry.path)?;

            // 验证 MD5 格式（32 位十六进制）
            if entry.md5.len() != 32 || !entry.md5.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!(
                    "Line {}: Invalid MD5 '{}' (must be 32 hex chars)",
                    line_num + 1,
                    entry.md5
                ));
            }

            if entry.size < 0 {
                return Err(format!("Line {}: Negative file size", line_num + 1));
            }

            // 检查重复路径
            let normalized = entry.path.replace('\\', "/");
            if !seen.insert(normalized.clone()) {
                return Err(format!(
                    "Line {}: Duplicate path '{}'",
                    line_num + 1,
                    normalized
                ));
            }

            files.push(entry);
        }

        if files.len() > 100_000 {
            return Err(format!(
                "Manifest too large: {} entries (max 100,000)",
                files.len()
            ));
        }

        Ok(files)
    }

    /// 验证路径安全性（防止路径穿越）
    fn validate_path(path: &str) -> Result<(), String> {
        if path.is_empty() {
            return Err("Empty path in manifest".to_string());
        }
        if path.starts_with('/') || path.starts_with('\\') {
            return Err(format!("Absolute path not allowed: '{}'", path));
        }
        if path.contains(':') {
            return Err(format!("Path contains drive letter: '{}'", path));
        }

        let reserved = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];

        for component in path.split(&['/', '\\']) {
            if component == "." || component == ".." {
                return Err(format!("Path traversal not allowed: '{}'", path));
            }
            let upper = component.to_uppercase();
            if reserved.contains(&upper.as_str()) {
                return Err(format!(
                    "Windows reserved name in path: '{}' in '{}'",
                    component, path
                ));
            }
        }

        Ok(())
    }

    // ========== 文件比较与计划 ==========

    /// 比较本地文件与清单，生成更新计划。
    ///
    /// 先按「是否存在 + 大小是否一致」判断；对其中**大小一致且不超过阈值**的文件再计算
    /// MD5，以识别「内容变化但大小不变」的文件——最典型的是 `config.ini` 的版本号（它决定
    /// 本地版本，若不更新则永远提示可更新）。大文件只按大小判断：游戏大资源多为内容寻址，
    /// 内容变化会改变文件名或大小。由此既避免对数 10GB 本地文件做全量哈希，又能正确探测
    /// 版本号等小文件的变化。下载得到的文件仍会在写入时校验 MD5。
    async fn plan_updates(
        &self,
        manifest: &[ManifestFile],
        install_path: &str,
        max_concurrent: usize,
    ) -> Vec<FilePlan> {
        /// 超过该大小的文件不再计算 MD5（只按大小判断）。
        const HASH_MAX_SIZE: i64 = 16 * 1024 * 1024;

        let install_dir = Path::new(install_path);
        let mut plans: Vec<FilePlan> = manifest
            .iter()
            .map(|entry| FilePlan {
                manifest: entry.clone(),
                source_path: None,
            })
            .collect();

        let mut to_hash: Vec<usize> = Vec::new();
        let mut need_download: usize = 0;
        for (idx, entry) in manifest.iter().enumerate() {
            let local_path = install_dir.join(&entry.path);
            let size_ok = fs::metadata(&local_path)
                .map(|m| m.len() as i64 == entry.size)
                .unwrap_or(false);
            if !size_ok {
                // 缺失或大小不符 → 需要下载
                need_download += 1;
                continue;
            }
            if entry.size <= HASH_MAX_SIZE {
                // 小文件：需 MD5 确认内容是否变化
                to_hash.push(idx);
            } else {
                // 大文件：按大小复用
                plans[idx].source_path = Some(local_path.to_string_lossy().to_string());
            }
        }

        tracing::info!(
            "[compare] {} files: {} need download, {} small files to hash",
            manifest.len(),
            need_download,
            to_hash.len()
        );

        let semaphore = Arc::new(Semaphore::new(max_concurrent.max(1).min(32)));
        let mut join_set = tokio::task::JoinSet::new();
        for &idx in &to_hash {
            let local_path = install_dir.join(&manifest[idx].path);
            let expected_md5 = manifest[idx].md5.clone();
            let sem = semaphore.clone();
            join_set.spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(permit) => permit,
                    Err(_) => return None,
                };
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    return None;
                }
                let path_str = local_path.to_string_lossy().to_string();
                let matched = tokio::task::spawn_blocking(move || {
                    hg_crypto::verify_md5(&path_str, &expected_md5).unwrap_or(false)
                })
                .await
                .unwrap_or(false);
                if matched {
                    Some(idx)
                } else {
                    None
                }
            });
        }
        while let Some(joined) = join_set.join_next().await {
            if let Ok(Some(idx)) = joined {
                let path = install_dir.join(&plans[idx].manifest.path);
                plans[idx].source_path = Some(path.to_string_lossy().to_string());
            }
        }

        plans
    }

    // ========== 下载 ==========

    /// 下载单个文件，支持断点续传和重试
    pub async fn download_file_with_resume(
        &self,
        url: &str,
        dest_path: &str,
        progress_callback: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let download_path = format!("{}.download", dest_path);
        let download_file = Path::new(&download_path);

        // 确保目标目录存在
        if let Some(parent) = Path::new(dest_path).parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let mut start_byte: u64 = 0;

        // 检查是否有未完成的下载（断点续传）
        if download_file.exists() {
            if let Ok(meta) = fs::metadata(download_file) {
                start_byte = meta.len();
                if start_byte > 0 {
                    tracing::info!(
                        "Resuming download from byte {} for {}",
                        start_byte,
                        dest_path
                    );
                }
            }
        }

        let max_retries = 3;
        let mut last_error = String::new();

        for attempt in 0..max_retries {
            if attempt > 0 {
                // 指数退避
                let delay = Duration::from_secs(attempt as u64);
                tokio::time::sleep(delay).await;
                start_byte = 0; // 重试时从头下载
            }

            let mut req = self.download_client.get(url);
            if start_byte > 0 {
                req = req.header("Range", format!("bytes={}-", start_byte));
            }

            match capture::send_stream(&self.download_client, req).await {
                Ok(resp) => {
                    let status = resp.status();
                    let is_partial = status == 206;
                    let is_ok = status == 200;

                    if !is_partial && !is_ok {
                        last_error = format!("HTTP {}", status);
                        continue;
                    }

                    // 如果服务器不支持 Range，从头开始
                    if is_ok && start_byte > 0 {
                        start_byte = 0;
                    }

                    let total = resp.content_length().unwrap_or(0) + start_byte;

                    let mut file = if start_byte > 0 && is_partial {
                        // 追加模式
                        fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&download_path)
                            .map_err(|e| format!("Failed to open file for append: {}", e))?
                    } else {
                        // 新建文件
                        fs::File::create(&download_path)
                            .map_err(|e| format!("Failed to create file: {}", e))?
                    };

                    let mut stream = resp.bytes_stream();
                    let mut downloaded = start_byte;
                    let mut last_emit = start_byte;

                    while let Some(chunk) = stream.next().await {
                        // 检查取消标志
                        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                            drop(file);
                            let _ = fs::remove_file(&download_path);
                            return Err("Download cancelled".to_string());
                        }

                        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
                        file.write_all(&chunk)
                            .map_err(|e| format!("Write error: {}", e))?;
                        downloaded += chunk.len() as u64;

                        // 每 256KB 报告一次进度
                        if downloaded - last_emit >= 256 * 1024 || downloaded == total {
                            progress_callback(downloaded, total);
                            last_emit = downloaded;
                        }
                    }

                    file.flush().map_err(|e| format!("Flush error: {}", e))?;
                    drop(file);

                    // MD5 校验
                    if !hg_crypto::verify_md5(
                        &download_path,
                        &hg_crypto::md5_hex(&fs::read(&download_path).unwrap_or_default()),
                    )? {
                        // 从清单 URL 中无法获取预期 MD5，跳过此处校验
                        // 清单校验在批量完成后统一进行
                    }

                    // 重命名为最终文件
                    fs::rename(&download_path, dest_path)
                        .map_err(|e| format!("Failed to rename: {}", e))?;

                    return Ok(());
                }
                Err(e) => {
                    last_error = e.to_string();
                    continue;
                }
            }
        }

        Err(format!(
            "Download failed after {} attempts: {}",
            max_retries, last_error
        ))
    }

    /// 下载文件并验证 MD5
    pub async fn download_and_verify(
        &self,
        url: &str,
        dest_path: &str,
        expected_md5: &str,
        progress_callback: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        self.download_file_with_resume(url, dest_path, progress_callback)
            .await?;

        // 下载后验证 MD5
        let verified = hg_crypto::verify_md5(dest_path, expected_md5)
            .map_err(|e| format!("MD5 verify error: {}", e))?;

        if !verified {
            let _ = fs::remove_file(dest_path);
            return Err(format!(
                "MD5 mismatch for {}: expected {}",
                dest_path, expected_md5
            ));
        }

        Ok(())
    }

    // ========== 完整安装/更新流程 ==========

    /// 执行完整的安装或更新流程
    /// 返回下载的总字节数
    ///
    /// `max_concurrent` 为同时下载的文件数，`resume` 控制中断后是否保留分片以便续传。
    pub async fn install_or_update(
        &self,
        channel: &GameChannel,
        install_path: &str,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        max_concurrent: usize,
        resume: bool,
    ) -> Result<String, String> {
        let max_concurrent = max_concurrent.clamp(1, 32);
        CANCEL_CLEANUP_REQUESTED.store(false, Ordering::SeqCst);
        if self.has_active_operation().await {
            return Err("Another operation is in progress".to_string());
        }
        // 1. 检查阶段
        tracing::info!(
            "[install] Starting install_or_update: channel={}, path={}",
            channel.as_str(),
            install_path
        );
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: 0,
            stage: InstallStage::Checking.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: 0,
            verified_bytes: 0,
        });

        // 官方客户端始终上报本地版本：只有带上版本时服务端才会返回 `patch`（含 cd_key）
        // 与 `pre_patch`。全新安装（无本地版本）时 `patch` 为 null，自动走清单逐文件路径。
        let local_version = self.read_local_version(install_path).ok();
        let (remote, patch_cd_key) = self
            .get_latest_package_with_cd_key(channel, local_version.as_deref())
            .await?;
        tracing::info!(
            "[install] Remote version: {}, resource: {}, patch_parts: {}, has_key: {}",
            remote.version,
            remote.resource_base_url,
            remote.patch_parts.len(),
            patch_cd_key.is_some()
        );

        // 1.5 补丁包优先：官方常规更新走"下载加密分卷 → 7zg 解压 → 覆盖/删除"，比按清单逐文件
        // 下载省得多（实测 1.6.3→1.6.4 只需 3 MB 补丁包，而清单差异可达 GB 级）。
        // 差量形态（含 hpatch `_patch` 条目）本实现不支持，检测到后回退清单路径。
        if remote.has_patch && !remote.patch_parts.is_empty() {
            match patch_cd_key.as_deref() {
                Some(key) => {
                    tracing::info!(
                        "[install] Using patch archive: {} parts, {} bytes",
                        remote.patch_parts.len(),
                        remote.patch_total_bytes
                    );
                    match self
                        .install_from_archive_parts(
                            channel,
                            install_path,
                            &remote.patch_parts,
                            key,
                            0,
                            progress_callback.clone(),
                            max_concurrent,
                            resume,
                        )
                        .await
                    {
                        Ok(version) => {
                            progress_callback(DownloadProgress {
                                stage: InstallStage::Completed.as_str().to_string(),
                                ..Default::default()
                            });
                            return Ok(version);
                        }
                        Err(error) if error.starts_with(ERR_DELTA_ARCHIVE) => {
                            tracing::warn!(
                                "[install] Patch archive is delta-based (needs hpatch), falling back to manifest download: {}",
                                error
                            );
                        }
                        Err(error) => {
                            progress_callback(DownloadProgress {
                                stage: InstallStage::Error.as_str().to_string(),
                                ..Default::default()
                            });
                            return Err(error);
                        }
                    }
                }
                None => {
                    tracing::warn!(
                        "[install] Server offered a patch archive without cd_key; falling back to manifest download"
                    );
                }
            }
        }

        // 2. 下载并解密清单
        tracing::info!("[install] Fetching manifest...");
        let (manifest, manifest_sha256) = self.fetch_manifest(&remote.resource_base_url).await?;
        tracing::info!("[install] Manifest loaded: {} files", manifest.len());

        // 3. 比较阶段
        tracing::info!("[install] Comparing local vs manifest...");
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: 0,
            stage: InstallStage::Comparing.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: manifest.len(),
            verified_bytes: 0,
        });

        let plans = self.plan_updates(&manifest, install_path, 16).await;

        if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
            progress_callback(DownloadProgress {
                stage: InstallStage::Error.as_str().to_string(),
                ..Default::default()
            });
            return Err("Install cancelled".to_string());
        }

        let mut files_to_download: Vec<&FilePlan> =
            plans.iter().filter(|p| p.source_path.is_none()).collect();

        tracing::info!(
            "[install] Plan: {} files to download (out of {} total)",
            files_to_download.len(),
            manifest.len()
        );

        if files_to_download.is_empty() {
            // 已经是最新版本：清理可能残留的续传暂存
            let stale_staging = format!("{}{}", install_path, INSTALL_STAGING_SUFFIX);
            let stale_marker = format!("{}{}", install_path, INSTALL_STAGING_VERSION_SUFFIX);
            if Path::new(&stale_staging).exists() {
                let _ = fs::remove_dir_all(&stale_staging);
                let _ = fs::remove_file(&stale_marker);
            }
            tracing::info!("[install] Already up to date, saving state");
            self.save_payload_state(channel, &remote.version, &manifest_sha256, &manifest)?;
            return Ok(remote.version);
        }

        // 4. 创建/复用固定暂存目录（固定名称让取消或失败后的分片在下次继续使用）
        let staging_dir = format!("{}{}", install_path, INSTALL_STAGING_SUFFIX);
        let staging_version_marker = format!("{}{}", install_path, INSTALL_STAGING_VERSION_SUFFIX);
        tracing::info!("[install] Staging dir: {}", staging_dir);
        let staging_path = PathBuf::from(&staging_dir);
        let previous_version = fs::read_to_string(&staging_version_marker).ok();
        if staging_path.exists()
            && previous_version.as_deref().map(str::trim) != Some(remote.version.as_str())
        {
            tracing::info!(
                "[install] Discarding stale staging for version {:?}",
                previous_version
            );
            let _ = fs::remove_dir_all(&staging_path);
        }
        if !staging_path.exists() {
            fs::create_dir_all(&staging_path)
                .map_err(|e| format!("Failed to create staging dir: {}", e))?;
            fs::write(&staging_version_marker, &remote.version)
                .map_err(|e| format!("Failed to write staging version: {}", e))?;
        }

        let install_dir = Path::new(install_path);

        let result = async {
            // 5. 只暂存需要更新的文件：本地已存在且 MD5 匹配的文件保持原样，
            //    不再整目录拷贝到暂存区，更新时只需下载/应用变更文件。
            // 6. 下载缺失/异常文件（并发下载） — 优先使用预下载文件
            let total_bytes: u64 = files_to_download
                .iter()
                .map(|p| p.manifest.size.max(0) as u64)
                .sum();

            // 预下载的产物是**加密分卷 zip**（官方 `predownload` 目录同理），不是清单里的
            // 游戏文件，因此不能按 `manifest.path` 去复用（旧实现就是在这里恒不命中，导致
            // 预下载流量白费）。分卷的复用发生在补丁包路径：按"同名 + MD5 一致"直接从
            // 预下载暂存搬到补丁暂存（见 download_parts_to_staging / bUsePreDownloadZip 等价逻辑）。
            let reused_bytes = 0u64;

            // 复用上次中断时已下载完成的暂存文件；未完成的分片计入已完成字节，
            // 下载时由 download_single_file 按 Range 续传。关闭续传时不复用。
            let mut resumed_bytes = reused_bytes;
            let mut staged_reused = 0u64;
            if resume {
                files_to_download.retain(|plan| {
                    let dest = staging_path.join(&plan.manifest.path);
                    let size = plan.manifest.size.max(0) as u64;
                    let Ok(meta) = fs::metadata(&dest) else {
                        return true;
                    };
                    if meta.len() != size {
                        return true;
                    }
                    // 小文件重新校验 MD5（大文件下载完成时已经校验过）
                    if size <= STAGED_REUSE_HASH_LIMIT
                        && !hg_crypto::verify_md5(dest.to_str().unwrap_or(""), &plan.manifest.md5)
                            .unwrap_or(false)
                    {
                        let _ = fs::remove_file(&dest);
                        return true;
                    }
                    staged_reused += size;
                    false
                });
                if staged_reused > 0 {
                    tracing::info!(
                        "[install] Reused {} bytes from previous staging files",
                        staged_reused
                    );
                }
                for plan in &files_to_download {
                    let partial = format!(
                        "{}.download",
                        staging_path.join(&plan.manifest.path).display()
                    );
                    if let Ok(meta) = fs::metadata(&partial) {
                        if meta.is_file() {
                            resumed_bytes += meta.len().min(plan.manifest.size.max(0) as u64);
                        }
                    }
                }
            }

            let file_count = files_to_download.len();
            tracing::info!(
                "[install] Downloading {} files, total {} bytes (resume={}, concurrent={}, already={})",
                file_count,
                total_bytes,
                resume,
                max_concurrent,
                resumed_bytes
            );

            let downloaded_bytes = Arc::new(AtomicU64::new(resumed_bytes));
            let semaphore = Arc::new(Semaphore::new(max_concurrent));
            let mut join_set = tokio::task::JoinSet::new();

            // Background task: emit progress every 500ms
            let progress_cb_bg = progress_callback.clone();
            let dl_bytes_bg = downloaded_bytes.clone();
            let total_bytes_bg = total_bytes;
            let file_count_bg = file_count;
            let progress_handle = tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(500));
                loop {
                    interval.tick().await;
                    let current = dl_bytes_bg.load(Ordering::Relaxed).min(total_bytes_bg);
                    if current >= total_bytes_bg && total_bytes_bg > 0 {
                        break;
                    }
                    progress_cb_bg(DownloadProgress {
                        downloaded: current,
                        total: total_bytes_bg,
                        stage: InstallStage::Downloading.as_str().to_string(),
                        current_file: None,
                        file_index: 0,
                        file_count: file_count_bg,
                        verified_bytes: 0,
                    });
                }
            });

            for (idx, plan) in files_to_download.iter().enumerate() {
                let dest = staging_path.join(&plan.manifest.path);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
                }

                let dest_str = dest.to_string_lossy().to_string();
                let file_name = plan.manifest.path.clone();
                let file_size = plan.manifest.size.max(0) as u64;
                let expected_md5 = plan.manifest.md5.clone();
                let resource_url = remote.resource_base_url.clone();
                let dl_bytes = downloaded_bytes.clone();
                let sem = semaphore.clone();
                let client = self.download_client.clone();
                let download_url = format!("{}/{}", resource_url, plan.manifest.path);

                tracing::debug!(
                    "[install] Spawn download {}/{}: {} ({} bytes)",
                    idx + 1,
                    file_count,
                    file_name,
                    file_size
                );

                join_set.spawn(async move {
                    let permit = match sem.acquire().await {
                        Ok(p) => p,
                        Err(e) => return (Err(format!("Semaphore: {}", e)), file_name),
                    };
                    let result = download_single_file(
                        &client,
                        &download_url,
                        &dest_str,
                        &expected_md5,
                        dl_bytes.clone(),
                        file_size,
                        resume,
                    )
                    .await;
                    drop(permit);
                    if let Err(ref e) = result {
                        tracing::error!("[install] Download FAILED: {} — {}", file_name, e);
                    }
                    (result, file_name)
                });
            }

            // Wait for all downloads + report per-file completion
            let mut completed = 0u32;
            let mut failed_files = Vec::new();
            while let Some(res) = join_set.join_next().await {
                let (result, file_name) =
                    res.map_err(|e| format!("Task join error: {}", e))?;
                completed += 1;
                match result {
                    Ok(()) => {
                        tracing::debug!(
                            "[install] Completed {}/{}: {}",
                            completed,
                            file_count,
                            file_name
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            "[install] Failed {}/{}: {} — {}",
                            completed,
                            file_count,
                            file_name,
                            e
                        );
                        failed_files.push((file_name, e));
                    }
                }
            }

            // Stop the progress emitter
            progress_handle.abort();

            if !failed_files.is_empty() {
                let summary: Vec<String> = failed_files
                    .iter()
                    .map(|(n, e)| format!("{}: {}", n, e))
                    .take(5)
                    .collect();
                return Err(format!(
                    "{} files failed: {}",
                    failed_files.len(),
                    summary.join("; ")
                ));
            }

            tracing::info!(
                "[install] All {} downloads complete, applying staged files...",
                file_count
            );

            // 7. 跳过全量校验：下载文件在 download_single_file 中已按 MD5 校验，
            //    本地文件在 plan_updates 中已按大小匹配；安装完成后由前端触发快速校验。

            // 8. 应用阶段：原子替换
            progress_callback(DownloadProgress {
                downloaded: total_bytes,
                total: total_bytes,
                stage: InstallStage::Applying.as_str().to_string(),
                current_file: None,
                file_index: 0,
                file_count: manifest.len(),
                verified_bytes: 0,
            });

            self.apply_staged_files(&staging_path, install_dir)?;

            // 9. 保存状态
            tracing::info!("[install] Saving payload state...");
            self.save_payload_state(channel, &remote.version, &manifest_sha256, &manifest)?;

            tracing::info!("[install] Install complete! Version: {}", remote.version);
            Ok::<String, String>(remote.version)
        }
        .await;

        // 成功时清理暂存；失败/取消且启用续传时保留，供下次安装复用与续传。
        let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
        let keep_staging =
            result.is_err() && resume && !cleanup_requested && dir_has_files(&staging_path);
        if keep_staging {
            tracing::info!(
                "[install] Keeping staging dir for resume: {} (cleanup_requested={})",
                staging_dir,
                cleanup_requested
            );
        } else {
            tracing::info!("[install] Cleaning up staging dir: {}", staging_dir);
            let _ = fs::remove_dir_all(&staging_path);
            let _ = fs::remove_file(&staging_version_marker);
        }

        match result {
            Ok(version) => {
                tracing::info!("[install] Install SUCCESS: version={}", version);
                progress_callback(DownloadProgress {
                    downloaded: 0,
                    total: 0,
                    stage: InstallStage::Completed.as_str().to_string(),
                    current_file: None,
                    file_index: 0,
                    file_count: 0,
                    verified_bytes: 0,
                });
                Ok(version)
            }
            Err(e) => {
                tracing::error!("[install] Install FAILED: {}", e);
                progress_callback(DownloadProgress {
                    downloaded: 0,
                    total: 0,
                    stage: InstallStage::Error.as_str().to_string(),
                    current_file: None,
                    file_index: 0,
                    file_count: 0,
                    verified_bytes: 0,
                });
                Err(e)
            }
        }
    }

    /// 原子替换：将暂存目录中的文件移动到安装目录
    fn apply_staged_files(&self, staging: &Path, target: &Path) -> Result<(), String> {
        // 对于暂存目录中的每个文件，直接复制/覆盖到目标
        for entry in WalkDir::new(staging) {
            let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
            if entry.file_type().is_file() {
                let relative = entry
                    .path()
                    .strip_prefix(staging)
                    .map_err(|e| format!("Strip prefix error: {}", e))?;
                let dest = target.join(relative);

                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Create dir error: {}", e))?;
                }

                fs::copy(entry.path(), &dest)
                    .map_err(|e| format!("Copy error {}: {}", relative.display(), e))?;
            }
        }

        Ok(())
    }
    // ========== 完整性修复 ==========

    /// 验证游戏文件完整性并修复（多线程校验 + 即时修复）
    pub async fn verify_and_repair(
        &self,
        channel: &GameChannel,
        install_path: &str,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        max_concurrent: usize,
        quick: bool,
        resume: bool,
    ) -> Result<String, String> {
        let max_concurrent = max_concurrent.max(1).min(32);
        if self.has_active_operation().await {
            return Err("Another operation is in progress".to_string());
        }
        tracing::info!(
            "[verify] ======== verify_and_repair START ======== channel={:?}, install_path={}, max_concurrent={}, quick={}",
            channel, install_path, max_concurrent, quick
        );

        // 1. 获取远程清单
        tracing::info!("[verify] Step 1: Fetching remote package info...");
        let remote = self.get_latest_package(channel, None).await?;
        tracing::info!(
            "[verify] Remote package: version={}, resource_base_url={}",
            remote.version,
            remote.resource_base_url
        );

        tracing::info!(
            "[verify] Step 2: Fetching manifest from {}/game_files ...",
            remote.resource_base_url
        );
        let (manifest, _) = self.fetch_manifest(&remote.resource_base_url).await?;
        tracing::info!("[verify] Manifest parsed: {} files", manifest.len());
        if manifest.is_empty() {
            tracing::warn!("[verify] WARNING: Manifest is empty! Nothing to verify.");
        }

        let total_verify_bytes: u64 = manifest.iter().map(|e| e.size as u64).sum();
        let file_count = manifest.len();
        let install_dir = Path::new(install_path);

        tracing::info!(
            "[verify] Total expected: {} files, {} bytes ({:.2} MB)",
            file_count,
            total_verify_bytes,
            total_verify_bytes as f64 / 1048576.0
        );

        // 检查安装目录
        if !install_dir.exists() {
            tracing::error!(
                "[verify] ERROR: Install directory does not exist: {}",
                install_path
            );
            return Err(format!(
                "Install directory does not exist: {}",
                install_path
            ));
        }
        tracing::info!("[verify] Install directory exists: {}", install_path);

        // ==================== Phase 1: 检查所有文件 ====================
        tracing::info!(
            "[verify] ======== Phase 1: Check files (quick={}) ========",
            quick
        );
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: total_verify_bytes,
            stage: InstallStage::Verifying.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count,
            verified_bytes: 0,
        });

        let checked_count = Arc::new(AtomicUsize::new(0));
        let verified_bytes = Arc::new(AtomicU64::new(0));
        let semaphore = Arc::new(Semaphore::new(max_concurrent));
        let mut check_set = tokio::task::JoinSet::new();

        // 需要修复的文件清单
        let repair_list: Arc<Mutex<Vec<(ManifestFile, String)>>> = Arc::new(Mutex::new(Vec::new()));

        // 后台进度发射器（检查阶段）
        let progress_cb_bg = progress_callback.clone();
        let vb_bg = verified_bytes.clone();
        let cc_bg = checked_count.clone();
        let total_bg = total_verify_bytes;
        let fc_bg = file_count;
        let check_progress_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    break;
                }
                let vb = vb_bg.load(Ordering::Relaxed);
                let cc = cc_bg.load(Ordering::Relaxed);
                if vb >= total_bg && total_bg > 0 {
                    break;
                }
                progress_cb_bg(DownloadProgress {
                    downloaded: 0,
                    total: total_bg,
                    stage: InstallStage::Verifying.as_str().to_string(),
                    current_file: None,
                    file_index: cc,
                    file_count: fc_bg,
                    verified_bytes: vb,
                });
            }
        });

        tracing::info!(
            "[verify] Spawning {} check tasks (max_concurrent={})...",
            file_count,
            max_concurrent
        );

        for (idx, entry) in manifest.iter().enumerate() {
            let local_path = install_dir.join(&entry.path);
            let entryClone = entry.clone();
            let entry_path = entry.path.clone();
            let entry_md5 = entry.md5.clone();
            let entry_size = entry.size.max(0) as u64;
            let sem = semaphore.clone();
            let vb = verified_bytes.clone();
            let cc = checked_count.clone();
            let rl = repair_list.clone();

            check_set.spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    tracing::debug!("[verify] Cancelled, skipping {}", entry_path);
                    vb.fetch_add(entry_size, Ordering::Relaxed);
                    cc.fetch_add(1, Ordering::Relaxed);
                    return;
                }

                // 检查文件是否存在 + 大小（快速模式跳过 MD5）
                let exists = local_path.exists();
                let actual_size = if exists {
                    fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };

                let size_ok = exists && actual_size == entry_size;

                let md5_ok = if !exists {
                    false
                } else if !size_ok {
                    false
                } else if quick {
                    true // 快速模式跳过 MD5
                } else {
                    let hash_path = local_path.clone();
                    let hash_expected = entry_md5.clone();
                    match tokio::task::spawn_blocking(move || {
                        hg_crypto::verify_md5_with_cancel(
                            hash_path.to_str().unwrap_or(""),
                            &hash_expected,
                            Some(&DOWNLOAD_CANCELLED),
                        )
                    })
                    .await
                    {
                        Ok(Ok(true)) => true,
                        Ok(Ok(false)) => {
                            tracing::debug!(
                                "[verify]   MD5 mismatch: {} (expected={}, actual=?)",
                                entry_path,
                                entry_md5
                            );
                            false
                        }
                        Ok(Err(e)) => {
                            tracing::warn!("[verify]   MD5 check error for {}: {}", entry_path, e);
                            false
                        }
                        Err(e) => {
                            tracing::warn!("[verify]   MD5 worker error for {}: {}", entry_path, e);
                            false
                        }
                    }
                };

                let needs_repair = !exists || !size_ok || !md5_ok;

                if needs_repair {
                    let reason = if !exists {
                        "MISSING"
                    } else if !size_ok {
                        &format!(
                            "SIZE_MISMATCH(expected={},actual={})",
                            entry_size, actual_size
                        )
                    } else {
                        "MD5_MISMATCH"
                    };
                    tracing::info!(
                        "[verify]   [{}] NEEDS_REPAIR: {} ({})",
                        idx,
                        entry_path,
                        reason
                    );
                    rl.lock().await.push((entryClone, entry_path));
                } else if idx % 500 == 0 || idx < 5 {
                    tracing::debug!(
                        "[verify]   [{}] OK: {} ({} bytes)",
                        idx,
                        entry_path,
                        entry_size
                    );
                }

                vb.fetch_add(entry_size, Ordering::Relaxed);
                cc.fetch_add(1, Ordering::Relaxed);
            });
        }

        // 等待所有检查任务完成
        tracing::info!("[verify] Waiting for all check tasks to complete...");
        while let Some(result) = check_set.join_next().await {
            if let Err(e) = result {
                tracing::error!("[verify] Check task panicked: {}", e);
            }
        }
        let _ = check_progress_handle.await;

        let total_checked = checked_count.load(Ordering::Relaxed);
        let pending_repair = repair_list.lock().await;

        if DOWNLOAD_CANCELLED.load(Ordering::Acquire) {
            tracing::info!("[verify] Cancelled after phase 1; skipping repair phase");
            return Err("Verification cancelled".to_string());
        }

        tracing::info!(
            "[verify] ======== Phase 1 DONE: {}/{} files checked, {} need repair ========",
            total_checked,
            file_count,
            pending_repair.len()
        );

        if !pending_repair.is_empty() {
            for (entry, path) in pending_repair.iter().take(10) {
                tracing::info!(
                    "[verify]   damaged: {} (size={}, md5={})",
                    path,
                    entry.size,
                    entry.md5
                );
            }
            if pending_repair.len() > 10 {
                tracing::info!(
                    "[verify]   ... and {} more damaged files",
                    pending_repair.len() - 10
                );
            }
        }

        // ==================== Phase 2: 修复有问题的文件 ====================
        // 在 drop 前收集损坏文件名列表
        let damaged_files: Vec<String> = pending_repair.iter().map(|(_, p)| p.clone()).collect();
        let damaged_count = damaged_files.len();

        if pending_repair.is_empty() {
            progress_callback(DownloadProgress {
                downloaded: 0,
                total: total_verify_bytes,
                stage: InstallStage::Completed.as_str().to_string(),
                current_file: None,
                file_index: total_checked,
                file_count,
                verified_bytes: total_verify_bytes,
            });
            tracing::info!("[verify] All files verified OK — no repair needed");
            return Ok("All files verified OK".to_string());
        }

        tracing::info!(
            "[verify] ======== Phase 2: Repair {} files ========",
            pending_repair.len()
        );
        let repair_total: u64 = pending_repair
            .iter()
            .map(|(e, _)| e.size.max(0) as u64)
            .sum();
        let repair_count = pending_repair.len();

        progress_callback(DownloadProgress {
            downloaded: 0,
            total: repair_total,
            stage: InstallStage::Repairing.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: repair_count,
            verified_bytes: 0,
        });

        let repaired_count = Arc::new(AtomicUsize::new(0));
        let repaired_bytes = Arc::new(AtomicU64::new(0));
        let sem2 = Arc::new(Semaphore::new(max_concurrent));
        let mut repair_set = tokio::task::JoinSet::new();

        // 后台进度发射器（修复阶段）
        let progress_cb_bg2 = progress_callback.clone();
        let rb_bg = repaired_bytes.clone();
        let rc_bg = repaired_count.clone();
        let rt_bg = repair_total;
        let rpc_bg = repair_count;
        let repair_progress_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    break;
                }
                let rb = rb_bg.load(Ordering::Relaxed);
                let rc = rc_bg.load(Ordering::Relaxed);
                if rb >= rt_bg && rt_bg > 0 {
                    break;
                }
                progress_cb_bg2(DownloadProgress {
                    downloaded: 0,
                    total: rt_bg,
                    stage: InstallStage::Repairing.as_str().to_string(),
                    current_file: None,
                    file_index: rc,
                    file_count: rpc_bg,
                    verified_bytes: rb,
                });
            }
        });

        for (entry, entry_path) in pending_repair.iter() {
            let local_path = install_dir.join(&entry.path);
            let entry_path = entry_path.clone();
            let entry_md5 = entry.md5.clone();
            let entry_size = entry.size.max(0) as u64;
            let resource_url = remote.resource_base_url.clone();
            let sem = sem2.clone();
            let rb = repaired_bytes.clone();
            let rc = repaired_count.clone();
            let client = self.download_client.clone();

            repair_set.spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    tracing::debug!("[verify] Repair cancelled, skipping {}", entry_path);
                    rb.fetch_add(entry_size, Ordering::Relaxed);
                    rc.fetch_add(1, Ordering::Relaxed);
                    return;
                }

                let dest = local_path
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_default();
                let _ = fs::create_dir_all(&dest);
                let dest_file = dest.join(local_path.file_name().unwrap_or_default());
                let dest_str = dest_file.to_string_lossy().to_string();
                let download_url = format!("{}/{}", resource_url, entry_path);
                tracing::info!(
                    "[verify] Repairing: {} -> {} ({} bytes, md5={})",
                    download_url,
                    dest_str,
                    entry_size,
                    entry_md5
                );
                match download_single_file(
                    &client,
                    &download_url,
                    &dest_str,
                    &entry_md5,
                    Arc::new(AtomicU64::new(0)),
                    entry_size,
                    resume,
                )
                .await
                {
                    Ok(()) => {
                        tracing::info!("[verify] Repair OK: {}", entry_path);
                        rc.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        tracing::error!("[verify] FAILED to repair {}: {}", entry_path, e);
                    }
                }

                rb.fetch_add(entry_size, Ordering::Relaxed);
            });
        }

        drop(pending_repair);

        // 等待所有修复任务完成
        tracing::info!("[verify] Waiting for all repair tasks to complete...");
        while let Some(result) = repair_set.join_next().await {
            if let Err(e) = result {
                tracing::error!("[verify] Repair task panicked: {}", e);
            }
        }
        let _ = repair_progress_handle.await;

        if DOWNLOAD_CANCELLED.load(Ordering::Acquire) {
            tracing::info!("[verify] Cancelled after repair tasks stopped");
            return Err("Verification cancelled".to_string());
        }

        let total_repaired = repaired_count.load(Ordering::Relaxed);

        tracing::info!(
            "[verify] ======== Phase 2 DONE: repaired {}/{} files ========",
            total_repaired,
            repair_count
        );

        // 最终进度
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: total_verify_bytes,
            stage: InstallStage::Completed.as_str().to_string(),
            current_file: None,
            file_index: total_checked,
            file_count,
            verified_bytes: total_verify_bytes,
        });

        tracing::info!(
            "[verify] ======== verify_and_repair END ======== Repaired {} files",
            total_repaired
        );

        // 构建结果：返回 JSON 结构数据，由前端做本地化
        let result = if damaged_count > 0 {
            let ok_count = total_checked.saturating_sub(damaged_count);
            let files: Vec<String> = damaged_files.iter().cloned().collect();
            serde_json::json!({
                "ok": ok_count,
                "failed": damaged_count,
                "repaired": total_repaired,
                "files": files,
            })
            .to_string()
        } else {
            serde_json::json!({
                "ok": total_checked,
                "failed": 0,
                "repaired": 0,
                "files": Vec::<String>::new(),
            })
            .to_string()
        };
        Ok(result)
    }

    // ========== 预下载 ==========

    /// 预下载游戏更新资源
    pub async fn preload_download(
        &self,
        channel: &GameChannel,
        install_path: &str,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        max_concurrent: usize,
        resume: bool,
        remote_package: Option<RemotePackage>,
    ) -> Result<String, String> {
        CANCEL_CLEANUP_REQUESTED.store(false, Ordering::SeqCst);
        // 1. 读取本地版本（接口只在上报本地版本时返回 pre_patch）
        let local_version = self.read_local_version(install_path).ok();

        // Reuse package metadata already fetched by install_preload.
        let remote = match remote_package {
            Some(remote) => remote,
            None => {
                self.get_latest_package_with_cd_key(channel, local_version.as_deref())
                    .await?
                    .0
            }
        };

        let preload_version = remote
            .preload_version
            .clone()
            .ok_or_else(|| "No preload package available".to_string())?;

        if remote.preload_parts.is_empty() {
            return Err("No preload package available".to_string());
        }

        if local_version.as_deref() == Some(preload_version.as_str()) {
            progress_callback(DownloadProgress {
                downloaded: 0,
                total: 0,
                stage: InstallStage::Completed.as_str().to_string(),
                current_file: None,
                file_index: 0,
                file_count: 0,
                verified_bytes: 0,
            });
            return Ok(format!("Already at version {}", preload_version));
        }

        let parts = remote.preload_parts;
        let part_count = parts.len();
        let total_bytes = remote.preload_total_bytes;

        tracing::info!(
            "[preload] Starting preload: version={}, {} parts, {} bytes",
            preload_version,
            part_count,
            total_bytes
        );

        // 3. 开始下载阶段：复用同版本暂存以支持续传。
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: total_bytes,
            stage: InstallStage::Preloading.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: part_count,
            verified_bytes: 0,
        });

        // 同版本的旧暂存直接复用，异版本先删除。
        let staging_path = match self.preload_staging_dir(install_path) {
            Some(dir)
                if Self::preload_staging_version(&dir).as_deref()
                    == Some(preload_version.as_str()) =>
            {
                tracing::info!("[preload] Reusing preload staging dir: {}", dir);
                PathBuf::from(dir)
            }
            Some(dir) => {
                tracing::info!("[preload] Removing stale preload staging dir: {}", dir);
                let _ = fs::remove_dir_all(&dir);
                Self::create_preload_staging(install_path, &preload_version)?
            }
            None => Self::create_preload_staging(install_path, &preload_version)?,
        };
        // 5. 并发下载所有分卷（download_single_file 内部完成单卷 MD5 校验与断点续传）
        let downloaded_bytes = Arc::new(AtomicU64::new(0));
        let finished_parts = Arc::new(AtomicUsize::new(0));
        let semaphore = Arc::new(Semaphore::new(max_concurrent.clamp(1, 32)));
        let mut join_set = tokio::task::JoinSet::new();

        // 后台进度发射器
        let progress_cb_bg = progress_callback.clone();
        let db_bg = downloaded_bytes.clone();
        let fp_bg = finished_parts.clone();
        let total_bg = total_bytes;
        let pc_bg = part_count;
        let progress_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    break;
                }
                let db = db_bg.load(Ordering::Relaxed);
                let fp = fp_bg.load(Ordering::Relaxed);
                if (db >= total_bg && total_bg > 0) || fp >= pc_bg {
                    break;
                }
                progress_cb_bg(DownloadProgress {
                    downloaded: db,
                    total: total_bg,
                    stage: InstallStage::Preloading.as_str().to_string(),
                    current_file: None,
                    file_index: fp,
                    file_count: pc_bg,
                    verified_bytes: 0,
                });
            }
        });

        for (index, part) in parts.iter().enumerate() {
            let file_name = Self::preload_part_file_name(&part.url, index);
            let dest = staging_path.join(&file_name);
            let dest_str = dest.to_string_lossy().to_string();
            let part_url = part.url.clone();
            let part_md5 = part.md5.clone();
            let part_size = part.size();
            let sem = semaphore.clone();
            let db = downloaded_bytes.clone();
            let fp = finished_parts.clone();
            let client = self.download_client.clone();

            join_set.spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(permit) => permit,
                    Err(_) => return Err("Download cancelled".to_string()),
                };

                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    return Err("Download cancelled".to_string());
                }

                // 续传：已下载且 MD5 一致的分卷直接跳过
                if Path::new(&dest_str).exists()
                    && hg_crypto::verify_md5(&dest_str, &part_md5).unwrap_or(false)
                {
                    tracing::info!("[preload] Reusing completed part: {}", file_name);
                    db.fetch_add(part_size, Ordering::Relaxed);
                    fp.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }

                let result = download_single_file(
                    &client, &part_url, &dest_str, &part_md5, db, part_size, resume,
                )
                .await;

                match result {
                    Ok(()) => {
                        fp.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }
                    Err(e) => {
                        tracing::error!("[preload] Failed to download {}: {}", file_name, e);
                        Err(e)
                    }
                }
            });
        }

        // 等待所有分卷下载完成
        let mut failures: Vec<String> = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(Ok(())) => {}
                Ok(Err(e)) => failures.push(e),
                Err(e) => failures.push(format!("Task failed: {}", e)),
            }
        }
        let _ = progress_handle.await;

        if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
            progress_callback(DownloadProgress {
                downloaded: 0,
                total: 0,
                stage: InstallStage::Error.as_str().to_string(),
                current_file: None,
                file_index: 0,
                file_count: 0,
                verified_bytes: 0,
            });
            // 启用续传且未要求清理时保留已下载分卷，下次预下载可继续
            if !resume || CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst) {
                let _ = fs::remove_dir_all(&staging_path);
            } else {
                tracing::info!(
                    "[preload] Keeping staging for resume after cancel: {}",
                    staging_path.display()
                );
            }
            return Err("Download cancelled".to_string());
        }

        // 6. 有分卷下载/校验失败：保留已下载分卷以备续传，但不标记为已完成
        if !failures.is_empty() {
            let _ = self.save_preload_state(channel, &preload_version, false);
            progress_callback(DownloadProgress {
                downloaded: 0,
                total: 0,
                stage: InstallStage::Error.as_str().to_string(),
                current_file: None,
                file_index: 0,
                file_count: 0,
                verified_bytes: 0,
            });
            tracing::error!(
                "[preload] {} of {} part(s) failed, first error: {}",
                failures.len(),
                part_count,
                failures.first().cloned().unwrap_or_default()
            );
            return Err(format!(
                "Preload failed for {}/{} part(s): {}",
                failures.len(),
                part_count,
                failures.first().cloned().unwrap_or_default()
            ));
        }

        // 7. 保存预下载状态
        self.save_preload_state(channel, &preload_version, true)?;

        // 最终进度
        progress_callback(DownloadProgress {
            downloaded: total_bytes,
            total: total_bytes,
            stage: InstallStage::Completed.as_str().to_string(),
            current_file: None,
            file_index: part_count,
            file_count: part_count,
            verified_bytes: total_bytes,
        });

        tracing::info!(
            "[preload] Preload completed: version={}, {} parts, {} bytes",
            preload_version,
            part_count,
            total_bytes
        );
        Ok(format!(
            "Preload completed: {} ({} parts, {} bytes)",
            preload_version, part_count, total_bytes
        ))
    }

    /// 安装官方预下载补丁：下载 `pre_patch` 分卷、解密解压并应用到安装目录。
    ///
    /// 与官方（Games.exe）一致：`pre_patch` 只负责**提前下载分卷**；真正"应用"必须拿到
    /// `patch.cd_key`（`pre_patch` 对象里没有密钥字段），因此这里要求密钥非空。
    pub async fn install_preload(
        &self,
        channel: &GameChannel,
        install_path: &str,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        max_concurrent: usize,
        resume: bool,
    ) -> Result<String, String> {
        if self.has_active_operation().await {
            return Err("Another operation is in progress".to_string());
        }

        let local_version = self.read_local_version(install_path).ok();
        let (remote, cd_key) = self
            .get_latest_package_with_cd_key(channel, local_version.as_deref())
            .await?;

        // 优先用 pre_patch 分卷；正式发版后 pre_patch 会被撤下，此时退回 patch 分卷
        // （两者在官方客户端里走的是同一条"下载分卷→7zg 解压"链路）。
        let (parts, expanded_bytes, target_version) = if remote.has_preload
            && !remote.preload_parts.is_empty()
        {
            let version = remote
                .preload_version
                .clone()
                .filter(|version| !version.is_empty())
                .ok_or_else(|| "No preload package available".to_string())?;
            (
                remote.preload_parts.clone(),
                remote.preload_expanded_bytes,
                version,
            )
        } else if remote.has_patch && !remote.patch_parts.is_empty() {
            (
                remote.patch_parts.clone(),
                0u64,
                remote.version.clone(),
            )
        } else {
            return Err("No preload package available".to_string());
        };

        if local_version.as_deref() == Some(target_version.as_str()) {
            return Err(format!(
                "Preload version {} is already installed",
                target_version
            ));
        }

        let cd_key = cd_key.ok_or_else(|| {
            "Preload package cannot be installed: no decryption key (patch.cd_key)".to_string()
        })?;

        // 预下载阶段不要提前把"完成"态抛给前端，等整体应用成功后再发
        let download_progress = progress_callback.clone();
        let inner_progress = Arc::new(move |progress: DownloadProgress| {
            if progress.stage != InstallStage::Completed.as_str() {
                download_progress(progress);
            }
        });

        let result = self
            .install_from_archive_parts(
                channel,
                install_path,
                &parts,
                &cd_key,
                expanded_bytes,
                inner_progress,
                max_concurrent,
                resume,
            )
            .await;

        match result {
            Ok(version) => {
                progress_callback(DownloadProgress {
                    stage: InstallStage::Completed.as_str().to_string(),
                    ..Default::default()
                });
                Ok(version)
            }
            Err(error) => {
                progress_callback(DownloadProgress {
                    stage: InstallStage::Error.as_str().to_string(),
                    ..Default::default()
                });
                Err(error)
            }
        }
    }

    /// 核心链路：**加密分卷 → 解密解压 → 应用**（预下载安装与版本补丁共用）。
    ///
    /// 复现的官方行为：
    /// - 分卷下载后逐卷 MD5 校验（官方 `Retry times` / 失败整卷重下）；
    /// - 用 `7zg.exe x -y -o"…" "<分卷>" -p"<cd_key>"` 等价的解密解压（Games.exe `CDecompressAssist::Start`）；
    /// - 解压产物先落暂存，再按"控制文件不落盘 + delete_files.txt 删除旧文件 + 原子替换"应用；
    /// - 正式更新时会优先复用预下载暂存里同名同 MD5 的分卷（等价官方 `bUsePreDownloadZip`）。
    #[allow(clippy::too_many_arguments)]
    async fn install_from_archive_parts(
        &self,
        channel: &GameChannel,
        install_path: &str,
        parts: &[PatchPart],
        cd_key: &str,
        expanded_bytes: u64,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        max_concurrent: usize,
        resume: bool,
    ) -> Result<String, String> {
        if parts.is_empty() {
            return Err("No archive parts available".to_string());
        }
        CANCEL_CLEANUP_REQUESTED.store(false, Ordering::SeqCst);

        let staging_path = PathBuf::from(format!("{}.staging.patch", install_path));
        fs::create_dir_all(&staging_path).map_err(|e| format!("Create patch staging: {}", e))?;

        // 可复用的分卷来源：所有预下载暂存目录（官方"预下载产物在正式更新时直接消费"）
        let reuse_dirs = self.preload_staging_dirs(install_path);

        let total_bytes: u64 = parts.iter().map(|part| part.size()).sum();
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: total_bytes,
            stage: InstallStage::Downloading.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: parts.len(),
            verified_bytes: 0,
        });

        if let Err(error) = self
            .download_parts_to_staging(
                parts,
                &staging_path,
                &reuse_dirs,
                max_concurrent,
                resume,
                &progress_callback,
            )
            .await
        {
            let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
            if !resume || cleanup_requested {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // 解压（解密在 zip 条目层完成）
        let part_paths = parts
            .iter()
            .enumerate()
            .map(|(index, part)| staging_path.join(Self::preload_part_file_name(&part.url, index)))
            .collect::<Vec<_>>();
        let extracted_dir = staging_path.join(".extracted");
        if extracted_dir.exists() {
            fs::remove_dir_all(&extracted_dir)
                .map_err(|e| format!("Remove previous extraction: {}", e))?;
        }
        fs::create_dir_all(&extracted_dir)
            .map_err(|e| format!("Create extraction directory: {}", e))?;

        let key_for_extract = cd_key.to_string();
        let extract_progress = progress_callback.clone();
        let extracted_dir_for_task = extracted_dir.clone();
        let extract_result = tokio::task::spawn_blocking(move || {
            Self::extract_encrypted_archive(
                &part_paths,
                &key_for_extract,
                &extracted_dir_for_task,
                expanded_bytes,
                extract_progress,
            )
        })
        .await
        .map_err(|e| format!("Archive extraction task failed: {}", e))?;

        if let Err(error) = extract_result {
            // 差量包：保留分卷（下次仍需复用），交给调用方回退
            if !error.starts_with(ERR_DELTA_ARCHIVE) {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // 解压产物自检：包内 `package_files` 是官方的"本包文件清单"，用它堵住"坏包铺进游戏目录"
        match Self::verify_archive_package_files(&extracted_dir) {
            Ok(0) => {}
            Ok(checked) => tracing::info!(
                "[archive] package_files self-check passed for {} file(s)",
                checked
            ),
            Err(error) => {
                let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
                if !resume || cleanup_requested {
                    let _ = fs::remove_dir_all(&staging_path);
                }
                return Err(error);
            }
        }

        // 应用（控制文件不落盘 + delete_files.txt + 原子替换）
        let apply_result = self.apply_extracted_files(
            &extracted_dir,
            Path::new(install_path),
            &progress_callback,
        );
        if let Err(error) = apply_result {
            let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
            if !resume || cleanup_requested {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // 用最新的服务端清单落盘状态。官方补丁/预下载包内自带 `game_files`（新版加密清单，
        // 实测 md5 与远端 `files/game_files` 一致），优先用它，省一次清单下载。
        let installed_package = self.get_latest_package(channel, None).await?;
        let archive_manifest = Self::read_archive_manifest(&extracted_dir);
        let (manifest, manifest_sha256) = match archive_manifest {
            Some(pair) => {
                tracing::info!(
                    "[archive] Using manifest bundled in the archive ({} files)",
                    pair.0.len()
                );
                pair
            }
            None => {
                self.fetch_manifest(&installed_package.resource_base_url)
                    .await?
            }
        };
        self.save_payload_state(
            channel,
            &installed_package.version,
            &manifest_sha256,
            &manifest,
        )?;

        // 成功：清掉补丁暂存与预下载暂存，并把"预下载完成"标记复位
        let _ = fs::remove_dir_all(&staging_path);
        self.cleanup_preload_staging(install_path);
        let _ = self.save_preload_state(channel, &installed_package.version, false);

        tracing::info!(
            "[archive] Applied patch archive: version={}, parts={}",
            installed_package.version,
            parts.len()
        );
        Ok(installed_package.version)
    }

    /// 下载分卷到指定暂存目录：已存在且 MD5 一致的跳过，能按"同名 + MD5"命中复用目录时直接搬过来。
    async fn download_parts_to_staging(
        &self,
        parts: &[PatchPart],
        staging_path: &Path,
        reuse_dirs: &[PathBuf],
        max_concurrent: usize,
        resume: bool,
        progress_callback: &Arc<dyn Fn(DownloadProgress) + Send + Sync>,
    ) -> Result<(), String> {
        let total_bytes: u64 = parts.iter().map(|part| part.size()).sum();
        let downloaded_bytes = Arc::new(AtomicU64::new(0));
        let finished_parts = Arc::new(AtomicUsize::new(0));
        let semaphore = Arc::new(Semaphore::new(max_concurrent.clamp(1, 32)));
        let mut join_set = tokio::task::JoinSet::new();

        let progress_cb_bg = progress_callback.clone();
        let db_bg = downloaded_bytes.clone();
        let fp_bg = finished_parts.clone();
        let part_count = parts.len();
        let progress_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    break;
                }
                let db = db_bg.load(Ordering::Relaxed);
                let fp = fp_bg.load(Ordering::Relaxed);
                if (db >= total_bytes && total_bytes > 0) || fp >= part_count {
                    break;
                }
                progress_cb_bg(DownloadProgress {
                    downloaded: db,
                    total: total_bytes,
                    stage: InstallStage::Downloading.as_str().to_string(),
                    current_file: None,
                    file_index: fp,
                    file_count: part_count,
                    verified_bytes: 0,
                });
            }
        });

        for (index, part) in parts.iter().enumerate() {
            let file_name = Self::preload_part_file_name(&part.url, index);
            let dest = staging_path.join(&file_name);
            let dest_str = dest.to_string_lossy().to_string();
            let part_url = part.url.clone();
            let part_md5 = part.md5.clone();
            let part_size = part.size();
            let reuse: Vec<PathBuf> = reuse_dirs.to_vec();
            let sem = semaphore.clone();
            let db = downloaded_bytes.clone();
            let fp = finished_parts.clone();
            let client = self.download_client.clone();

            join_set.spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(permit) => permit,
                    Err(_) => return Err("Download cancelled".to_string()),
                };
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    return Err("Download cancelled".to_string());
                }

                // 1) 本暂存目录里已有且完整
                if Path::new(&dest_str).exists()
                    && hg_crypto::verify_md5(&dest_str, &part_md5).unwrap_or(false)
                {
                    tracing::info!("[archive] Reusing staged part: {}", file_name);
                    db.fetch_add(part_size, Ordering::Relaxed);
                    fp.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }

                // 2) 复用预下载暂存里的同名分卷（内容寻址：同名 + MD5 一致）
                for dir in &reuse {
                    let candidate = dir.join(&file_name);
                    if candidate == Path::new(&dest_str) || !candidate.is_file() {
                        continue;
                    }
                    let candidate_str = candidate.to_string_lossy().to_string();
                    if !hg_crypto::verify_md5(&candidate_str, &part_md5).unwrap_or(false) {
                        continue;
                    }
                    if let Some(parent) = Path::new(&dest_str).parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let moved = fs::rename(&candidate, &dest_str).is_ok()
                        || (fs::copy(&candidate, &dest_str).is_ok()
                            && hg_crypto::verify_md5(&dest_str, &part_md5).unwrap_or(false));
                    if moved {
                        let _ = fs::remove_file(&candidate);
                        tracing::info!(
                            "[archive] Reused pre-downloaded part {} from {}",
                            file_name,
                            dir.display()
                        );
                        db.fetch_add(part_size, Ordering::Relaxed);
                        fp.fetch_add(1, Ordering::Relaxed);
                        return Ok(());
                    }
                }

                // 3) 正常下载
                let result = download_single_file(
                    &client, &part_url, &dest_str, &part_md5, db, part_size, resume,
                )
                .await;

                match result {
                    Ok(()) => {
                        fp.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }
                    Err(e) => {
                        tracing::error!("[archive] Failed to download {}: {}", file_name, e);
                        Err(e)
                    }
                }
            });
        }

        let mut failures: Vec<String> = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(Ok(())) => {}
                Ok(Err(e)) => failures.push(e),
                Err(e) => failures.push(format!("Task failed: {}", e)),
            }
        }
        let _ = progress_handle.await;

        if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
            return Err("Download cancelled".to_string());
        }
        if !failures.is_empty() {
            return Err(format!(
                "{} of {} part(s) failed: {}",
                failures.len(),
                parts.len(),
                failures.first().cloned().unwrap_or_default()
            ));
        }
        Ok(())
    }

    /// 解压 WinZip AES 加密的分卷 zip（顺序拼接后解密），产物落到 `output_dir`。
    ///
    /// 差量形态检测：官方补丁包有两种内容形态——"最终文件包"（解压即用）与"差量包"
    /// （条目形如 `vfs_files/vfs_patch/diff_<a>_<b>/xxx_patch`，必须由 hpatch 结合本地 base
    /// 文件打补丁，见 Patch.exe / `CPatchCotroller::DoPatch`）。本实现不包含 hpatch，
    /// 因此一旦发现差量条目就返回 `ERR_DELTA_ARCHIVE` 前缀的错误，交由调用方回退到
    /// "清单逐文件下载"路径，绝不把 `_patch` 当游戏文件铺进安装目录。
    fn extract_encrypted_archive(
        part_paths: &[PathBuf],
        cd_key: &str,
        output_dir: &Path,
        expected_bytes: u64,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
    ) -> Result<(), String> {
        let reader = MultipartZipReader::new(part_paths)
            .map_err(|e| format!("Open archive parts: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(reader).map_err(|e| format!("Open archive: {}", e))?;
        let file_count = archive.len();

        // 第一遍：统计解压总量 + 差量形态检测
        let mut total_bytes = 0u64;
        let mut delta_entries = Vec::new();
        for index in 0..file_count {
            let name = archive.name_for_index(index).unwrap_or("").to_string();
            let normalized = name.replace('\\', "/").to_lowercase();
            if normalized.ends_with("_patch") || normalized.contains("vfs_files/vfs_patch/") {
                if delta_entries.len() < 5 {
                    delta_entries.push(name.clone());
                }
                continue;
            }
            let file = archive
                .by_index_decrypt(index, cd_key.as_bytes())
                .map_err(|e| format!("Decrypt archive entry: {}", e))?;
            if !file.is_dir() {
                total_bytes = total_bytes
                    .checked_add(file.size())
                    .ok_or_else(|| "Archive is too large".to_string())?;
            }
        }
        if !delta_entries.is_empty() {
            return Err(format!(
                "{} archive contains hpatch delta entries (e.g. {}), which require Patch.exe",
                ERR_DELTA_ARCHIVE,
                delta_entries.join(", ")
            ));
        }
        // `total_size` 只是服务端的"预留空间估计"（实测 1.66×~2.5×），仅在没有实际条目时兜底，
        // 避免进度条分母虚高（见逆向文档 §6.3）。
        if total_bytes == 0 {
            total_bytes = expected_bytes;
        }

        let mut extracted_bytes = 0u64;
        let mut extracted_files = 0usize;
        let mut seen_paths = HashSet::new();
        let mut buffer = vec![0u8; 1024 * 1024];

        for index in 0..file_count {
            if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                return Err("Archive installation cancelled".to_string());
            }
            let entry_name = archive
                .name_for_index(index)
                .ok_or_else(|| "Invalid path in archive".to_string())?
                .to_string();
            let safe_name = entry_name.trim_end_matches(['/', '\\']);
            GameLauncherService::validate_path(safe_name)?;

            let mut entry = archive
                .by_index_decrypt(index, cd_key.as_bytes())
                .map_err(|e| format!("Decrypt archive entry: {}", e))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("Unsafe path in archive: {}", entry_name))?
                .to_path_buf();
            let normalized = relative.to_string_lossy().replace('\\', "/").to_lowercase();
            if !seen_paths.insert(normalized) {
                return Err(format!("Duplicate path in archive: {}", entry_name));
            }

            let destination = output_dir.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&destination)
                    .map_err(|e| format!("Create extracted directory: {}", e))?;
                continue;
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Create extracted directory: {}", e))?;
            }
            let mut output =
                File::create(&destination).map_err(|e| format!("Create extracted file: {}", e))?;
            let current_file = entry_name;
            loop {
                if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                    return Err("Archive installation cancelled".to_string());
                }
                let read = entry
                    .read(&mut buffer)
                    .map_err(|e| format!("Read extracted file {}: {}", current_file, e))?;
                if read == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..read])
                    .map_err(|e| format!("Write extracted file {}: {}", current_file, e))?;
                extracted_bytes = extracted_bytes.saturating_add(read as u64);
                progress_callback(DownloadProgress {
                    downloaded: extracted_bytes,
                    total: total_bytes,
                    stage: InstallStage::Applying.as_str().to_string(),
                    current_file: Some(current_file.clone()),
                    file_index: extracted_files,
                    file_count,
                    verified_bytes: 0,
                });
            }
            extracted_files += 1;
        }

        if extracted_files == 0 {
            return Err("Archive contains no installable files".to_string());
        }
        Ok(())
    }

    /// 把解压产物应用到游戏安装目录。
    ///
    /// 与官方（Games.exe `CCopyGameFile`，RVA `0x00277c50` / `0x00278dc0`）对齐的三条规则：
    /// 1. **包内控制文件不落盘**：`package_files` / `delete_files.txt` / `patch.json` 只用于驱动流程，
    ///    实测官方安装目录里不存在它们（`game_files` 是正式文件，照常应用）；
    /// 2. **按 `delete_files.txt` 删除旧文件**：官方会拼出 `<目录>\delete_files.txt` 并逐条删除；
    /// 3. **原子替换**：先写 `<目标>.hgtmp`，校验长度后再 rename 覆盖，避免半写文件。
    fn apply_extracted_files(
        &self,
        extracted_dir: &Path,
        install_dir: &Path,
        progress_callback: &Arc<dyn Fn(DownloadProgress) + Send + Sync>,
    ) -> Result<(), String> {
        let entries = WalkDir::new(extracted_dir)
            .into_iter()
            .map(|entry| entry.map_err(|e| format!("Read extracted files: {}", e)))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|entry| entry.file_type().is_file())
            .collect::<Vec<_>>();

        let mut files: Vec<(PathBuf, PathBuf, u64)> = Vec::new();
        for entry in &entries {
            let relative = entry
                .path()
                .strip_prefix(extracted_dir)
                .map_err(|e| format!("Resolve extracted file path: {}", e))?
                .to_path_buf();
            if is_archive_control_file(&relative) {
                continue;
            }
            let size = entry
                .metadata()
                .map_err(|e| format!("Read extracted file metadata: {}", e))?
                .len();
            files.push((relative, entry.path().to_path_buf(), size));
        }

        let total_bytes: u64 = files.iter().map(|(_, _, size)| *size).sum();
        let mut copied_bytes = 0u64;
        let mut buffer = vec![0u8; 1024 * 1024];

        for (index, (relative, source_path, size)) in files.iter().enumerate() {
            if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                return Err("Archive installation cancelled".to_string());
            }
            let destination = install_dir.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Create install directory: {}", e))?;
            }
            // 原子替换：先写临时文件，落盘后 rename 覆盖目标
            let temp_path = PathBuf::from(format!("{}.hgtmp", destination.display()));
            let _ = fs::remove_file(&temp_path);

            let mut source =
                File::open(source_path).map_err(|e| format!("Open extracted file: {}", e))?;
            {
                let mut output = File::create(&temp_path)
                    .map_err(|e| format!("Create install temp file: {}", e))?;
                loop {
                    if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                        drop(output);
                        let _ = fs::remove_file(&temp_path);
                        return Err("Archive installation cancelled".to_string());
                    }
                    let read = source
                        .read(&mut buffer)
                        .map_err(|e| format!("Read extracted file: {}", e))?;
                    if read == 0 {
                        break;
                    }
                    output
                        .write_all(&buffer[..read])
                        .map_err(|e| format!("Write installed file: {}", e))?;
                    copied_bytes = copied_bytes.saturating_add(read as u64);
                    progress_callback(DownloadProgress {
                        downloaded: copied_bytes,
                        total: total_bytes,
                        stage: InstallStage::Applying.as_str().to_string(),
                        current_file: Some(relative.to_string_lossy().to_string()),
                        file_index: index,
                        file_count: files.len(),
                        verified_bytes: 0,
                    });
                }
                output
                    .flush()
                    .map_err(|e| format!("Flush installed file: {}", e))?;
            }

            let written = fs::metadata(&temp_path)
                .map(|m| m.len())
                .unwrap_or(u64::MAX);
            if written != *size {
                let _ = fs::remove_file(&temp_path);
                return Err(format!(
                    "Applied file size mismatch for {}: expected {}, got {}",
                    relative.display(),
                    size,
                    written
                ));
            }
            fs::rename(&temp_path, &destination)
                .map_err(|e| format!("Replace installed file {}: {}", relative.display(), e))?;
        }

        self.remove_deleted_files(extracted_dir, install_dir)?;
        Ok(())
    }

    /// 按包内 `delete_files.txt` 删除安装目录里的旧文件（官方 `CCopyGameFile` 的行为）
    fn remove_deleted_files(&self, extracted_dir: &Path, install_dir: &Path) -> Result<(), String> {
        let list_path = extracted_dir.join(ARCHIVE_DELETE_LIST);
        if !list_path.is_file() {
            return Ok(());
        }
        let content = match hg_crypto::decrypt_file_to_string(&list_path.to_string_lossy()) {
            Ok(text) => text,
            Err(_) => fs::read_to_string(&list_path)
                .map_err(|e| format!("Read {}: {}", ARCHIVE_DELETE_LIST, e))?,
        };
        let mut removed = 0usize;
        let mut skipped = 0usize;
        for relative in parse_delete_list(&content) {
            let relative = relative.trim_start_matches("./");
            if Self::validate_path(relative).is_err() {
                skipped += 1;
                continue;
            }
            let target = install_dir.join(relative);
            if target.is_file() {
                match fs::remove_file(&target) {
                    Ok(()) => removed += 1,
                    Err(e) => tracing::warn!(
                        "[apply] Failed to delete {}: {}",
                        target.display(),
                        e
                    ),
                }
            } else if target.is_dir() {
                skipped += 1;
            }
        }
        if removed > 0 || skipped > 0 {
            tracing::info!(
                "[apply] delete_files.txt: removed={}, skipped={}",
                removed,
                skipped
            );
        }
        Ok(())
    }

    /// 读取包内自带的新版清单（`game_files`，固定 AES-256-CBC 加密的 NDJSON）。
    ///
    /// 官方补丁/预下载包都会带上它（与远端 `files/game_files` 内容一致）；解不开或解析失败时
    /// 返回 `None`，由调用方回退到远端清单。
    fn read_archive_manifest(extracted_dir: &Path) -> Option<(Vec<ManifestFile>, String)> {
        let path = extracted_dir.join("game_files");
        if !path.is_file() {
            return None;
        }
        let bytes = fs::read(&path).ok()?;
        let sha256 = hg_crypto::sha256_hex(&bytes);
        let text = hg_crypto::decrypt_bytes_to_string(&bytes).ok()?;
        match Self::parse_manifest(&text) {
            Ok(files) if !files.is_empty() => Some((files, sha256)),
            _ => None,
        }
    }

    /// 用包内 `package_files` 校验解压产物。
    ///
    /// 逆向依据：官方补丁/预下载包内同时带 `game_files`（新版清单）与 `package_files`
    /// （**本包文件清单**，同样是"固定 AES-256-CBC 加密的 NDJSON"；实测本机阿米娅安装目录
    /// 里那份 510,176 字节 / 3115 条，解密后即 `{"path","md5","size"}` 行）。
    /// 这里只校验"解压目录里确实存在"的条目：不匹配说明包本身损坏，宁可不铺；
    /// 不在包内的条目（属其它分卷）直接跳过，避免误报。
    fn verify_archive_package_files(extracted_dir: &Path) -> Result<usize, String> {
        let path = extracted_dir.join("package_files");
        if !path.is_file() {
            return Ok(0);
        }
        let bytes = fs::read(&path).map_err(|e| format!("Read package_files: {}", e))?;
        let text = match hg_crypto::decrypt_bytes_to_string(&bytes) {
            Ok(text) => text,
            // 少数形态可能是明文清单
            Err(_) => {
                fs::read_to_string(&path).map_err(|e| format!("Read package_files: {}", e))?
            }
        };
        let entries = match Self::parse_manifest(&text) {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(
                    "[archive] package_files not parseable, skipping check: {}",
                    error
                );
                return Ok(0);
            }
        };

        let mut checked = 0usize;
        let mut bad = 0usize;
        let mut samples: Vec<String> = Vec::new();
        for entry in &entries {
            let candidate = extracted_dir.join(&entry.path);
            if !candidate.is_file() {
                continue;
            }
            checked += 1;
            if !hg_crypto::verify_md5(&candidate.to_string_lossy(), &entry.md5).unwrap_or(false) {
                bad += 1;
                if samples.len() < 5 {
                    samples.push(entry.path.clone());
                }
            }
        }
        if bad > 0 {
            return Err(format!(
                "Archive content failed package_files MD5 check: {} of {} checked file(s) mismatch, e.g. {}",
                bad,
                checked,
                samples.join(", ")
            ));
        }
        Ok(checked)
    }

    /// 从分卷 URL 推断本地文件名（去掉查询串）；文件名非法时回退为 part_###.zip
    fn preload_part_file_name(url: &str, index: usize) -> String {
        let path = url.split('?').next().unwrap_or("");
        let name = path.rsplit('/').next().unwrap_or("");
        if Self::validate_path(name).is_ok() {
            name.to_string()
        } else {
            format!("part_{:03}.zip", index + 1)
        }
    }

    /// 预下载暂存目录内的版本标记文件名（见模块级 `PRELOAD_VERSION_MARKER`）

    /// 新建预下载暂存目录并写入目标版本标记
    fn create_preload_staging(install_path: &str, version: &str) -> Result<PathBuf, String> {
        let dir = format!("{}.staging.preload.{}", install_path, uuid::Uuid::new_v4());
        let path = PathBuf::from(&dir);
        fs::create_dir_all(&path).map_err(|e| format!("Create staging dir: {}", e))?;
        fs::write(path.join(PRELOAD_VERSION_MARKER), version)
            .map_err(|e| format!("Write preload marker: {}", e))?;
        Ok(path)
    }

    /// 读取预下载暂存目录记录的目标版本
    fn preload_staging_version(dir: &str) -> Option<String> {
        let content = fs::read_to_string(Path::new(dir).join(PRELOAD_VERSION_MARKER)).ok()?;
        Some(content.trim().to_string())
    }

    /// 获取预下载 staging 目录路径（最新的一个）
    fn preload_staging_dir(&self, install_path: &str) -> Option<String> {
        self.preload_staging_dirs(install_path)
            .into_iter()
            .next()
            .map(|path| path.to_string_lossy().to_string())
    }

    /// 列出全部预下载 staging 目录（可能残留多个版本，正式更新时都要作为复用来源）
    fn preload_staging_dirs(&self, install_path: &str) -> Vec<PathBuf> {
        let Some(parent) = Path::new(install_path).parent() else {
            return Vec::new();
        };
        let Some(stem) = Path::new(install_path).file_name().and_then(|s| s.to_str()) else {
            return Vec::new();
        };
        let prefix = format!("{}.staging.preload.", stem);
        let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with(&prefix) || !entry.path().is_dir() {
                    continue;
                }
                let modified = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                dirs.push((modified, entry.path()));
            }
        }
        // 新到旧：优先复用最近一次预下载的产物
        dirs.sort_by(|a, b| b.0.cmp(&a.0));
        dirs.into_iter().map(|(_, path)| path).collect()
    }

    /// 清理全部预下载 staging 目录
    fn cleanup_preload_staging(&self, install_path: &str) {
        for dir in self.preload_staging_dirs(install_path) {
            let _ = fs::remove_dir_all(dir);
        }
    }

    /// 保存 payload 状态到文件
    fn save_payload_state(
        &self,
        channel: &GameChannel,
        version: &str,
        manifest_sha256: &str,
        manifest: &[ManifestFile],
    ) -> Result<(), String> {
        let state_dir = crate::utils::paths::app_data_dir()
            .map_err(|e| format!("App data dir: {}", e))?
            .join("game_state");

        fs::create_dir_all(&state_dir).map_err(|e| format!("Create state dir: {}", e))?;

        // Preserve existing preload state if present
        let existing = self.load_payload_state(channel);

        let state = PayloadState {
            channel: channel.as_str().to_string(),
            version: version.to_string(),
            manifest_sha256: manifest_sha256.to_string(),
            file_count: manifest.len(),
            total_bytes: manifest.iter().map(|f| f.size.max(0) as u64).sum(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            preload_version: existing.as_ref().and_then(|s| s.preload_version.clone()),
            preload_completed: existing.as_ref().map_or(false, |s| s.preload_completed),
        };

        let state_file = state_dir.join(format!("{}.json", channel.as_str()));
        let json =
            serde_json::to_string_pretty(&state).map_err(|e| format!("JSON serialize: {}", e))?;

        // 原子写入：先写临时文件，再重命名
        let tmp_file = state_file.with_extension("json.tmp");
        fs::write(&tmp_file, &json).map_err(|e| format!("Write state: {}", e))?;
        fs::rename(&tmp_file, &state_file).map_err(|e| format!("Rename state: {}", e))?;

        Ok(())
    }

    /// 读取 payload 状态（同步版本，供内部使用）
    fn load_payload_state(&self, channel: &GameChannel) -> Option<PayloadState> {
        let state_dir = crate::utils::paths::app_data_dir().ok()?.join("game_state");
        let state_file = state_dir.join(format!("{}.json", channel.as_str()));
        let content = fs::read_to_string(&state_file).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// 读取 payload 状态（异步版本，供外部使用）
    pub async fn get_payload_state(&self, channel: &GameChannel) -> Option<PayloadState> {
        self.load_payload_state(channel)
    }

    /// 保存预下载状态
    fn save_preload_state(
        &self,
        channel: &GameChannel,
        preload_version: &str,
        completed: bool,
    ) -> Result<(), String> {
        let state_dir = crate::utils::paths::app_data_dir()
            .map_err(|e| format!("App data dir: {}", e))?
            .join("game_state");

        fs::create_dir_all(&state_dir).map_err(|e| format!("Create state dir: {}", e))?;

        let mut existing = self
            .load_payload_state(channel)
            .unwrap_or_else(|| PayloadState {
                channel: channel.as_str().to_string(),
                version: String::new(),
                manifest_sha256: String::new(),
                file_count: 0,
                total_bytes: 0,
                updated_at: String::new(),
                preload_version: None,
                preload_completed: false,
            });

        existing.preload_version = Some(preload_version.to_string());
        existing.preload_completed = completed;

        let state_file = state_dir.join(format!("{}.json", channel.as_str()));
        let json = serde_json::to_string_pretty(&existing)
            .map_err(|e| format!("JSON serialize: {}", e))?;

        let tmp_file = state_file.with_extension("json.tmp");
        fs::write(&tmp_file, &json).map_err(|e| format!("Write state: {}", e))?;
        fs::rename(&tmp_file, &state_file).map_err(|e| format!("Rename state: {}", e))?;

        Ok(())
    }

    // ========== Banner / Announcement / Background ==========

    /// 通用 batch_proxy 请求（web API）
    async fn batch_proxy_web(
        &self,
        channel: &GameChannel,
        proxy_reqs: serde_json::Value,
    ) -> Result<BatchProxyResponse, String> {
        let req_body = serde_json::json!({
            "seq": channel.seq(),
            "proxy_reqs": proxy_reqs
        });

        let resp = capture::send(
            &self.http_client,
            self.http_client.post(channel.web_api_url()).json(&req_body),
        )
        .await
        .map_err(|e| format!("Web API request failed: {}", e))?;

        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        // Log the raw response for debugging announcement parsing
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(rsps) = raw.get("proxy_rsps").and_then(|v| v.as_array()) {
                for (i, rsp) in rsps.iter().enumerate() {
                    let kind = rsp.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
                    crate::safe_eprintln!("[Launcher] proxy_rsps[{}] kind={}", i, kind);
                    if let Some(ann_rsp) = rsp.get("get_announcement_rsp") {
                        crate::safe_eprintln!(
                            "[Launcher]   get_announcement_rsp keys: {:?}",
                            ann_rsp.as_object().map(|m| m.keys().collect::<Vec<_>>())
                        );
                        if let Some(tabs) = ann_rsp.get("tabs") {
                            let tab_arr = tabs.as_array();
                            crate::safe_eprintln!(
                                "[Launcher]   tabs count: {}",
                                tab_arr.map_or(0, |a| a.len())
                            );
                            if let Some(tabs) = tab_arr {
                                for (ti, tab) in tabs.iter().enumerate() {
                                    let tab_name =
                                        tab.get("tabName").and_then(|v| v.as_str()).unwrap_or("?");
                                    let ann_count = tab
                                        .get("announcements")
                                        .and_then(|v| v.as_array())
                                        .map_or(0, |a| a.len());
                                    crate::safe_eprintln!(
                                        "[Launcher]     tab[{}] name={}, announcements={}",
                                        ti, tab_name, ann_count
                                    );
                                }
                            }
                        } else {
                            crate::safe_eprintln!("[Launcher]   no 'tabs' key in get_announcement_rsp");
                        }
                    }
                    if let Some(banner_rsp) = rsp.get("get_banner_rsp") {
                        let count = banner_rsp
                            .get("banners")
                            .and_then(|v| v.as_array())
                            .map_or(0, |a| a.len());
                        crate::safe_eprintln!("[Launcher]   get_banner_rsp: {} banners", count);
                    }
                }
            }
        }

        let body: BatchProxyResponse = serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse web API response: {}", e))?;

        Ok(body)
    }

    /// 获取 Banner 列表
    pub async fn get_banners(&self, channel: &GameChannel) -> Result<Vec<BannerItem>, String> {
        let proxy_reqs = serde_json::json!([{
            "kind": "get_banner",
            "get_banner_req": {
                "appcode": channel.app_code(),
                "language": "zh-cn",
                "channel": channel.channel(),
                "sub_channel": channel.sub_channel(),
                "platform": "Windows",
                "source": "launcher"
            }
        }]);

        let body = self.batch_proxy_web(channel, proxy_reqs).await?;

        let banners = body
            .proxy_rsps
            .iter()
            .filter_map(|r| r.get_banner_rsp.as_ref())
            .flat_map(|rsp| {
                rsp.banners.iter().map(|b| BannerItem {
                    image_url: b.url.clone(),
                    jump_url: b.jump_url.clone(),
                })
            })
            .collect();

        Ok(banners)
    }

    /// 获取公告列表
    pub async fn get_announcements(
        &self,
        channel: &GameChannel,
    ) -> Result<Vec<AnnouncementItem>, String> {
        let proxy_reqs = serde_json::json!([{
            "kind": "get_announcement",
            "get_announcement_req": {
                "appcode": channel.app_code(),
                "language": "zh-cn",
                "channel": channel.channel(),
                "sub_channel": channel.sub_channel(),
                "platform": "Windows",
                "source": "launcher"
            }
        }]);

        let body = self.batch_proxy_web(channel, proxy_reqs).await?;

        let announcements = body
            .proxy_rsps
            .iter()
            .filter_map(|r| r.get_announcement_rsp.as_ref())
            .flat_map(|rsp| {
                rsp.tabs.iter().flat_map(|tab| {
                    tab.announcements.iter().map(|a| {
                        let date = a
                            .start_ts
                            .as_ref()
                            .and_then(|ts| ts.parse::<i64>().ok())
                            .map(|ts| {
                                let dt =
                                    chrono::DateTime::from_timestamp(ts, 0).unwrap_or_default();
                                dt.format("%m/%d").to_string()
                            })
                            .unwrap_or_default();

                        AnnouncementItem {
                            category: tab.tab_name.clone(),
                            title: a.content.clone(),
                            date,
                            jump_url: a.jump_url.clone().unwrap_or_default(),
                        }
                    })
                })
            })
            .collect();

        Ok(announcements)
    }

    /// 获取启动器公告内容（Banner + 公告合并返回）
    async fn batch_proxy_web_raw(
        &self,
        channel: &GameChannel,
        proxy_reqs: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let req_body = serde_json::json!({
            "seq": channel.seq(),
            "proxy_reqs": proxy_reqs
        });

        let resp = capture::send(
            &self.http_client,
            self.http_client.post(channel.web_api_url()).json(&req_body),
        )
        .await
        .map_err(|e| format!("Web API request failed: {}", e))?;

        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        let raw: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse web API response: {}", e))?;

        Ok(raw)
    }

    pub async fn get_notice_content(
        &self,
        channel: &GameChannel,
    ) -> Result<LauncherNoticeContent, String> {
        // B服公告API与官服相同，直接用官服参数
        let api_channel = if *channel == GameChannel::Bilibili {
            &GameChannel::Official
        } else {
            channel
        };

        let proxy_reqs = serde_json::json!([
            {
                "kind": "get_banner",
                "get_banner_req": {
                    "appcode": api_channel.app_code(),
                    "language": "zh-cn",
                    "channel": api_channel.channel(),
                    "sub_channel": api_channel.sub_channel(),
                    "platform": "Windows",
                    "source": "launcher"
                }
            },
            {
                "kind": "get_announcement",
                "get_announcement_req": {
                    "appcode": api_channel.app_code(),
                    "language": "zh-cn",
                    "channel": api_channel.channel(),
                    "sub_channel": api_channel.sub_channel(),
                    "platform": "Windows",
                    "source": "launcher"
                }
            },
            {
                "kind": "get_sidebar",
                "get_sidebar_req": {
                    "appcode": api_channel.app_code(),
                    "language": "zh-cn",
                    "channel": api_channel.channel(),
                    "sub_channel": api_channel.sub_channel(),
                    "platform": "Windows",
                    "source": "launcher"
                }
            }
        ]);

        let raw = self.batch_proxy_web_raw(api_channel, proxy_reqs).await?;

        let mut banners = Vec::new();
        let mut announcements = Vec::new();

        if let Some(rsps) = raw.get("proxy_rsps").and_then(|v| v.as_array()) {
            for rsp in rsps {
                let kind = rsp.get("kind").and_then(|v| v.as_str()).unwrap_or("");

                if kind == "get_banner" {
                    if let Some(banner_rsp) = rsp.get("get_banner_rsp") {
                        if let Some(items) = banner_rsp.get("banners").and_then(|v| v.as_array()) {
                            for b in items {
                                let image_url = b
                                    .get("url")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let jump_url = b
                                    .get("jump_url")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if !image_url.is_empty() {
                                    banners.push(BannerItem {
                                        image_url,
                                        jump_url,
                                    });
                                }
                            }
                        }
                    }
                }

                if kind == "get_announcement" {
                    if let Some(ann_rsp) = rsp.get("get_announcement_rsp") {
                        if let Some(tabs) = ann_rsp.get("tabs").and_then(|v| v.as_array()) {
                            for tab in tabs {
                                let tab_name = tab
                                    .get("tabName")
                                    .or_else(|| tab.get("tab_name"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if let Some(items) =
                                    tab.get("announcements").and_then(|v| v.as_array())
                                {
                                    for a in items {
                                        let title = a
                                            .get("title")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .trim()
                                            .to_string();
                                        let content = a
                                            .get("content")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .trim()
                                            .to_string();
                                        let display_title =
                                            if !title.is_empty() { title } else { content };
                                        if display_title.is_empty() {
                                            continue;
                                        }

                                        let date = a
                                            .get("start_ts")
                                            .or_else(|| a.get("startTs"))
                                            .and_then(|v| {
                                                // 尝试从字符串或数字解析时间戳
                                                if let Some(s) = v.as_str() {
                                                    s.parse::<i64>().ok()
                                                } else {
                                                    v.as_i64()
                                                }
                                            })
                                            .map(|ts| {
                                                // 如果时间戳大于1e12，认为是毫秒，转换为秒
                                                let secs = if ts > 1_000_000_000_000 {
                                                    ts / 1000
                                                } else {
                                                    ts
                                                };
                                                let dt = chrono::DateTime::from_timestamp(secs, 0)
                                                    .unwrap_or_default();
                                                dt.format("%m/%d").to_string()
                                            })
                                            .unwrap_or_default();

                                        let jump_url = a
                                            .get("jump_url")
                                            .or_else(|| a.get("jumpUrl"))
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string();

                                        announcements.push(AnnouncementItem {
                                            category: tab_name.clone(),
                                            title: display_title,
                                            date,
                                            jump_url,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        crate::safe_eprintln!(
            "[Launcher] get_notice_content result: {} banners, {} announcements",
            banners.len(),
            announcements.len()
        );

        let sidebars = Self::parse_sidebars(&raw);
        crate::safe_eprintln!("[Launcher] get_notice_content: {} sidebars", sidebars.len());

        Ok(LauncherNoticeContent {
            banners,
            announcements,
            sidebars,
        })
    }

    /// 解析 `get_sidebar_rsp`：把「条目自身」与「sidebar_labels[0]」两处链接合并成扁平列表。
    ///
    /// 官方数据不一致：社媒条目把地址放在 `pic.url`（二维码）+ `jump_url`，
    /// 而 `CS` 这类条目 `pic` 为 null、地址只在 `sidebar_labels[0].jump_url`。
    /// 侧边栏解析失败不影响公告主流程，故整体失败时返回空列表。
    fn parse_sidebars(raw: &serde_json::Value) -> Vec<SidebarItem> {
        let mut sidebars = Vec::new();

        let Some(rsps) = raw.get("proxy_rsps").and_then(|v| v.as_array()) else {
            return sidebars;
        };

        for rsp in rsps {
            let Some(sidebar_rsp) = rsp.get("get_sidebar_rsp") else {
                continue;
            };

            let parsed: SidebarRsp = match serde_json::from_value(sidebar_rsp.clone()) {
                Ok(v) => v,
                Err(e) => {
                    crate::safe_eprintln!("[Launcher] Failed to parse get_sidebar_rsp: {}", e);
                    return sidebars;
                }
            };

            for item in parsed.sidebars {
                let label = item.sidebar_labels.first();

                // 链接、二维码与文案都优先取条目自身，缺失时回退到第一条 label（CS 即属此类）
                let jump_url = if !item.jump_url.is_empty() {
                    item.jump_url.clone()
                } else {
                    label.map(|l| l.jump_url.clone()).unwrap_or_default()
                };
                let qr_url = match &item.pic {
                    Some(pic) if !pic.url.is_empty() => pic.url.clone(),
                    _ => label.map(|l| l.pic_url.clone()).unwrap_or_default(),
                };
                let title = match &item.pic {
                    Some(pic) if !pic.description.as_deref().unwrap_or("").is_empty() => {
                        pic.description.clone().unwrap_or_default()
                    }
                    _ => label.map(|l| l.content.clone()).unwrap_or_default(),
                };
                let need_token =
                    item.need_token || label.map(|l| l.need_token).unwrap_or(false);

                sidebars.push(SidebarItem {
                    media: item.media,
                    display_type: item.display_type,
                    title,
                    qr_url,
                    jump_url,
                    need_token,
                });
            }
        }

        sidebars
    }

    /// 获取启动器背景媒体（图片或视频）
    pub async fn get_background_image(
        &self,
        channel: &GameChannel,
    ) -> Result<Option<BackgroundMedia>, String> {
        let proxy_reqs = serde_json::json!([{
            "kind": "get_main_bg_image",
            "get_main_bg_image_req": {
                "appcode": channel.app_code(),
                "language": "zh-cn",
                "channel": channel.channel(),
                "sub_channel": channel.sub_channel(),
                "platform": "Windows",
                "source": "launcher"
            }
        }]);

        let body = self.batch_proxy_web(channel, proxy_reqs).await?;

        crate::safe_eprintln!(
            "[Launcher] Background API proxy_rsps count: {}",
            body.proxy_rsps.len()
        );

        for (i, rsp) in body.proxy_rsps.iter().enumerate() {
            crate::safe_eprintln!("[Launcher] proxy_rsp[{}] kind={:?}", i, rsp.kind);
            if let Some(ref bg_rsp) = rsp.get_main_bg_image_rsp {
                crate::safe_eprintln!("[Launcher] get_main_bg_image_rsp: {:?}", bg_rsp);
                if let Some(ref bg_data) = bg_rsp.main_bg_image {
                    let url = bg_data.url.clone();
                    let alt = bg_data.video_url.clone().filter(|u| !u.is_empty());
                    let url_is_video = self.classify_media_type(&url) == "video";

                    // 接口把图片和视频放在同一条响应里，两者都返回给前端，
                    // 由前端根据用户设置选择展示图片还是视频
                    let (image_url, video_url) = if url_is_video {
                        // url 本身就是视频，另一个字段若是图片则作为图片
                        let image = alt
                            .clone()
                            .filter(|u| self.classify_media_type(u) != "video");
                        (image, Some(url))
                    } else {
                        let video = alt.filter(|u| self.classify_media_type(u) == "video");
                        (if url.is_empty() { None } else { Some(url) }, video)
                    };

                    crate::safe_eprintln!(
                        "[Launcher] Background media found: image={:?}, video={:?}",
                        image_url, video_url
                    );
                    return Ok(Some(BackgroundMedia {
                        image_url,
                        video_url,
                    }));
                }
            }
        }

        crate::safe_eprintln!("[Launcher] No background media found in response");
        Ok(None)
    }

    /// 判断 URL 的媒体类型
    fn classify_media_type(&self, url: &str) -> String {
        let lower = url.to_lowercase();
        if lower.ends_with(".mp4")
            || lower.ends_with(".webm")
            || lower.ends_with(".ogg")
            || lower.contains(".mp4?")
            || lower.contains(".webm?")
        {
            "video".to_string()
        } else {
            "image".to_string()
        }
    }

    /// 切换游戏渠道（5阶段流程）
    pub async fn switch_channel(
        &self,
        from_channel: &GameChannel,
        to_channel: &GameChannel,
        install_path: &str,
        app: tauri::AppHandle,
    ) -> Result<String, String> {
        if self.has_active_operation().await {
            return Err("Another operation is in progress".to_string());
        }

        tracing::info!(
            "[switch] Starting: {} -> {}, path={}",
            from_channel.as_str(),
            to_channel.as_str(),
            install_path
        );

        let game_dir = Path::new(install_path);
        let staging_dir = game_dir.join(".switch.download");
        let backup_root = game_dir.join(".switch");

        let emit = |phase: &str,
                    downloaded: u64,
                    total: u64,
                    file: Option<String>,
                    idx: usize,
                    count: usize| {
            let progress = SwitchProgress {
                phase: phase.to_string(),
                downloaded,
                total,
                current_file: file,
                file_index: idx,
                file_count: count,
                from_channel: from_channel.as_str().to_string(),
                to_channel: to_channel.as_str().to_string(),
            };
            let _ = app.emit("launcher://switch-progress", &progress);
            let _ = app.emit("launcher://progress", &ActiveOperation::Switching(progress));
        };

        // ===== Phase 1: Fetch manifests + diff =====
        self.set_active_operation(Some(ActiveOperation::Switching(SwitchProgress {
            phase: "checking".to_string(),
            downloaded: 0,
            total: 0,
            current_file: None,
            file_index: 0,
            file_count: 0,
            from_channel: from_channel.as_str().to_string(),
            to_channel: to_channel.as_str().to_string(),
        })))
        .await;

        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }

        let from_remote = self.get_latest_package(from_channel, None).await?;
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let to_remote = self.get_latest_package(to_channel, None).await?;
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let (from_manifest, _) = self.fetch_manifest(&from_remote.resource_base_url).await?;
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let (to_manifest, _) = self.fetch_manifest(&to_remote.resource_base_url).await?;

        let from_map: std::collections::HashMap<&str, &ManifestFile> =
            from_manifest.iter().map(|f| (f.path.as_str(), f)).collect();
        let to_map: std::collections::HashMap<&str, &ManifestFile> =
            to_manifest.iter().map(|f| (f.path.as_str(), f)).collect();

        let mut files_to_download: Vec<ManifestFile> = Vec::new();
        let mut files_to_remove: Vec<ManifestFile> = Vec::new();

        for (path, to_entry) in &to_map {
            match from_map.get(path) {
                Some(from_entry) => {
                    if from_entry.md5 != to_entry.md5 || from_entry.size != to_entry.size {
                        files_to_download.push((*to_entry).clone());
                    }
                }
                None => {
                    files_to_download.push((*to_entry).clone());
                }
            }
        }
        for (path, from_entry) in &from_map {
            if !to_map.contains_key(path) {
                files_to_remove.push((*from_entry).clone());
            }
        }

        tracing::info!(
            "[switch] Diff: {} to download, {} to remove",
            files_to_download.len(),
            files_to_remove.len()
        );

        if files_to_download.is_empty() && files_to_remove.is_empty() {
            self.set_active_operation(None).await;
            return Ok(to_remote.version);
        }

        // ===== Phase 2: Download to staging =====
        fs::create_dir_all(&staging_dir).map_err(|e| format!("Create staging dir: {}", e))?;
        let mut downloaded_files: Vec<PathBuf> = Vec::new();

        let total_download_bytes: u64 =
            files_to_download.iter().map(|f| f.size.max(0) as u64).sum();
        let mut accumulated_bytes: u64 = 0;

        for (idx, file) in files_to_download.iter().enumerate() {
            if SWITCH_CANCELLED.load(Ordering::SeqCst) {
                tracing::info!("[switch] Cancelled during download, cleaning staging");
                for f in &downloaded_files {
                    let _ = fs::remove_file(f);
                }
                let _ = fs::remove_dir_all(&staging_dir);
                self.set_active_operation(None).await;
                reset_switch_cancel();
                return Err("Switch cancelled".to_string());
            }

            let dest = staging_dir.join(&file.path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).ok();
            }

            let backup_path = backup_root.join(to_channel.as_str()).join(&file.path);
            let file_size = file.size.max(0) as u64;

            if backup_path.exists() {
                if let Ok(meta) = fs::metadata(&backup_path) {
                    if meta.len() as i64 == file.size {
                        if hg_crypto::verify_md5(backup_path.to_str().unwrap_or(""), &file.md5)
                            .unwrap_or(false)
                        {
                            tracing::info!("[switch] Reusing backup for {}", file.path);
                            fs::copy(&backup_path, &dest)
                                .map_err(|e| format!("Copy backup: {}", e))?;
                            accumulated_bytes += file_size;
                            downloaded_files.push(dest);
                            emit(
                                "downloading",
                                accumulated_bytes,
                                total_download_bytes,
                                Some(file.path.clone()),
                                idx,
                                files_to_download.len(),
                            );
                            continue;
                        }
                    }
                }
            }

            let download_url = format!("{}/{}", to_remote.resource_base_url, file.path);
            emit(
                "downloading",
                accumulated_bytes,
                total_download_bytes,
                Some(file.path.clone()),
                idx,
                files_to_download.len(),
            );

            let dl_counter = Arc::new(AtomicU64::new(0));
            let dl_counter_clone = dl_counter.clone();
            let dest_clone = dest.to_string_lossy().to_string();
            let md5_clone = file.md5.clone();
            let url_clone = download_url.clone();

            let result = download_single_file(
                &self.download_client,
                &url_clone,
                &dest_clone,
                &md5_clone,
                dl_counter_clone,
                file_size,
                false,
            )
            .await;
            match result {
                Ok(()) => {
                    accumulated_bytes += file_size;
                    downloaded_files.push(dest);
                }
                Err(e) => {
                    tracing::error!("[switch] Download failed for {}: {}", file.path, e);
                    for f in &downloaded_files {
                        let _ = fs::remove_file(f);
                    }
                    let _ = fs::remove_dir_all(&staging_dir);
                    self.set_active_operation(None).await;
                    return Err(format!("Download failed for {}: {}", file.path, e));
                }
            }
        }

        tracing::info!(
            "[switch] Phase 2 complete: {} files in staging",
            downloaded_files.len()
        );

        // ===== Phase 3: Backup old files + delete =====
        let backup_dir = backup_root.join(from_channel.as_str());
        let mut backed_up_files: Vec<(PathBuf, PathBuf)> = Vec::new();

        for (idx, file) in files_to_remove.iter().enumerate() {
            if SWITCH_CANCELLED.load(Ordering::SeqCst) {
                tracing::info!("[switch] Cancelled during backup, restoring");
                for (original, backup) in &backed_up_files {
                    if !original.exists() && backup.exists() {
                        if let Some(parent) = original.parent() {
                            fs::create_dir_all(parent).ok();
                        }
                        fs::copy(backup, original).ok();
                    }
                }
                self.set_active_operation(None).await;
                reset_switch_cancel();
                return Err("Switch cancelled".to_string());
            }

            let original = game_dir.join(&file.path);
            let backup = backup_dir.join(&file.path);
            if let Some(parent) = backup.parent() {
                fs::create_dir_all(parent).ok();
            }

            emit(
                "backing_up",
                idx as u64,
                files_to_remove.len() as u64,
                Some(file.path.clone()),
                idx,
                files_to_remove.len(),
            );

            if original.exists() {
                fs::copy(&original, &backup).map_err(|e| format!("Backup copy: {}", e))?;
                fs::remove_file(&original).map_err(|e| format!("Delete original: {}", e))?;
                backed_up_files.push((original, backup));
            }
        }

        tracing::info!(
            "[switch] Phase 3 complete: {} files backed up",
            backed_up_files.len()
        );

        // ===== Phase 4: Copy staging to game dir =====
        let mut moved_files: Vec<PathBuf> = Vec::new();

        for (idx, file) in files_to_download.iter().enumerate() {
            if SWITCH_CANCELLED.load(Ordering::SeqCst) {
                tracing::info!("[switch] Cancelled during move, rolling back");
                for dst in &moved_files {
                    let _ = fs::remove_file(dst);
                    let relative = dst.strip_prefix(game_dir).unwrap_or(dst);
                    let backup = backup_dir.join(relative);
                    if backup.exists() {
                        if let Some(parent) = dst.parent() {
                            fs::create_dir_all(parent).ok();
                        }
                        fs::copy(backup, dst).ok();
                    }
                }
                self.set_active_operation(None).await;
                reset_switch_cancel();
                return Err("Switch cancelled".to_string());
            }

            let src = staging_dir.join(&file.path);
            let dst = game_dir.join(&file.path);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).ok();
            }

            emit(
                "moving",
                idx as u64,
                files_to_download.len() as u64,
                Some(file.path.clone()),
                idx,
                files_to_download.len(),
            );

            fs::copy(&src, &dst).map_err(|e| format!("Move to game dir: {}", e))?;
            moved_files.push(dst);
        }

        tracing::info!(
            "[switch] Phase 4 complete: {} files moved to game dir",
            moved_files.len()
        );

        // ===== Phase 5: Cleanup =====
        let _ = fs::remove_dir_all(&staging_dir);

        emit("completed", 0, 0, None, 0, 0);
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.set_active_operation(None).await;

        tracing::info!(
            "[switch] Channel switch complete: {} -> {}",
            from_channel.as_str(),
            to_channel.as_str()
        );
        Ok(to_remote.version)
    }
}

/// 原子地回退已累计的下载进度（避免并发任务下溢）
fn subtract_download_progress(counter: &AtomicU64, bytes: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
        Some(value.saturating_sub(bytes))
    });
}

/// 单文件下载+验证（供并发下载使用）
/// - 流式 MD5 校验，避免把大文件整体读入内存
/// - 断点续传：`resume` 为真时保留 `.download` 分片并按 Range 继续
/// - 最多重试 3 次，期间保留已写入的分片
async fn download_single_file(
    client: &Client,
    url: &str,
    dest_path: &str,
    expected_md5: &str,
    dl_bytes: Arc<AtomicU64>,
    file_size: u64,
    resume: bool,
) -> Result<(), String> {
    let download_path = format!("{}.download", dest_path);
    let download_file = Path::new(&download_path);

    if let Some(parent) = Path::new(dest_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }

    if !resume {
        let _ = fs::remove_file(download_file);
    }

    if resume {
        // 上次已完整下载但未及重命名：校验通过后直接改名，不再重新下载
        let existing_len = fs::metadata(download_file).map(|m| m.len()).unwrap_or(0);
        if file_size > 0
            && existing_len == file_size
            && (expected_md5.is_empty()
                || hg_crypto::verify_md5(&download_path, expected_md5).unwrap_or(false))
        {
            tracing::info!("[download] Completing interrupted rename: {}", dest_path);
            fs::rename(&download_path, dest_path).map_err(|e| format!("Rename: {}", e))?;
            return Ok(());
        }
        // 长度超过预期说明是旧数据的残留，直接丢弃
        if file_size > 0 && existing_len >= file_size {
            let _ = fs::remove_file(download_file);
        }
    }

    let max_retries = 3u32;
    let mut last_error = String::new();
    // 本次调用累计写入 dl_bytes 的字节数，重试前回退
    let mut counted_bytes: u64 = 0;

    for attempt in 0..max_retries {
        if attempt > 0 {
            let delay = Duration::from_secs(attempt as u64 * 2);
            tracing::warn!(
                "[download] Retry {}/{} for {} after {}s: {}",
                attempt + 1,
                max_retries,
                dest_path,
                delay.as_secs(),
                last_error
            );
            tokio::time::sleep(delay).await;
            if counted_bytes > 0 {
                subtract_download_progress(&dl_bytes, counted_bytes);
                counted_bytes = 0;
            }
        }

        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
            tracing::info!("[download] Cancelled before request: {}", dest_path);
            return Err("Download cancelled".to_string());
        }

        let mut start_byte = if resume {
            fs::metadata(download_file).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        if file_size > 0 && start_byte >= file_size {
            start_byte = 0;
        }
        if start_byte > 0 {
            tracing::debug!(
                "[download] Resuming {} from byte {}/{}",
                dest_path,
                start_byte,
                file_size
            );
        }

        let mut req = client.get(url);
        if start_byte > 0 {
            req = req.header("Range", format!("bytes={}-", start_byte));
        }

        match capture::send_stream(client, req).await {
            Ok(resp) => {
                let status = resp.status();
                let is_partial = status == 206;
                let is_ok = status == 200;

                if !is_partial && !is_ok {
                    last_error = format!("HTTP {}", status);
                    tracing::warn!(
                        "[download] HTTP {} for {} (attempt {}/{})",
                        status,
                        dest_path,
                        attempt + 1,
                        max_retries
                    );
                    continue;
                }

                if is_ok && start_byte > 0 {
                    tracing::debug!(
                        "[download] Server ignored Range for {}, restarting from 0",
                        dest_path
                    );
                    // 服务端忽略 Range：丢弃旧前缀，避免进度重复累计
                    subtract_download_progress(&dl_bytes, start_byte);
                    start_byte = 0;
                }

                let content_length = resp.content_length().unwrap_or(0);
                let total = content_length + start_byte;
                tracing::debug!(
                    "[download] Starting {}: total={}, start_byte={}, status={}",
                    dest_path,
                    total,
                    start_byte,
                    status
                );

                let file = if start_byte > 0 && is_partial {
                    fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&download_path)
                        .map_err(|e| format!("Open append: {}", e))?
                } else {
                    fs::File::create(&download_path).map_err(|e| format!("Create file: {}", e))?
                };
                let mut writer = BufWriter::with_capacity(1024 * 1024, file);

                let mut stream = resp.bytes_stream();
                let mut downloaded = start_byte;
                let mut last_log = start_byte;
                let log_interval = 4 * 1024 * 1024; // log every 4 MB
                let mut stream_error: Option<String> = None;

                while let Some(chunk) = stream.next().await {
                    if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                        let _ = writer.flush();
                        drop(writer);
                        if !resume {
                            let _ = fs::remove_file(&download_path);
                        }
                        tracing::info!("[download] Cancelled: {}", dest_path);
                        return Err("Download cancelled".to_string());
                    }
                    let chunk = match chunk {
                        Ok(chunk) => chunk,
                        Err(e) => {
                            stream_error = Some(format!("Stream: {}", e));
                            break;
                        }
                    };
                    writer
                        .write_all(&chunk)
                        .map_err(|e| format!("Write: {}", e))?;
                    let chunk_len = chunk.len() as u64;
                    downloaded += chunk_len;
                    counted_bytes += chunk_len;
                    dl_bytes.fetch_add(chunk_len, Ordering::Relaxed);

                    // Log progress periodically
                    if downloaded - last_log >= log_interval || downloaded == total {
                        tracing::debug!(
                            "[download] {} {}/{} ({:.1}%)",
                            dest_path,
                            downloaded,
                            total,
                            if total > 0 {
                                downloaded as f64 / total as f64 * 100.0
                            } else {
                                0.0
                            }
                        );
                        last_log = downloaded;
                    }
                }
                writer.flush().map_err(|e| format!("Flush: {}", e))?;
                drop(writer);

                if let Some(error) = stream_error {
                    last_error = error;
                    tracing::warn!(
                        "[download] Stream interrupted for {} (attempt {}/{}), keeping {}/{} bytes",
                        dest_path,
                        attempt + 1,
                        max_retries,
                        downloaded,
                        total
                    );
                    continue;
                }

                tracing::debug!(
                    "[download] Stream complete for {}, verifying MD5",
                    dest_path
                );

                // 流式 MD5 校验，避免大文件占用大量内存
                let verified = expected_md5.is_empty()
                    || hg_crypto::verify_md5(&download_path, expected_md5).unwrap_or(false);
                if !verified {
                    let _ = fs::remove_file(&download_path);
                    tracing::error!(
                        "[download] MD5 mismatch for {}: expected={}",
                        dest_path,
                        expected_md5
                    );
                    return Err(format!(
                        "MD5 mismatch for {}: expected {}",
                        dest_path, expected_md5
                    ));
                }

                tracing::debug!("[download] Renaming {} -> {}", download_path, dest_path);
                fs::rename(&download_path, dest_path).map_err(|e| format!("Rename: {}", e))?;

                tracing::info!("[download] OK: {} ({} bytes)", dest_path, downloaded);
                return Ok(());
            }
            Err(e) => {
                last_error = e.to_string();
                tracing::warn!(
                    "[download] Request error for {} (attempt {}/{}): {}",
                    dest_path,
                    attempt + 1,
                    max_retries,
                    last_error
                );
                continue;
            }
        }
    }

    if !resume {
        let _ = fs::remove_file(&download_path);
    }
    tracing::error!(
        "[download] FAILED after {} attempts: {} — {}",
        max_retries,
        dest_path,
        last_error
    );
    Err(format!(
        "Download failed after {} attempts: {}",
        max_retries, last_error
    ))
}
