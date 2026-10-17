use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bytes::Bytes;
use chrono::Local;
use reqwest::header::HeaderMap;
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};

use super::paths;
use crate::{log_info, log_warn};

const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_PAGE_SIZE: u64 = 500;
const META_FILE: &str = "meta.json";
const EVENTS_FILE: &str = "events.jsonl";

static RECORDING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone)]
pub struct CaptureBody {
    pub encoding: String,
    pub size: u64,
    pub truncated: bool,
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CaptureEntry {
    pub index: u64,
    pub timestamp: String,
    pub method: String,
    pub url: String,
    pub request_headers: Vec<(String, String)>,
    pub request_body: Option<CaptureBody>,
    pub status: Option<u16>,
    pub response_headers: Option<Vec<(String, String)>>,
    pub response_body: Option<CaptureBody>,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CaptureSessionMeta {
    pub id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub count: u64,
    pub size_bytes: u64,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct CaptureStatus {
    pub recording: bool,
    pub session_id: Option<String>,
    pub started_at: Option<String>,
    pub count: u64,
    pub size_bytes: u64,
}

#[derive(Serialize)]
pub struct CapturePage {
    pub total: u64,
    pub entries: Vec<CaptureEntry>,
}

struct ActiveSession {
    meta: CaptureSessionMeta,
    writer: BufWriter<File>,
}

struct CaptureService {
    active: Mutex<Option<ActiveSession>>,
}

fn service() -> &'static CaptureService {
    static INSTANCE: OnceLock<CaptureService> = OnceLock::new();
    INSTANCE.get_or_init(|| CaptureService {
        active: Mutex::new(None),
    })
}

fn active_lock() -> MutexGuard<'static, Option<ActiveSession>> {
    service().active.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn is_recording() -> bool {
    RECORDING.load(Ordering::Relaxed)
}

pub fn capture_root() -> Result<PathBuf, String> {
    paths::capture_dir().map_err(|e| e.to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn write_meta(meta: &CaptureSessionMeta) -> Result<(), String> {
    let path = PathBuf::from(&meta.path).join(META_FILE);
    let text = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn status_of(meta: Option<&CaptureSessionMeta>) -> CaptureStatus {
    match meta {
        Some(meta) => CaptureStatus {
            recording: is_recording(),
            session_id: Some(meta.id.clone()),
            started_at: Some(meta.started_at.clone()),
            count: meta.count,
            size_bytes: meta.size_bytes,
        },
        None => CaptureStatus {
            recording: false,
            session_id: None,
            started_at: None,
            count: 0,
            size_bytes: 0,
        },
    }
}

pub fn status() -> CaptureStatus {
    let guard = active_lock();
    status_of(guard.as_ref().map(|s| &s.meta))
}

pub fn start() -> Result<CaptureStatus, String> {
    let mut guard = active_lock();
    if let Some(session) = guard.as_ref() {
        log_info!("[capture] already recording: {}", session.meta.id);
        return Ok(status_of(Some(&session.meta)));
    }

    let root = capture_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let id = format!("{}-{}", stamp, suffix);
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let meta = CaptureSessionMeta {
        id: id.clone(),
        started_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        ended_at: None,
        status: "recording".to_string(),
        count: 0,
        size_bytes: 0,
        path: dir.to_string_lossy().to_string(),
    };
    write_meta(&meta)?;

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(EVENTS_FILE))
        .map_err(|e| e.to_string())?;

    *guard = Some(ActiveSession {
        meta,
        writer: BufWriter::new(file),
    });
    RECORDING.store(true, Ordering::Relaxed);
    log_info!("[capture] recording started: {}", id);
    Ok(status_of(guard.as_ref().map(|session| &session.meta)))
}

pub fn stop() -> Result<CaptureStatus, String> {
    RECORDING.store(false, Ordering::Relaxed);
    let mut guard = active_lock();
    let Some(mut session) = guard.take() else {
        return Ok(status_of(None));
    };

    let _ = session.writer.flush();
    session.meta.status = "completed".to_string();
    session.meta.ended_at = Some(Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    if let Ok(info) = fs::metadata(PathBuf::from(&session.meta.path).join(EVENTS_FILE)) {
        session.meta.size_bytes = info.len();
    }
    let meta = session.meta.clone();
    if let Err(e) = write_meta(&meta) {
        log_warn!("[capture] failed to write session meta: {}", e);
    }
    log_info!("[capture] recording stopped: {} entries", meta.count);
    Ok(status_of(Some(&meta)))
}

pub fn list_sessions() -> Result<Vec<CaptureSessionMeta>, String> {
    let root = capture_root()?;
    let mut sessions = Vec::new();
    if !root.exists() {
        return Ok(sessions);
    }

    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let meta_path = entry.path().join(META_FILE);
        let Ok(text) = fs::read_to_string(&meta_path) else {
            continue;
        };
        let Ok(mut meta) = serde_json::from_str::<CaptureSessionMeta>(&text) else {
            continue;
        };
        let mut is_active = false;
        {
            let guard = active_lock();
            if let Some(active) = guard.as_ref() {
                if active.meta.id == meta.id {
                    meta = active.meta.clone();
                    is_active = true;
                }
            }
        }
        if !is_active && meta.status == "recording" {
            meta.status = "completed".to_string();
            let _ = write_meta(&meta);
        }
        sessions.push(meta);
    }

    sessions.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(sessions)
}

pub fn read_entries(id: &str, offset: u64, limit: u64) -> Result<CapturePage, String> {
    if !valid_id(id) {
        return Err("Invalid session id".to_string());
    }
    let path = capture_root()?.join(id).join(EVENTS_FILE);
    let file = File::open(&path).map_err(|e| format!("Failed to open session '{}': {}", id, e))?;
    let limit = limit.clamp(1, MAX_PAGE_SIZE);

    let reader = BufReader::new(file);
    let mut entries: Vec<CaptureEntry> = Vec::new();
    let mut total: u64 = 0;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        if total >= offset && (entries.len() as u64) < limit {
            if let Ok(entry) = serde_json::from_str::<CaptureEntry>(&line) {
                entries.push(entry);
            }
        }
        total += 1;
    }

    Ok(CapturePage { total, entries })
}

pub fn delete_session(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Invalid session id".to_string());
    }
    if is_recording() {
        let guard = active_lock();
        if let Some(active) = guard.as_ref() {
            if active.meta.id == id {
                return Err("Cannot delete the session being recorded".to_string());
            }
        }
    }
    let dir = capture_root()?.join(id);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete session '{}': {}", id, e))
}

fn headers_to_vec(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                String::from_utf8_lossy(value.as_bytes()).to_string(),
            )
        })
        .collect()
}

