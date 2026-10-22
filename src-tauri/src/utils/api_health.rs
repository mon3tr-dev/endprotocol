use chrono::Local;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::utils::AppError;

/// 连续失败达到该次数后暂停 API 请求。
const BLOCK_THRESHOLD: u32 = 5;
/// 签名类错误更容易由本地时间偏差导致，阈值更低。
const SIGNATURE_BLOCK_THRESHOLD: u32 = 3;
/// 服务器时间与本地时间偏差超过该值时，直接判定为时钟异常。
pub const CLOCK_SKEW_THRESHOLD_SECONDS: i64 = 180;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static BLOCKED: AtomicBool = AtomicBool::new(false);
static STATE: OnceLock<Mutex<ApiHealthSnapshot>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFailureKind {
    ClockSkew,
    Signature,
    Auth,
    Network,
    Server,
    Parse,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct ApiHealthSnapshot {
    pub blocked: bool,
    pub consecutive_failures: u32,
    pub kind: Option<ApiFailureKind>,
    pub message: Option<String>,
    pub clock_skew_seconds: Option<i64>,
    pub last_failure_at: Option<String>,
}

impl Default for ApiHealthSnapshot {
    fn default() -> Self {
        Self {
            blocked: false,
            consecutive_failures: 0,
            kind: None,
            message: None,
            clock_skew_seconds: None,
            last_failure_at: None,
        }
    }
}

fn state() -> &'static Mutex<ApiHealthSnapshot> {
    STATE.get_or_init(|| Mutex::new(ApiHealthSnapshot::default()))
}

/// 初始化事件通道。未初始化时仍然会记录状态，前端可通过轮询发现。
pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    let _ = state();
}

/// 每次真实 API 请求前调用。被暂停时立即返回错误，避免持续请求/卡住。
pub fn ensure_available() -> Result<(), AppError> {
    if !BLOCKED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let snapshot = snapshot();
    let detail = snapshot
        .message
        .unwrap_or_else(|| "Repeated API failures detected".to_string());
    Err(AppError::AuthError {
        message: format!(
            "API requests are paused after {} consecutive failures: {}",
            snapshot.consecutive_failures, detail
        ),
    })
}

pub fn record_success() {
    if BLOCKED.load(Ordering::SeqCst) {
        return;
    }
    if let Ok(mut state) = state().lock() {
        *state = ApiHealthSnapshot::default();
    }
}

pub fn record_failure(kind: ApiFailureKind, message: &str, clock_skew_seconds: Option<i64>) {
    if BLOCKED.load(Ordering::SeqCst) {
        return;
    }

    let (should_block, snapshot) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        state.consecutive_failures += 1;
        state.kind = Some(kind);
        state.message = Some(message.to_string());
        state.clock_skew_seconds = clock_skew_seconds;
        state.last_failure_at = Some(Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string());

        let confirmed_clock_skew = matches!(kind, ApiFailureKind::ClockSkew)
            && clock_skew_seconds
                .map(|skew| skew.abs() >= CLOCK_SKEW_THRESHOLD_SECONDS)
                .unwrap_or(false);
        let threshold = if matches!(kind, ApiFailureKind::ClockSkew | ApiFailureKind::Signature) {
            SIGNATURE_BLOCK_THRESHOLD
        } else {
            BLOCK_THRESHOLD
        };
        let should_block = confirmed_clock_skew || state.consecutive_failures >= threshold;
        if should_block {
            state.blocked = true;
            BLOCKED.store(true, Ordering::SeqCst);
        }
        (should_block, state.clone())
    };

    if should_block {
        if let Some(logger) = crate::utils::logger::try_get_logger() {
            logger.error_with_module(
                "api_health",
                &format!(
                    "API requests paused after {} failures (kind={:?}, skew={:?}): {}",
                    snapshot.consecutive_failures,
                    snapshot.kind,
                    snapshot.clock_skew_seconds,
                    message
                ),
            );
        }
        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit("app:api-health", &snapshot);
        }
    } else if let Some(logger) = crate::utils::logger::try_get_logger() {
        logger.warn_with_module(
            "api_health",
            &format!(
                "API failure {} (kind={:?}, skew={:?}): {}",
                snapshot.consecutive_failures,
                snapshot.kind,
                snapshot.clock_skew_seconds,
                message
            ),
        );
    }
}

pub fn reset() {
    let was_blocked = BLOCKED.swap(false, Ordering::SeqCst);
    if let Ok(mut state) = state().lock() {
        *state = ApiHealthSnapshot::default();
    }
    if was_blocked {
        if let Some(logger) = crate::utils::logger::try_get_logger() {
            logger.warn_with_module("api_health", "API request guard reset by user");
        }
    }
}

pub fn snapshot() -> ApiHealthSnapshot {
    state()
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

pub fn classify_error(
    code: i64,
    message: &str,
    clock_skew_seconds: Option<i64>,
) -> ApiFailureKind {
    let lower = message.to_lowercase();
    let confirmed_clock_skew = clock_skew_seconds
        .map(|skew| skew.abs() >= CLOCK_SKEW_THRESHOLD_SECONDS)
        .unwrap_or(false);

    if confirmed_clock_skew {
        return ApiFailureKind::ClockSkew;
    }
    if lower.contains("sign")
        || lower.contains("timestamp")
        || lower.contains("expire")
        || lower.contains("过期")
        || lower.contains("签名")
        || lower.contains("时间")
    {
        return ApiFailureKind::Signature;
    }
    if code == 401
        || code == 403
        || code == 10001
        || code == 10002
        || lower.contains("cred")
        || lower.contains("token")
        || lower.contains("auth")
        || lower.contains("登录")
        || lower.contains("认证")
    {
        return ApiFailureKind::Auth;
    }
    if code >= 500 || code == -1 {
        return ApiFailureKind::Server;
    }
    ApiFailureKind::Unknown
}
