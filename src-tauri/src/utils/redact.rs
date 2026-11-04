//! 敏感信息脱敏工具。
//!
//! 用于日志输出：在写入日志文件前把 URL query 中的令牌类参数替换为掩码，
//! 避免 `cred` / `token` / `u8token` 等凭证落盘到 `logs/app-*.log`。
//!
//! 关联：机密字段登记表见 `docs/secure_storage.md`。

/// 需要脱敏的 query 参数名（小写比较）。
///
/// 覆盖：森空岛 `cred`/`token`/`u8token`、鹰角 `hytoken`/`u8_token`/`token_by_*`、
/// 抽卡接口 `token`、通用 `sign`/`password`/`secret`/`key`。
const SENSITIVE_QUERY_KEYS: &[&str] = &[
    "cred",
    "token",
    "u8token",
    "u8_token",
    "hytoken",
    "hy_token",
    "sign",
    "password",
    "passwd",
    "secret",
    "access_token",
    "refresh_token",
    "id_token",
    "session",
    "sessionid",
    "code",
    "device_token",
    "devicetoken",
    "phone",
    "mobile",
];

/// 判断某个 query 参数名是否需要脱敏。
fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_QUERY_KEYS.iter().any(|k| lower == *k)
}

/// 生成掩码文本：保留首尾各 4 个字符，中间用 `***` 代替；过短的直接整体隐藏。
fn mask(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        "***".to_string()
    } else {
        format!(
            "{}***{}",
            chars[..4].iter().collect::<String>(),
            chars[chars.len() - 4..].iter().collect::<String>()
        )
    }
}

/// 对 URL 的 query 参数做脱敏，返回可安全写入日志的字符串。
///
/// 非 URL 或无 query 的输入原样返回（仍会剥掉 fragment 中的潜在令牌）。
///
/// ```
/// # use endprotocol_lib::utils::redact::redact_url;
/// let out = redact_url("https://x.dev/api?token=abcdefghijkl&server_id=1");
/// assert!(!out.contains("abcdefghijkl"));
/// assert!(out.contains("server_id=1"));
/// ```
pub fn redact_url(url: &str) -> String {
    let (base, fragment) = match url.split_once('#') {
        Some((b, f)) => (b, Some(f)),
        None => (url, None),
    };

    let (path, query) = match base.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (base, None),
    };

    let Some(query) = query else {
        return match fragment {
            Some(f) => format!("{}#{}", path, mask(f)),
            None => path.to_string(),
        };
    };

    let mut parts: Vec<String> = Vec::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        match pair.split_once('=') {
            Some((k, v)) if is_sensitive_key(k) => {
                parts.push(format!("{}={}", k, mask(v)));
            }
            _ => parts.push(pair.to_string()),
        }
    }

    let mut out = path.to_string();
    if !parts.is_empty() {
        out.push('?');
        out.push_str(&parts.join("&"));
    }
    if let Some(f) = fragment {
        out.push('#');
        out.push_str(&mask(f));
    }
    out
}

/// 对可能包含令牌的普通文本做脱敏（如 `token=xxx` 或 `"token": "xxx"` 形态）。
///
/// 命中敏感参数名时替换整个值（保留原有的引号包裹形式）。
///
/// 实现方式：扫描标识符（`[A-Za-z_][A-Za-z0-9_-]*`），确认其后（允许引号与空白）
/// 是 `=` 或 `:`，再把对应的值替换为掩码。
pub fn redact_text(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;

    while i < bytes.len() {
        // 定位标识符起点
        let c = bytes[i] as char;
        if !(c.is_ascii_alphabetic() || c == '_') {
            out.push(c);
            i += 1;
            continue;
        }

        let word_start = i;
        while i < bytes.len() {
            let ch = bytes[i] as char;
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                i += 1;
            } else {
                break;
            }
        }
        let word = &text[word_start..i];

        // 标识符后允许出现闭合引号与空白，然后应是 `=` 或 `:`
        let mut j = i;
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            j += 1;
        }
        if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
            j += 1;
            while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                j += 1;
            }
        }

        if j >= bytes.len() || (bytes[j] != b'=' && bytes[j] != b':') || !is_sensitive_key(word) {
            // 非敏感标识符：原样输出（含其后跳过的空白）
            out.push_str(word);
            while i < j {
                out.push(bytes[i] as char);
                i += 1;
            }
            continue;
        }

        // 输出标识符与其后的空白/引号
        out.push_str(word);
        while i < j {
            out.push(bytes[i] as char);
            i += 1;
        }

        // 分隔符
        out.push(bytes[j] as char);
        j += 1;

        // 分隔符与值之间的空白
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            out.push(bytes[j] as char);
            j += 1;
        }

        // 值：引号包裹或裸串
        if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
            let quote = bytes[j];
            let value_start = j + 1;
            let mut end = value_start;
            while end < bytes.len() && bytes[end] != quote {
                end += 1;
            }
            out.push(quote as char);
            out.push_str(&mask(&text[value_start..end]));
            if end < bytes.len() {
                out.push(quote as char);
                j = end + 1;
            } else {
                j = end;
            }
        } else {
            let value_start = j;
            while j < bytes.len() {
                let ch = bytes[j] as char;
                if ch.is_whitespace() || ch == '&' || ch == ',' || ch == '}' {
                    break;
                }
                j += 1;
            }
            out.push_str(&mask(&text[value_start..j]));
        }

        i = j;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_token_query_param() {
        let out = redact_url("https://a.dev/api/record/char?lang=zh-cn&token=SECRETVALUE123&server_id=1");
        assert!(!out.contains("SECRETVALUE123"));
        assert!(out.contains("token=SECR***E123"));
        assert!(out.contains("server_id=1"));
        assert!(out.contains("lang=zh-cn"));
    }

    #[test]
    fn keeps_non_sensitive_params() {
        let url = "https://a.dev/api?server_id=1&lang=zh-cn";
        assert_eq!(redact_url(url), url);
    }

    #[test]
    fn handles_url_without_query() {
        assert_eq!(redact_url("https://a.dev/api"), "https://a.dev/api");
    }

    #[test]
    fn masks_short_values_entirely() {
        let out = redact_url("https://a.dev/api?token=abc");
        assert_eq!(out, "https://a.dev/api?token=***");
    }

    #[test]
    fn redacts_fragment() {
        let out = redact_url("https://a.dev/cb#access_token=SECRETVALUE999");
        assert!(!out.contains("SECRETVALUE999"));
    }

    #[test]
    fn redact_text_handles_key_value() {
        let out = redact_text("u8_token=abcdefghijklmnop and lang=zh-cn");
        assert!(!out.contains("abcdefghijklmnop"));
        assert!(out.contains("lang=zh-cn"));
    }

    #[test]
    fn redact_text_handles_json_shape() {
        let head = "{\"token";
        let key = head
            .rsplit(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
            .next()
            .unwrap_or("");
        println!("KEY = {:?}", key);
        let out = redact_text("{\"token\": \"supersecretvalue\"}");
        println!("OUT = {:?}", out);
        assert!(!out.contains("supersecretvalue"));
    }
}