fn encode_body(bytes: &[u8]) -> CaptureBody {
    let (slice, truncated) = if bytes.len() > MAX_BODY_BYTES {
        (&bytes[..MAX_BODY_BYTES], true)
    } else {
        (bytes, false)
    };

    let (encoding, data) = match std::str::from_utf8(slice) {
        Ok(text) => ("utf8", text.to_string()),
        Err(_) => {
            if truncated && std::str::from_utf8(bytes).is_ok() {
                ("utf8", String::from_utf8_lossy(slice).to_string())
            } else {
                ("base64", BASE64.encode(slice))
            }
        }
    };

    CaptureBody {
        encoding: encoding.to_string(),
        size: bytes.len() as u64,
        truncated,
        data,
    }
}

struct RequestMeta {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
}

impl RequestMeta {
    fn from_request(request: &reqwest::Request) -> Self {
        Self {
            method: request.method().to_string(),
            url: request.url().to_string(),
            headers: headers_to_vec(request.headers()),
            body: request
                .body()
                .and_then(|body| body.as_bytes())
                .map(|bytes| bytes.to_vec()),
        }
    }
}

struct Draft {
    meta: RequestMeta,
    status: Option<StatusCode>,
    headers: Option<HeaderMap>,
    body: Option<Vec<u8>>,
    duration_ms: u64,
    error: Option<String>,
    note: Option<String>,
}

impl Draft {
    fn record(self) {
        let entry = CaptureEntry {
            index: 0,
            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
            method: self.meta.method,
            url: self.meta.url,
            request_headers: self.meta.headers,
            request_body: self.meta.body.as_deref().map(encode_body),
            status: self.status.map(|status| status.as_u16()),
            response_headers: self.headers.as_ref().map(headers_to_vec),
            response_body: self.body.as_deref().map(encode_body),
            duration_ms: self.duration_ms,
            error: self.error,
            note: self.note,
        };
        write_entry(entry);
    }
}

