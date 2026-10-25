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
