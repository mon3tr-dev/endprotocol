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

/// å…¨å±€ä¸‹è½½å–æ¶ˆæ ‡å¿—
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
static SWITCH_CANCELLED: AtomicBool = AtomicBool::new(false);
/// æœ¬æ¬¡å–æ¶ˆæ˜¯å¦åŒæ—¶åˆ é™¤ä¸‹è½½ç¼“å­˜ï¼ˆç”± launcher_cancel_download å¸¦ install_path æ—¶ç½®ä½ï¼‰
static CANCEL_CLEANUP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// å®‰è£…æš‚å­˜ç›®å½•åŽç¼€ï¼šå›ºå®šåç§°ï¼Œä¿è¯å–æ¶ˆ/å¤±è´¥åŽä¸‹æ¬¡è¿è¡Œä»èƒ½ç»­ä¼ 
const INSTALL_STAGING_SUFFIX: &str = ".staging.resume";
/// å®‰è£…æš‚å­˜ç›®å½•å¯¹åº”çš„ç‰ˆæœ¬æ ‡è®°æ–‡ä»¶åŽç¼€ï¼ˆä¸Žæš‚å­˜ç›®å½•åŒçº§ï¼Œé¿å…è¢«å½“ä½œæ¸¸æˆæ–‡ä»¶åº”ç”¨ï¼‰
const INSTALL_STAGING_VERSION_SUFFIX: &str = ".staging.resume.version";
/// å°æ–‡ä»¶å¤ç”¨å‰é‡æ–°æ ¡éªŒ MD5 çš„å°ºå¯¸ä¸Šé™ï¼ˆå¤§æ–‡ä»¶ä¸‹è½½å®Œæˆæ—¶å·²æ ¡éªŒï¼‰
const STAGED_REUSE_HASH_LIMIT: u64 = 16 * 1024 * 1024;
/// é¢„ä¸‹è½½åˆ†å·æš‚å­˜ç›®å½•çš„ç‰ˆæœ¬æ ‡è®°æ–‡ä»¶
const PRELOAD_VERSION_MARKER: &str = ".preload_version";

/// è¡¥ä¸ / é¢„ä¸‹è½½åŒ…å†…çš„**æŽ§åˆ¶æ–‡ä»¶**ï¼šå®ƒä»¬ä¸æ˜¯æ¸¸æˆæ–‡ä»¶ï¼Œä¸èƒ½é“ºè¿›å®‰è£…ç›®å½•ã€‚
///
/// é€†å‘ä¾æ®ï¼ˆGames.exeï¼‰ï¼š
/// - `CCopyGameFile` æž„é€ å‡½æ•°ç”¨ `package_files` / `delete_files.txt` / `patch.json` ä¸‰ä¸ªåå­—
///   å»ºç«‹"è·³è¿‡åå•"ï¼ˆRVA `0x00278dc0`ï¼Œç´§é‚» RVA `0x00277c50` çš„ `delete_files.txt` è·¯å¾„æž„é€ ï¼‰ï¼›
/// - æœ¬æœºå®˜æ–¹å®‰è£…ç›®å½• `E:\Endfield Game` å®žæµ‹åªæœ‰ `game_files`ï¼Œæ²¡æœ‰ `package_files` /
///   `delete_files.txt` / `patch.json`ã€‚
///
/// `game_files` **ä¸åœ¨**æŽ’é™¤ä¹‹åˆ—ï¼šå®ƒæ˜¯æ¸¸æˆå®‰è£…ç›®å½•å†…çš„æ­£å¼æ–‡ä»¶ï¼ˆå®˜æ–¹å®žæµ‹ä¿ç•™ï¼‰ã€‚
const ARCHIVE_CONTROL_FILES: [&str; 3] = ["package_files", "delete_files.txt", "patch.json"];
/// åŒ…å†…"éœ€è¦åˆ é™¤çš„æ—§æ–‡ä»¶"æ¸…å•
const ARCHIVE_DELETE_LIST: &str = "delete_files.txt";
/// å·®é‡è¡¥ä¸åŒ…ï¼ˆå« hpatch `_patch` æ¡ç›®ï¼‰çš„é”™è¯¯å‰ç¼€ï¼šè°ƒç”¨æ–¹æ®æ­¤å›žé€€åˆ°æ¸…å•é€æ–‡ä»¶ä¸‹è½½
const ERR_DELTA_ARCHIVE: &str = "DELTA_ARCHIVE:";

/// åˆ¤æ–­è§£åŽ‹äº§ç‰©ä¸­çš„ç›¸å¯¹è·¯å¾„æ˜¯å¦ä¸ºåŒ…å†…æŽ§åˆ¶æ–‡ä»¶ï¼ˆåªåŒ¹é…åŒ…æ ¹ä¸‹çš„é‚£å‡ ä¸ªåå­—ï¼‰
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

/// ä¸€æ¬¡å…¬å‘Šç±»è¯·æ±‚è§£æžå‡ºæ¥çš„ä¸‰é¡¹å†…å®¹ï¼ˆBanner / å…¬å‘Š / å³ä¾§æ ï¼‰ã€‚
///
/// å•ç‹¬æˆç»“æž„æ˜¯ä¸ºäº†è®© `get_banners` / `get_announcements` / `get_notice_content`
/// å…±ç”¨åŒä¸€å¥—è§£æžä¸Žå›žè½é€»è¾‘ï¼šè°ç¼ºå“ªé¡¹å°±è¡¥å“ªé¡¹ï¼Œä¸å¿…æ•´ä»½æ¢æŽ‰ã€‚
#[derive(Debug, Default)]
struct NoticeParts {
    banners: Vec<BannerItem>,
    announcements: Vec<AnnouncementItem>,
    sidebars: Vec<SidebarItem>,
}

/// è¯»å– `delete_files.txt` å†…å®¹ï¼šå®˜æ–¹æ˜¯"æ¯è¡Œä¸€ä¸ªç›¸å¯¹è·¯å¾„"çš„æ¸…å•ï¼›
/// è¿™é‡ŒåŒæ—¶å…¼å®¹ JSON æ•°ç»„ï¼ˆ`["a","b"]` æˆ– `[{"path":"a"}]`ï¼‰ï¼Œä¸¤ç§éƒ½å½’ä¸€åŒ–ä¸ºç›¸å¯¹è·¯å¾„åˆ—è¡¨ã€‚
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

/// æ ‡è®°æœ¬æ¬¡å–æ¶ˆéœ€è¦è¿žå¸¦åˆ é™¤ç¼“å­˜æ–‡ä»¶ï¼ˆå¿…é¡»åœ¨ cancel_download ä¹‹å‰è°ƒç”¨ï¼‰
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

