use thiserror::Error;

/// 应用错误类型
#[derive(Debug, Error)]
pub enum AppError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("JSON serialization failed: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Authentication failed: {message}")]
    AuthError { message: String },

    #[error("Configuration error: {message}")]
    ConfigError { message: String },

    #[error("Network error: {message}")]
    NetworkError { message: String },

    #[error("Invalid input: {message}")]
    ValidationError { message: String },

    #[error("API error (code={code}): {message}")]
    ApiError { code: i32, message: String },
}

impl AppError {
    /// 是否为「会话/凭证对本次请求失效」的错误（森空岛 `code=10000 请求异常`）。
    ///
    /// 这类错误与网络无关：同一条 cred 在 `/api/v1/user/check` 上仍然是有效的，
    /// 只有数据接口拒绝。因此它必须触发**换 cred** 而不是重试或提示网络异常。
    ///
    /// 判定统一走 [`crate::utils::api_health::is_session_invalid`]，避免各处用
    /// `contains("API error")` 这种宽泛匹配（那会把「请勿重复签到」也算成故障）。
    pub fn is_session_invalid(&self) -> bool {
        match self {
            AppError::AuthError { message } => message.contains(SESSION_INVALID_MARKER),
            AppError::ApiError { code, message } => {
                crate::utils::api_health::is_session_invalid(*code as i64, message)
            }
            AppError::HttpError(error) => matches!(
                error.status(),
                Some(reqwest::StatusCode::UNAUTHORIZED) | Some(reqwest::StatusCode::FORBIDDEN)
            ),
            _ => false,
        }
    }
}

/// `call_skland_api` 在会话失效时写入错误文案的固定标记。
///
/// 用标记而不是解析整段文案：文案里带着服务端原文（中文/乱码/版本差异都可能），
/// 而标记由我们自己拼接，最稳。
pub const SESSION_INVALID_MARKER: &str = "SESSION_INVALID";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_is_detected() {
        let error = AppError::AuthError {
            message: format!("{SESSION_INVALID_MARKER} API error: code=10000, message=请求异常"),
        };
        assert!(error.is_session_invalid());
    }

    /// 普通鉴权失败（如 hytoken 过期、签名错误）不应被判成「会话失效」——
    /// 前者需要重新登录、后者需要校准时间，修复路径完全不同。
    #[test]
    fn other_auth_errors_are_not_session_invalid() {
        for message in [
            "OAuth grant failed: token expired",
            "Generate cred failed: bad code",
            "sign mismatch",
            "API error: code=10001, message=请勿重复签到！",
        ] {
            let error = AppError::AuthError {
                message: message.to_string(),
            };
            assert!(
                !error.is_session_invalid(),
                "expected {message} not to be session-invalid"
            );
        }
    }

    /// `ApiError` 走 `api_health::is_session_invalid` 的同一判据。
    #[test]
    fn api_error_variant_is_checked_by_code() {
        assert!(AppError::ApiError {
            code: 10000,
            message: "请求异常".to_string(),
        }
        .is_session_invalid());
        assert!(!AppError::ApiError {
            code: 10001,
            message: "请勿重复签到！".to_string(),
        }
        .is_session_invalid());
    }

    #[test]
    fn non_auth_variants_are_not_session_invalid() {
        assert!(!AppError::ConfigError {
            message: "Lock failed".to_string(),
        }
        .is_session_invalid());
        assert!(!AppError::IoError(std::io::Error::other("boom")).is_session_invalid());
    }
}
