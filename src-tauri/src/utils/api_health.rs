use chrono::Local;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::utils::AppError;

/// 连续失败达到该次数后暂停 API 请求。
const BLOCK_THRESHOLD: u32 = 5;
/// 签名类错误更容易由本地时间偏差导致，阈值更低。
const SIGNATURE_BLOCK_THRESHOLD: u32 = 3;
/// 数美设备指纹接口连续失败阈值：达到后判定为设备指纹环境异常，
/// 需要用户重启电脑并同步时区后重试。
const DEVICE_FINGERPRINT_BLOCK_THRESHOLD: u32 = 3;
/// 服务器时间与本地时间偏差超过该值时，直接判定为时钟异常。
pub const CLOCK_SKEW_THRESHOLD_SECONDS: i64 = 180;
/// 熔断冷却时间：到点后自动放行一次探测请求（半开恢复）。
///
/// 熔断原本是**永久闩锁**，只能靠用户手动「重新登录 / 重试」解除。但森空岛
/// 的失败常常是**凭证在服务端被轮换**导致的会话级 10000，本机稍后重试即可成功
/// —— 没有冷却期就等于把一次瞬时故障变成了「必须重启登录」的死状态。
const BLOCK_COOLDOWN_SECS: u64 = 120;
/// 森空岛签到接口的「今天已经签过」业务码（响应文案通常为 `请勿重复签到！`）。
const ATTENDANCE_ALREADY_SIGNED_CODE: i64 = 10001;
/// 森空岛「数据接口拒绝当前会话」的业务码（文案通常为 `请求异常`）。
///
/// 它不是网络/服务端故障：`/api/v1/user/check` 在完全相同的时刻返回成功，
/// 而同一条 cred 走数据接口就 10000 —— 说明 cred 对数据域已失效，唯一解法是
/// 用 hytoken 换一把新 cred。归到 [`ApiFailureKind::Auth`] 才能驱动正确的修复
/// 路径（刷新凭证），而不是白白重试或提示用户检查网络。
const SESSION_INVALID_CODE: i64 = 10000;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static BLOCKED: AtomicBool = AtomicBool::new(false);
/// 熔断到期时间（Unix 毫秒）。`0` 表示没有设置冷却。
static BLOCKED_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
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
    /// 数美设备指纹接口（fp-it.portal101.cn）连续失败：通常由本机时间/时区异常
    /// 或设备指纹环境被拒绝导致，前端会提示重启电脑并同步时区。
    DeviceFingerprint,
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

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 初始化事件通道。未初始化时仍然会记录状态，前端可通过轮询发现。
pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    let _ = state();
}

/// 当前是否处于熔断中（供调用方决定是否跳过必然被拒的探测请求）。
pub fn is_blocked() -> bool {
    BLOCKED.load(Ordering::SeqCst)
}