/// æ¸…ç†æŒ‡å®šå®‰è£…è·¯å¾„ä¸‹çš„æ‰€æœ‰æš‚å­˜ç›®å½•å’Œ .download ç¼“å­˜æ–‡ä»¶
pub fn cleanup_staging_files(install_path: &str) {
    let install_dir = Path::new(install_path);
    // åˆ é™¤åˆ‡æ¢æš‚å­˜ç›®å½•
    let switch_staging = format!("{}.switch.download", install_path);
    if Path::new(&switch_staging).exists() {
        tracing::info!("[cleanup] Removing switch staging: {}", switch_staging);
        let _ = fs::remove_dir_all(&switch_staging);
    }
    // åˆ é™¤æ—§æ ¼å¼ staging ç›®å½•
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
    // åˆ é™¤å®‰è£…ç›®å½•å†…çš„ .download æ–‡ä»¶
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

/// ç›®å½•å†…æ˜¯å¦å­˜åœ¨ä»»æ„æ–‡ä»¶ï¼ˆç”¨äºŽåˆ¤æ–­æš‚å­˜åŒºæ˜¯å¦å€¼å¾—ä¿ç•™ï¼‰
fn dir_has_files(dir: &Path) -> bool {
    WalkDir::new(dir)
        .into_iter()
        .flatten()
        .any(|entry| entry.file_type().is_file())
}

/// æ£€æŸ¥æŒ‡å®šå®‰è£…è·¯å¾„ä¸‹æ˜¯å¦å­˜åœ¨ä¸‹è½½ç¼“å­˜ï¼ˆæš‚å­˜ç›®å½•æˆ– .download æ–‡ä»¶ï¼‰
pub fn has_download_cache(install_path: &str) -> bool {
    let install_dir = Path::new(install_path);
    // æ£€æŸ¥ *.staging.* ç›®å½•
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
    // æ£€æŸ¥å®‰è£…ç›®å½•å†…çš„ .download æ–‡ä»¶
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
    /// åªä¸²è¡ŒåŒ–ã€Œä¼šå†™å®‰è£…ç›®å½•ã€çš„é•¿ä»»åŠ¡ï¼ˆå®‰è£…/æ›´æ–°ã€æ ¡éªŒä¿®å¤ã€é¢„ä¸‹è½½ã€åˆ‡æœï¼‰ã€‚
    /// æ•´ä¸ªæœåŠ¡æ­¤å‰è¢« `Arc<Mutex<GameLauncherService>>` åŒ…ç€ï¼Œè€Œå®‰è£…ä¸€è·‘å°±æ˜¯å‡ ååˆ†é’Ÿï¼Œ
    /// æœŸé—´å…¬å‘Šã€èƒŒæ™¯å›¾ã€çŠ¶æ€æŸ¥è¯¢å…¨éƒ¨æŽ’é˜Ÿç­‰é”â€”â€”å‰ç«¯åˆ·æ–°åŽå¯åŠ¨æµç¨‹çš„ä»»åŠ¡é‡Œå°±æœ‰
    /// å…¬å‘Šå’ŒèƒŒæ™¯å›¾ï¼ŒäºŽæ˜¯å¡æ­»åœ¨ã€Œæ­£åœ¨åŠ è½½åˆå§‹æ•°æ®â€¦ã€ã€‚
    write_gate: Arc<Semaphore>,
}

impl GameLauncherService {
    pub fn new() -> Self {
        let http_client = crate::utils::http_client::client_builder()
            .timeout(Duration::from_secs(30))
            .user_agent("EndProtocol/0.1.0")
            .build()
            .expect("Failed to create HTTP client");

        let download_client = crate::utils::http_client::client_builder()
            .connect_timeout(Duration::from_secs(30))
            // å•æ–‡ä»¶å¯èƒ½ä¸‹è½½æ•°ååˆ†é’Ÿï¼Œè¿™é‡Œåªé™åˆ¶è¯»è¶…æ—¶ï¼Œé¿å…å¤§æ–‡ä»¶è¢«æ€»è¶…æ—¶ä¸­æ–­
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

    /// å–ã€Œä¼šå†™å®‰è£…ç›®å½•ã€çš„é•¿ä»»åŠ¡é—¸é—¨ï¼ˆå®¹é‡ 1ï¼‰ã€‚å‘½ä»¤å±‚å…ˆ acquire åˆ° permit å†æ‰§è¡Œï¼Œ
    /// ä¿è¯å®‰è£…/æ ¡éªŒ/é¢„ä¸‹è½½/åˆ‡æœå½¼æ­¤ä¸å¹¶å‘ï¼ŒåŒæ—¶ä¸å†å µä½åªè¯»å‘½ä»¤ã€‚
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

    // ========== ç‰ˆæœ¬æ£€æŸ¥ ==========

    /// ä»Ž launcher API èŽ·å–æœ€æ–°ç‰ˆæœ¬å’Œèµ„æºåœ°å€
    ///
    /// `local_version` ä¼šä½œä¸º `version` å­—æ®µå‘ç»™å®˜æ–¹æŽ¥å£ï¼š
    /// - å®˜æ–¹å®¢æˆ·ç«¯å§‹ç»ˆä¸ŠæŠ¥æœ¬åœ°ç‰ˆæœ¬ï¼›åªæœ‰åœ¨å¸¦ä¸Šç‰ˆæœ¬æ—¶æŽ¥å£æ‰ä¼šè¿”å›ž `pre_patch`ï¼ˆé¢„ä¸‹è½½è¡¥ä¸åŒ…ï¼‰ã€‚
    /// - å…¨æ–°å®‰è£…ï¼ˆæ— æœ¬åœ°ç‰ˆæœ¬ï¼‰ä¼  `None`ï¼Œæ­¤æ—¶è¿”å›žçš„ `pkg.packs` ä¸ºå®Œæ•´å®‰è£…åŒ…åˆ†å·åˆ—è¡¨ã€‚
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
                "Failed to parse API response: {} â€” body preview: {}",
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

        // é¢„ä¸‹è½½è¡¥ä¸åŒ…ï¼ˆpre_patchï¼‰ï¼šå®˜æ–¹åœ¨æ­£å¼å‘ç‰ˆå‰æä¾›çš„åˆ†å·åŽ‹ç¼©åŒ…
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

        // ç‰ˆæœ¬è¡¥ä¸åŒ…ï¼ˆpatchï¼‰ï¼šå®˜æ–¹å¸¸è§„æ›´æ–°çš„ä¸»é€šé“ã€‚
        // patch.patches æ˜¯ WinZip AES-256 åŠ å¯†åˆ†å·ï¼Œå¯†ç  = patch.cd_keyï¼›patch.url æ˜¯æœªåŠ å¯†æ•´åŒ…ã€‚
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

        // è§£å¯†å¯†é’¥ï¼šå®˜æ–¹çœŸå€¼åœ¨ patch.cd_keyï¼ˆ`pkg` é‡Œæ²¡æœ‰è¯¥é”®ï¼Œè§ Games.exe ParseLatestGameJsonï¼‰ã€‚
        // ä¿ç•™ pkg.cd_key ä½œä¸ºåŽ†å²å½¢æ€å…œåº•ã€‚
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
                patch_is_delta: patch_info.map(|p| p.is_delta()).unwrap_or(false),
                patch_whole_url: patch_info.map(|p| p.url.clone()).unwrap_or_default(),
                patch_whole_md5: patch_info.map(|p| p.md5.clone()).unwrap_or_default(),
                patch_whole_bytes: patch_info
                    .map(|p| p.package_size.parse().unwrap_or(0))
                    .unwrap_or(0),
            },
            cd_key,
        ))
    }

    /// æ£€æŸ¥æ¸¸æˆå®‰è£…çŠ¶æ€
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
        // å¸¦ä¸Šæœ¬åœ°ç‰ˆæœ¬ï¼šå®˜æ–¹æŽ¥å£åªåœ¨è¿™ç§æƒ…å†µä¸‹è¿”å›ž pre_patchï¼ˆé¢„ä¸‹è½½è¡¥ä¸åŒ…ï¼‰
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

        // é¢„ä¸‹è½½å¯ç”¨æ¡ä»¶ï¼šå·²å®‰è£… + å®˜æ–¹æä¾›é¢„ä¸‹è½½è¡¥ä¸åŒ… + æœ¬åœ°ç‰ˆæœ¬ä¸æ˜¯é¢„ä¸‹è½½ç›®æ ‡ç‰ˆæœ¬
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

    /// æ‰«æå®‰è£…ç›®å½•ï¼Œæ£€æŸ¥å·²æœ‰æ–‡ä»¶çš„å®Œæ•´æ€§
    pub async fn scan_install_dir(
        &self,
        channel: &GameChannel,
        install_path: &str,
    ) -> Result<FileScanResult, String> {
        let path = Path::new(install_path);

        // æ£€æŸ¥æ ¸å¿ƒæ–‡ä»¶
        let has_exe = path.join(channel.executable_name()).exists();
        let has_data = path.join(channel.data_dir_name()).is_dir();
        let has_config = path.join("config.ini").exists();
        let channel_detected = has_exe && has_data && has_config;

        // èŽ·å–è¿œç¨‹æ¸…å•
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
                        // å¤§å°ä¸åŒ¹é…
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

            // å¤§å°åŒ¹é…ï¼Œæ£€æŸ¥ MD5
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

    /// è¯»å–æœ¬åœ° config.ini ä¸­çš„ç‰ˆæœ¬å·
    fn read_local_version(&self, install_path: &str) -> Result<String, String> {
        let config_path = Path::new(install_path).join("config.ini");
        let content =
            hg_crypto::decrypt_file_to_string(config_path.to_str().ok_or("Invalid config path")?)?;

        // è§£æžç‰ˆæœ¬å·ï¼Œæ ¼å¼ç±»ä¼¼ "game_version = x.y.z"
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

    /// æ¯”è¾ƒç‰ˆæœ¬å·æ˜¯å¦ç›¸ç­‰
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

    // ========== æ¸…å•ä¸‹è½½ä¸Žè§£æž ==========

    /// ä¸‹è½½å¹¶è§£å¯†æ¸¸æˆæ–‡ä»¶æ¸…å•
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

        // è®¡ç®—åŠ å¯†å­—èŠ‚çš„ SHA-256 ç”¨äºŽçŠ¶æ€è·Ÿè¸ª
        let manifest_sha256 = hg_crypto::sha256_hex(&encrypted);
        tracing::debug!("[manifest] SHA-256: {}", manifest_sha256);

        // AES-256-CBC è§£å¯†
        let decrypted = hg_crypto::decrypt_bytes_to_string(&encrypted)?;
        tracing::debug!("[manifest] Decrypted size: {} bytes", decrypted.len());

        // è§£æž NDJSONï¼ˆæ¯è¡Œä¸€ä¸ª JSON å¯¹è±¡ï¼‰
        let files = Self::parse_manifest(&decrypted)?;
        tracing::info!("[manifest] Parsed {} files", files.len());

        Ok((files, manifest_sha256))
    }

    /// è§£æžè§£å¯†åŽçš„æ¸…å•æ–‡æœ¬ï¼ˆNDJSON æ ¼å¼ï¼‰
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

            // éªŒè¯è·¯å¾„å®‰å…¨æ€§
            Self::validate_path(&entry.path)?;

            // éªŒè¯ MD5 æ ¼å¼ï¼ˆ32 ä½åå…­è¿›åˆ¶ï¼‰
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

            // æ£€æŸ¥é‡å¤è·¯å¾„
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

    /// éªŒè¯è·¯å¾„å®‰å…¨æ€§ï¼ˆé˜²æ­¢è·¯å¾„ç©¿è¶Šï¼‰
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

    // ========== æ–‡ä»¶æ¯”è¾ƒä¸Žè®¡åˆ’ ==========

    /// æ¯”è¾ƒæœ¬åœ°æ–‡ä»¶ä¸Žæ¸…å•ï¼Œç”Ÿæˆæ›´æ–°è®¡åˆ’ã€‚
    ///
    /// å…ˆæŒ‰ã€Œæ˜¯å¦å­˜åœ¨ + å¤§å°æ˜¯å¦ä¸€è‡´ã€åˆ¤æ–­ï¼›å¯¹å…¶ä¸­**å¤§å°ä¸€è‡´ä¸”ä¸è¶…è¿‡é˜ˆå€¼**çš„æ–‡ä»¶å†è®¡ç®—
    /// MD5ï¼Œä»¥è¯†åˆ«ã€Œå†…å®¹å˜åŒ–ä½†å¤§å°ä¸å˜ã€çš„æ–‡ä»¶â€”â€”æœ€å…¸åž‹çš„æ˜¯ `config.ini` çš„ç‰ˆæœ¬å·ï¼ˆå®ƒå†³å®š
    /// æœ¬åœ°ç‰ˆæœ¬ï¼Œè‹¥ä¸æ›´æ–°åˆ™æ°¸è¿œæç¤ºå¯æ›´æ–°ï¼‰ã€‚å¤§æ–‡ä»¶åªæŒ‰å¤§å°åˆ¤æ–­ï¼šæ¸¸æˆå¤§èµ„æºå¤šä¸ºå†…å®¹å¯»å€ï¼Œ
    /// å†…å®¹å˜åŒ–ä¼šæ”¹å˜æ–‡ä»¶åæˆ–å¤§å°ã€‚ç”±æ­¤æ—¢é¿å…å¯¹æ•° 10GB æœ¬åœ°æ–‡ä»¶åšå…¨é‡å“ˆå¸Œï¼Œåˆèƒ½æ­£ç¡®æŽ¢æµ‹
    /// ç‰ˆæœ¬å·ç­‰å°æ–‡ä»¶çš„å˜åŒ–ã€‚ä¸‹è½½å¾—åˆ°çš„æ–‡ä»¶ä»ä¼šåœ¨å†™å…¥æ—¶æ ¡éªŒ MD5ã€‚
    async fn plan_updates(
        &self,
        manifest: &[ManifestFile],
        install_path: &str,
        max_concurrent: usize,
    ) -> Vec<FilePlan> {
        /// è¶…è¿‡è¯¥å¤§å°çš„æ–‡ä»¶ä¸å†è®¡ç®— MD5ï¼ˆåªæŒ‰å¤§å°åˆ¤æ–­ï¼‰ã€‚
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
                // ç¼ºå¤±æˆ–å¤§å°ä¸ç¬¦ â†’ éœ€è¦ä¸‹è½½
                need_download += 1;
                continue;
            }
            if entry.size <= HASH_MAX_SIZE {
                // å°æ–‡ä»¶ï¼šéœ€ MD5 ç¡®è®¤å†…å®¹æ˜¯å¦å˜åŒ–
                to_hash.push(idx);
            } else {
                // å¤§æ–‡ä»¶ï¼šæŒ‰å¤§å°å¤ç”¨
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

    // ========== ä¸‹è½½ ==========

    /// ä¸‹è½½å•ä¸ªæ–‡ä»¶ï¼Œæ”¯æŒæ–­ç‚¹ç»­ä¼ å’Œé‡è¯•
    pub async fn download_file_with_resume(
        &self,
        url: &str,
        dest_path: &str,
        progress_callback: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let download_path = format!("{}.download", dest_path);
        let download_file = Path::new(&download_path);

        // ç¡®ä¿ç›®æ ‡ç›®å½•å­˜åœ¨
        if let Some(parent) = Path::new(dest_path).parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let mut start_byte: u64 = 0;

        // æ£€æŸ¥æ˜¯å¦æœ‰æœªå®Œæˆçš„ä¸‹è½½ï¼ˆæ–­ç‚¹ç»­ä¼ ï¼‰
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
                // æŒ‡æ•°é€€é¿
                let delay = Duration::from_secs(attempt as u64);
                tokio::time::sleep(delay).await;
                start_byte = 0; // é‡è¯•æ—¶ä»Žå¤´ä¸‹è½½
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

                    // å¦‚æžœæœåŠ¡å™¨ä¸æ”¯æŒ Rangeï¼Œä»Žå¤´å¼€å§‹
                    if is_ok && start_byte > 0 {
                        start_byte = 0;
                    }

                    let total = resp.content_length().unwrap_or(0) + start_byte;

                    let mut file = if start_byte > 0 && is_partial {
                        // è¿½åŠ æ¨¡å¼
                        fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&download_path)
                            .map_err(|e| format!("Failed to open file for append: {}", e))?
                    } else {
                        // æ–°å»ºæ–‡ä»¶
                        fs::File::create(&download_path)
                            .map_err(|e| format!("Failed to create file: {}", e))?
                    };

                    let mut stream = resp.bytes_stream();
                    let mut downloaded = start_byte;
                    let mut last_emit = start_byte;

                    while let Some(chunk) = stream.next().await {
                        // æ£€æŸ¥å–æ¶ˆæ ‡å¿—
                        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                            drop(file);
                            let _ = fs::remove_file(&download_path);
                            return Err("Download cancelled".to_string());
                        }

                        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
                        file.write_all(&chunk)
                            .map_err(|e| format!("Write error: {}", e))?;
                        downloaded += chunk.len() as u64;

                        // æ¯ 256KB æŠ¥å‘Šä¸€æ¬¡è¿›åº¦
                        if downloaded - last_emit >= 256 * 1024 || downloaded == total {
                            progress_callback(downloaded, total);
                            last_emit = downloaded;
                        }
                    }

                    file.flush().map_err(|e| format!("Flush error: {}", e))?;
                    drop(file);

                    // MD5 æ ¡éªŒ
                    if !hg_crypto::verify_md5(
                        &download_path,
                        &hg_crypto::md5_hex(&fs::read(&download_path).unwrap_or_default()),
                    )? {
                        // ä»Žæ¸…å• URL ä¸­æ— æ³•èŽ·å–é¢„æœŸ MD5ï¼Œè·³è¿‡æ­¤å¤„æ ¡éªŒ
                        // æ¸…å•æ ¡éªŒåœ¨æ‰¹é‡å®ŒæˆåŽç»Ÿä¸€è¿›è¡Œ
                    }

                    // é‡å‘½åä¸ºæœ€ç»ˆæ–‡ä»¶
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

    /// ä¸‹è½½æ–‡ä»¶å¹¶éªŒè¯ MD5
    pub async fn download_and_verify(
        &self,
        url: &str,
        dest_path: &str,
        expected_md5: &str,
        progress_callback: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        self.download_file_with_resume(url, dest_path, progress_callback)
            .await?;

        // ä¸‹è½½åŽéªŒè¯ MD5
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

    // ========== å®Œæ•´å®‰è£…/æ›´æ–°æµç¨‹ ==========

    /// æ‰§è¡Œå®Œæ•´çš„å®‰è£…æˆ–æ›´æ–°æµç¨‹
    /// è¿”å›žä¸‹è½½çš„æ€»å­—èŠ‚æ•°
    ///
    /// `max_concurrent` ä¸ºåŒæ—¶ä¸‹è½½çš„æ–‡ä»¶æ•°ï¼Œ`resume` æŽ§åˆ¶ä¸­æ–­åŽæ˜¯å¦ä¿ç•™åˆ†ç‰‡ä»¥ä¾¿ç»­ä¼ ã€‚
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
        // 1. æ£€æŸ¥é˜¶æ®µ
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

        // å®˜æ–¹å®¢æˆ·ç«¯å§‹ç»ˆä¸ŠæŠ¥æœ¬åœ°ç‰ˆæœ¬ï¼šåªæœ‰å¸¦ä¸Šç‰ˆæœ¬æ—¶æœåŠ¡ç«¯æ‰ä¼šè¿”å›ž `patch`ï¼ˆå« cd_keyï¼‰
        // ä¸Ž `pre_patch`ã€‚å…¨æ–°å®‰è£…ï¼ˆæ— æœ¬åœ°ç‰ˆæœ¬ï¼‰æ—¶ `patch` ä¸º nullï¼Œè‡ªåŠ¨èµ°æ¸…å•é€æ–‡ä»¶è·¯å¾„ã€‚
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

        if remote.patch_is_delta {
            tracing::info!(
                "[install] Server offered a V2 delta patch archive (hpatch); using the manifest file-by-file path instead"
            );
        }

        // 1.5 è¡¥ä¸åŒ…ä¼˜å…ˆï¼šå®˜æ–¹å¸¸è§„æ›´æ–°èµ°"ä¸‹è½½åŠ å¯†åˆ†å· â†’ 7zg è§£åŽ‹ â†’ è¦†ç›–/åˆ é™¤"ï¼Œæ¯”æŒ‰æ¸…å•é€æ–‡ä»¶
        // ä¸‹è½½çœå¾—å¤šï¼ˆå®žæµ‹ç»ˆæœ«åœ° 1.6.3â†’1.6.4 åªéœ€ 3 MB è¡¥ä¸åŒ…ï¼Œè€Œæ¸…å•å·®å¼‚å¯è¾¾ GB çº§ï¼‰ã€‚
        //
        // ä½†**å·®é‡å½¢æ€**ï¼ˆV2 ç´¢å¼•éžç©ºï¼ŒåŒ…å†…æ˜¯ `vfs_files/vfs_patch/â€¦_patch`ï¼‰å¿…é¡»ç”± hpatch
        // ç»“åˆæœ¬åœ° base æ–‡ä»¶ç”Ÿæˆæ–°æ–‡ä»¶ï¼Œæœ¬å®žçŽ°ä¸å« hpatchï¼Œæ‰€ä»¥æå‰åˆ¤æŽ‰ã€ç›´æŽ¥èµ°æ¸…å•é€æ–‡ä»¶ï¼Œ
        // ä¸åŽ»ç™½ä¸‹å‡  GB åˆ†å·å†å¤±è´¥ã€‚æ˜Žæ—¥æ–¹èˆŸçš„è¡¥ä¸ç›®å‰éƒ½æ˜¯è¿™ç§å·®é‡åŒ…ã€‚
        if remote.has_patch && !remote.patch_parts.is_empty() && !remote.patch_is_delta {
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

        // 1.6 **å·®é‡åŒ…å…œåº•**ï¼šæ˜Žæ—¥æ–¹èˆŸçš„è¡¥ä¸æ˜¯ V2 å·®é‡åŒ…ï¼ˆ`vfs_files/vfs_patch/â€¦_patch`ï¼‰ï¼Œ
        // å¿…é¡»ç”± hpatch ç»“åˆæœ¬åœ° base ç”Ÿæˆæ–°æ–‡ä»¶ï¼›æœ¬å®žçŽ°ä¸å« hpatchã€‚ä½†æœåŠ¡ç«¯åŒæ—¶æä¾›
        // `patch.url` â€”â€” ä¸€ä¸ª**æœªåŠ å¯†çš„æ•´è¡¥ä¸ zipï¼Œæ¡ç›®å°±æ˜¯æœ€ç»ˆæ¸¸æˆæ–‡ä»¶**ï¼ˆå®žæµ‹æ˜Žæ—¥æ–¹èˆŸ
        // 79.0.0 è¿™ä»½ 3,518,344,483 B / 3616 æ¡ï¼ŒæŠ½æ · md5 ä¸Žæ¸…å•ä¸€è‡´ï¼Œä¸”æ—  `_patch` æ¡ç›®ï¼‰ã€‚
        // æ‰€ä»¥å·®é‡åŒ…è¿™æ¡è·¯ä¸Šï¼Œç”¨æ•´è¡¥ä¸ zip é“ºç›˜ï¼Œæ¯”æŒ‰æ¸…å•é€æ–‡ä»¶é‡ä¸‹çœå¾—å¤šã€‚
        if remote.patch_is_delta && !remote.patch_whole_url.is_empty() {
            tracing::info!(
                "[install] V2 delta patch detected; using the unencrypted whole patch zip instead (server reports {} bytes of volumes)",
                remote.patch_whole_bytes
            );
            match self
                .install_from_whole_patch_zip(
                    channel,
                    install_path,
                    &remote.patch_whole_url,
                    &remote.patch_whole_md5,
                    progress_callback.clone(),
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
                Err(error) => {
                    tracing::warn!(
                        "[install] Whole patch zip failed ({}); falling back to manifest download",
                        error
                    );
                }
            }
        }

        // 2. ä¸‹è½½å¹¶è§£å¯†æ¸…å•
        tracing::info!("[install] Fetching manifest...");
        let (manifest, manifest_sha256) = self.fetch_manifest(&remote.resource_base_url).await?;
        tracing::info!("[install] Manifest loaded: {} files", manifest.len());

        // 3. æ¯”è¾ƒé˜¶æ®µ
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
            // å·²ç»æ˜¯æœ€æ–°ç‰ˆæœ¬ï¼šæ¸…ç†å¯èƒ½æ®‹ç•™çš„ç»­ä¼ æš‚å­˜
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

        // 4. åˆ›å»º/å¤ç”¨å›ºå®šæš‚å­˜ç›®å½•ï¼ˆå›ºå®šåç§°è®©å–æ¶ˆæˆ–å¤±è´¥åŽçš„åˆ†ç‰‡åœ¨ä¸‹æ¬¡ç»§ç»­ä½¿ç”¨ï¼‰
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
            // 5. åªæš‚å­˜éœ€è¦æ›´æ–°çš„æ–‡ä»¶ï¼šæœ¬åœ°å·²å­˜åœ¨ä¸” MD5 åŒ¹é…çš„æ–‡ä»¶ä¿æŒåŽŸæ ·ï¼Œ
            //    ä¸å†æ•´ç›®å½•æ‹·è´åˆ°æš‚å­˜åŒºï¼Œæ›´æ–°æ—¶åªéœ€ä¸‹è½½/åº”ç”¨å˜æ›´æ–‡ä»¶ã€‚
            // 6. ä¸‹è½½ç¼ºå¤±/å¼‚å¸¸æ–‡ä»¶ï¼ˆå¹¶å‘ä¸‹è½½ï¼‰ â€” ä¼˜å…ˆä½¿ç”¨é¢„ä¸‹è½½æ–‡ä»¶
            let total_bytes: u64 = files_to_download
                .iter()
                .map(|p| p.manifest.size.max(0) as u64)
                .sum();

            // é¢„ä¸‹è½½çš„äº§ç‰©æ˜¯**åŠ å¯†åˆ†å· zip**ï¼ˆå®˜æ–¹ `predownload` ç›®å½•åŒç†ï¼‰ï¼Œä¸æ˜¯æ¸…å•é‡Œçš„
            // æ¸¸æˆæ–‡ä»¶ï¼Œå› æ­¤ä¸èƒ½æŒ‰ `manifest.path` åŽ»å¤ç”¨ï¼ˆæ—§å®žçŽ°å°±æ˜¯åœ¨è¿™é‡Œæ’ä¸å‘½ä¸­ï¼Œå¯¼è‡´
            // é¢„ä¸‹è½½æµé‡ç™½è´¹ï¼‰ã€‚åˆ†å·çš„å¤ç”¨å‘ç”Ÿåœ¨è¡¥ä¸åŒ…è·¯å¾„ï¼šæŒ‰"åŒå + MD5 ä¸€è‡´"ç›´æŽ¥ä»Ž
            // é¢„ä¸‹è½½æš‚å­˜æ¬åˆ°è¡¥ä¸æš‚å­˜ï¼ˆè§ download_parts_to_staging / bUsePreDownloadZip ç­‰ä»·é€»è¾‘ï¼‰ã€‚
            let reused_bytes = 0u64;

            // å¤ç”¨ä¸Šæ¬¡ä¸­æ–­æ—¶å·²ä¸‹è½½å®Œæˆçš„æš‚å­˜æ–‡ä»¶ï¼›æœªå®Œæˆçš„åˆ†ç‰‡è®¡å…¥å·²å®Œæˆå­—èŠ‚ï¼Œ
            // ä¸‹è½½æ—¶ç”± download_single_file æŒ‰ Range ç»­ä¼ ã€‚å…³é—­ç»­ä¼ æ—¶ä¸å¤ç”¨ã€‚
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
                    // å°æ–‡ä»¶é‡æ–°æ ¡éªŒ MD5ï¼ˆå¤§æ–‡ä»¶ä¸‹è½½å®Œæˆæ—¶å·²ç»æ ¡éªŒè¿‡ï¼‰
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
                        tracing::error!("[install] Download FAILED: {} â€” {}", file_name, e);
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
                            "[install] Failed {}/{}: {} â€” {}",
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

            // 7. è·³è¿‡å…¨é‡æ ¡éªŒï¼šä¸‹è½½æ–‡ä»¶åœ¨ download_single_file ä¸­å·²æŒ‰ MD5 æ ¡éªŒï¼Œ
            //    æœ¬åœ°æ–‡ä»¶åœ¨ plan_updates ä¸­å·²æŒ‰å¤§å°åŒ¹é…ï¼›å®‰è£…å®ŒæˆåŽç”±å‰ç«¯è§¦å‘å¿«é€Ÿæ ¡éªŒã€‚

            // 8. åº”ç”¨é˜¶æ®µï¼šåŽŸå­æ›¿æ¢
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

            // 9. ä¿å­˜çŠ¶æ€
            tracing::info!("[install] Saving payload state...");
            self.save_payload_state(channel, &remote.version, &manifest_sha256, &manifest)?;

            tracing::info!("[install] Install complete! Version: {}", remote.version);
            Ok::<String, String>(remote.version)
        }
        .await;

        // æˆåŠŸæ—¶æ¸…ç†æš‚å­˜ï¼›å¤±è´¥/å–æ¶ˆä¸”å¯ç”¨ç»­ä¼ æ—¶ä¿ç•™ï¼Œä¾›ä¸‹æ¬¡å®‰è£…å¤ç”¨ä¸Žç»­ä¼ ã€‚
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

    /// åŽŸå­æ›¿æ¢ï¼šå°†æš‚å­˜ç›®å½•ä¸­çš„æ–‡ä»¶ç§»åŠ¨åˆ°å®‰è£…ç›®å½•
    fn apply_staged_files(&self, staging: &Path, target: &Path) -> Result<(), String> {
        // å¯¹äºŽæš‚å­˜ç›®å½•ä¸­çš„æ¯ä¸ªæ–‡ä»¶ï¼Œç›´æŽ¥å¤åˆ¶/è¦†ç›–åˆ°ç›®æ ‡
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
    // ========== å®Œæ•´æ€§ä¿®å¤ ==========

    /// éªŒè¯æ¸¸æˆæ–‡ä»¶å®Œæ•´æ€§å¹¶ä¿®å¤ï¼ˆå¤šçº¿ç¨‹æ ¡éªŒ + å³æ—¶ä¿®å¤ï¼‰
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

        // 1. èŽ·å–è¿œç¨‹æ¸…å•
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

        // æ£€æŸ¥å®‰è£…ç›®å½•
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

        // ==================== Phase 1: æ£€æŸ¥æ‰€æœ‰æ–‡ä»¶ ====================
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

        // éœ€è¦ä¿®å¤çš„æ–‡ä»¶æ¸…å•
        let repair_list: Arc<Mutex<Vec<(ManifestFile, String)>>> = Arc::new(Mutex::new(Vec::new()));

        // åŽå°è¿›åº¦å‘å°„å™¨ï¼ˆæ£€æŸ¥é˜¶æ®µï¼‰
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

                // æ£€æŸ¥æ–‡ä»¶æ˜¯å¦å­˜åœ¨ + å¤§å°ï¼ˆå¿«é€Ÿæ¨¡å¼è·³è¿‡ MD5ï¼‰
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
                    true // å¿«é€Ÿæ¨¡å¼è·³è¿‡ MD5
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

        // ç­‰å¾…æ‰€æœ‰æ£€æŸ¥ä»»åŠ¡å®Œæˆ
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

        // ==================== Phase 2: ä¿®å¤æœ‰é—®é¢˜çš„æ–‡ä»¶ ====================
        // åœ¨ drop å‰æ”¶é›†æŸåæ–‡ä»¶ååˆ—è¡¨
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
            tracing::info!("[verify] All files verified OK â€” no repair needed");
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

        // åŽå°è¿›åº¦å‘å°„å™¨ï¼ˆä¿®å¤é˜¶æ®µï¼‰
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

        // ç­‰å¾…æ‰€æœ‰ä¿®å¤ä»»åŠ¡å®Œæˆ
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

        // æœ€ç»ˆè¿›åº¦
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

        // æž„å»ºç»“æžœï¼šè¿”å›ž JSON ç»“æž„æ•°æ®ï¼Œç”±å‰ç«¯åšæœ¬åœ°åŒ–
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

    // ========== é¢„ä¸‹è½½ ==========

    /// é¢„ä¸‹è½½æ¸¸æˆæ›´æ–°èµ„æº
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
        // 1. è¯»å–æœ¬åœ°ç‰ˆæœ¬ï¼ˆæŽ¥å£åªåœ¨ä¸ŠæŠ¥æœ¬åœ°ç‰ˆæœ¬æ—¶è¿”å›ž pre_patchï¼‰
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

        // 3. å¼€å§‹ä¸‹è½½é˜¶æ®µï¼šå¤ç”¨åŒç‰ˆæœ¬æš‚å­˜ä»¥æ”¯æŒç»­ä¼ ã€‚
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: total_bytes,
            stage: InstallStage::Preloading.as_str().to_string(),
            current_file: None,
            file_index: 0,
            file_count: part_count,
            verified_bytes: 0,
        });

        // åŒç‰ˆæœ¬çš„æ—§æš‚å­˜ç›´æŽ¥å¤ç”¨ï¼Œå¼‚ç‰ˆæœ¬å…ˆåˆ é™¤ã€‚
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
        // 5. å¹¶å‘ä¸‹è½½æ‰€æœ‰åˆ†å·ï¼ˆdownload_single_file å†…éƒ¨å®Œæˆå•å· MD5 æ ¡éªŒä¸Žæ–­ç‚¹ç»­ä¼ ï¼‰
        let downloaded_bytes = Arc::new(AtomicU64::new(0));
        let finished_parts = Arc::new(AtomicUsize::new(0));
        let semaphore = Arc::new(Semaphore::new(max_concurrent.clamp(1, 32)));
        let mut join_set = tokio::task::JoinSet::new();

        // åŽå°è¿›åº¦å‘å°„å™¨
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

                // ç»­ä¼ ï¼šå·²ä¸‹è½½ä¸” MD5 ä¸€è‡´çš„åˆ†å·ç›´æŽ¥è·³è¿‡
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

        // ç­‰å¾…æ‰€æœ‰åˆ†å·ä¸‹è½½å®Œæˆ
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
            // å¯ç”¨ç»­ä¼ ä¸”æœªè¦æ±‚æ¸…ç†æ—¶ä¿ç•™å·²ä¸‹è½½åˆ†å·ï¼Œä¸‹æ¬¡é¢„ä¸‹è½½å¯ç»§ç»­
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

        // 6. æœ‰åˆ†å·ä¸‹è½½/æ ¡éªŒå¤±è´¥ï¼šä¿ç•™å·²ä¸‹è½½åˆ†å·ä»¥å¤‡ç»­ä¼ ï¼Œä½†ä¸æ ‡è®°ä¸ºå·²å®Œæˆ
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

        // 7. ä¿å­˜é¢„ä¸‹è½½çŠ¶æ€
        self.save_preload_state(channel, &preload_version, true)?;

        // æœ€ç»ˆè¿›åº¦
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

    /// å®‰è£…å®˜æ–¹é¢„ä¸‹è½½è¡¥ä¸ï¼šä¸‹è½½ `pre_patch` åˆ†å·ã€è§£å¯†è§£åŽ‹å¹¶åº”ç”¨åˆ°å®‰è£…ç›®å½•ã€‚
    ///
    /// ä¸Žå®˜æ–¹ï¼ˆGames.exeï¼‰ä¸€è‡´ï¼š`pre_patch` åªè´Ÿè´£**æå‰ä¸‹è½½åˆ†å·**ï¼›çœŸæ­£"åº”ç”¨"å¿…é¡»æ‹¿åˆ°
    /// `patch.cd_key`ï¼ˆ`pre_patch` å¯¹è±¡é‡Œæ²¡æœ‰å¯†é’¥å­—æ®µï¼‰ï¼Œå› æ­¤è¿™é‡Œè¦æ±‚å¯†é’¥éžç©ºã€‚
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

        // ä¼˜å…ˆç”¨ pre_patch åˆ†å·ï¼›æ­£å¼å‘ç‰ˆåŽ pre_patch ä¼šè¢«æ’¤ä¸‹ï¼Œæ­¤æ—¶é€€å›ž patch åˆ†å·
        // ï¼ˆä¸¤è€…åœ¨å®˜æ–¹å®¢æˆ·ç«¯é‡Œèµ°çš„æ˜¯åŒä¸€æ¡"ä¸‹è½½åˆ†å·â†’7zg è§£åŽ‹"é“¾è·¯ï¼‰ã€‚
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

        // é¢„ä¸‹è½½é˜¶æ®µä¸è¦æå‰æŠŠ"å®Œæˆ"æ€æŠ›ç»™å‰ç«¯ï¼Œç­‰æ•´ä½“åº”ç”¨æˆåŠŸåŽå†å‘
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
            // å·®é‡é¢„ä¸‹è½½åŒ…ï¼ˆV2ï¼‰ï¼šåŒ…å†…æ˜¯ hpatch ç”¨çš„ `_patch` æ•°æ®ï¼Œä¸èƒ½ç›´æŽ¥é“ºè¿›æ¸¸æˆç›®å½•ã€‚
            // åˆ†å·å·²ç»ç•™å¥½ï¼Œç­‰æ­£å¼å‘ç‰ˆåŽèµ°ã€Œæ›´æ–°ã€æŒ‰æ¸…å•é€æ–‡ä»¶ä¸‹è½½å³å¯ï¼Œè¿™é‡Œç»™å‡ºå¯è¯»æç¤º
            // è€Œä¸æ˜¯æŠŠå†…éƒ¨å‰ç¼€ `DELTA_ARCHIVE:` æ³„æ¼åˆ°ç•Œé¢ä¸Šã€‚
            Err(error) if error.starts_with(ERR_DELTA_ARCHIVE) => {
                progress_callback(DownloadProgress {
                    stage: InstallStage::Error.as_str().to_string(),
                    ..Default::default()
                });
                tracing::warn!("[preload] delta archive cannot be applied directly: {error}");
                Err(
                    "This preload package is a V2 delta patch (hpatch-based) and cannot be applied directly; use Update instead"
                        .to_string(),
                )
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

    /// æ ¸å¿ƒé“¾è·¯ï¼š**åŠ å¯†åˆ†å· â†’ è§£å¯†è§£åŽ‹ â†’ åº”ç”¨**ï¼ˆé¢„ä¸‹è½½å®‰è£…ä¸Žç‰ˆæœ¬è¡¥ä¸å…±ç”¨ï¼‰ã€‚
    ///
    /// å¤çŽ°çš„å®˜æ–¹è¡Œä¸ºï¼š
    /// - åˆ†å·ä¸‹è½½åŽé€å· MD5 æ ¡éªŒï¼ˆå®˜æ–¹ `Retry times` / å¤±è´¥æ•´å·é‡ä¸‹ï¼‰ï¼›
    /// - ç”¨ `7zg.exe x -y -o"â€¦" "<åˆ†å·>" -p"<cd_key>"` ç­‰ä»·çš„è§£å¯†è§£åŽ‹ï¼ˆGames.exe `CDecompressAssist::Start`ï¼‰ï¼›
    /// - è§£åŽ‹äº§ç‰©å…ˆè½æš‚å­˜ï¼Œå†æŒ‰"æŽ§åˆ¶æ–‡ä»¶ä¸è½ç›˜ + delete_files.txt åˆ é™¤æ—§æ–‡ä»¶ + åŽŸå­æ›¿æ¢"åº”ç”¨ï¼›
    /// - æ­£å¼æ›´æ–°æ—¶ä¼šä¼˜å…ˆå¤ç”¨é¢„ä¸‹è½½æš‚å­˜é‡ŒåŒååŒ MD5 çš„åˆ†å·ï¼ˆç­‰ä»·å®˜æ–¹ `bUsePreDownloadZip`ï¼‰ã€‚
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

        // å¯å¤ç”¨çš„åˆ†å·æ¥æºï¼šæ‰€æœ‰é¢„ä¸‹è½½æš‚å­˜ç›®å½•ï¼ˆå®˜æ–¹"é¢„ä¸‹è½½äº§ç‰©åœ¨æ­£å¼æ›´æ–°æ—¶ç›´æŽ¥æ¶ˆè´¹"ï¼‰
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

        // è§£åŽ‹ï¼ˆè§£å¯†åœ¨ zip æ¡ç›®å±‚å®Œæˆï¼‰
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
            // å·®é‡åŒ…ï¼šä¿ç•™åˆ†å·ï¼ˆä¸‹æ¬¡ä»éœ€å¤ç”¨ï¼‰ï¼Œäº¤ç»™è°ƒç”¨æ–¹å›žé€€
            if !error.starts_with(ERR_DELTA_ARCHIVE) {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // è§£åŽ‹äº§ç‰©è‡ªæ£€ï¼šåŒ…å†… `package_files` æ˜¯å®˜æ–¹çš„"æœ¬åŒ…æ–‡ä»¶æ¸…å•"ï¼Œç”¨å®ƒå µä½"ååŒ…é“ºè¿›æ¸¸æˆç›®å½•"
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

        // åº”ç”¨ï¼ˆæŽ§åˆ¶æ–‡ä»¶ä¸è½ç›˜ + delete_files.txt + åŽŸå­æ›¿æ¢ï¼‰
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

        // ç”¨æœ€æ–°çš„æœåŠ¡ç«¯æ¸…å•è½ç›˜çŠ¶æ€ã€‚å®˜æ–¹è¡¥ä¸/é¢„ä¸‹è½½åŒ…å†…è‡ªå¸¦ `game_files`ï¼ˆæ–°ç‰ˆåŠ å¯†æ¸…å•ï¼Œ
        // å®žæµ‹ md5 ä¸Žè¿œç«¯ `files/game_files` ä¸€è‡´ï¼‰ï¼Œä¼˜å…ˆç”¨å®ƒï¼Œçœä¸€æ¬¡æ¸…å•ä¸‹è½½ã€‚
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

        // æˆåŠŸï¼šæ¸…æŽ‰è¡¥ä¸æš‚å­˜ä¸Žé¢„ä¸‹è½½æš‚å­˜ï¼Œå¹¶æŠŠ"é¢„ä¸‹è½½å®Œæˆ"æ ‡è®°å¤ä½
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

    /// ç”¨**æœªåŠ å¯†æ•´è¡¥ä¸ zip**ï¼ˆ`patch.url`ï¼‰æ›´æ–°ï¼šå·®é‡åŒ…ï¼ˆV2ï¼‰èµ°ä¸é€šæ—¶çš„å®˜æ–¹å›žé€€å½¢æ€ã€‚
    ///
    /// å®žæµ‹ä¾æ®ï¼ˆæ˜Žæ—¥æ–¹èˆŸ 79.0.0ï¼Œ`patch.url` æŒ‡å‘ 3,518,344,483 B çš„ zipï¼‰ï¼š
    /// - 3616 ä¸ªæ¡ç›®ã€**0 ä¸ªåŠ å¯†æ¡ç›®**ã€**0 ä¸ª `_patch` æ¡ç›®**ï¼Œæ¡ç›®åå°±æ˜¯æœ€ç»ˆæ¸¸æˆæ–‡ä»¶è·¯å¾„ï¼›
    /// - æŠ½æ · `config.ini` / `WebviewConfig/WebPortalSign.gryph` çš„ MD5 ä¸Žè¿œç«¯æ¸…å•é€æ¡ä¸€è‡´ï¼›
    /// - åŒ…å†…åŒæ ·å¸¦ `game_files`ï¼ˆ16 Bï¼‰ä¸Ž `package_files` ç­‰æŽ§åˆ¶æ–‡ä»¶ã€‚
    /// æ‰€ä»¥è¿™æ¡è·¯ä¸Ž"åˆ†å·è§£å¯†è§£åŽ‹"å…±ç”¨åŽåŠæ®µï¼ˆè‡ªæ£€ + æŽ§åˆ¶æ–‡ä»¶è¿‡æ»¤ + delete æ¸…å• + åŽŸå­æ›¿æ¢ï¼‰ï¼Œ
    /// åªæ˜¯å‰åŠæ®µæ¢æˆ"ä¸‹è½½ä¸€ä¸ªæ˜Žæ–‡ zip å†æ™®é€šè§£åŽ‹"ã€‚
    async fn install_from_whole_patch_zip(
        &self,
        channel: &GameChannel,
        install_path: &str,
        url: &str,
        expected_md5: &str,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
        resume: bool,
    ) -> Result<String, String> {
        CANCEL_CLEANUP_REQUESTED.store(false, Ordering::SeqCst);

        let staging_path = PathBuf::from(format!("{}.staging.wholepatch", install_path));
        fs::create_dir_all(&staging_path).map_err(|e| format!("Create whole-patch staging: {}", e))?;
        let archive_path = staging_path.join("patch.zip");
        let archive_str = archive_path.to_string_lossy().to_string();

        // 1) ä¸‹è½½æ•´åŒ…ï¼ˆæ–­ç‚¹ç»­ä¼  + MD5ï¼‰
        progress_callback(DownloadProgress {
            downloaded: 0,
            total: 0,
            stage: InstallStage::Downloading.as_str().to_string(),
            current_file: Some("patch.zip".to_string()),
            file_index: 0,
            file_count: 1,
            verified_bytes: 0,
        });
        let counter = Arc::new(AtomicU64::new(0));
        let download = download_single_file(
            &self.download_client,
            url,
            &archive_str,
            expected_md5,
            counter,
            0,
            resume,
        )
        .await;
        if let Err(error) = download {
            let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
            if !resume || cleanup_requested {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // 2) è§£åŽ‹ï¼ˆæ˜Žæ–‡ zipï¼Œä¸éœ€è¦å¯†ç ï¼‰
        let extracted_dir = staging_path.join(".extracted");
        if extracted_dir.exists() {
            let _ = fs::remove_dir_all(&extracted_dir);
        }
        fs::create_dir_all(&extracted_dir)
            .map_err(|e| format!("Create extraction directory: {}", e))?;

        let extracted_for_task = extracted_dir.clone();
        let archive_for_task = archive_path.clone();
        let progress_for_task = progress_callback.clone();
        let extract_result = tokio::task::spawn_blocking(move || {
            Self::extract_plain_archive(&archive_for_task, &extracted_for_task, progress_for_task)
        })
        .await
        .map_err(|e| format!("Whole-patch extraction task failed: {}", e))?;
        if let Err(error) = extract_result {
            let cleanup_requested = CANCEL_CLEANUP_REQUESTED.load(Ordering::SeqCst);
            if !resume || cleanup_requested {
                let _ = fs::remove_dir_all(&staging_path);
            }
            return Err(error);
        }

        // 3) è‡ªæ£€ + 4) åº”ç”¨ï¼ˆä¸Žåˆ†å·è·¯å¾„å…±ç”¨åŒä¸€å¥—é€»è¾‘ï¼‰
        match Self::verify_archive_package_files(&extracted_dir) {
            Ok(0) => {}
            Ok(checked) => tracing::info!(
                "[wholepatch] package_files self-check passed for {} file(s)",
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
        self.apply_extracted_files(&extracted_dir, Path::new(install_path), &progress_callback)?;

        // 5) è½çŠ¶æ€ï¼ˆä¼˜å…ˆç”¨åŒ…å†… game_filesï¼‰
        let installed_package = self.get_latest_package(channel, None).await?;
        let (manifest, manifest_sha256) = match Self::read_archive_manifest(&extracted_dir) {
            Some(pair) => pair,
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
        let _ = self.save_preload_state(channel, &installed_package.version, false);

        let _ = fs::remove_dir_all(&staging_path);
        tracing::info!(
            "[wholepatch] Applied whole patch zip: version={}",
            installed_package.version
        );
        Ok(installed_package.version)
    }

    /// è§£åŽ‹**æœªåŠ å¯†**çš„æ•´è¡¥ä¸ zipï¼ˆ`patch.url`ï¼‰ã€‚ä¸Ž `extract_encrypted_archive` çš„åŒºåˆ«åªæœ‰
    /// ä¸€å¤„ï¼šæ¡ç›®ä¸éœ€è¦å¯†ç ï¼Œä½†ä»ç„¶ä¼šæ‹’ç»å·®é‡æ¡ç›®ï¼Œé¿å…æŠŠ `_patch` æ•°æ®é“ºè¿›æ¸¸æˆç›®å½•ã€‚
    fn extract_plain_archive(
        archive_path: &Path,
        output_dir: &Path,
        progress_callback: Arc<dyn Fn(DownloadProgress) + Send + Sync>,
    ) -> Result<(), String> {
        let file = File::open(archive_path).map_err(|e| format!("Open whole patch zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Parse whole patch zip: {}", e))?;
        let file_count = archive.len();

        let mut total_bytes = 0u64;
        let mut delta_entries = Vec::new();
        for index in 0..file_count {
            // zip 9ï¼š`name_for_index` è¿”å›ž `Option<ZipResult<Cow<str>>>`ï¼ˆåŒå±‚ï¼‰ã€‚
            // è¿™é‡Œåªåšå·®é‡å½¢æ€é¢„æ£€ï¼Œå¤±è´¥æ—¶ç”¨ç©ºåè·³è¿‡å³å¯ã€‚
            let name = archive
                .name_for_index(index)
                .map(|r| r.unwrap_or_default())
                .unwrap_or_default()
                .to_string();
            let normalized = name.replace('\\', "/").to_lowercase();
            if normalized.ends_with("_patch") || normalized.contains("vfs_files/vfs_patch/") {
                if delta_entries.len() < 5 {
                    delta_entries.push(name);
                }
                continue;
            }
            if let Ok(entry) = archive.by_index(index) {
                if !entry.is_dir() {
                    total_bytes = total_bytes.saturating_add(entry.size());
                }
            }
        }
        if !delta_entries.is_empty() {
            return Err(format!(
                "{} whole patch zip unexpectedly contains hpatch delta entries (e.g. {})",
                ERR_DELTA_ARCHIVE,
                delta_entries.join(", ")
            ));
        }

        let mut extracted_bytes = 0u64;
        let mut extracted_files = 0usize;
        let mut seen_paths = HashSet::new();
        let mut buffer = vec![0u8; 1024 * 1024];

        for index in 0..file_count {
            if DOWNLOAD_CANCELLED.load(Ordering::Relaxed) {
                return Err("Whole patch installation cancelled".to_string());
            }
            let entry_name = archive
                .name_for_index(index)
                .ok_or_else(|| "Invalid path in whole patch zip".to_string())?
                .map_err(|e| format!("Resolve zip entry name: {}", e))?
                .to_string();
            let safe_name = entry_name.trim_end_matches(['/', '\\']);
            GameLauncherService::validate_path(safe_name)?;

            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("Open zip entry: {}", e))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("Unsafe path in whole patch zip: {}", entry_name))?
                .to_path_buf();
            let normalized = relative.to_string_lossy().replace('\\', "/").to_lowercase();
            if !seen_paths.insert(normalized) {
                return Err(format!("Duplicate path in whole patch zip: {}", entry_name));
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
                    return Err("Whole patch installation cancelled".to_string());
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
            return Err("Whole patch zip contains no installable files".to_string());
        }
        Ok(())
    }

    /// ä¸‹è½½åˆ†å·åˆ°æŒ‡å®šæš‚å­˜ç›®å½•ï¼šå·²å­˜åœ¨ä¸” MD5 ä¸€è‡´çš„è·³è¿‡ï¼Œèƒ½æŒ‰"åŒå + MD5"å‘½ä¸­å¤ç”¨ç›®å½•æ—¶ç›´æŽ¥æ¬è¿‡æ¥ã€‚
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

                // 1) æœ¬æš‚å­˜ç›®å½•é‡Œå·²æœ‰ä¸”å®Œæ•´
                if Path::new(&dest_str).exists()
                    && hg_crypto::verify_md5(&dest_str, &part_md5).unwrap_or(false)
                {
                    tracing::info!("[archive] Reusing staged part: {}", file_name);
                    db.fetch_add(part_size, Ordering::Relaxed);
                    fp.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }

                // 2) å¤ç”¨é¢„ä¸‹è½½æš‚å­˜é‡Œçš„åŒååˆ†å·ï¼ˆå†…å®¹å¯»å€ï¼šåŒå + MD5 ä¸€è‡´ï¼‰
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

                // 3) æ­£å¸¸ä¸‹è½½
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

    /// è§£åŽ‹ WinZip AES åŠ å¯†çš„åˆ†å· zipï¼ˆé¡ºåºæ‹¼æŽ¥åŽè§£å¯†ï¼‰ï¼Œäº§ç‰©è½åˆ° `output_dir`ã€‚
    ///
    /// å·®é‡å½¢æ€æ£€æµ‹ï¼šå®˜æ–¹è¡¥ä¸åŒ…æœ‰ä¸¤ç§å†…å®¹å½¢æ€â€”â€”"æœ€ç»ˆæ–‡ä»¶åŒ…"ï¼ˆè§£åŽ‹å³ç”¨ï¼‰ä¸Ž"å·®é‡åŒ…"
    /// ï¼ˆæ¡ç›®å½¢å¦‚ `vfs_files/vfs_patch/diff_<a>_<b>/xxx_patch`ï¼Œå¿…é¡»ç”± hpatch ç»“åˆæœ¬åœ° base
    /// æ–‡ä»¶æ‰“è¡¥ä¸ï¼Œè§ Patch.exe / `CPatchCotroller::DoPatch`ï¼‰ã€‚æœ¬å®žçŽ°ä¸åŒ…å« hpatchï¼Œ
    /// å› æ­¤ä¸€æ—¦å‘çŽ°å·®é‡æ¡ç›®å°±è¿”å›ž `ERR_DELTA_ARCHIVE` å‰ç¼€çš„é”™è¯¯ï¼Œäº¤ç”±è°ƒç”¨æ–¹å›žé€€åˆ°
    /// "æ¸…å•é€æ–‡ä»¶ä¸‹è½½"è·¯å¾„ï¼Œç»ä¸æŠŠ `_patch` å½“æ¸¸æˆæ–‡ä»¶é“ºè¿›å®‰è£…ç›®å½•ã€‚
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

        // ç¬¬ä¸€éï¼šç»Ÿè®¡è§£åŽ‹æ€»é‡ + å·®é‡å½¢æ€æ£€æµ‹
        let mut total_bytes = 0u64;
        let mut delta_entries = Vec::new();
        for index in 0..file_count {
            // zip 9ï¼š`name_for_index` è¿”å›ž `Option<ZipResult<Cow<str>>>`ï¼ˆåŒå±‚ï¼‰ã€‚
            // è¿™é‡Œåªåšå·®é‡å½¢æ€é¢„æ£€ï¼Œå¤±è´¥æ—¶ç”¨ç©ºåè·³è¿‡å³å¯ã€‚
            let name = archive
                .name_for_index(index)
                .map(|r| r.unwrap_or_default())
                .unwrap_or_default()
                .to_string();
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
        // `total_size` åªæ˜¯æœåŠ¡ç«¯çš„"é¢„ç•™ç©ºé—´ä¼°è®¡"ï¼ˆå®žæµ‹ 1.66Ã—~2.5Ã—ï¼‰ï¼Œä»…åœ¨æ²¡æœ‰å®žé™…æ¡ç›®æ—¶å…œåº•ï¼Œ
        // é¿å…è¿›åº¦æ¡åˆ†æ¯è™šé«˜ï¼ˆè§é€†å‘æ–‡æ¡£ Â§6.3ï¼‰ã€‚
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
                .map_err(|e| format!("Resolve zip entry name: {}", e))?
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

    /// æŠŠè§£åŽ‹äº§ç‰©åº”ç”¨åˆ°æ¸¸æˆå®‰è£…ç›®å½•ã€‚
    ///
    /// ä¸Žå®˜æ–¹ï¼ˆGames.exe `CCopyGameFile`ï¼ŒRVA `0x00277c50` / `0x00278dc0`ï¼‰å¯¹é½çš„ä¸‰æ¡è§„åˆ™ï¼š
    /// 1. **åŒ…å†…æŽ§åˆ¶æ–‡ä»¶ä¸è½ç›˜**ï¼š`package_files` / `delete_files.txt` / `patch.json` åªç”¨äºŽé©±åŠ¨æµç¨‹ï¼Œ
    ///    å®žæµ‹å®˜æ–¹å®‰è£…ç›®å½•é‡Œä¸å­˜åœ¨å®ƒä»¬ï¼ˆ`game_files` æ˜¯æ­£å¼æ–‡ä»¶ï¼Œç…§å¸¸åº”ç”¨ï¼‰ï¼›
    /// 2. **æŒ‰ `delete_files.txt` åˆ é™¤æ—§æ–‡ä»¶**ï¼šå®˜æ–¹ä¼šæ‹¼å‡º `<ç›®å½•>\delete_files.txt` å¹¶é€æ¡åˆ é™¤ï¼›
    /// 3. **åŽŸå­æ›¿æ¢**ï¼šå…ˆå†™ `<ç›®æ ‡>.hgtmp`ï¼Œæ ¡éªŒé•¿åº¦åŽå† rename è¦†ç›–ï¼Œé¿å…åŠå†™æ–‡ä»¶ã€‚
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
            // åŽŸå­æ›¿æ¢ï¼šå…ˆå†™ä¸´æ—¶æ–‡ä»¶ï¼Œè½ç›˜åŽ rename è¦†ç›–ç›®æ ‡
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

    /// æŒ‰åŒ…å†… `delete_files.txt` åˆ é™¤å®‰è£…ç›®å½•é‡Œçš„æ—§æ–‡ä»¶ï¼ˆå®˜æ–¹ `CCopyGameFile` çš„è¡Œä¸ºï¼‰
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

    /// è¯»å–åŒ…å†…è‡ªå¸¦çš„æ–°ç‰ˆæ¸…å•ï¼ˆ`game_files`ï¼Œå›ºå®š AES-256-CBC åŠ å¯†çš„ NDJSONï¼‰ã€‚
    ///
    /// å®˜æ–¹è¡¥ä¸/é¢„ä¸‹è½½åŒ…éƒ½ä¼šå¸¦ä¸Šå®ƒï¼ˆä¸Žè¿œç«¯ `files/game_files` å†…å®¹ä¸€è‡´ï¼‰ï¼›è§£ä¸å¼€æˆ–è§£æžå¤±è´¥æ—¶
    /// è¿”å›ž `None`ï¼Œç”±è°ƒç”¨æ–¹å›žé€€åˆ°è¿œç«¯æ¸…å•ã€‚
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

    /// ç”¨åŒ…å†… `package_files` æ ¡éªŒè§£åŽ‹äº§ç‰©ã€‚
    ///
    /// é€†å‘ä¾æ®ï¼šå®˜æ–¹è¡¥ä¸/é¢„ä¸‹è½½åŒ…å†…åŒæ—¶å¸¦ `game_files`ï¼ˆæ–°ç‰ˆæ¸…å•ï¼‰ä¸Ž `package_files`
    /// ï¼ˆ**æœ¬åŒ…æ–‡ä»¶æ¸…å•**ï¼ŒåŒæ ·æ˜¯"å›ºå®š AES-256-CBC åŠ å¯†çš„ NDJSON"ï¼›å®žæµ‹æœ¬æœºé˜¿ç±³å¨…å®‰è£…ç›®å½•
    /// é‡Œé‚£ä»½ 510,176 å­—èŠ‚ / 3115 æ¡ï¼Œè§£å¯†åŽå³ `{"path","md5","size"}` è¡Œï¼‰ã€‚
    /// è¿™é‡Œåªæ ¡éªŒ"è§£åŽ‹ç›®å½•é‡Œç¡®å®žå­˜åœ¨"çš„æ¡ç›®ï¼šä¸åŒ¹é…è¯´æ˜ŽåŒ…æœ¬èº«æŸåï¼Œå®å¯ä¸é“ºï¼›
    /// ä¸åœ¨åŒ…å†…çš„æ¡ç›®ï¼ˆå±žå…¶å®ƒåˆ†å·ï¼‰ç›´æŽ¥è·³è¿‡ï¼Œé¿å…è¯¯æŠ¥ã€‚
    fn verify_archive_package_files(extracted_dir: &Path) -> Result<usize, String> {
        let path = extracted_dir.join("package_files");
        if !path.is_file() {
            return Ok(0);
        }
        let bytes = fs::read(&path).map_err(|e| format!("Read package_files: {}", e))?;
        let text = match hg_crypto::decrypt_bytes_to_string(&bytes) {
            Ok(text) => text,
            // å°‘æ•°å½¢æ€å¯èƒ½æ˜¯æ˜Žæ–‡æ¸…å•
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

    /// ä»Žåˆ†å· URL æŽ¨æ–­æœ¬åœ°æ–‡ä»¶åï¼ˆåŽ»æŽ‰æŸ¥è¯¢ä¸²ï¼‰ï¼›æ–‡ä»¶åéžæ³•æ—¶å›žé€€ä¸º part_###.zip
    fn preload_part_file_name(url: &str, index: usize) -> String {
        let path = url.split('?').next().unwrap_or("");
        let name = path.rsplit('/').next().unwrap_or("");
        if Self::validate_path(name).is_ok() {
            name.to_string()
        } else {
            format!("part_{:03}.zip", index + 1)
        }
    }

    /// é¢„ä¸‹è½½æš‚å­˜ç›®å½•å†…çš„ç‰ˆæœ¬æ ‡è®°æ–‡ä»¶åï¼ˆè§æ¨¡å—çº§ `PRELOAD_VERSION_MARKER`ï¼‰

    /// æ–°å»ºé¢„ä¸‹è½½æš‚å­˜ç›®å½•å¹¶å†™å…¥ç›®æ ‡ç‰ˆæœ¬æ ‡è®°
    fn create_preload_staging(install_path: &str, version: &str) -> Result<PathBuf, String> {
        let dir = format!("{}.staging.preload.{}", install_path, uuid::Uuid::new_v4());
        let path = PathBuf::from(&dir);
        fs::create_dir_all(&path).map_err(|e| format!("Create staging dir: {}", e))?;
        fs::write(path.join(PRELOAD_VERSION_MARKER), version)
            .map_err(|e| format!("Write preload marker: {}", e))?;
        Ok(path)
    }

    /// è¯»å–é¢„ä¸‹è½½æš‚å­˜ç›®å½•è®°å½•çš„ç›®æ ‡ç‰ˆæœ¬
    fn preload_staging_version(dir: &str) -> Option<String> {
        let content = fs::read_to_string(Path::new(dir).join(PRELOAD_VERSION_MARKER)).ok()?;
        Some(content.trim().to_string())
    }

    /// èŽ·å–é¢„ä¸‹è½½ staging ç›®å½•è·¯å¾„ï¼ˆæœ€æ–°çš„ä¸€ä¸ªï¼‰
    fn preload_staging_dir(&self, install_path: &str) -> Option<String> {
        self.preload_staging_dirs(install_path)
            .into_iter()
            .next()
            .map(|path| path.to_string_lossy().to_string())
    }

    /// åˆ—å‡ºå…¨éƒ¨é¢„ä¸‹è½½ staging ç›®å½•ï¼ˆå¯èƒ½æ®‹ç•™å¤šä¸ªç‰ˆæœ¬ï¼Œæ­£å¼æ›´æ–°æ—¶éƒ½è¦ä½œä¸ºå¤ç”¨æ¥æºï¼‰
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
        // æ–°åˆ°æ—§ï¼šä¼˜å…ˆå¤ç”¨æœ€è¿‘ä¸€æ¬¡é¢„ä¸‹è½½çš„äº§ç‰©
        dirs.sort_by(|a, b| b.0.cmp(&a.0));
        dirs.into_iter().map(|(_, path)| path).collect()
    }

    /// æ¸…ç†å…¨éƒ¨é¢„ä¸‹è½½ staging ç›®å½•
    fn cleanup_preload_staging(&self, install_path: &str) {
        for dir in self.preload_staging_dirs(install_path) {
            let _ = fs::remove_dir_all(dir);
        }
    }

    /// ä¿å­˜ payload çŠ¶æ€åˆ°æ–‡ä»¶
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

        // åŽŸå­å†™å…¥ï¼šå…ˆå†™ä¸´æ—¶æ–‡ä»¶ï¼Œå†é‡å‘½å
        let tmp_file = state_file.with_extension("json.tmp");
        fs::write(&tmp_file, &json).map_err(|e| format!("Write state: {}", e))?;
        fs::rename(&tmp_file, &state_file).map_err(|e| format!("Rename state: {}", e))?;

        Ok(())
    }

    /// è¯»å– payload çŠ¶æ€ï¼ˆåŒæ­¥ç‰ˆæœ¬ï¼Œä¾›å†…éƒ¨ä½¿ç”¨ï¼‰
    fn load_payload_state(&self, channel: &GameChannel) -> Option<PayloadState> {
        let state_dir = crate::utils::paths::app_data_dir().ok()?.join("game_state");
        let state_file = state_dir.join(format!("{}.json", channel.as_str()));
        let content = fs::read_to_string(&state_file).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// è¯»å– payload çŠ¶æ€ï¼ˆå¼‚æ­¥ç‰ˆæœ¬ï¼Œä¾›å¤–éƒ¨ä½¿ç”¨ï¼‰
    pub async fn get_payload_state(&self, channel: &GameChannel) -> Option<PayloadState> {
        self.load_payload_state(channel)
    }

    /// ä¿å­˜é¢„ä¸‹è½½çŠ¶æ€
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

    /// é€šç”¨ batch_proxy è¯·æ±‚ï¼ˆweb APIï¼‰
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

    /// èŽ·å– Banner åˆ—è¡¨
    pub async fn get_banners(&self, channel: &GameChannel) -> Result<Vec<BannerItem>, String> {
        let mut parts = self
            .fetch_notice_parts(channel, &["get_banner"])
            .await?;

        // è¯¥æ¸ é“æ²¡æœ‰ Banner æ—¶ç”¨å›žè½æ¸ é“ï¼ˆå®˜æœ / å›½é™…æœï¼‰çš„è¡¥ä¸Šã€‚
        if parts.banners.is_empty() {
            if let Some(fallback) = channel.notice_fallback_channel() {
                if let Ok(fb) = self.fetch_notice_parts(&fallback, &["get_banner"]).await {
                    parts.banners = fb.banners;
                }
            }
        }

        Ok(parts.banners)
    }

    /// èŽ·å–å…¬å‘Šåˆ—è¡¨
    pub async fn get_announcements(
        &self,
        channel: &GameChannel,
    ) -> Result<Vec<AnnouncementItem>, String> {
        let mut parts = self
            .fetch_notice_parts(channel, &["get_announcement"])
            .await?;

        // è¯¥æ¸ é“æ²¡æœ‰å…¬å‘Šæ—¶ç”¨å›žè½æ¸ é“ï¼ˆå®˜æœ / å›½é™…æœï¼‰çš„è¡¥ä¸Šã€‚
        if parts.announcements.is_empty() {
            if let Some(fallback) = channel.notice_fallback_channel() {
                if let Ok(fb) = self.fetch_notice_parts(&fallback, &["get_announcement"]).await {
                    parts.announcements = fb.announcements;
                }
            }
        }

        Ok(parts.announcements)
    }

    /// èŽ·å–å¯åŠ¨å™¨å…¬å‘Šå†…å®¹ï¼ˆBanner + å…¬å‘Šåˆå¹¶è¿”å›žï¼‰
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

    /// èŽ·å–å¯åŠ¨å™¨å…¬å‘Šå†…å®¹ï¼ˆBanner + å…¬å‘Š + å³ä¾§æ ï¼‰
    ///
    /// ä¸‰é¡¹å†…å®¹å„è‡ªç‹¬ç«‹å›žè½ï¼šæŸæ¸ é“æ‹¿ä¸åˆ°å…¬å‘Šå°±ç”¨å®˜æœï¼ˆå›½é™…æœæ¸ é“ç”¨ Globalï¼‰çš„ï¼Œ
    /// æ‹¿ä¸åˆ°å³ä¾§æ åŒç†â€”â€”çº¿ä¸Š B æœä¸‰é¡¹å…¨ç©ºã€å®˜æœä¸‰é¡¹é½å…¨ã€‚
    pub async fn get_notice_content(
        &self,
        channel: &GameChannel,
    ) -> Result<LauncherNoticeContent, String> {
        let mut parts = self
            .fetch_notice_parts(channel, &["get_banner", "get_announcement", "get_sidebar"])
            .await?;

        // è¯¥æ¸ é“ç¼ºå“ªä¸€é¡¹ï¼Œå°±ç”¨å›žè½æ¸ é“è¡¥å“ªä¸€é¡¹ã€‚
        let needs_fallback = parts.banners.is_empty()
            || parts.announcements.is_empty()
            || parts.sidebars.is_empty();

        if needs_fallback {
            if let Some(fallback) = channel.notice_fallback_channel() {
                match self
                    .fetch_notice_parts(
                        &fallback,
                        &["get_banner", "get_announcement", "get_sidebar"],
                    )
                    .await
                {
                    Ok(fb) => {
                        if parts.banners.is_empty() {
                            parts.banners = fb.banners;
                        }
                        if parts.announcements.is_empty() {
                            parts.announcements = fb.announcements;
                        }
                        if parts.sidebars.is_empty() {
                            parts.sidebars = fb.sidebars;
                        }
                    }
                    Err(e) => {
                        crate::safe_eprintln!(
                            "[Launcher] notice fallback to {:?} failed: {}",
                            fallback,
                            e
                        );
                    }
                }
            }
        }

        crate::safe_eprintln!(
            "[Launcher] get_notice_content result: {} banners, {} announcements, {} sidebars",
            parts.banners.len(),
            parts.announcements.len(),
            parts.sidebars.len()
        );

        Ok(LauncherNoticeContent {
            banners: parts.banners,
            announcements: parts.announcements,
            sidebars: parts.sidebars,
        })
    }

    /// ä¸€æ¬¡ `web/batch_proxy` è¯·æ±‚æ‹‰å–æŒ‡å®šçš„å…¬å‘Šç±»å†…å®¹ã€‚
    ///
    /// `kinds` å–æŽ¥å£çš„å®Œæ•´ kind åï¼ˆ`get_banner` / `get_announcement` / `get_sidebar`ï¼‰ï¼Œ
    /// è¯·æ±‚ä½“é‡Œçš„é”®æ˜¯ `<kind>_req`ï¼ˆå¦‚ `get_banner_req`ï¼‰ã€‚
    ///
    /// å‚æ•°ç›´æŽ¥ç”¨æ¸ é“è‡ªå·±çš„ appcode/channel/sub_channelï¼Œ**ä¸åš**ä»»ä½•é¢„å…ˆæ›¿æ¢ï¼š
    /// å›žè½ç”±è°ƒç”¨æ–¹åœ¨æ‹¿åˆ°ç©ºç»“æžœåŽå†³å®šï¼Œé¿å…"B æœ"è¿™ç§ç¡¬æ›¿æ¢æŠŠå®˜æœå†…å®¹åŽŸæ ·é¡¶æŽ‰
    /// ï¼ˆå®˜æ–¹ B æœæœ¬æ¥å°±ä¸Žå®˜æœåŒå†…å®¹ï¼Œè¡Œä¸ºä¸€è‡´ï¼›ä½†æ˜Žæ—¥æ–¹èˆŸ B æœ appcode ç›¸åŒã€
    /// channel ä¸åŒï¼Œç¡¬æ›¿æ¢ä¼šä¸¢æŽ‰è¯¥æ¸ é“çœŸæ­£ç‹¬æœ‰çš„æ•°æ®ï¼‰ã€‚
    async fn fetch_notice_parts(
        &self,
        channel: &GameChannel,
        kinds: &[&str],
    ) -> Result<NoticeParts, String> {
        let proxy_reqs: Vec<serde_json::Value> = kinds
            .iter()
            .map(|kind| {
                let req_key = format!("{}_req", kind);
                serde_json::json!({
                    "kind": kind,
                    req_key: {
                        "appcode": channel.app_code(),
                        "language": "zh-cn",
                        "channel": channel.channel(),
                        "sub_channel": channel.sub_channel(),
                        "platform": "Windows",
                        "source": "launcher"
                    }
                })
            })
            .collect();

        let raw = self
            .batch_proxy_web_raw(channel, serde_json::Value::Array(proxy_reqs))
            .await?;
        Ok(Self::parse_notice_parts(&raw))
    }

    /// ä»Ž `batch_proxy` çš„åŽŸå§‹å“åº”é‡Œè§£æžå‡º Banner / å…¬å‘Š / å³ä¾§æ ä¸‰é¡¹ã€‚
    fn parse_notice_parts(raw: &serde_json::Value) -> NoticeParts {
        let mut parts = NoticeParts::default();

        let Some(rsps) = raw.get("proxy_rsps").and_then(|v| v.as_array()) else {
            return parts;
        };

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
                                parts.banners.push(BannerItem {
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
                                            if let Some(s) = v.as_str() {
                                                s.parse::<i64>().ok()
                                            } else {
                                                v.as_i64()
                                            }
                                        })
                                        .map(|ts| {
                                            let secs = if ts > 1_000_000_000_000 {
                                                ts / 1000
                                            } else {
                                                ts
                                            };
                                            let dt =
                                                chrono::DateTime::from_timestamp(secs, 0)
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

                                    parts.announcements.push(AnnouncementItem {
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

        parts.sidebars = Self::parse_sidebars(raw);
        parts
    }

    /// è§£æž `get_sidebar_rsp`ï¼šæŠŠã€Œæ¡ç›®è‡ªèº«ã€ä¸Žã€Œsidebar_labels[0]ã€ä¸¤å¤„é“¾æŽ¥åˆå¹¶æˆæ‰å¹³åˆ—è¡¨ã€‚
    ///
    /// å®˜æ–¹æ•°æ®ä¸ä¸€è‡´ï¼šç¤¾åª’æ¡ç›®æŠŠåœ°å€æ”¾åœ¨ `pic.url`ï¼ˆäºŒç»´ç ï¼‰+ `jump_url`ï¼Œ
    /// è€Œ `CS` è¿™ç±»æ¡ç›® `pic` ä¸º nullã€åœ°å€åªåœ¨ `sidebar_labels[0].jump_url`ã€‚
    /// ä¾§è¾¹æ è§£æžå¤±è´¥ä¸å½±å“å…¬å‘Šä¸»æµç¨‹ï¼Œæ•…æ•´ä½“å¤±è´¥æ—¶è¿”å›žç©ºåˆ—è¡¨ã€‚
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

                // é“¾æŽ¥ã€äºŒç»´ç ä¸Žæ–‡æ¡ˆéƒ½ä¼˜å…ˆå–æ¡ç›®è‡ªèº«ï¼Œç¼ºå¤±æ—¶å›žé€€åˆ°ç¬¬ä¸€æ¡ labelï¼ˆCS å³å±žæ­¤ç±»ï¼‰
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

    /// èŽ·å–å¯åŠ¨å™¨èƒŒæ™¯åª’ä½“ï¼ˆå›¾ç‰‡æˆ–è§†é¢‘ï¼‰
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

                    // æŽ¥å£æŠŠå›¾ç‰‡å’Œè§†é¢‘æ”¾åœ¨åŒä¸€æ¡å“åº”é‡Œï¼Œä¸¤è€…éƒ½è¿”å›žç»™å‰ç«¯ï¼Œ
                    // ç”±å‰ç«¯æ ¹æ®ç”¨æˆ·è®¾ç½®é€‰æ‹©å±•ç¤ºå›¾ç‰‡è¿˜æ˜¯è§†é¢‘
                    let (image_url, video_url) = if url_is_video {
                        // url æœ¬èº«å°±æ˜¯è§†é¢‘ï¼Œå¦ä¸€ä¸ªå­—æ®µè‹¥æ˜¯å›¾ç‰‡åˆ™ä½œä¸ºå›¾ç‰‡
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

    /// åˆ¤æ–­ URL çš„åª’ä½“ç±»åž‹
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

    /// åˆ‡æ¢æ¸¸æˆæ¸ é“ï¼ˆ5é˜¶æ®µæµç¨‹ï¼‰
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

        // å¤±è´¥/å–æ¶ˆçš„**ç»ˆæ€äº‹ä»¶**ï¼šå‰ç«¯é  `phase === "error"` æ‰ä¼šæŠŠæŒ‰é’®ä»Žã€Œåˆ‡æ¢ä¸­ã€
        // å¤ä½ï¼ˆ`localActiveOp` åªåœ¨æ”¶åˆ°ç»ˆæ€æˆ–ç»„ä»¶é‡æŒ‚æ—¶æ¸…ç©ºï¼‰ï¼Œåªè¿”å›ž `Err` ä¼šè®©
        // ç•Œé¢æ°¸è¿œå¡åœ¨åˆ‡æ¢ä¸­ã€‚æ‰€æœ‰å¤±è´¥è·¯å¾„å¿…é¡»å…ˆèµ°è¿™é‡Œå† `return Err`ã€‚
        // è¿›ç¨‹é¢„æ£€ï¼ˆPhase 0ï¼‰å‘ç”Ÿåœ¨ `set_active_operation` ä¹‹å‰ï¼Œå‰ç«¯è¿˜æ²¡è¿›åˆ‡æ¢æ€ï¼Œ
        // ä¸éœ€è¦å‘ç»ˆæ€ã€‚
        let emit_terminal = |phase: &str| {
            emit(phase, 0, 0, None, 0, 0);
        };

        // ===== Phase 0: æ¸¸æˆè¿›ç¨‹é¢„æ£€ =====
        // ä¸¤ä¸ªæ¸ é“çš„æ¸¸æˆè¿›ç¨‹åŒåï¼ˆ`Arknights.exe` / `Endfield.exe`ï¼‰ï¼Œæ¸ é“å‚æ•°å–å“ªä¸ª
        // éƒ½ä¸€æ ·ã€‚æ–‡ä»¶è¢«æ¸¸æˆæˆ–å…¶ä¼´ç”Ÿç»„ä»¶ï¼ˆAntiCheatExpertã€å¯åŠ¨å™¨ WebView ç­‰ï¼‰å ç”¨æ—¶
        // Phase 4 çš„è¦†ç›–å†™å…¥ä¼šæ‹¿åˆ° os error 32ï¼Œæ‰€ä»¥è¿›ä»»ä½•é˜¶æ®µå‰å…ˆæ‹¦ä½ã€‚
        let running = crate::utils::process::exists_once(from_channel.process_name());
        if running {
            tracing::warn!(
                "[switch] Refused: game process {} is running",
                from_channel.process_name()
            );
            return Err(format!(
                "Game is running ({}). Stop it before switching channels.",
                from_channel.process_name()
            ));
        }

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
            emit_terminal("error");
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }

        let from_remote = match self.get_latest_package(from_channel, None).await {
            Ok(v) => v,
            Err(e) => {
                self.set_active_operation(None).await;
                emit_terminal("error");
                return Err(e);
            }
        };
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            emit_terminal("error");
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let to_remote = match self.get_latest_package(to_channel, None).await {
            Ok(v) => v,
            Err(e) => {
                self.set_active_operation(None).await;
                emit_terminal("error");
                return Err(e);
            }
        };
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            emit_terminal("error");
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let (from_manifest, _) = match self.fetch_manifest(&from_remote.resource_base_url).await {
            Ok(v) => v,
            Err(e) => {
                self.set_active_operation(None).await;
                emit_terminal("error");
                return Err(e);
            }
        };
        if SWITCH_CANCELLED.load(Ordering::SeqCst) {
            self.set_active_operation(None).await;
            emit_terminal("error");
            reset_switch_cancel();
            return Err("Switch cancelled".to_string());
        }
        let (to_manifest, _) = match self.fetch_manifest(&to_remote.resource_base_url).await {
            Ok(v) => v,
            Err(e) => {
                self.set_active_operation(None).await;
                emit_terminal("error");
                return Err(e);
            }
        };

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
                emit_terminal("error");
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
                    emit_terminal("error");
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

        // å¤‡ä»½èŒƒå›´ = å°†è¢«åˆ é™¤çš„æ–‡ä»¶ + å°†è¢«è¦†ç›–ä¸”æœ¬åœ°å­˜åœ¨çš„ MD5 å·®å¼‚æ–‡ä»¶ã€‚
        // åŽè€…è®©åå‘åˆ‡æ¢èƒ½å‘½ä¸­ Phase 2 çš„ã€ŒReusing backupã€å¿«é€Ÿè·¯å¾„ï¼š
        // å®˜â†”B æ¥å›žåˆ‡æ—¶ï¼Œ520 MB çš„å…±æœ‰å·®å¼‚æ–‡ä»¶ä¸å†éœ€è¦é‡æ–°ä¸‹è½½ã€‚
        let mut backup_source: Vec<(&ManifestFile, bool)> = files_to_remove
            .iter()
            .map(|f| (f, false))
            .collect();
        backup_source.extend(
            files_to_download
                .iter()
                .filter(|f| game_dir.join(&f.path).exists())
                .map(|f| (f, true)),
        );

        for (idx, (file, will_overwrite)) in backup_source.iter().enumerate() {
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
                // è¦†ç›–åž‹å¤‡ä»½çš„åŽŸæ–‡ä»¶ä»åœ¨åŽŸåœ°ï¼ˆPhase 4 æ‰è¦†ç›–ï¼‰ï¼Œæ— éœ€æ¢å¤ï¼›
                // åˆ é™¤åž‹å¤‡ä»½ç”±ä¸Šé¢ backed_up_files å¾ªçŽ¯è¿˜åŽŸ
                self.set_active_operation(None).await;
                emit_terminal("error");
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
                backup_source.len() as u64,
                Some(file.path.clone()),
                idx,
                backup_source.len(),
            );

            if original.exists() {
                if let Err(e) = fs::copy(&original, &backup) {
                    self.set_active_operation(None).await;
                    emit_terminal("error");
                    return Err(format!("Backup copy: {}", e));
                }
                // è¦†ç›–åž‹å¤‡ä»½åªç•™å‰¯æœ¬ï¼Œä¸åˆ åŽŸæ–‡ä»¶ï¼ˆåŽŸæ–‡ä»¶ä¼šåœ¨ Phase 4 è¢«è¦†ç›–ï¼‰ï¼›
                // åˆ é™¤åž‹å¤‡ä»½ç…§æ—§ç§»èµ°åŽŸæ–‡ä»¶
                if !will_overwrite {
                    if let Err(e) = fs::remove_file(&original) {
                        self.set_active_operation(None).await;
                        emit_terminal("error");
                        return Err(format!("Delete original: {}", e));
                    }
                }
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
                emit_terminal("error");
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

            if let Err(e) = fs::copy(&src, &dst) {
                // ç›®æ ‡æ–‡ä»¶è¢«å ç”¨ï¼ˆos error 32ï¼Œæ¸¸æˆ/æ€è½¯/ä¼´ç”Ÿè¿›ç¨‹ï¼‰æˆ–å…¶å®ƒ IO å¤±è´¥ï¼š
                // ç›®å½•æ­¤åˆ»åœåœ¨åŠåˆ‡æ¢çŠ¶æ€ï¼Œå¿…é¡»æ•´ä½“å›žæ»šâ€”â€”å·²è¦†ç›–çš„æ–‡ä»¶ä»Žå¤‡ä»½è¿˜åŽŸï¼Œ
                // å·²åˆ é™¤çš„æ–‡ä»¶ä»Žå¤‡ä»½æ”¾å›žï¼Œè®©ç›®å½•å›žåˆ° from_channel çš„å®Œæ•´çŠ¶æ€ã€‚
                tracing::error!(
                    "[switch] Apply failed for {} ({}), rolling back",
                    file.path,
                    e
                );
                for dst_moved in &moved_files {
                    let _ = fs::remove_file(dst_moved);
                    let relative = dst_moved.strip_prefix(game_dir).unwrap_or(dst_moved);
                    let backup = backup_dir.join(relative);
                    if backup.exists() {
                        if let Some(parent) = dst_moved.parent() {
                            fs::create_dir_all(parent).ok();
                        }
                        fs::copy(&backup, dst_moved).ok();
                    }
                }
                for (original, backup) in &backed_up_files {
                    if !original.exists() && backup.exists() {
                        if let Some(parent) = original.parent() {
                            fs::create_dir_all(parent).ok();
                        }
                        fs::copy(backup, original).ok();
                    }
                }
                let _ = fs::remove_dir_all(&staging_dir);
                self.set_active_operation(None).await;
                emit_terminal("error");
                return Err(format!(
                    "Move to game dir: {} â€” switched files were rolled back. Close the game and programs that may lock its files, then retry.",
                    e
                ));
            }
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

/// åŽŸå­åœ°å›žé€€å·²ç´¯è®¡çš„ä¸‹è½½è¿›åº¦ï¼ˆé¿å…å¹¶å‘ä»»åŠ¡ä¸‹æº¢ï¼‰ã€‚
/// Rust 1.99 èµ· `fetch_update` å¼ƒç”¨ï¼Œæ›´å `try_update`ã€‚
fn subtract_download_progress(counter: &AtomicU64, bytes: u64) {
    let _ = counter.try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
        Some(value.saturating_sub(bytes))
    });
}

/// å•æ–‡ä»¶ä¸‹è½½+éªŒè¯ï¼ˆä¾›å¹¶å‘ä¸‹è½½ä½¿ç”¨ï¼‰
/// - æµå¼ MD5 æ ¡éªŒï¼Œé¿å…æŠŠå¤§æ–‡ä»¶æ•´ä½“è¯»å…¥å†…å­˜
/// - æ–­ç‚¹ç»­ä¼ ï¼š`resume` ä¸ºçœŸæ—¶ä¿ç•™ `.download` åˆ†ç‰‡å¹¶æŒ‰ Range ç»§ç»­
/// - æœ€å¤šé‡è¯• 3 æ¬¡ï¼ŒæœŸé—´ä¿ç•™å·²å†™å…¥çš„åˆ†ç‰‡
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
        // ä¸Šæ¬¡å·²å®Œæ•´ä¸‹è½½ä½†æœªåŠé‡å‘½åï¼šæ ¡éªŒé€šè¿‡åŽç›´æŽ¥æ”¹åï¼Œä¸å†é‡æ–°ä¸‹è½½
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
        // é•¿åº¦è¶…è¿‡é¢„æœŸè¯´æ˜Žæ˜¯æ—§æ•°æ®çš„æ®‹ç•™ï¼Œç›´æŽ¥ä¸¢å¼ƒ
        if file_size > 0 && existing_len >= file_size {
            let _ = fs::remove_file(download_file);
        }
    }

    let max_retries = 3u32;
    let mut last_error = String::new();
    // æœ¬æ¬¡è°ƒç”¨ç´¯è®¡å†™å…¥ dl_bytes çš„å­—èŠ‚æ•°ï¼Œé‡è¯•å‰å›žé€€
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
                    // æœåŠ¡ç«¯å¿½ç•¥ Rangeï¼šä¸¢å¼ƒæ—§å‰ç¼€ï¼Œé¿å…è¿›åº¦é‡å¤ç´¯è®¡
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

                // æµå¼ MD5 æ ¡éªŒï¼Œé¿å…å¤§æ–‡ä»¶å ç”¨å¤§é‡å†…å­˜
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
        "[download] FAILED after {} attempts: {} â€” {}",
        max_retries,
        dest_path,
        last_error
    );
    Err(format!(
        "Download failed after {} attempts: {}",
        max_retries, last_error
    ))
}

#[cfg(test)]
mod notice_fallback_tests {
    use super::*;
    use crate::models::game::GameChannel;

    /// å›žè½æ¸ é“çš„æ˜ å°„å…³ç³»ï¼ˆB æœ â†’ å®˜æœã€GooglePlay â†’ Globalï¼Œä¸»æ¸ é“ä¸å›žè½ï¼‰ã€‚
    #[test]
    fn fallback_channel_mapping() {
        assert_eq!(
            GameChannel::Bilibili.notice_fallback_channel(),
            Some(GameChannel::Official)
        );
        assert_eq!(
            GameChannel::ArknightsBilibili.notice_fallback_channel(),
            Some(GameChannel::Arknights)
        );
        assert_eq!(
            GameChannel::GooglePlay.notice_fallback_channel(),
            Some(GameChannel::Global)
        );
        assert_eq!(GameChannel::Official.notice_fallback_channel(), None);
        assert_eq!(GameChannel::Global.notice_fallback_channel(), None);
        assert_eq!(GameChannel::Arknights.notice_fallback_channel(), None);
    }

    /// çœŸå®žæŽ¥å£è”è°ƒï¼šB æœå…¬å‘Šä¸‰é¡¹å…¨ç©ºï¼Œå›žè½åŽåº”æ‹¿åˆ°å®˜æœå†…å®¹ã€‚
    ///
    /// è¿™æ¡æµ‹è¯•æ‰“çš„æ˜¯çº¿ä¸Š `web/batch_proxy`ï¼ŒéªŒè¯ã€ŒB æœ â†’ å®˜æœã€çš„å›žè½çœŸçš„ç”Ÿæ•ˆã€‚
    #[tokio::test]
    async fn bilibili_channel_falls_back_to_official() {
        let svc = GameLauncherService::new();

        let bili = svc
            .get_notice_content(&GameChannel::ArknightsBilibili)
            .await
            .expect("bilibili notice content");

        let official = svc
            .get_notice_content(&GameChannel::Arknights)
            .await
            .expect("official notice content");

        assert!(
            !official.announcements.is_empty(),
            "å®˜æœå…¬å‘Šä¸åº”ä¸ºç©ºï¼Œå¦åˆ™æ— æ³•éªŒè¯å›žè½"
        );
        assert!(
            !official.sidebars.is_empty(),
            "å®˜æœå³ä¾§æ ä¸åº”ä¸ºç©ºï¼Œå¦åˆ™æ— æ³•éªŒè¯å›žè½"
        );
        assert_eq!(
            bili.announcements.len(),
            official.announcements.len(),
            "B æœå…¬å‘Šåº”å›žè½åˆ°å®˜æœ"
        );
        assert_eq!(
            bili.sidebars.len(),
            official.sidebars.len(),
            "B æœå³ä¾§æ åº”å›žè½åˆ°å®˜æœ"
        );
        assert_eq!(
            bili.banners.len(),
            official.banners.len(),
            "B æœ Banner åº”å›žè½åˆ°å®˜æœ"
        );
    }

    /// çœŸå®žæŽ¥å£è”è°ƒï¼š`get_banners` / `get_announcements` å•ç‹¬èµ°æ—¶ä¹Ÿè¦èƒ½å›žè½ã€‚
    #[tokio::test]
    async fn single_kind_endpoints_fall_back() {
        let svc = GameLauncherService::new();

        let bili_banners = svc
            .get_banners(&GameChannel::ArknightsBilibili)
            .await
            .expect("bilibili banners");
        let official_banners = svc
            .get_banners(&GameChannel::Arknights)
            .await
            .expect("official banners");

        assert!(
            !bili_banners.is_empty(),
            "B æœ Banner åº”å›žè½åˆ°å®˜æœ"
        );
        assert_eq!(bili_banners.len(), official_banners.len());

        let bili_ann = svc
            .get_announcements(&GameChannel::Bilibili)
            .await
            .expect("bilibili announcements");
        let official_ann = svc
            .get_announcements(&GameChannel::Official)
            .await
            .expect("official announcements");

        assert!(!bili_ann.is_empty(), "ç»ˆæœ«åœ° B æœå…¬å‘Šåº”å›žè½åˆ°å®˜æœ");
        assert_eq!(bili_ann.len(), official_ann.len());
    }
}