fn write_entry(mut entry: CaptureEntry) {
    if !is_recording() {
        return;
    }
    let mut guard = active_lock();
    let Some(session) = guard.as_mut() else {
        return;
    };

    session.meta.count += 1;
    entry.index = session.meta.count;

    let line = match serde_json::to_string(&entry) {
        Ok(line) => line,
        Err(e) => {
            log_warn!("[capture] failed to serialize entry: {}", e);
            return;
        }
    };

    let written = writeln!(session.writer, "{}", line).and_then(|_| session.writer.flush());
    match written {
        Ok(()) => {
            session.meta.size_bytes += line.len() as u64 + 1;
        }
        Err(e) => {
            log_warn!("[capture] failed to write entry: {}", e);
            RECORDING.store(false, Ordering::Relaxed);
        }
    }
}

fn rebuild_response(status: StatusCode, headers: HeaderMap, body: Bytes) -> Response {
    let mut http_response = http::Response::new(body);
    *http_response.status_mut() = status;
    *http_response.headers_mut() = headers;
    http_response.into()
}

pub async fn send(client: &Client, builder: RequestBuilder) -> Result<Response, reqwest::Error> {
    let recording = is_recording();
    let started = Instant::now();
    let request = builder.build()?;
    let meta = recording.then(|| RequestMeta::from_request(&request));
    let result = client.execute(request).await;

    let Some(meta) = meta else {
        return result;
    };
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(response) => {
            let status = response.status();
            let headers = response.headers().clone();
            match response.bytes().await {
                Ok(body) => {
                    Draft {
                        meta,
                        status: Some(status),
                        headers: Some(headers.clone()),
                        body: Some(body.to_vec()),
                        duration_ms,
                        error: None,
                        note: None,
                    }
                    .record();
                    Ok(rebuild_response(status, headers, body))
                }
                Err(err) => {
                    Draft {
                        meta,
                        status: Some(status),
                        headers: Some(headers),
                        body: None,
                        duration_ms,
                        error: Some(err.to_string()),
                        note: Some("response body could not be read".to_string()),
                    }
                    .record();
                    Err(err)
                }
            }
        }
        Err(err) => {
            Draft {
                meta,
                status: None,
                headers: None,
                body: None,
                duration_ms,
                error: Some(err.to_string()),
                note: None,
            }
            .record();
            Err(err)
        }
    }
}

pub async fn send_stream(
    client: &Client,
    builder: RequestBuilder,
) -> Result<Response, reqwest::Error> {
    let recording = is_recording();
    let started = Instant::now();
    let request = builder.build()?;
    let meta = recording.then(|| RequestMeta::from_request(&request));
    let result = client.execute(request).await;

    let Some(meta) = meta else {
        return result;
    };
    let duration_ms = started.elapsed().as_millis() as u64;

    match &result {
        Ok(response) => {
            Draft {
                meta,
                status: Some(response.status()),
                headers: Some(response.headers().clone()),
                body: None,
                duration_ms,
                error: None,
                note: Some("streaming response, body not recorded".to_string()),
            }
            .record();
        }
        Err(err) => {
            Draft {
                meta,
                status: None,
                headers: None,
                body: None,
                duration_ms,
                error: Some(err.to_string()),
                note: None,
            }
            .record();
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use reqwest::header::HeaderValue;

    use super::*;

    #[test]
    fn encode_body_keeps_text_and_encodes_binary() {
        let source = "hello 世界";
        let text = encode_body(source.as_bytes());
        assert_eq!(text.encoding, "utf8");
        assert_eq!(text.data, source);
        assert_eq!(text.size, source.len() as u64);
        assert!(!text.truncated);

        let binary = encode_body(&[0xff, 0xfe, 0x00, 0x01]);
        assert_eq!(binary.encoding, "base64");
        assert_eq!(binary.size, 4);
        assert!(!binary.truncated);

        let empty = encode_body(b"");
        assert_eq!(empty.encoding, "utf8");
        assert_eq!(empty.data, "");
        assert_eq!(empty.size, 0);
    }

    #[test]
    fn session_id_validation_blocks_path_traversal() {
        assert!(valid_id("20261001-120000-abcdef12"));
        assert!(!valid_id("../escape"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn headers_are_converted_to_pairs() {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.append("set-cookie", HeaderValue::from_static("a=1"));
        headers.append("set-cookie", HeaderValue::from_static("b=2"));

        let pairs = headers_to_vec(&headers);
        assert!(pairs.contains(&("content-type".to_string(), "application/json".to_string())));
        assert_eq!(
            pairs
                .iter()
                .filter(|(name, _)| name == "set-cookie")
                .count(),
            2
        );
    }
}