/// 每次真实 API 请求前调用。被暂停时立即返回错误，避免持续请求/卡住。
///
/// 冷却时间到点后自动解除熔断并放行本次请求（半开）：请求成功就完全恢复，
/// 再次失败则重新熔断并重新计时。
pub fn ensure_available() -> Result<(), AppError> {
    if !BLOCKED.load(Ordering::SeqCst) {
        return Ok(());
    }

    let until = BLOCKED_UNTIL_MS.load(Ordering::SeqCst);
    if until != 0 && now_millis() >= until {
        clear_block();
        if let Some(logger) = crate::utils::logger::try_get_logger() {
            logger.warn_with_module(
                "api_health",
                &format!(
                    "block cooldown elapsed ({}s), allowing a probe request",
                    BLOCK_COOLDOWN_SECS
                ),
            );
        }
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

/// 凭证修复成功后调用：解除熔断，让后续重试可以真正发出。
///
/// 修复路径（用 hytoken 换新 cred）是熔断的「解药」而不是「病因」：它既不依赖
/// dId/签名，也不依赖那把已经失效的 cred，因此**不该**被熔断挡住。若挡住，
/// 恢复链会被自己锁死 —— 这正是「必须手动重新登录才能恢复」的根因。
pub fn clear_after_repair(reason: &str) {
    let was_blocked = BLOCKED.swap(false, Ordering::SeqCst);
    BLOCKED_UNTIL_MS.store(0, Ordering::SeqCst);
    if let Ok(mut state) = state().lock() {
        *state = ApiHealthSnapshot::default();
    }
    if was_blocked {
        if let Some(logger) = crate::utils::logger::try_get_logger() {
            logger.warn_with_module(
                "api_health",
                &format!("API request guard released after repair: {reason}"),
            );
        }
    }
}

fn clear_block() {
    BLOCKED.store(false, Ordering::SeqCst);
    BLOCKED_UNTIL_MS.store(0, Ordering::SeqCst);
    if let Ok(mut state) = state().lock() {
        *state = ApiHealthSnapshot::default();
    }
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
        let threshold = match kind {
            ApiFailureKind::ClockSkew | ApiFailureKind::Signature => SIGNATURE_BLOCK_THRESHOLD,
            ApiFailureKind::DeviceFingerprint => DEVICE_FINGERPRINT_BLOCK_THRESHOLD,
            _ => BLOCK_THRESHOLD,
        };
        let should_block = confirmed_clock_skew || state.consecutive_failures >= threshold;
        if should_block {
            state.blocked = true;
            BLOCKED.store(true, Ordering::SeqCst);
            BLOCKED_UNTIL_MS.store(
                now_millis() + BLOCK_COOLDOWN_SECS * 1000,
                Ordering::SeqCst,
            );
        }
        (should_block, state.clone())
    };

    if should_block {
        if let Some(logger) = crate::utils::logger::try_get_logger() {
            logger.error_with_module(
                "api_health",
                &format!(
                    "API requests paused after {} failures (kind={:?}, skew={:?}, cooldown={}s): {}",
                    snapshot.consecutive_failures,
                    snapshot.kind,
                    snapshot.clock_skew_seconds,
                    BLOCK_COOLDOWN_SECS,
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
    BLOCKED_UNTIL_MS.store(0, Ordering::SeqCst);
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

/// 判断是否为「目标状态已达成」这类可预期的业务结果（幂等成功）。
///
/// 客户端无法提前知道角色当天是否已签到，因此重复签到时服务端会返回
/// `code=10001, message=请勿重复签到！`。这是正常的业务分支而不是 API 故障：
/// 不得计入连续失败、不得重试，也不应触发前端告警/熔断。
pub fn is_benign_business_error(code: i64, message: &str) -> bool {
    if code == 0 {
        return false;
    }
    let lower = message.to_lowercase();
    lower.contains("重复签到")
        || lower.contains("已签到")
        || lower.contains("已经签到")
        || lower.contains("already signed")
        || (code == ATTENDANCE_ALREADY_SIGNED_CODE && lower.contains("签到"))
}

/// 是否为「会话/凭证已失效」类业务结果（`code=10000 请求异常`）。
///
/// 判据必须同时看业务码与文案：签到等幂等结果（`10001 请勿重复签到`）不走这里，
/// 已由 [`is_benign_business_error`] 提前拦下。
pub fn is_session_invalid(code: i64, message: &str) -> bool {
    if code == 0 {
        return false;
    }
    if is_benign_business_error(code, message) {
        return false;
    }
    code == SESSION_INVALID_CODE
        || message.contains("请求异常")
        || message.to_lowercase().contains("unauthorized")
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
    // 会话失效必须在通用关键字之前判定：`请求异常` 不含 sign/auth 字样，
    // 落到下面的兜底会被误判成 Server，进而把「换一把 cred 就好」的问题
    // 报成网络故障。
    if is_session_invalid(code, message) {
        return ApiFailureKind::Auth;
    }
    if lower.contains("数美") || lower.contains("deviceprofile") || lower.contains("device_id") {
        return ApiFailureKind::DeviceFingerprint;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实抓包里的会话失效响应：`HTTP 401` + `code=10000 请求异常`。
    #[test]
    fn session_invalid_is_detected() {
        assert!(is_session_invalid(10000, "请求异常"));
        assert!(is_session_invalid(10000, "unknown"));
    }

    /// 会话失效**必须**归为 Auth（→ 走换 cred），不能落到 Server（→ 无脑重试）。
    ///
    /// 回归：旧代码 `请求异常` 不含 sign/auth 关键字，被兜底成 `Server`，
    /// 于是「换一把 cred 就好」的问题被当成网络故障反复重试，直到熔断。
    #[test]
    fn session_invalid_classifies_as_auth_not_server() {
        assert_eq!(
            classify_error(10000, "请求异常", Some(0)),
            ApiFailureKind::Auth
        );
        assert_eq!(
            classify_error(10000, "请求异常", None),
            ApiFailureKind::Auth
        );
    }

    /// 「请勿重复签到」是幂等成功，绝不能被当成会话失效。
    ///
    /// 回归：自动签到每轮都会命中它；若算作会话失效，就会每次都触发一次
    /// 换 cred（把用户凭据反复轮换），并让 `is_benign_business_error` 形同虚设。
    #[test]
    fn benign_already_signed_is_not_session_invalid() {
        assert!(is_benign_business_error(10001, "请勿重复签到！"));
        assert!(!is_session_invalid(10001, "请勿重复签到！"));
        assert!(!is_session_invalid(10001, "已签到"));
    }

    /// `code=0` 永远不是失败，也不是会话失效。
    #[test]
    fn success_is_never_a_failure() {
        assert!(!is_benign_business_error(0, "OK"));
        assert!(!is_session_invalid(0, "OK"));
    }

    /// 时钟偏差优先于一切：它的解药是校准时间，不是换 cred。
    #[test]
    fn clock_skew_takes_precedence() {
        assert_eq!(
            classify_error(10000, "请求异常", Some(CLOCK_SKEW_THRESHOLD_SECONDS + 60)),
            ApiFailureKind::ClockSkew
        );
    }

    /// 设备指纹类错误不能被会话失效吞掉（否则会给出错误的修复指引）。
    #[test]
    fn device_fingerprint_error_is_not_session_invalid() {
        assert_eq!(
            classify_error(-1, "数美设备指纹接口请求失败", None),
            ApiFailureKind::DeviceFingerprint
        );
        assert!(!is_session_invalid(-1, "数美设备指纹接口请求失败"));
    }
}
